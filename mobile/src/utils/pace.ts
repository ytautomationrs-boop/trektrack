/** Formats seconds-per-km as "M:SS/km" — shared by the create wizard's pace stepper and the dashboard card's pace readout so they never drift. */
export function formatPace(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}
