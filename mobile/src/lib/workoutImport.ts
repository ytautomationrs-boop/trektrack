import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { API_BASE_URL } from "../api/config";
import { getToken } from "../lib/tokenStorage";
import type { ApiError } from "../api/http";
import type { RaceSampleIngestResult } from "../api/raceTypes";
import type { CheckInIngestResult } from "../api/challengeTypes";

/**
 * Uploading a workout file exported from a watch or training app.
 *
 * This is the pilot's evidence path — a browser has no health store, and
 * exporting a file is a smaller ask than connecting a third-party account.
 * The backend parses GPX, TCX and FIT (see
 * backend/src/modules/imports/workoutFile.ts) and feeds the result into the
 * same ingestion pipeline HealthKit samples use.
 *
 * Not routed through api/http.ts: that helper sets a JSON content type and
 * serialises a body, and a multipart upload needs the browser to set its own
 * boundary. It still has to reproduce http.ts's timeout and error shape, so
 * callers can handle failures the same way everywhere — which is what the
 * duplication below is for.
 */

/** Longer than the usual request timeout: a large FIT file over a phone connection is a real upload. */
const UPLOAD_TIMEOUT_MS = 60_000;

export type ImportedWorkout = {
  format: "gpx" | "tcx" | "fit";
  metricKey: string;
  distanceMeters: number;
  startTime: string;
  source: string;
};

export type ImportResult = RaceSampleIngestResult & { imported: ImportedWorkout };
export type ChallengeImportResult = CheckInIngestResult & { imported: ImportedWorkout & { localDate: string } };

/** What the file picker offers. Kept in step with detectFormat() on the backend. */
export const ACCEPTED_EXTENSIONS = [".gpx", ".tcx", ".fit"];

export type PickedFile = { name: string; blob: Blob };

/**
 * Opens the platform's file picker.
 *
 * Returns null when the user backs out, which is an ordinary outcome and not
 * an error — callers should do nothing rather than report a failure.
 */
export async function pickWorkoutFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Watches and training apps hand out these with assorted MIME types (or
    // none at all), so the filter is by extension. "*/*" keeps a file the
    // picker doesn't recognise from being greyed out; the backend checks the
    // bytes regardless of what the file is called.
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const name = asset.name ?? "activity";
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    const err: ApiError = new Error(`Streak reads ${ACCEPTED_EXTENSIONS.join(", ")} files — that one is ${name.split(".").pop() ?? "an unknown type"}.`);
    err.code = "unsupported_format";
    throw err;
  }

  // Web hands back a real File (which is a Blob); native gives a file:// URI
  // that has to be read before it can be sent.
  if (Platform.OS === "web" && asset.file) return { name, blob: asset.file };

  const response = await fetch(asset.uri);
  return { name, blob: await response.blob() };
}

/** Uploads a picked file against one race entry. Throws an ApiError shaped like every other API failure. */
export function importWorkoutFile(raceEntryId: string, file: PickedFile): Promise<ImportResult> {
  return upload(`/race-entries/${raceEntryId}/import`, file);
}

/**
 * The StreakPot equivalent. The day it counts for is derived server-side
 * from when the activity happened, in the participant's timezone — the
 * client never names a date, or someone could move a workout onto whichever
 * day they still needed.
 */
export function importChallengeWorkout(participantId: string, file: PickedFile): Promise<ChallengeImportResult> {
  return upload(`/challenge-participants/${participantId}/import`, file);
}

async function upload<T>(path: string, file: PickedFile): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  const form = new FormData();
  form.append("file", file.blob, file.name);

  const token = await getToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      // Deliberately no Content-Type: it has to carry the multipart boundary,
      // and only the runtime knows what that is. Setting it by hand produces
      // a body the server cannot parse.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const wrapped: ApiError = new Error(
      aborted ? "That upload took too long. Check your connection and try again." : "Couldn't reach Streak. Check your connection and try again."
    );
    wrapped.isNetworkError = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = new Error(body.message ?? `Upload failed: ${res.status}`);
    err.code = body.error;
    err.status = res.status;
    throw err;
  }

  return res.json();
}
