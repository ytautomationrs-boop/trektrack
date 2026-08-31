import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { Decoder, Stream } from "@garmin/fitsdk";

/**
 * Parses a workout file exported from a watch or training app into the same
 * sample shape HealthKit and Strava produce, so it lands in the existing
 * ingestion path — validators, anomaly detection, evidence retention — with
 * nothing special-cased downstream.
 *
 * ## What this can and cannot cover
 *
 * A workout file describes an *activity*. Running, cycling and swimming are
 * activities and come through fine. **Steps are not** — they are a daily
 * total a phone accumulates, not something a watch writes a workout file
 * for — and neither is sleep. Those two metrics have no import path at all,
 * which is a fact the UI has to state rather than quietly scoring them zero.
 *
 * That is still wider than Strava was: Strava's sync covered running and
 * cycling only, and swimming is recorded by any pool-capable watch.
 *
 * ## Trust
 *
 * These files are supplied by the person being scored, so nothing here is
 * evidence in the way a HealthKit read is. It is checked for internal
 * consistency and for physical possibility, and anything past that is the
 * job of the anomaly rules and — during the pilot — the human who reviews a
 * payout before sending the EFT.
 */

export class WorkoutFileError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export type ParsedWorkout = {
  metricKey: "running" | "cycling" | "swimming";
  distanceMeters: number;
  startTime: Date;
  endTime: Date;
  /** What produced the file — a watch model, or the app that exported it. */
  sourceName: string;
  /** True when the file names a recording device, rather than only an app. */
  isWearableSourced: boolean;
  gpsRoute: Array<{ lat: number; lng: number; t: string }>;
  format: "gpx" | "tcx" | "fit";
  /** sha256 of the file bytes — the dedup handle, so re-uploading one file cannot score twice. */
  contentHash: string;
};

/**
 * Average speeds past which the activity did not happen on foot, a bike or in
 * a pool. Deliberately generous: these reject a car or a bad unit conversion,
 * not a fast athlete. Everything below them but still unusual is left to
 * runAnomalyDetection, which judges against the person's own history rather
 * than against a constant.
 */
const MAX_AVERAGE_KMH: Record<ParsedWorkout["metricKey"], number> = {
  // Marathon world record pace is ~20.9 km/h; a sprint touches 37 but never
  // as a whole-activity average.
  running: 32,
  // A pro time trial averages ~55. Sustained 80 is a motor.
  cycling: 80,
  // A 50m freestyle world record is ~8.6 km/h.
  swimming: 12,
};

/** Guards against a file whose clock says an activity lasted a fortnight. */
const MAX_DURATION_HOURS = 24;

const GPX_SPORT_HINTS: Array<[RegExp, ParsedWorkout["metricKey"]]> = [
  [/run|jog|trail/i, "running"],
  [/bike|cycl|ride|mtb/i, "cycling"],
  [/swim/i, "swimming"],
];

/** FIT's sport enum, as the SDK decodes it. */
const FIT_SPORT_MAP: Record<string, ParsedWorkout["metricKey"]> = {
  running: "running",
  cycling: "cycling",
  swimming: "swimming",
};

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function sportFromText(text: string | undefined, fallbackName: string): ParsedWorkout["metricKey"] | null {
  const haystack = `${text ?? ""} ${fallbackName}`;
  for (const [pattern, metric] of GPX_SPORT_HINTS) {
    if (pattern.test(haystack)) return metric;
  }
  return null;
}

// ── GPX ────────────────────────────────────────────────────────────────

function parseGpx(text: string, filename: string): Omit<ParsedWorkout, "format" | "contentHash"> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let doc: any;
  try {
    doc = parser.parse(text);
  } catch {
    throw new WorkoutFileError("unreadable_file", "That GPX file couldn't be read — it may be incomplete.");
  }

  const gpx = doc?.gpx;
  if (!gpx) throw new WorkoutFileError("not_a_workout", "That doesn't look like a GPX file.");

  const points: Array<{ lat: number; lng: number; t: string }> = [];
  for (const trk of asArray(gpx.trk)) {
    for (const seg of asArray(trk.trkseg)) {
      for (const pt of asArray(seg.trkpt)) {
        const lat = Number(pt?.["@_lat"]);
        const lng = Number(pt?.["@_lon"]);
        const time = pt?.time;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !time) continue;
        points.push({ lat, lng, t: new Date(time).toISOString() });
      }
    }
  }

  if (points.length < 2) {
    throw new WorkoutFileError("no_track_points", "That GPX file has no GPS track in it, so there's nothing to measure.");
  }

  // GPX carries no distance field — it is the sum of the track.
  let distanceMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev && cur) distanceMeters += haversineMeters(prev, cur);
  }

  const trkType = asArray(gpx.trk)[0]?.type;
  const metricKey = sportFromText(typeof trkType === "string" ? trkType : undefined, filename);
  if (!metricKey) {
    throw new WorkoutFileError(
      "unknown_sport",
      "We couldn't tell what sport that file is for. Export it again with the activity type set, or rename the file to include 'run', 'ride' or 'swim'."
    );
  }

  const creator = gpx?.["@_creator"];
  return {
    metricKey,
    distanceMeters,
    startTime: new Date(points[0]!.t),
    endTime: new Date(points[points.length - 1]!.t),
    sourceName: typeof creator === "string" && creator.trim() ? creator.trim() : "GPX file",
    isWearableSourced: typeof creator === "string" && creator.trim().length > 0,
    gpsRoute: points,
  };
}

