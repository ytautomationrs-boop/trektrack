/** Formats minutes-since-local-midnight (0-1439) as "8:00 AM" — shared by the create wizard's time steppers and the dashboard card's window readout. */
export function formatTimeOfDay(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** One-line summary of a time window for a metric card — "Before 8:00 AM", "5:00 AM - 7:00 PM", or "After 6:00 PM" depending on which bound(s) are set. Null if neither bound is set (no window). */
export function formatTimeWindow(startTimeMinutes: number | null, endTimeMinutes: number | null): string | null {
  if (startTimeMinutes == null && endTimeMinutes == null) return null;
  if (startTimeMinutes == null) return `Before ${formatTimeOfDay(endTimeMinutes!)}`;
  if (endTimeMinutes == null) return `After ${formatTimeOfDay(startTimeMinutes)}`;
  return `${formatTimeOfDay(startTimeMinutes)} - ${formatTimeOfDay(endTimeMinutes)}`;
}

export const EARLY_BIRD_END_MINUTES = 480; // 8:00 AM
export const TIME_STEP_MINUTES = 15;
