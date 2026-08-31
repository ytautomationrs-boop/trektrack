import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * The next local midnight strictly after `from`, expressed as the UTC
 * instant it corresponds to in `timeZone`.
 *
 * Used to schedule a race's RUNNING start once it LOCKS. "Strictly after"
 * matters at the boundary: if `from` is 00:00:00.001 local, this returns
 * tomorrow's midnight, not the one that just passed — a race that fills in
 * the same instant local midnight ticks over should still get a full
 * upcoming day, not an already-elapsed one.
 */
export function nextMidnightInTimeZone(from: Date, timeZone: string): Date {
  const zoned = toZonedTime(from, timeZone);
  const nextLocalMidnight = new Date(
    zoned.getFullYear(),
    zoned.getMonth(),
    zoned.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return fromZonedTime(nextLocalMidnight, timeZone);
}