// ── TCX ────────────────────────────────────────────────────────────────

function parseTcx(text: string, filename: string): Omit<ParsedWorkout, "format" | "contentHash"> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let doc: any;
  try {
    doc = parser.parse(text);
  } catch {
    throw new WorkoutFileError("unreadable_file", "That TCX file couldn't be read — it may be incomplete.");
  }

  const activity = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)[0];
  if (!activity) throw new WorkoutFileError("not_a_workout", "That doesn't look like a TCX file.");

  const laps = asArray(activity.Lap);
  if (laps.length === 0) throw new WorkoutFileError("no_track_points", "That TCX file has no recorded laps.");

  // Unlike GPX, TCX states the distance — trust the file's own total rather
  // than re-deriving it, which is what any other reader of this file would do.
  let distanceMeters = 0;
  for (const lap of laps) distanceMeters += Number(lap?.DistanceMeters) || 0;

  const points: Array<{ lat: number; lng: number; t: string }> = [];
  for (const lap of laps) {
    for (const tp of asArray(lap?.Track?.Trackpoint ?? asArray(lap?.Track).flatMap((t: any) => asArray(t?.Trackpoint)))) {
      const lat = Number(tp?.Position?.LatitudeDegrees);
      const lng = Number(tp?.Position?.LongitudeDegrees);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !tp?.Time) continue;
      points.push({ lat, lng, t: new Date(tp.Time).toISOString() });
    }
  }

  const sport = activity?.["@_Sport"];
  const metricKey = sportFromText(typeof sport === "string" ? sport : undefined, filename);
  if (!metricKey) {
    throw new WorkoutFileError("unknown_sport", "We couldn't tell what sport that file is for — it has no activity type set.");
  }

  const startIso = activity?.Id ?? laps[0]?.["@_StartTime"];
  const startTime = new Date(startIso);
  if (Number.isNaN(startTime.getTime())) {
    throw new WorkoutFileError("unreadable_file", "That TCX file has no readable start time.");
  }
  const totalSeconds = laps.reduce((sum: number, lap: any) => sum + (Number(lap?.TotalTimeSeconds) || 0), 0);

  const creator = activity?.Creator?.Name ?? doc?.TrainingCenterDatabase?.Author?.Name;
  return {
    metricKey,
    distanceMeters,
    startTime,
    endTime: new Date(startTime.getTime() + totalSeconds * 1000),
    sourceName: typeof creator === "string" && creator.trim() ? creator.trim() : "TCX file",
    isWearableSourced: typeof activity?.Creator?.Name === "string",
    gpsRoute: points,
  };
}

// ── FIT ────────────────────────────────────────────────────────────────

