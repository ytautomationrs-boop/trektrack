import { toZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { sendOnce } from "../notifications/service.js";
import { challengeDayNumber } from "./scoring.js";

/**
 * The daily "you haven't checked in yet" reminder.
 *
 * This is the most consequential notification in the app, and the reason is
 * asymmetry: missing a day doesn't just lose you progress, it forfeits your
 * whole stake to the other participants. Someone who simply forgot to open
 * the app loses real money to people who didn't beat them at anything. A
 * reminder is the difference between a fair game and a memory test.
 *
 * Unlike every other notification here, this is driven by a periodic SCAN
 * rather than a one-time state transition, so it needs an explicit dedupe
 * key — `<challengeId>:<localDate>` — or the 5-minute tick would re-send it
 * all evening.
 */

/** How close to the local cutoff a reminder goes out. Late enough that most people who were going to log activity already have, early enough to still act on it. */
const REMIND_WITHIN_HOURS = 4;

export async function sendCheckInReminders(now = new Date()) {
  const participants = await prisma.challengeParticipant.findMany({
    where: { status: "ACTIVE", challenge: { status: "ACTIVE" } },
    include: { challenge: { select: { id: true, title: true, durationDays: true, startDate: true, gracePeriodMinutes: true } } },
  });

  let sent = 0;
  let skipped = 0;

  for (const participant of participants) {
    const { challenge } = participant;
    try {
      const localDate = currentLocalDate(now, participant.timezone);
      const day = challengeDayNumber(challenge.startDate, participant.timezone, localDate);
      if (day < 1 || day > challenge.durationDays) continue;

      // Only remind inside the closing window of the participant's OWN local
      // day — a reminder at 9am is noise, one at 8pm is actionable.
      const local = toZonedTime(now, participant.timezone);
      const hoursLeftLocally = 24 - (local.getHours() + local.getMinutes() / 60);
      if (hoursLeftLocally > REMIND_WITHIN_HOURS) continue;

      // Already passed today? Then there's nothing to remind them about.
      const checkIn = await prisma.dailyCheckIn.findUnique({
        where: { participantId_challengeDay: { participantId: participant.id, challengeDay: day } },
      });
      if (checkIn?.result === "PASSED") continue;

      const didSend = await sendOnce(participant.userId, "challenge_checkin_reminder", `${challenge.id}:${localDate}`, {
        title: `Day ${day} of "${challenge.title}"`,
        body: "You haven't hit today's target yet. Miss it and your stake goes to the others.",
        data: { challengeId: challenge.id },
      });
      if (didSend) sent++;
      else skipped++;
    } catch (err) {
      // One participant's bad timezone string must not stop everyone else's
      // reminders going out.
      console.error(`[push] reminder failed for participant ${participant.id}:`, err);
    }
  }

  return { sent, skipped, considered: participants.length };
}

function currentLocalDate(now: Date, timezone: string): string {
  const local = toZonedTime(now, timezone);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}
