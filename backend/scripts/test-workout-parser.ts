// Unit tests for the workout-file parser — pure functions, no server and no
// database, so they run standalone and fast. The HTTP path that uses them is
// covered in smoke-races.ts.
import { Encoder, Profile } from "@garmin/fitsdk";
import { parseWorkoutFile, workoutToSample, WorkoutFileError } from "../src/modules/imports/workoutFile.js";

// A short out-and-back run: 10 points ~100m apart, one per 30s.
// 900m over 4.5 minutes ≈ 12 km/h, a very ordinary pace.
function makeGpx(opts: { points: number; stepMeters: number; stepSeconds: number; type?: string }) {
  const start = new Date("2026-08-27T06:00:00Z").getTime();
  const pts: string[] = [];
  for (let i = 0; i < opts.points; i++) {
    // ~111_320 m per degree of latitude.
    const lat = -33.9 + (i * opts.stepMeters) / 111_320;
    const t = new Date(start + i * opts.stepSeconds * 1000).toISOString();
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="18.42"><time>${t}</time></trkpt>`);
  }
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin Forerunner 255">
  <trk><name>Morning</name><type>${opts.type ?? "running"}</type><trkseg>
    ${pts.join("\n    ")}
  </trkseg></trk>
</gpx>`;
}

function makeTcx(distanceMeters: number, seconds: number, sport = "Running") {
  return `<?xml version="1.0"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="${sport}">
      <Id>2026-08-27T06:00:00Z</Id>
      <Lap StartTime="2026-08-27T06:00:00Z">
        <TotalTimeSeconds>${seconds}</TotalTimeSeconds>
        <DistanceMeters>${distanceMeters}</DistanceMeters>
        <Track>
          <Trackpoint><Time>2026-08-27T06:00:00Z</Time><Position><LatitudeDegrees>-33.9</LatitudeDegrees><LongitudeDegrees>18.42</LongitudeDegrees></Position></Trackpoint>
          <Trackpoint><Time>2026-08-27T06:10:00Z</Time><Position><LatitudeDegrees>-33.89</LatitudeDegrees><LongitudeDegrees>18.42</LongitudeDegrees></Position></Trackpoint>
        </Track>
      </Lap>
      <Creator><Name>Polar Vantage</Name></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

/**
 * Builds a genuine FIT file with Garmin's own encoder.
 *
 * GPX and TCX are XML and can be written by hand; FIT is a binary format
 * with a header, message definitions and a CRC, so a hand-rolled fixture
 * would only ever test my idea of the format. Encoding with the SDK and
 * decoding with the parser tests it against the real thing — the parser has
 * no idea the bytes came from the same library.
 *
 * Still not a substitute for a file off an actual watch, which would carry
 * far more messages and vendor quirks.
 */
function makeFit(opts: { sport: string; distanceMeters: number; seconds: number; withDevice?: boolean }) {
  const start = new Date("2026-08-27T06:00:00Z");
  const encoder = new Encoder();

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 3121,
    timeCreated: start,
    serialNumber: 1234,
  });

  if (opts.withDevice) {
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.DEVICE_INFO,
      timestamp: start,
      manufacturer: "garmin",
      garminProduct: "fenix7",
    });
  }

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: new Date(start.getTime() + opts.seconds * 1000),
    startTime: start,
    sport: opts.sport,
    totalDistance: opts.distanceMeters,
    totalElapsedTime: opts.seconds,
    totalTimerTime: opts.seconds,
  });

  return Buffer.from(encoder.close());
}

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}
function expectError(label: string, fn: () => unknown, code: string) {
  try {
    fn();
    console.log(`  FAIL  ${label} (no error thrown)`);
    fail++;
  } catch (err) {
    const got = err instanceof WorkoutFileError ? err.code : String(err);
    check(label, got, code);
  }
}

console.log("\n=== GPX ===");
const gpx = parseWorkoutFile(Buffer.from(makeGpx({ points: 10, stepMeters: 100, stepSeconds: 30 })), "morning.gpx");
check("sport detected from <type>", gpx.metricKey, "running");
check("format detected from content", gpx.format, "gpx");
check("distance summed from the track (~900m)", Math.abs(gpx.distanceMeters - 900) < 20, true);
check("device read from creator", gpx.sourceName, "Garmin Forerunner 255");
check("counted as wearable-sourced", gpx.isWearableSourced, true);
check("track retained as evidence", gpx.gpsRoute.length, 10);

console.log("\n=== TCX ===");
const tcx = parseWorkoutFile(Buffer.from(makeTcx(5000, 1500)), "ride.tcx");
check("sport from the Sport attribute", tcx.metricKey, "running");
check("format detected", tcx.format, "tcx");
check("distance taken from the file, not re-derived", tcx.distanceMeters, 5000);
check("creator read", tcx.sourceName, "Polar Vantage");
check("swimming recognised", parseWorkoutFile(Buffer.from(makeTcx(1500, 1800, "Swimming")), "pool.tcx").metricKey, "swimming");
check("cycling recognised", parseWorkoutFile(Buffer.from(makeTcx(30000, 3600, "Biking")), "ride.tcx").metricKey, "cycling");

console.log("\n=== FIT (encoded with Garmin's own SDK) ===");
const fitBuf = makeFit({ sport: "running", distanceMeters: 5000, seconds: 1800 });
const fit = parseWorkoutFile(fitBuf, "activity.fit");
check("format detected from the .FIT header bytes, not the extension", fit.format, "fit");
check("  even when the filename lies", parseWorkoutFile(fitBuf, "actually-a-run.gpx").format, "fit");
check("sport read from the session message", fit.metricKey, "running");
check("distance taken from the session total", fit.distanceMeters, 5000);
check("duration derived from totalElapsedTime", (fit.endTime.getTime() - fit.startTime.getTime()) / 1000, 1800);
check("cycling recognised", parseWorkoutFile(makeFit({ sport: "cycling", distanceMeters: 30000, seconds: 3600 }), "r.fit").metricKey, "cycling");
check("swimming recognised", parseWorkoutFile(makeFit({ sport: "swimming", distanceMeters: 1500, seconds: 1800 }), "s.fit").metricKey, "swimming");

const fitWithDevice = parseWorkoutFile(makeFit({ sport: "running", distanceMeters: 5000, seconds: 1800, withDevice: true }), "d.fit");
check("device name read when the file carries one", fitWithDevice.isWearableSourced, true);
check("  no device info means no wearable claim", fit.isWearableSourced, false);

expectError(
  "a FIT file whose pace is impossible",
  () => parseWorkoutFile(makeFit({ sport: "running", distanceMeters: 50000, seconds: 600 }), "x.fit"),
  "implausible_activity"
);
expectError(
  "a sport there are no competitions for",
  () => parseWorkoutFile(makeFit({ sport: "rowing", distanceMeters: 5000, seconds: 1800 }), "x.fit"),
  "unknown_sport"
);
// Corrupting a byte in the middle breaks the CRC the SDK writes.
const corrupted = Buffer.from(fitBuf);
corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
expectError("a corrupted FIT file fails its own integrity check", () => parseWorkoutFile(corrupted, "x.fit"), "unreadable_file");

console.log("\n=== Dedup handle ===");
const a = parseWorkoutFile(Buffer.from(makeGpx({ points: 10, stepMeters: 100, stepSeconds: 30 })), "a.gpx");
const b = parseWorkoutFile(Buffer.from(makeGpx({ points: 10, stepMeters: 100, stepSeconds: 30 })), "renamed.gpx");
check("the same bytes hash the same whatever the filename", a.contentHash, b.contentHash);
check("and produce the same sourceBundleId", workoutToSample(a).sourceBundleId, workoutToSample(b).sourceBundleId);
const different = parseWorkoutFile(Buffer.from(makeGpx({ points: 11, stepMeters: 100, stepSeconds: 30 })), "a.gpx");
check("different content hashes differently", different.contentHash !== a.contentHash, true);

console.log("\n=== Sample shape matches the health/Strava path ===");
const sample = workoutToSample(gpx);
check("metric", sample.metricKey, "running");
check("unit", sample.unit, "meters");
check("not a manual entry — a device recorded it", sample.wasManualEntry, false);
check("provenance recorded for review", (sample.corroboration as any).importedFile.format, "gpx");

console.log("\n=== Physically impossible files are refused ===");
// 10 points 1km apart, 1s between them = 3.6 million km/h.
expectError("a car cannot be a run", () => parseWorkoutFile(Buffer.from(makeGpx({ points: 10, stepMeters: 1000, stepSeconds: 1 })), "x.gpx"), "implausible_activity");
expectError("swimming faster than the world record", () => parseWorkoutFile(Buffer.from(makeTcx(5000, 600, "Swimming")), "x.tcx"), "implausible_activity");
expectError("a file with no distance", () => parseWorkoutFile(Buffer.from(makeTcx(0, 600)), "x.tcx"), "implausible_activity");
expectError("an unknown sport", () => parseWorkoutFile(Buffer.from(makeGpx({ points: 10, stepMeters: 100, stepSeconds: 30, type: "kayaking" })), "x.gpx"), "unknown_sport");
expectError("not a workout file at all", () => parseWorkoutFile(Buffer.from("just some text"), "notes.txt"), "unsupported_format");
expectError("truncated XML", () => parseWorkoutFile(Buffer.from("<gpx><trk><trkseg>"), "x.gpx"), "no_track_points");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