function parseFit(buffer: Buffer, filename: string): Omit<ParsedWorkout, "format" | "contentHash"> {
  let messages: any;
  try {
    const stream = Stream.fromBuffer(buffer);
    const decoder = new Decoder(stream);
    if (!decoder.isFIT() || !decoder.checkIntegrity()) {
      throw new WorkoutFileError("unreadable_file", "That FIT file failed its own integrity check — try exporting it again.");
    }
    const result = decoder.read();
    if (result.errors?.length) {
      // Partial decodes are common and usually still usable; only bail when
      // nothing came out.
      if (!result.messages) throw new WorkoutFileError("unreadable_file", "That FIT file couldn't be read.");
    }
    messages = result.messages;
  } catch (err) {
    if (err instanceof WorkoutFileError) throw err;
    throw new WorkoutFileError("unreadable_file", "That FIT file couldn't be read — it may be incomplete.");
  }

  const session = asArray(messages?.sessionMesgs)[0];
  if (!session) throw new WorkoutFileError("not_a_workout", "That FIT file has no activity session in it.");

  const sportRaw = typeof session.sport === "string" ? session.sport.toLowerCase() : "";
  const metricKey = FIT_SPORT_MAP[sportRaw] ?? sportFromText(sportRaw, filename);
  if (!metricKey) {
    throw new WorkoutFileError("unknown_sport", `We don't run competitions for "${sportRaw || "that sport"}" yet.`);
  }

  const distanceMeters = Number(session.totalDistance) || 0;
  const startTime = new Date(session.startTime);
  if (Number.isNaN(startTime.getTime())) {
    throw new WorkoutFileError("unreadable_file", "That FIT file has no readable start time.");
  }
  const elapsedSeconds = Number(session.totalElapsedTime) || Number(session.totalTimerTime) || 0;

  const points: Array<{ lat: number; lng: number; t: string }> = [];
  // FIT stores position in semicircles, not degrees.
  const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;
  for (const record of asArray(messages?.recordMesgs)) {
    const lat = Number(record?.positionLat);
    const lng = Number(record?.positionLong);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !record?.timestamp) continue;
    points.push({
      lat: lat * SEMICIRCLE_TO_DEG,
      lng: lng * SEMICIRCLE_TO_DEG,
      t: new Date(record.timestamp).toISOString(),
    });
  }

  const device = asArray(messages?.deviceInfoMesgs).find((d: any) => d?.manufacturer || d?.garminProduct);
  const sourceName = device?.garminProduct ?? device?.manufacturer ?? "FIT file";

  return {
    metricKey,
    distanceMeters,
    startTime,
    endTime: new Date(startTime.getTime() + elapsedSeconds * 1000),
    sourceName: String(sourceName),
    isWearableSourced: !!device,
    gpsRoute: points,
  };
}

// ── Entry point ────────────────────────────────────────────────────────

function detectFormat(buffer: Buffer, filename: string): ParsedWorkout["format"] {
  // FIT's header carries the ASCII tag ".FIT" at byte 8 — checked before the
  // extension, because the extension is whatever the user's file happens to
  // be called and the bytes are not.
  if (buffer.length > 12 && buffer.toString("ascii", 8, 12) === ".FIT") return "fit";

  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 2048));
  if (/<TrainingCenterDatabase/i.test(head)) return "tcx";
  if (/<gpx/i.test(head)) return "gpx";

  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "gpx" || ext === "tcx" || ext === "fit") return ext;

  throw new WorkoutFileError(
    "unsupported_format",
    "We can read GPX, TCX and FIT files — the export options most watches and training apps offer."
  );
}

export function parseWorkoutFile(buffer: Buffer, filename: string): ParsedWorkout {
  const format = detectFormat(buffer, filename);
  const parsed =
    format === "fit" ? parseFit(buffer, filename) : format === "tcx" ? parseTcx(buffer.toString("utf8"), filename) : parseGpx(buffer.toString("utf8"), filename);

  const durationMs = parsed.endTime.getTime() - parsed.startTime.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new WorkoutFileError("implausible_activity", "That file's start and end times don't make sense.");
  }
  if (durationMs > MAX_DURATION_HOURS * 3_600_000) {
    throw new WorkoutFileError("implausible_activity", `That file says the activity lasted over ${MAX_DURATION_HOURS} hours.`);
  }
  if (!(parsed.distanceMeters > 0)) {
    throw new WorkoutFileError("implausible_activity", "That file records no distance.");
  }

  const kmh = parsed.distanceMeters / 1000 / (durationMs / 3_600_000);
  const limit = MAX_AVERAGE_KMH[parsed.metricKey];
  if (kmh > limit) {
    throw new WorkoutFileError(
      "implausible_activity",
      `That works out to ${kmh.toFixed(1)} km/h average, which is beyond what we can accept for ${parsed.metricKey}.`
    );
  }

  return {
    ...parsed,
    format,
    // Bytes, not parsed content: the same activity exported twice is a
    // different file and legitimately re-importable, but the identical file
    // uploaded twice must not score twice.
    contentHash: createHash("sha256").update(buffer).digest("hex"),
  };
}

/** Turns a parsed file into the sample shape HealthKit and Strava both produce. */
export function workoutToSample(parsed: ParsedWorkout) {
  return {
    metricKey: parsed.metricKey,
    value: Math.round(parsed.distanceMeters),
    unit: "meters",
    startTime: parsed.startTime.toISOString(),
    endTime: parsed.endTime.toISOString(),
    sourceBundleId: `file:${parsed.contentHash}`,
    sourceName: parsed.sourceName,
    // A workout file is a device recording, not a typed-in number — the
    // thing `wasManualEntry` exists to reject. It is still user-supplied,
    // which is what `importedFile` below records: anomaly rules and the
    // human reviewing a payout can both see where this came from.
    wasManualEntry: false,
    isWearableSourced: parsed.isWearableSourced,
    corroboration: {
      gpsRoute: parsed.gpsRoute,
      importedFile: { format: parsed.format, contentHash: parsed.contentHash, pointCount: parsed.gpsRoute.length },
    },
  };
}
