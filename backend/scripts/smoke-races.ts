// End-to-end smoke test of the fixed-prize race model against the running
// server + real Postgres. Exercises the properties the model actually turns
// on, not just "does it return 200":
//
//   1. fill is INDEFINITE — no deadline — and locks at the exact headcount,
//      never before, never after; the 11th entrant is refused
//   2. locking recognises revenue and freezes the prize commitment
//      immediately; the actual RUNNING transition waits for the scheduled
//      instant, which a job — not the lock itself — has to advance to
//   3. an entrant can withdraw (full refund) while FILLING, and re-enter the
//      same race afterward; withdrawal is refused once LOCKED
//   4. an admin can manually cancel a stale FILLING race (full refund); there
//      is no automatic time-based equivalent
//   5. ranking is by aggregate total, prizes come off the frozen snapshot
//   6. points follow the position scale and the total floors at zero
//   7. a voluntary lower-league entry pays/wins that league's fixed
//      schedule but earns ZERO points and no racesWon credit, either way
//   8. a user can create a PRIVATE race but never a public one, and never
//      sets its fee, prizes, field size or league
//
// Run with the server up:  npm run smoke:races
//
// NOTE: this creates real rows in whatever database DATABASE_URL points at —
// ~130 users on @smoke.test addresses, their races, entries and ledger
// movements, including revenue/expense against the platform account.
// Dev databases only. Clean up afterwards with:  npm run smoke:clean
//
// Every section creates its OWN race rather than entering a shared open one.
// That is deliberate: an earlier version joined whatever race was FILLING,
// which swept a real user's entry into the run and got it deleted (unrefunded)
// by the cleanup.

import { PrismaClient } from "@prisma/client";
import { adminCancelRace, cancelRaceEntry, createRace as createRaceUnchecked, startLockedRaces } from "../src/modules/races/service.js";
import { resolveDueRaces } from "../src/modules/races/resolution.js";
import { applyRaceResult } from "../src/modules/races/leagues.js";
import { startDueChallenges, resolveDueChallenges } from "../src/modules/challenges/resolution.js";
import { finalizeDueCheckIns } from "../src/modules/challenges/scoring.js";
import { sendOnce } from "../src/modules/notifications/service.js";
import { createDeposit } from "../src/modules/wallet/service.js";
import { buildServer, rateLimitKey } from "../src/server.js";
import { reconcilePendingDeposits } from "../src/jobs/depositReconciliation.js";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

const API = "http://localhost:4000";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
}
function note(msg: string) { console.log(`        ${msg}`); }
function section(t: string) { console.log(`\n=== ${t} ===`); }

async function api(path: string, { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {}) {
  const hasBody = body !== undefined;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = Date.now();

/**
 * Creates a race, activating its format first if the seed has it switched off.
 *
 * Which formats are auto-opened is a product decision that changes — the seed
 * now activates running and cycling, because a workout file cannot carry
 * steps and a steps race would be unscoreable. This suite tests race
 * MECHANICS, which are metric-agnostic, so it should not break every time
 * that decision changes. Activating here is test setup, the same posture as
 * forceRaceRunning below.
 */
async function createRace(raceTypeKey: string, leagueLevel: number) {
  await prisma.raceType.updateMany({ where: { key: raceTypeKey, isActive: false }, data: { isActive: true } });
  return createRaceUnchecked(raceTypeKey, leagueLevel);
}

/** Mints a fresh single-use pilot invite code directly (bypassing HTTP — this is test setup, not the flow under test). */
async function makeInviteCode() {
  const code = await prisma.inviteCode.create({ data: { code: `smoke_${stamp}_${Math.random().toString(36).slice(2)}`, label: "smoke test" } });
  return code.code;
}

/**
 * `realisticEmail` uses a domain with a real TLD. Paystack validates the
 * email on /transaction/initialize and rejects `.test`, so any user who
 * needs to reach Paystack has to have one. Still ends in a suffix
 * cleanup-smoke.ts matches exactly, and example.com is IANA-reserved, so it
 * can never collide with a real account.
 */
async function makeUser(i: number, balanceCents: number, opts: { realisticEmail?: boolean } = {}) {
  const email = opts.realisticEmail ? `racer${i}_${stamp}@smoke.example.com` : `racer${i}_${stamp}@smoke.test`;
  const inviteCode = await makeInviteCode();
  const { json } = await api("/auth/signup", {
    method: "POST",
    body: { email, password: "password123", displayName: `Racer ${i}`, timezone: "Africa/Johannesburg", inviteCode },
  });
  if (!json.token) throw new Error(`signup failed for ${email}: ${JSON.stringify(json)}`);
  await prisma.user.update({ where: { id: json.user.id }, data: { walletBalanceCents: balanceCents } });
  return { id: json.user.id, token: json.token, email };
}

/**
 * A sample window that cannot escape the participant's local day.
 *
 * A challenge check-in is scored against ONE local calendar day, so a window
 * that crosses local midnight is correctly refused with "outside_day_window".
 * The fixture used to be `start` to `start + 1h`, which meant the suite
 * passed all day and failed after 23:00 local — a real failure with a
 * misleading cause, and one that only ever showed up late at night.
 *
 * Clamps the end to just before local midnight instead.
 */
function windowInsideLocalDay(start: Date, timezone: string, hours = 1) {
  const endOfLocalDay = new Date(
    new Date(formatInTimeZone(start, timezone, "yyyy-MM-dd") + "T23:59:00" + formatInTimeZone(start, timezone, "XXX")).getTime()
  );
  const end = new Date(Math.min(start.getTime() + hours * 3_600_000, endOfLocalDay.getTime()));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** A day of steps with the pedometer corroboration the validator demands. */
function stepsSample(value: number, startIso: string, endIso: string) {
  return {
    metricKey: "steps",
    value,
    unit: "steps",
    startTime: startIso,
    endTime: endIso,
    sourceBundleId: `com.apple.health.smoke.${value}.${startIso}`,
    sourceName: "Apple Watch",
    wasManualEntry: false,
    isWearableSourced: true,
    corroboration: { pedometerStepCount: Math.round(value * 0.98), gaitConfidence: 0.9 },
  };
}

/**
 * Forces a LOCKED race straight into its scoring window: rewrites
 * scheduledStartAt into the past by exactly (durationDays + 2 hours), so
 * startLockedRaces() computes an endsAt that is 2 hours ago — already due
 * for resolution — without needing a separate manual startedAt/endsAt patch.
 */
async function forceRaceRunning(raceId: string, durationDays: number) {
  const scheduledStartAt = new Date(Date.now() - (durationDays * 86_400_000 + 2 * 3_600_000));
  await prisma.race.update({ where: { id: raceId }, data: { scheduledStartAt } });
  const result = await startLockedRaces();
  if (result.started === 0 || !result.raceIds.includes(raceId)) {
    throw new Error(`forceRaceRunning: race ${raceId} did not transition to RUNNING`);
  }
  return prisma.race.findUniqueOrThrow({ where: { id: raceId } });
}

/**
 * Every /admin route the server actually registers, with a concrete path
 * (parameters filled with a throwaway id so the request reaches the guard
 * rather than 404ing before it).
 */
async function enumerateAdminRoutes(): Promise<Array<{ method: "GET" | "POST"; path: string }>> {
  const app = await buildServer();
  const found: Array<{ method: "GET" | "POST"; path: string }> = [];
  const seen = new Set<string>();

  for (const route of app.routeTable) {
    if (!route.url.startsWith("/admin")) continue;
    if (route.method !== "GET" && route.method !== "POST") continue;
    const path = route.url.replace(/:[A-Za-z]+/g, "smoke-nonexistent-id");
    const key = `${route.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ method: route.method, path });
  }

  await app.close();
  return found;
}

async function main() {
  section("Setup — open races from standing config");
  // Admin routes now require isAdmin (pilot gating) — one dedicated
  // admin-flagged user whose token every /admin/* call below uses.
  const adminUser = await makeUser(0, 0);
  await prisma.user.update({ where: { id: adminUser.id }, data: { isAdmin: true } });
  // A dedicated race, never a shared open one. Joining whatever happened to
  // be FILLING once pulled a REAL user's entry into a smoke run, and the
  // cleanup then deleted their entry and ledger row without refunding them.
  // Every section below creates its own race for the same reason.
  const race = await createRace("steps_1d_individual", 1);
  note(`race ${race.id} — needs exactly ${race.entrantCount}, fee R${race.entryFeeCents / 100}, purse R${race.totalPrizeCents / 100}`);
  check("race opens in FILLING", race.status, "FILLING");
  check("prize snapshot frozen at creation", (race.prizeSnapshot as any[]).length, 5);
  check("race has an anchor timezone", race.anchorTimezone, "Africa/Johannesburg");
  check("no signup deadline exists on the row", "signupClosesAt" in race, false);

  section("Entering — fill is indefinite, and locks at the exact headcount");
  const users = [];
  for (let i = 1; i <= 11; i++) users.push(await makeUser(i, 20000));

  let lockedAtEntry: number | null = null;
  for (let i = 0; i < 10; i++) {
    const { status, json } = await api(`/races/${race.id}/enter`, { method: "POST", token: users[i].token, body: {} });
    if (status !== 201) throw new Error(`entry ${i + 1} failed: ${JSON.stringify(json)}`);
    if (json.lockedRace) lockedAtEntry = i + 1;
    if (i === 8) check("9th entrant does NOT lock the race", json.lockedRace, false);
  }
  check("race locks on exactly the 10th entrant", lockedAtEntry, 10);

  const locked = await prisma.race.findUniqueOrThrow({ where: { id: race.id } });
  check("status is LOCKED, not RUNNING yet", locked.status, "LOCKED");
  check("lockedAt set", locked.lockedAt !== null, true);
  check("scheduledStartAt set", locked.scheduledStartAt !== null, true);
  check("startedAt NOT set yet — scoring hasn't begun", locked.startedAt, null);

  const eleventh = await api(`/races/${race.id}/enter`, { method: "POST", token: users[10].token, body: {} });
  check("11th entrant refused", eleventh.status, 400);
  check("  with race_not_open", eleventh.json.error, "race_not_open");

  section("Locking recognises revenue immediately — RUNNING is a later, separate step");
  const feeEntries = await prisma.ledgerEntry.findMany({ where: { raceId: race.id, type: "RACE_ENTRY_FEE" } });
  check("10 entry-fee debits", feeEntries.length, 10);
  check("all COMPLETED at LOCK time, before RUNNING even exists", feeEntries.every((e) => e.status === "COMPLETED"), true);
  const revenue = await prisma.ledgerEntry.findFirst({ where: { raceId: race.id, type: "RACE_ENTRY_REVENUE" } });
  check("revenue recognised at lock", revenue?.amountCents, 10 * race.entryFeeCents);

  const tooEarly = await startLockedRaces();
  check("the lifecycle job does NOT start it early — scheduledStartAt is hours away", tooEarly.raceIds.includes(race.id), false);
  const stillLocked = await prisma.race.findUniqueOrThrow({ where: { id: race.id } });
  check("  still LOCKED", stillLocked.status, "LOCKED");

  const running = await forceRaceRunning(race.id, 1);
  check("once scheduledStartAt arrives, status flips to RUNNING", running.status, "RUNNING");
  check("startedAt set from the SCHEDULED instant", running.startedAt?.getTime(), running.scheduledStartAt?.getTime());
  check("endsAt is startedAt + durationDays", running.endsAt?.getTime(), (running.startedAt?.getTime() ?? 0) + 86_400_000);

  section("Scoring — aggregate totals");
  const stepsByEntrant = [12000, 30000, 3000, 21000, 6000, 27000, 9000, 24000, 15000, 18000];
  const entries = await prisma.raceEntry.findMany({ where: { raceId: race.id }, orderBy: { joinedAt: "asc" } });
  const winStart = new Date(running.startedAt!.getTime() + 60_000).toISOString();
  const winEnd = new Date(running.startedAt!.getTime() + 3_600_000).toISOString();

  for (let i = 0; i < 10; i++) {
    const { json } = await api(`/race-entries/${entries[i].id}/samples`, {
      method: "POST",
      token: users[i].token,
      body: { samples: [stepsSample(stepsByEntrant[i], winStart, winEnd)] },
    });
    if (json.accepted !== 1) throw new Error(`sample ${i} rejected: ${JSON.stringify(json.rejected)}`);
  }
  note("10 samples accepted through the shared validator");

  const dup = await api(`/race-entries/${entries[0].id}/samples`, {
    method: "POST", token: users[0].token, body: { samples: [stepsSample(stepsByEntrant[0], winStart, winEnd)] },
  });
  check("duplicate re-sync accepted but not double-counted", dup.json.accepted, 1);

  const liveTotal = await prisma.raceHealthSample.aggregate({
    where: { raceEntryId: entries[0].id }, _sum: { value: true },
  });
  check("  the duplicate really did not inflate the total", liveTotal._sum.value, stepsByEntrant[0]);

  section("Live standings expose position and gap-to-leader");
  const live = await api(`/races/${race.id}`, { token: users[1].token });
  const expectedOrder = [...stepsByEntrant].sort((a, b) => b - a);
  check("individuals sorted by total, highest first", live.json.standings.individuals.map((r: any) => r.total), expectedOrder);
  check("positions are 1-based and contiguous", live.json.standings.individuals.map((r: any) => r.position), [1,2,3,4,5,6,7,8,9,10]);
  check("the leader's own gap is 0", live.json.standings.individuals[0].gapFromLeader, 0);
  check("last place's gap is leader-minus-last", live.json.standings.individuals[9].gapFromLeader, expectedOrder[0] - expectedOrder[9]);
  check("standings are flagged provisional before resolution", live.json.standingsAreProvisional, true);

  section("Resolution — fixed prizes off the snapshot");
  const resolved = await resolveDueRaces();
  check("one race resolved", resolved.resolved, 1);

  const scored = await prisma.raceEntry.findMany({ where: { raceId: race.id }, orderBy: { finishPosition: "asc" } });
  check("positions 1..10 assigned", scored.map((e) => e.finishPosition), [1,2,3,4,5,6,7,8,9,10]);
  check("ranked by aggregate, not by join order", scored.map((e) => e.aggregateValue), expectedOrder);
  check("  winner is the highest stepper, not the first to enter", scored[0].userId, users[1].id);
  check("prizes match the frozen schedule", scored.map((e) => e.prizeCents), [7500,5000,3750,2500,1250,0,0,0,0,0]);
  check("trophies follow the position scale", scored.map((e) => e.pointsAwarded), [6,4,3,2,1,0,-1,-2,-3,-4]);

  const paid = scored.reduce((s, e) => s + e.prizeCents, 0);
  check("total paid equals the pre-announced purse", paid, race.totalPrizeCents);
  note(`platform: R${(10 * race.entryFeeCents) / 100} in, R${paid / 100} out, net R${(10 * race.entryFeeCents - paid) / 100}`);

  section("League trophies — permanence and the zero floor");
  const winner = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: users[1].id, metricKey: "steps" } } });
  check("winner has 6 trophies", winner!.totalPoints, 6);
  check("winner still in league 1 (one win is not a promotion)", winner!.currentLevel, 1);

  const last = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: users[2].id, metricKey: "steps" } } });
  check("last place floored at 0, not -4", last!.totalPoints, 0);
  const lastAudit = await prisma.racePointEntry.findFirst({ where: { userId: users[2].id } });
  check("  but the audit row records the real -4", lastAudit!.points, -4);
  check("  with before/after showing the floor", [lastAudit!.pointsBefore, lastAudit!.pointsAfter], [0, 0]);

  const leagues = await api("/me/leagues", { token: users[1].token });
  const stepsStanding = leagues.json.standings.find((x: any) => x.metricKey === "steps");
  check("standings are returned per metric", leagues.json.standings.length, 4);
  check("  no global rank field anywhere", "rank" in leagues.json, false);
  check("  no combined points total either", "totalPoints" in leagues.json, false);
  check("  steps reports points to next league", stepsStanding.pointsToNextLeague, 10);

  section("Metrics are independent");
  for (const other of ["running", "cycling", "swimming"]) {
    const s = leagues.json.standings.find((x: any) => x.metricKey === other);
    check(`  ${other} untouched by a steps win`, s.totalPoints, 0);
    check(`  ${other} still at league 1`, s.currentLeague.level, 1);
    check(`  ${other} shows no races entered`, s.racesEntered, 0);
  }
  const pointRows = await prisma.racePointEntry.findMany({ where: { userId: users[1].id } });
  check("  every point row is tagged with its metric", pointRows.every((r) => r.metricKey === "steps"), true);
  const otherStates = await prisma.userLeagueState.findMany({
    where: { userId: users[1].id, metricKey: { not: "steps" } },
  });
  check("  and no other metric accrued anything", otherStates.every((x) => x.totalPoints === 0), true);

  section("Wallets");
  const wWin = await prisma.user.findUnique({ where: { id: users[1].id } });
  check("winner: 20000 - 2500 fee + 7500 prize", wWin!.walletBalanceCents, 20000 - 2500 + 7500);
  const wLast = await prisma.user.findUnique({ where: { id: users[2].id } });
  check("last place: fee gone, no prize", wLast!.walletBalanceCents, 20000 - 2500);

  section("Withdrawal — full refund while FILLING, refused once LOCKED");
  const withdrawRace = await createRace("steps_1d_individual", 1);
  const withdrawer = await makeUser(90, 20000);
  await api(`/races/${withdrawRace.id}/enter`, { method: "POST", token: withdrawer.token, body: {} });
  const afterEnter = await prisma.user.findUnique({ where: { id: withdrawer.id } });
  check("fee debited on entry", afterEnter!.walletBalanceCents, 20000 - withdrawRace.entryFeeCents);
  const pendingFee = await prisma.ledgerEntry.findFirst({ where: { raceId: withdrawRace.id, userId: withdrawer.id, type: "RACE_ENTRY_FEE" } });
  check("fee is PENDING while filling", pendingFee!.status, "PENDING");

  const withdrawResult = await api(`/races/${withdrawRace.id}/withdraw`, { method: "POST", token: withdrawer.token });
  check("withdrawal succeeds while FILLING", withdrawResult.status, 200);
  const withdrawnEntry = await prisma.raceEntry.findUnique({ where: { raceId_userId: { raceId: withdrawRace.id, userId: withdrawer.id } } });
  check("entry status is WITHDRAWN", withdrawnEntry!.status, "WITHDRAWN");
  const afterWithdraw = await prisma.user.findUnique({ where: { id: withdrawer.id } });
  check("wallet made whole", afterWithdraw!.walletBalanceCents, 20000);
  const reversedPending = await prisma.ledgerEntry.findFirst({ where: { raceId: withdrawRace.id, userId: withdrawer.id, type: "RACE_ENTRY_FEE" } });
  check("original debit marked REVERSED, not left COMPLETED", reversedPending!.status, "REVERSED");
  const refundRow = await prisma.ledgerEntry.findFirst({ where: { raceId: withdrawRace.id, userId: withdrawer.id, type: "RACE_ENTRY_REFUND" } });
  check("a refund ledger row exists", refundRow?.amountCents, withdrawRace.entryFeeCents);

  const doubleWithdraw = await api(`/races/${withdrawRace.id}/withdraw`, { method: "POST", token: withdrawer.token });
  check("withdrawing again is refused — nothing to withdraw", doubleWithdraw.status, 400);
  check("  with not_entered", doubleWithdraw.json.error, "not_entered");

  const reentry = await api(`/races/${withdrawRace.id}/enter`, { method: "POST", token: withdrawer.token, body: {} });
  check("re-entering the SAME race after withdrawing succeeds", reentry.status, 201);
  const reenteredEntry = await prisma.raceEntry.findUnique({ where: { raceId_userId: { raceId: withdrawRace.id, userId: withdrawer.id } } });
  check("  status is ENTERED again, same row reused", reenteredEntry!.status, "ENTERED");
  check("  and charged again", (await prisma.user.findUnique({ where: { id: withdrawer.id } }))!.walletBalanceCents, 20000 - withdrawRace.entryFeeCents);

  section("Admin manual cancel — the only way a FILLING race is ever cancelled");
  const staleRace = await createRace("steps_1d_individual", 1);
  const partial = [];
  for (let i = 0; i < 3; i++) partial.push(await makeUser(700 + i, 20000));
  for (const u of partial) await api(`/races/${staleRace.id}/enter`, { method: "POST", token: u.token, body: {} });

  const cancelResult = await api(`/admin/races/${staleRace.id}/cancel`, {
    method: "POST",
    token: adminUser.token,
    body: { reason: "Smoke test — manual cancel of a stale race" },
  });
  check("admin cancel succeeds", cancelResult.status, 200);
  check("refunded exactly the 3 partial entrants", cancelResult.json.refundedEntrants, 3);
  check("  for the full fee each", cancelResult.json.refundedCents, 3 * staleRace.entryFeeCents);

  const cancelledRow = await prisma.race.findUniqueOrThrow({ where: { id: staleRace.id } });
  check("race status is CANCELLED_UNFILLED", cancelledRow.status, "CANCELLED_UNFILLED");
  const partialWallets = await Promise.all(partial.map((u) => prisma.user.findUnique({ where: { id: u.id } })));
  check("every partial entrant made whole", partialWallets.every((w) => w!.walletBalanceCents === 20000), true);

  // This is real money refunded on a deliberate operator decision — had no
  // attribution at all until today.
  const refundLedgerRows = await prisma.ledgerEntry.findMany({ where: { raceId: staleRace.id, type: "RACE_ENTRY_REFUND" } });
  check("every refund is attributed to the cancelling admin", refundLedgerRows.every((r) => r.performedByUserId === adminUser.id), true);

  const cancelAgain = await api(`/admin/races/${staleRace.id}/cancel`, { method: "POST", token: adminUser.token, body: { reason: "double cancel" } });
  check("cancelling an already-cancelled race is refused", cancelAgain.status, 400);
  check("  with cannot_cancel", cancelAgain.json.error, "cannot_cancel");

  section("Squad race — 4 squads of 4, one fixed prize split evenly");
  const squadRace = await createRace("steps_7d_squad", 1);
  note(`${squadRace.entrantCount} squads x ${squadRace.squadSize} members = ${squadRace.entrantCount * (squadRace.squadSize ?? 1)} entrants, purse R${squadRace.totalPrizeCents / 100}`);

  const squadUsers = [];
  for (let i = 0; i < 16; i++) squadUsers.push(await makeUser(200 + i, 20000));

  const squadNames = ["Alpha", "Bravo", "Charlie", "Delta"];
  const squadIds: Record<string, string> = {};
  const squadCodes: Record<string, string> = {};
  let squadLocked = false;
  for (let sq = 0; sq < 4; sq++) {
    for (let m = 0; m < 4; m++) {
      const u = squadUsers[sq * 4 + m];
      const body: any = m === 0 ? { squadName: squadNames[sq] } : { squadInviteCode: squadCodes[squadNames[sq]] };
      const { status, json } = await api(`/races/${squadRace.id}/enter`, { method: "POST", token: u.token, body });
      if (status !== 201) throw new Error(`squad entry ${sq}/${m} failed: ${JSON.stringify(json)}`);
      if (m === 0) {
        squadIds[squadNames[sq]] = json.entry.squadId;
        const founded = await prisma.raceSquad.findUnique({ where: { id: json.entry.squadId } });
        squadCodes[squadNames[sq]] = founded!.inviteCode;
      }
      if (json.lockedRace) squadLocked = true;
    }
  }
  check("teammates joined via the captain's code", Object.keys(squadCodes).length, 4);
  check("squad race locks only when all 16 are in", squadLocked, true);
  const lockedSquad = await prisma.race.findUniqueOrThrow({ where: { id: squadRace.id } });
  check("  status LOCKED", lockedSquad.status, "LOCKED");

  const withdrawAttemptOnLocked = await api(`/races/${squadRace.id}/withdraw`, { method: "POST", token: squadUsers[0].token });
  check("withdrawal is refused once LOCKED", withdrawAttemptOnLocked.status, 400);
  check("  with cannot_withdraw", withdrawAttemptOnLocked.json.error, "cannot_withdraw");

  const fifth = await makeUser(299, 20000);
  const overflow = await api(`/races/${squadRace.id}/enter`, { method: "POST", token: fifth.token, body: { squadName: "Echo" } });
  check("a 5th squad is refused", overflow.status, 400);

  const runningSquad = await forceRaceRunning(squadRace.id, 7);
  check("  status RUNNING after its scheduled start", runningSquad.status, "RUNNING");

  const sqStart = new Date(runningSquad.startedAt!.getTime() + 60_000).toISOString();
  const sqEnd = new Date(runningSquad.startedAt!.getTime() + 3_600_000).toISOString();
  const perSquadSteps = [10000, 8000, 6000, 4000]; // each member walks this much

  const squadEntries = await prisma.raceEntry.findMany({ where: { raceId: squadRace.id }, orderBy: { joinedAt: "asc" } });
  for (let i = 0; i < 16; i++) {
    const steps = perSquadSteps[Math.floor(i / 4)] + i; // +i keeps sourceBundleIds distinct
    const { json } = await api(`/race-entries/${squadEntries[i].id}/samples`, {
      method: "POST", token: squadUsers[i].token, body: { samples: [stepsSample(steps, sqStart, sqEnd)] },
    });
    if (json.accepted !== 1) throw new Error(`squad sample ${i} rejected: ${JSON.stringify(json.rejected)}`);
  }

  await resolveDueRaces();
  const squads = await prisma.raceSquad.findMany({ where: { raceId: squadRace.id }, orderBy: { finishPosition: "asc" } });
  check("squads ranked 1-4 by aggregate", squads.map((q) => q.name), squadNames);
  check("  winning squad's aggregate is the sum of its members", squads[0].aggregateValue, 10000 * 4 + (0 + 1 + 2 + 3));

  const alphaEntries = await prisma.raceEntry.findMany({ where: { squadId: squadIds.Alpha } });
  check("every Alpha member placed 1st", alphaEntries.map((e) => e.finishPosition), [1, 1, 1, 1]);
  check("the single prize split evenly, 4 x R150", alphaEntries.map((e) => e.prizeCents), [15000, 15000, 15000, 15000]);
  check("  summing to exactly the pre-announced purse", alphaEntries.reduce((t, e) => t + e.prizeCents, 0), squadRace.totalPrizeCents);
  check("every Alpha member gets the squad's trophies", alphaEntries.map((e) => e.pointsAwarded), [6, 6, 6, 6]);

  const deltaEntries = await prisma.raceEntry.findMany({ where: { squadId: squadIds.Delta } });
  check("last squad: -4 each, no prize", deltaEntries.map((e) => e.pointsAwarded), [-4, -4, -4, -4]);
  check("  and nothing paid", deltaEntries.every((e) => e.prizeCents === 0), true);

  section("Squad privacy — invite-only by default");
  const privRace = await createRace("steps_7d_squad", 1);

  const captain = await makeUser(400, 20000);
  const stranger = await makeUser(401, 20000);
  const friend = await makeUser(402, 20000);
  const opener = await makeUser(403, 20000);
  const walkUp = await makeUser(404, 20000);

  const founded = await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: captain.token, body: { squadName: "Private" },
  });
  check("founding a squad succeeds", founded.status, 201);
  const privateSquad = await prisma.raceSquad.findFirst({ where: { raceId: privRace.id, name: "Private" } });
  check("a squad founded with no policy is INVITE_ONLY", privateSquad!.joinPolicy, "INVITE_ONLY");
  check("  and gets a shareable code", typeof privateSquad!.inviteCode === "string" && privateSquad!.inviteCode.length === 8, true);

  const walkIn = await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: stranger.token, body: { squadId: privateSquad!.id },
  });
  check("a stranger CANNOT join an invite-only squad by id", walkIn.status, 400);
  check("  with squad_invite_only", walkIn.json.error, "squad_invite_only");
  const strangerEntry = await prisma.raceEntry.findFirst({ where: { raceId: privRace.id, userId: stranger.id } });
  check("  and no entry was created", strangerEntry, null);
  const strangerWallet = await prisma.user.findUnique({ where: { id: stranger.id } });
  check("  and nothing was debited", strangerWallet!.walletBalanceCents, 20000);

  const withCode = await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: friend.token, body: { squadInviteCode: privateSquad!.inviteCode },
  });
  check("someone holding the code CAN join", withCode.status, 201);
  const friendEntry = await prisma.raceEntry.findFirst({ where: { raceId: privRace.id, userId: friend.id } });
  check("  and lands in the right squad", friendEntry!.squadId, privateSquad!.id);

  const badCode = await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: stranger.token, body: { squadInviteCode: "deadbeef" },
  });
  check("a wrong code is refused", badCode.json.error, "invalid_squad_code");

  await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: opener.token, body: { squadName: "Open House", squadJoinPolicy: "OPEN" },
  });
  const openSquad = await prisma.raceSquad.findFirst({ where: { raceId: privRace.id, name: "Open House" } });
  check("a squad founded with OPEN is open", openSquad!.joinPolicy, "OPEN");
  const walkUpJoin = await api(`/races/${privRace.id}/enter`, {
    method: "POST", token: walkUp.token, body: { squadId: openSquad!.id },
  });
  check("anyone can join an OPEN squad by id", walkUpJoin.status, 201);

  section("Squad code lookup + payload shape the detail screen needs");
  const lookup = await api(`/race-squads/by-code/${privateSquad!.inviteCode}`, { token: stranger.token });
  check("code lookup resolves without joining", lookup.status, 200);
  check("  names the squad", lookup.json.squad.name, "Private");
  check("  and reports it as joinable", lookup.json.joinable, true);
  const afterLookup = await prisma.raceEntry.findFirst({ where: { raceId: privRace.id, userId: stranger.id } });
  check("  purely read-only — still no entry", afterLookup, null);

  const detail = await api(`/races/${privRace.id}`, { token: captain.token });
  check("race detail returns a prizes array", Array.isArray(detail.json.race.prizes), true);
  check("  populated from the frozen snapshot", detail.json.race.prizes.length > 0, true);
  check("  with fill counts", typeof detail.json.race.entrantsRequired, "number");
  check("  and decorated squads", typeof detail.json.race.squads[0].memberCount, "number");
  check("  carrying joinPolicy", detail.json.race.squads.every((q: any) => q.joinPolicy != null), true);

  const captainView = detail.json.race.squads.find((q: any) => q.name === "Private");
  check("the captain sees their own squad's code", captainView.inviteCode, privateSquad!.inviteCode);
  const strangerDetail = await api(`/races/${privRace.id}`, { token: stranger.token });
  const strangerView = strangerDetail.json.race.squads.find((q: any) => q.name === "Private");
  check("a non-member is NOT given the code", strangerView.inviteCode, null);
  check("  but still sees the squad exists", strangerView.name, "Private");

  section("Leagues — promotion, the isOpen gate, no demotion, and the lower-league opt-in");
  const climber = squadUsers[0]; // already has 5 points from winning above
  await prisma.userLeagueState.update({
    where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } },
    data: { totalPoints: 16, qualifiedLevel: 2 },
  });
  const gated = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } } });
  check("qualified for L2 but still placed in L1 while L2 is closed", [gated!.qualifiedLevel, gated!.currentLevel], [2, 1]);

  const standingGated = await api("/me/leagues/steps", { token: climber.token });
  check("  surfaced as a pending promotion, not a failure", standingGated.json.qualifiedForUnopenedLevel, 2);

  const readiness = await api("/admin/leagues/readiness?metricKey=steps", { token: adminUser.token });
  const l2 = readiness.json.levels.find((l: any) => l.level === 2);
  note(`L2 readiness: ${l2.qualifiedCount} qualified, needs ~${l2.recommendedMinimum} to fill ${l2.requiredEntrants}-entrant races`);
  const refused = await api("/admin/leagues/steps/2/open", { method: "POST", token: adminUser.token, body: {} });
  check("opening an under-populated league is refused", refused.status, 400);
  check("  with insufficient_qualified_users", refused.json.error, "insufficient_qualified_users");

  const forced = await api("/admin/leagues/steps/2/open", { method: "POST", token: adminUser.token, body: { force: true } });
  check("force opens it", forced.status, 200);
  check("  and promotes everyone already qualified", forced.json.promotedUsers >= 1, true);
  const promoted = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } } });
  check("  climber now in steps L2", promoted!.currentLevel, 2);
  const swimAfterPromotion = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: climber.id, metricKey: "swimming" } } });
  check("  and swimming is STILL league 1", swimAfterPromotion?.currentLevel ?? 1, 1);

  // ── The lower-league opt-in, now that climber is genuinely in L2 ──
  const lowerRace = await createRace("steps_1d_individual", 1); // L1 — below climber's real L2
  const bareAttempt = await api(`/races/${lowerRace.id}/enter`, { method: "POST", token: climber.token, body: {} });
  check("entering a lower league without opting in is refused", bareAttempt.status, 400);
  check("  with lower_league_available, not a flat wrong_league", bareAttempt.json.error, "lower_league_available");

  const optInAttempt = await api(`/races/${lowerRace.id}/enter`, {
    method: "POST", token: climber.token, body: { acceptLowerLeague: true },
  });
  check("with the explicit opt-in, entry succeeds", optInAttempt.status, 201);
  check("  entry is flagged lowerLeagueOptIn", optInAttempt.json.entry.lowerLeagueOptIn, true);
  check("  and pays L1's fee, not L2's", optInAttempt.json.entry.entryFeeCents, lowerRace.entryFeeCents);

  // A HIGHER league is never enterable, opt-in or not.
  const higherRace = await createRace("steps_1d_individual", 2); // L2 is open now
  const freshL1User = await makeUser(600, 20000);
  const jumpUp = await api(`/races/${higherRace.id}/enter`, {
    method: "POST", token: freshL1User.token, body: { acceptLowerLeague: true },
  });
  check("jumping UP a league is refused even with the opt-in flag", jumpUp.status, 400);
  check("  with a flat wrong_league", jumpUp.json.error, "wrong_league");

  // Run lowerRace to completion with climber winning it outright, and prove
  // the win pays and ranks normally but moves NONE of climber's real
  // standing — not points, not racesWon.
  const lowerFillers = [];
  for (let i = 0; i < 9; i++) lowerFillers.push(await makeUser(610 + i, 20000));
  for (const u of lowerFillers) await api(`/races/${lowerRace.id}/enter`, { method: "POST", token: u.token, body: {} });
  const lowerLocked = await prisma.race.findUniqueOrThrow({ where: { id: lowerRace.id } });
  check("lower-league race locked with climber inside it", lowerLocked.status, "LOCKED");

  const climberBefore = await prisma.userLeagueState.findUniqueOrThrow({ where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } } });

  const lowerRunning = await forceRaceRunning(lowerRace.id, 1);
  const lowerEntries = await prisma.raceEntry.findMany({ where: { raceId: lowerRace.id }, orderBy: { joinedAt: "asc" } });
  const lStart = new Date(lowerRunning.startedAt!.getTime() + 60_000).toISOString();
  const lEnd = new Date(lowerRunning.startedAt!.getTime() + 3_600_000).toISOString();
  for (let i = 0; i < lowerEntries.length; i++) {
    const isClimber = lowerEntries[i].userId === climber.id;
    const owner = [climber, ...lowerFillers].find((u) => u.id === lowerEntries[i].userId)!;
    const steps = isClimber ? 50000 : 5000 + i * 100; // climber walks away with it
    const { json } = await api(`/race-entries/${lowerEntries[i].id}/samples`, {
      method: "POST", token: owner.token, body: { samples: [stepsSample(steps, lStart, lEnd)] },
    });
    if (json.accepted !== 1) throw new Error(`lower-league sample rejected: ${JSON.stringify(json.rejected)}`);
  }
  await resolveDueRaces();

  const climberEntry = await prisma.raceEntry.findUniqueOrThrow({ where: { raceId_userId: { raceId: lowerRace.id, userId: climber.id } } });
  check("climber genuinely won the lower-league race", climberEntry.finishPosition, 1);
  check("  and was paid the L1 1st-place prize", climberEntry.prizeCents, prizeSnapshotFirst(lowerRunning));
  check("  but pointsAwarded is 0, not the nominal +5", climberEntry.pointsAwarded, 0);

  const climberAfter = await prisma.userLeagueState.findUniqueOrThrow({ where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } } });
  check("  totalPoints is UNCHANGED by the win", climberAfter.totalPoints, climberBefore.totalPoints);
  check("  currentLevel is UNCHANGED", climberAfter.currentLevel, climberBefore.currentLevel);
  check("  racesWon did NOT increment despite finishing 1st", climberAfter.racesWon, climberBefore.racesWon);

  const climberPointRow = await prisma.racePointEntry.findFirst({ where: { userId: climber.id, raceId: lowerRace.id } });
  check("  the audit row is stamped lowerLeagueOptIn for later display", climberPointRow?.lowerLeagueOptIn, true);
  check("  and records the real 0, not a suppressed +5", climberPointRow?.points, 0);

  function prizeSnapshotFirst(r: any) {
    return (r.prizeSnapshot as Array<{ position: number; amountCents: number }>).find((p) => p.position === 1)!.amountCents;
  }

  // A bad result must move points down but never the league (unrelated to
  // the opt-in mechanics above — reusing the applyRaceResult helper directly
  // to simulate a subsequent race result for climber's REAL league).
  const demoTx = await prisma.$transaction(async (tx) => {
    return applyRaceResult(tx, {
      userId: climber.id, metricKey: "steps", raceId: squadRace.id,
      raceEntryId: `smoke-demotion-${stamp}`, points: -4, position: 10,
    });
  });
  check("a bad result drops points", demoTx.pointsAfter, climberAfter.totalPoints - 4 < 0 ? 0 : climberAfter.totalPoints - 4);
  check("  but the league does NOT drop", demoTx.levelAfter, 2);
  const afterBad = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: climber.id, metricKey: "steps" } } });
  check("  persisted", afterBad!.currentLevel, 2);

  // Put L2 back to closed so the smoke run leaves config as it found it.
  await prisma.leagueLevel.update({
    where: { metricKey_level: { metricKey: "steps", level: 2 } },
    data: { isOpen: false, openedAt: null },
  });

  section("Creating a private race — pilot: admin-flagged accounts only");
  const organiser = await makeUser(500, 20000);
  await prisma.user.update({ where: { id: organiser.id }, data: { isAdmin: true } });

  const blockedAttempt = await api("/races", {
    method: "POST",
    token: users[1].token, // an ordinary, non-admin racer
    body: { name: "Should be blocked", metricKey: "running", durationDays: 7, format: "INDIVIDUAL" },
  });
  check("a regular user CANNOT create a race during the pilot", blockedAttempt.status, 403);
  check("  with admin_only", blockedAttempt.json.error, "admin_only");

  const created = await api("/races", {
    method: "POST",
    token: organiser.token,
    body: { name: "Smoke Private Solo", metricKey: "running", durationDays: 7, format: "INDIVIDUAL", entryFeeCents: 4200 },
  });
  check("an admin-flagged user CAN create a private race", created.status, 201);
  check("  it is PRIVATE", created.json.race.visibility, "PRIVATE");
  check("  with a shareable code", typeof created.json.inviteCode === "string", true);
  check("  and the creator is entrant 1", created.json.race.entrantsNow, 1);
  check("  anchored to the creator's own timezone", created.json.race.anchorTimezone, "Africa/Johannesburg");

  const createdRow = await prisma.race.findUnique({ where: { id: created.json.race.id } });
  const creatorRunning = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId: organiser.id, metricKey: "running" } } });
  check("  a running race uses the creator's RUNNING league", createdRow!.leagueLevel, creatorRunning!.currentLevel);
  check("  fee came from the host's request", createdRow!.entryFeeCents, 4200);
  check("  prizes came from the frozen schedule", (createdRow!.prizeSnapshot as any[]).length, 5);
  check("  in the creator's own league", createdRow!.leagueLevel, 1);
  const organiserWallet = await prisma.user.findUnique({ where: { id: organiser.id } });
  check("  and the creator was charged", organiserWallet!.walletBalanceCents, 20000 - createdRow!.entryFeeCents);

  const publicAttempt = await api("/races", {
    method: "POST",
    token: organiser.token,
    body: { name: "Smoke Public", metricKey: "steps", durationDays: 1, format: "INDIVIDUAL", visibility: "PUBLIC" },
  });
  check("a user CANNOT create a public race", publicAttempt.status, 400);
  check("  with public_race_not_user_creatable", publicAttempt.json.error, "public_race_not_user_creatable");

  const byCode = await api(`/races/by-code/${created.json.inviteCode}`, { token: users[1].token });
  check("the race code resolves for an invitee", byCode.status, 200);
  check("  naming the race", byCode.json.race.name, "Smoke Private Solo");

  section("Race /me/stats and /metric-types stay race-only");
  const stats = await api("/me/stats", { token: users[1].token });
  check("/me/stats responds", stats.status, 200);
  check("  with race stats, not challenge stats", "racesEntered" in stats.json, true);
  check("  and no global rank", "rank" in stats.json, false);

  const metrics = await api("/metric-types");
  const metricKeys = metrics.json.metricTypes.map((m: any) => m.key).sort();
  check("race metric-types are the four race metrics, no sleep", metricKeys, ["cycling", "running", "steps", "swimming"]);
  check("  and no pace-target flag on them", "supportsPaceTarget" in metrics.json.metricTypes[0], false);
  check("  and no daily-target fields", "defaultTarget" in metrics.json.metricTypes[0], false);

  section("StreakPot — pooled stakes, zero platform commission");
  const platformBefore = await prisma.user.findUniqueOrThrow({ where: { email: "platform@streak.demo" } });

  const potStart = new Date(Date.now() + 3_000); // a couple seconds out, satisfies "must be in the future"
  const created2 = await api("/challenges", {
    method: "POST",
    token: adminUser.token,
    body: {
      title: "Smoke Solo Steps Pot",
      durationDays: 1,
      startDate: potStart.toISOString(),
      stakeCents: 5000,
      visibility: "PUBLIC",
      mode: "SOLO",
      metricRequirements: [{ metricKey: "steps", dailyTarget: 5000 }],
    },
  });
  check("admin can create a StreakPot challenge", created2.status, 201);
  const challengeId = created2.json.challenge.id;

  const blockedCreate = await api("/challenges", {
    method: "POST",
    token: users[1].token,
    body: { title: "Should be blocked", durationDays: 1, startDate: potStart.toISOString(), stakeCents: 1000, visibility: "PUBLIC", mode: "SOLO", metricRequirements: [{ metricKey: "steps", dailyTarget: 1000 }] },
  });
  check("a regular user CANNOT create a challenge during the pilot", blockedCreate.status, 403);

  // Squad challenges have no squad entity (no ChallengeSquad table), so
  // there's no way to form one and WHOLE_GROUP elimination has nothing to
  // scope to. Creation must refuse rather than produce a challenge people
  // could stake into and never take part in properly.
  const squadAttempt = await api("/challenges", {
    method: "POST",
    token: adminUser.token,
    body: {
      title: "Should be refused",
      durationDays: 7,
      startDate: potStart.toISOString(),
      stakeCents: 5000,
      visibility: "PUBLIC",
      mode: "SQUAD",
      eliminationScope: "WHOLE_GROUP",
      metricRequirements: [{ metricKey: "steps", dailyTarget: 5000 }],
    },
  });
  check("SQUAD challenges are refused while squads don't exist", squadAttempt.status, 400);
  check("  with a validation error naming mode", squadAttempt.json.message?.includes("Squad challenges aren't available yet"), true);

  const finisher = await makeUser(900, 20000);
  const quitter = await makeUser(901, 20000);
  const joinFinisher = await api(`/challenges/${challengeId}/join`, { method: "POST", token: finisher.token, body: {} });
  check("finisher joins and stakes", joinFinisher.status, 201);
  const joinQuitter = await api(`/challenges/${challengeId}/join`, { method: "POST", token: quitter.token, body: {} });
  check("quitter joins and stakes", joinQuitter.status, 201);

  const finisherAfterJoin = await prisma.user.findUniqueOrThrow({ where: { id: finisher.id } });
  check("stake debited immediately at join", finisherAfterJoin.walletBalanceCents, 20000 - 5000);
  const holdEntry = await prisma.ledgerEntry.findFirst({ where: { userId: finisher.id, challengeId, type: "STAKE_HOLD" } });
  check("STAKE_HOLD is PENDING before the challenge starts", holdEntry!.status, "PENDING");

  const afterStart = new Date(potStart.getTime() + 1_000);
  const startResult = await startDueChallenges(afterStart);
  // >= 1, not === 1. The job starts every challenge that is due, and a
  // leftover from an interrupted run makes an exact count fail for a reason
  // that has nothing to do with what is being tested. The assertion that
  // matters is the status check on THIS challenge, immediately below.
  check("challenge lifecycle starts it", startResult.started >= 1, true);
  const activeChallenge = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  check("status is ACTIVE", activeChallenge.status, "ACTIVE");
  const heldNowCompleted = await prisma.ledgerEntry.findFirst({ where: { userId: finisher.id, challengeId, type: "STAKE_HOLD" } });
  check("STAKE_HOLD becomes COMPLETED once ACTIVE (stake genuinely at risk)", heldNowCompleted!.status, "COMPLETED");

  const finisherParticipant = await prisma.challengeParticipant.findUniqueOrThrow({ where: { challengeId_userId: { challengeId, userId: finisher.id } } });
  // The participant's own LOCAL calendar date for the challenge's start
  // instant — not a raw UTC slice, which would be flaky near UTC midnight
  // for a Johannesburg (UTC+2) participant.
  const finisherStartLocal = toZonedTime(activeChallenge.startDate, finisherParticipant.timezone);
  const localDate = `${finisherStartLocal.getFullYear()}-${String(finisherStartLocal.getMonth() + 1).padStart(2, "0")}-${String(finisherStartLocal.getDate()).padStart(2, "0")}`;
  const checkInWindow = windowInsideLocalDay(activeChallenge.startDate, finisherParticipant.timezone);
  const checkIn = await api(`/challenge-participants/${finisherParticipant.id}/check-in`, {
    method: "POST",
    token: finisher.token,
    body: { localDate, samples: [stepsSample(6000, checkInWindow.start, checkInWindow.end)] },
  });
  check("finisher's check-in is accepted", checkIn.status, 200);
  check("  and passes (6000 >= 5000 target)", checkIn.json.dayResult, "PASSED");

  // Evidence retention: challenges used to score a day and discard the raw
  // samples, leaving a disputed day with nothing behind it but one computed
  // total, and anomaly flags with nothing to hang off.
  const storedEvidence = await prisma.challengeHealthSample.findMany({ where: { participantId: finisherParticipant.id } });
  check("  the raw sample is retained as evidence", storedEvidence.length, 1);
  check("    against the day's check-in", storedEvidence[0]!.checkInId !== null, true);
  check("    with its source preserved", storedEvidence[0]!.sourceName, "Apple Watch");

  // Re-submitting the same sample must not duplicate the trail — the OS
  // health store is re-read on every foreground.
  await api(`/challenge-participants/${finisherParticipant.id}/check-in`, {
    method: "POST",
    token: finisher.token,
    body: { localDate, samples: [stepsSample(6000, checkInWindow.start, checkInWindow.end)] },
  });
  const afterResubmit = await prisma.challengeHealthSample.count({ where: { participantId: finisherParticipant.id } });
  check("  re-submitting the same sample doesn't duplicate the evidence", afterResubmit, 1);

  // Quitter never checks in — finalizeDueCheckIns scores it SYNC_ISSUE once
  // past cutoff, same as a race entrant who never syncs.
  const wayPastCutoff = new Date(activeChallenge.startDate.getTime() + 2 * 86_400_000);
  const finalizeResult = await finalizeDueCheckIns(wayPastCutoff);
  check("quitter's missed day gets finalized", finalizeResult.finalized >= 1, true);
  const quitterParticipant = await prisma.challengeParticipant.findUniqueOrThrow({ where: { challengeId_userId: { challengeId, userId: quitter.id } } });
  check("quitter is ELIMINATED", quitterParticipant.status, "ELIMINATED");
  const finisherStillActive = await prisma.challengeParticipant.findUniqueOrThrow({ where: { id: finisherParticipant.id } });
  check("finisher stays ACTIVE", finisherStillActive.status, "ACTIVE");

  const resolveResult = await resolveDueChallenges(wayPastCutoff);
  // Same reasoning as startDueChallenges above — scoped by the status check
  // on this specific challenge rather than by a global count.
  check("challenge lifecycle resolves it", resolveResult.resolved >= 1, true);
  const completedChallenge = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  check("status is COMPLETED", completedChallenge.status, "COMPLETED");

  const finisherWallet = await prisma.user.findUniqueOrThrow({ where: { id: finisher.id } });
  check("the sole finisher gets the FULL pool (both stakes)", finisherWallet.walletBalanceCents, 20000 - 5000 + 5000 * 2);
  const payout = await prisma.ledgerEntry.findFirst({ where: { userId: finisher.id, challengeId, type: "POOL_PAYOUT" } });
  check("  recorded as POOL_PAYOUT", payout!.amountCents, 10000);
  const finisherParticipantAfter = await prisma.challengeParticipant.findUniqueOrThrow({ where: { id: finisherParticipant.id } });
  check("  finisher's participant status becomes FINISHED", finisherParticipantAfter.status, "FINISHED");
  check("  and escrowStatus RELEASED", finisherParticipantAfter.escrowStatus, "RELEASED");

  const quitterWallet = await prisma.user.findUniqueOrThrow({ where: { id: quitter.id } });
  check("quitter's stake stays gone — no further debit or refund", quitterWallet.walletBalanceCents, 20000 - 5000);
  const forfeitMarker = await prisma.ledgerEntry.findFirst({ where: { userId: quitter.id, challengeId, type: "STAKE_FORFEITED" } });
  check("  a STAKE_FORFEITED marker records where it went", forfeitMarker?.amountCents, 0);

  const platformAfter = await prisma.user.findUniqueOrThrow({ where: { email: "platform@streak.demo" } });
  check("platform account balance is UNCHANGED — zero commission, proven not just asserted", platformAfter.walletBalanceCents, platformBefore.walletBalanceCents);

  section("StreakPot — withdrawal, invites, and redemption");
  const wStart = new Date(Date.now() + 3_000);
  const inviteOnly = await api("/challenges", {
    method: "POST",
    token: adminUser.token,
    body: {
      title: "Invite-only Smoke Pot",
      durationDays: 3,
      startDate: wStart.toISOString(),
      stakeCents: 4000,
      visibility: "INVITE_ONLY",
      mode: "SOLO",
      metricRequirements: [{ metricKey: "steps", dailyTarget: 5000 }],
    },
  });
  check("an INVITE_ONLY challenge can be created", inviteOnly.status, 201);
  const ioId = inviteOnly.json.challenge.id;
  const ioCode = (await prisma.challenge.findUniqueOrThrow({ where: { id: ioId } })).inviteCode!;
  check("  and gets a shareable code", typeof ioCode === "string", true);

  const quitter2 = await makeUser(960, 20000);
  const noCode = await api(`/challenges/${ioId}/join`, { method: "POST", token: quitter2.token, body: {} });
  check("joining an invite-only challenge without the code is refused", noCode.status, 403);
  check("  and nothing was staked", (await prisma.user.findUniqueOrThrow({ where: { id: quitter2.id } })).walletBalanceCents, 20000);

  const joinWithCode = await api(`/challenges/${ioId}/join`, { method: "POST", token: quitter2.token, body: { inviteCode: ioCode } });
  check("with the code, joining succeeds", joinWithCode.status, 201);
  check("  and the stake is debited", (await prisma.user.findUniqueOrThrow({ where: { id: quitter2.id } })).walletBalanceCents, 20000 - 4000);

  // Withdrawal is only allowed while OPEN — once ACTIVE the stake is
  // committed, because everyone else's share of the pool depends on it.
  const wd = await api(`/challenges/${ioId}/withdraw`, { method: "POST", token: quitter2.token });
  check("a participant can withdraw before the challenge starts", wd.status, 200);
  check("  refunded in full", wd.json.refundedCents, 4000);
  check("  wallet made whole", (await prisma.user.findUniqueOrThrow({ where: { id: quitter2.id } })).walletBalanceCents, 20000);
  const wdRow = await prisma.challengeParticipant.findUniqueOrThrow({
    where: { challengeId_userId: { challengeId: ioId, userId: quitter2.id } },
  });
  check("  status is WITHDRAWN", wdRow.status, "WITHDRAWN");

  // Rejoin, then start the challenge, and confirm withdrawal is refused.
  await api(`/challenges/${ioId}/join`, { method: "POST", token: quitter2.token, body: { inviteCode: ioCode } });
  await startDueChallenges(new Date(wStart.getTime() + 1_000));
  const lateWd = await api(`/challenges/${ioId}/withdraw`, { method: "POST", token: quitter2.token });
  check("withdrawal is refused once the challenge is ACTIVE", lateWd.status, 400);
  check("  with cannot_withdraw", lateWd.json.error, "cannot_withdraw");

  // Redemption: charged immediately, and the fee joins the POOL rather than
  // becoming platform revenue — the whole point of zero commission.
  const platformBeforeRedemption = (await prisma.user.findUniqueOrThrow({ where: { email: "platform@streak.demo" } })).walletBalanceCents;
  const redeemParticipant = await prisma.challengeParticipant.findUniqueOrThrow({
    where: { challengeId_userId: { challengeId: ioId, userId: quitter2.id } },
  });
  const walletBeforeRedemption = (await prisma.user.findUniqueOrThrow({ where: { id: quitter2.id } })).walletBalanceCents;
  const redeem = await api(`/challenge-participants/${redeemParticipant.id}/redemption`, { method: "POST", token: quitter2.token });
  check("a redemption can be bought while active", redeem.status, 200);
  check("  charged the fixed fee", redeem.json.feeCents, 2000);
  check("  debited from the wallet", (await prisma.user.findUniqueOrThrow({ where: { id: quitter2.id } })).walletBalanceCents, walletBeforeRedemption - 2000);
  check(
    "  and the platform account did NOT gain it — the fee goes to the pool",
    (await prisma.user.findUniqueOrThrow({ where: { email: "platform@streak.demo" } })).walletBalanceCents,
    platformBeforeRedemption
  );
  const secondRedeem = await api(`/challenge-participants/${redeemParticipant.id}/redemption`, { method: "POST", token: quitter2.token });
  check("a second redemption is refused — one per challenge", secondRedeem.status, 400);
  check("  with already_purchased", secondRedeem.json.error, "already_purchased");

  // Someone else's participant record must not be redeemable by you.
  const nosy = await makeUser(961, 20000);
  const crossRedeem = await api(`/challenge-participants/${redeemParticipant.id}/redemption`, { method: "POST", token: nosy.token });
  check("another user CANNOT buy a redemption on your participation", crossRedeem.status, 403);

  section("Forfeiting a held prize is attributed — it had no attribution at all");
  // forfeitHeldPrize is disqualifyEntry's money-side sibling: a prize held
  // for review that is confirmed as fraud and never paid. It took no
  // reviewer id of any kind before today — the parameter didn't exist.
  //
  // A PENDING RACE_PRIZE row is created directly (same posture as the
  // RaceHealthSample/RaceAnomalyFlag fixtures above) rather than driving an
  // entire race through fill, lock and resolution just to reach the one
  // state this route acts on.
  const forfeitRace = await createRace("running_1d_individual", 1);
  const forfeitWinner = await makeUser(9800, 20000);
  const forfeitEntryRes = await api(`/races/${forfeitRace.id}/enter`, { method: "POST", token: forfeitWinner.token, body: {} });
  check("the would-be winner can enter", forfeitEntryRes.status, 201);
  const heldPrize = await prisma.ledgerEntry.create({
    data: {
      userId: forfeitWinner.id,
      raceId: forfeitRace.id,
      type: "RACE_PRIZE",
      status: "PENDING",
      amountCents: forfeitRace.entryFeeCents * 3,
      currency: "zar",
      description: "smoke test — held for review",
    },
  });

  const forfeitNotAdmin = await api(`/admin/race-prizes/${heldPrize.id}/forfeit`, { method: "POST", token: forfeitWinner.token, body: { reason: "x" } });
  check("a non-admin cannot forfeit a held prize", forfeitNotAdmin.status, 403);

  const forfeitRes = await api(`/admin/race-prizes/${heldPrize.id}/forfeit`, {
    method: "POST",
    token: adminUser.token,
    body: { reason: "smoke test confirmed cheat" },
  });
  check("an admin can forfeit a held prize", forfeitRes.status, 200);
  const forfeitedRow = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: heldPrize.id } });
  check("  status becomes FAILED — never paid", forfeitedRow.status, "FAILED");
  check("  attributed to the forfeiting admin", forfeitedRow.performedByUserId, adminUser.id);

  const forfeitAgain = await api(`/admin/race-prizes/${heldPrize.id}/forfeit`, { method: "POST", token: adminUser.token, body: { reason: "double forfeit" } });
  check("forfeiting an already-forfeited prize is refused", forfeitAgain.status, 400);
  check("  with not_held", forfeitAgain.json.error, "not_held");

  section("Anomaly flag review is attributed to the acting admin, not the caller");
  // reviewedBy used to be a free-text field the CLIENT supplied on the
  // request body — forgeable, optional, and never checked against who was
  // actually authenticated. That mattered because DISMISSED releases a held
  // prize, and disqualifyEntry's reviewerId parameter was optional and its
  // only caller never passed it at all, so a CONFIRMED_CHEAT disqualify was
  // never attributed to anyone. Neither path had any coverage before this.
  const flagRace = await createRace("running_1d_individual", 1);
  const flaggedUser = await makeUser(9700, 20000);
  const flagEntryRes = await api(`/races/${flagRace.id}/enter`, { method: "POST", token: flaggedUser.token, body: {} });
  check("the flagged user can enter a race", flagEntryRes.status, 201);
  const flagEntry = await prisma.raceEntry.findFirstOrThrow({ where: { raceId: flagRace.id, userId: flaggedUser.id } });

  // Health samples and flags are set up directly, the same way makeInviteCode
  // bypasses HTTP for setup elsewhere in this suite — the anomaly rules
  // themselves aren't what's under test here.
  const flagSample = await prisma.raceHealthSample.create({
    data: {
      raceEntryId: flagEntry.id,
      metricKey: "running",
      value: 42000,
      unit: "meters",
      startTime: new Date(Date.now() - 3_600_000),
      endTime: new Date(),
      sourceBundleId: `smoke_flagtest_${stamp}`,
      sourceName: "Smoke Watch",
      wasManualEntry: false,
    },
  });
  const dismissFlag = await prisma.raceAnomalyFlag.create({
    data: { sampleId: flagSample.id, raceId: flagRace.id, raceEntryId: flagEntry.id, ruleKey: "smoke.test", severity: "MEDIUM", details: {} },
  });
  const disqualifyFlag = await prisma.raceAnomalyFlag.create({
    data: { sampleId: flagSample.id, raceId: flagRace.id, raceEntryId: flagEntry.id, ruleKey: "smoke.test", severity: "HIGH", details: {} },
  });

  const dismissNotAdmin = await api(`/admin/race-flags/${dismissFlag.id}`, { method: "POST", token: flaggedUser.token, body: { decision: "DISMISSED" } });
  check("a non-admin cannot review a flag", dismissNotAdmin.status, 403);

  const dismissRes = await api(`/admin/race-flags/${dismissFlag.id}`, { method: "POST", token: adminUser.token, body: { decision: "DISMISSED" } });
  check("an admin can dismiss a flag", dismissRes.status, 200);
  const dismissedRow = await prisma.raceAnomalyFlag.findUniqueOrThrow({ where: { id: dismissFlag.id } });
  check("  status becomes DISMISSED", dismissedRow.status, "DISMISSED");
  check("  attributed to the ACTING admin from the session, not something the client sent", dismissedRow.reviewedByUserId, adminUser.id);

  // A client-supplied reviewer name must be ignored entirely — there is no
  // longer a field for it to land in, so this proves the old spoof vector is
  // gone rather than just unused.
  const spoofAttempt = await api(`/admin/race-flags/${disqualifyFlag.id}`, {
    method: "POST",
    token: adminUser.token,
    body: { decision: "DISMISSED", reviewedBy: "someone-else-entirely" },
  });
  check("a client-supplied reviewer name is silently ignored", spoofAttempt.status, 200);
  const spoofedRow = await prisma.raceAnomalyFlag.findUniqueOrThrow({ where: { id: disqualifyFlag.id } });
  check("  attribution still points at the real caller", spoofedRow.reviewedByUserId, adminUser.id);

  // Separately: disqualifyEntry's own attribution, via a fresh flag so this
  // assertion doesn't depend on the DISMISSED one above.
  const cheatFlag = await prisma.raceAnomalyFlag.create({
    data: { sampleId: flagSample.id, raceId: flagRace.id, raceEntryId: flagEntry.id, ruleKey: "smoke.test", severity: "HIGH", details: {} },
  });
  const disqualifyRes = await api(`/admin/race-entries/${flagEntry.id}/disqualify`, {
    method: "POST",
    token: adminUser.token,
    body: { reason: "smoke test confirmed cheat" },
  });
  check("an admin can disqualify an entry", disqualifyRes.status, 200);
  const disqualifiedEntry = await prisma.raceEntry.findUniqueOrThrow({ where: { id: flagEntry.id } });
  check("  entry status becomes DISQUALIFIED", disqualifiedEntry.status, "DISQUALIFIED");
  const cheatFlagAfter = await prisma.raceAnomalyFlag.findUniqueOrThrow({ where: { id: cheatFlag.id } });
  check("  the entry's open flags become CONFIRMED_CHEAT", cheatFlagAfter.status, "CONFIRMED_CHEAT");
  check(
    "  attributed to the disqualifying admin — this call site used to drop the id entirely",
    cheatFlagAfter.reviewedByUserId,
    adminUser.id
  );

  section("Every /admin route rejects anonymous and non-admin callers");
  // Enumerated from the LIVE route table, not hand-listed — so a new /admin
  // route added without a requireAdmin guard fails here rather than shipping
  // open. Two such routes (/admin/reports and /admin/race-flags) WERE open
  // until this test was written.
  //
  // This used to be a hand-maintained array carrying the same claim in a
  // comment, which is a promise the code did not keep: four admin routes
  // added for the sponsored-pilot money model slipped through it untested.
  // buildServer() has no side effects — the scheduler and listen() live in
  // the entrypoint below it — so the table can just be read.
  const adminRoutes = await enumerateAdminRoutes();
  if (adminRoutes.length < 12) throw new Error(`only found ${adminRoutes.length} admin routes — enumeration is probably broken`);

  const plainUser = users[1];
  let anonOk = 0;
  let nonAdminOk = 0;
  for (const route of adminRoutes) {
    const anon = await api(route.path, { method: route.method, body: route.method === "POST" ? {} : undefined });
    if (anon.status === 401) anonOk++;
    else console.log(`  !! ${route.method} ${route.path} allowed an ANONYMOUS caller (${anon.status})`);

    const nonAdmin = await api(route.path, { method: route.method, token: plainUser.token, body: route.method === "POST" ? {} : undefined });
    if (nonAdmin.status === 403) nonAdminOk++;
    else console.log(`  !! ${route.method} ${route.path} allowed a NON-ADMIN caller (${nonAdmin.status})`);
  }
  check(`all ${adminRoutes.length} admin routes reject anonymous callers`, anonOk, adminRoutes.length);
  check(`all ${adminRoutes.length} admin routes reject non-admin callers`, nonAdminOk, adminRoutes.length);

  section("Concurrency — the guards the model's core claims rest on");
  // Everything else in this suite enters races one at a time, which is
  // exactly the case the guards are NOT for. Two claims are only meaningful
  // under contention, and both are load-bearing:
  //
  //   1. "exactly N entrants" is the legal and product premise of the whole
  //      fixed-prize model. A count-then-insert would let two simultaneous
  //      10th entrants both read 9 and both insert, producing an 11-entrant
  //      race paying a purse priced for 10.
  //   2. A wallet balance can only be spent once. Two simultaneous entries
  //      against a balance covering one must not both succeed, or the
  //      platform has funded the difference.

  const raceConc = await createRace("steps_1d_individual", 1);
  const rushUsers = await Promise.all(Array.from({ length: 15 }, (_, i) => makeUser(1000 + i, 20000)));

  // All 15 fire at once at a race that has exactly 10 slots.
  const rushResults = await Promise.all(
    rushUsers.map((u) => api(`/races/${raceConc.id}/enter`, { method: "POST", token: u.token, body: {} }))
  );
  const accepted = rushResults.filter((r) => r.status === 201).length;
  const rushRefused = rushResults.filter((r) => r.status !== 201).length;
  check("15 simultaneous entries to a 10-slot race: exactly 10 accepted", accepted, 10);
  check("  and the other 5 refused", rushRefused, 5);

  const rushRow = await prisma.race.findUniqueOrThrow({ where: { id: raceConc.id } });
  const rushEntries = await prisma.raceEntry.count({ where: { raceId: raceConc.id, status: "ENTERED" } });
  check("  the race holds exactly its headcount, never more", rushEntries, raceConc.entrantCount);
  check("  and locked", rushRow.status, "LOCKED");
  check("  exactly one entry reported the lock", rushResults.filter((r) => r.json?.lockedRace === true).length, 1);

  // Double-spend: one wallet, enough for exactly one entry, two races at once.
  const raceA = await createRace("steps_1d_individual", 1);
  const raceB = await createRace("steps_7d_individual", 1);
  const feeA = raceA.entryFeeCents;
  const brokeUser = await makeUser(1100, feeA); // exactly one entry's worth

  const [tryA, tryB] = await Promise.all([
    api(`/races/${raceA.id}/enter`, { method: "POST", token: brokeUser.token, body: {} }),
    api(`/races/${raceB.id}/enter`, { method: "POST", token: brokeUser.token, body: {} }),
  ]);
  const spendAccepted = [tryA, tryB].filter((r) => r.status === 201).length;
  check("one balance, two simultaneous entries: only one succeeds", spendAccepted, 1);
  const brokeAfter = await prisma.user.findUniqueOrThrow({ where: { id: brokeUser.id } });
  check("  and the wallet never goes negative", brokeAfter.walletBalanceCents >= 0, true);
  check("  exactly one fee was taken", brokeAfter.walletBalanceCents, feeA - (spendAccepted === 1 ? feeA : 0));

  section("Pilot money model — sponsored in, EFT out, nothing paid in");
  // The first ~50 users are funded by the platform, so deposits are off and
  // the only way money enters a wallet is an admin grant. Payouts are sent
  // by hand, which is also the only place a fabricated self-imported result
  // gets caught before it becomes cash.
  const sponsored = await makeUser(9400, 0);
  const sponsorAdmin = await makeUser(9401, 0);
  await prisma.user.update({ where: { id: sponsorAdmin.id }, data: { isAdmin: true } });

  const depositBlocked = await api("/me/wallet/deposit/intent", {
    method: "POST",
    token: sponsored.token,
    body: { amountCents: 5000 },
  });
  check("depositing is refused while the pilot is sponsored", depositBlocked.status, 403);
  check("  with deposits_disabled", depositBlocked.json.error, "deposits_disabled");

  const grantRef = `smoke_grant_${stamp}`;
  const notAdmin = await api("/admin/sponsored-credit", {
    method: "POST",
    token: sponsored.token,
    body: { email: sponsored.email, amountCents: 10000, grantRef },
  });
  check("a non-admin cannot grant themselves credit", notAdmin.status, 403);

  const granted = await api("/admin/sponsored-credit", {
    method: "POST",
    token: sponsorAdmin.token,
    body: { email: sponsored.email, amountCents: 10000, grantRef, note: "pilot wave 1" },
  });
  check("an admin can sponsor an account", granted.status, 200);
  check("  and the balance lands", granted.json.wallet?.balanceCents, 10000);

  // The operator is a person at a terminal; the failure mode is paying twice.
  const repeat = await api("/admin/sponsored-credit", {
    method: "POST",
    token: sponsorAdmin.token,
    body: { email: sponsored.email, amountCents: 10000, grantRef },
  });
  check("the same grant reference is refused", repeat.status, 409);
  const afterRepeat = await prisma.user.findUniqueOrThrow({ where: { id: sponsored.id } });
  check("  and nothing was granted twice", afterRepeat.walletBalanceCents, 10000);

  // A granted balance is a platform liability the moment it exists, because
  // the holder can withdraw it as cash — so the platform side must move too.
  const platformAfterGrant = await prisma.user.findUniqueOrThrow({ where: { email: "platform@streak.demo" } });
  const grantExpense = await prisma.ledgerEntry.findFirst({
    where: { externalRef: grantRef, type: "SPONSORED_CREDIT_EXPENSE" },
  });
  check("the platform records the sponsorship as an expense", grantExpense != null, true);
  check("  for the mirrored amount", grantExpense?.amountCents, -10000);

  // Attribution: a grant is a one-tap action in the admin console with no
  // shell history behind it, so "who did this" has to be a real column, not
  // text an admin might type into a note field. Both ledger rows for one
  // grant carry the same admin id.
  const grantCredit = await prisma.ledgerEntry.findFirst({ where: { externalRef: grantRef, type: "SPONSORED_CREDIT" } });
  check("the recipient's own ledger row is attributed to the admin", grantCredit?.performedByUserId, sponsorAdmin.id);
  check("  and so is the platform's mirrored expense", grantExpense?.performedByUserId, sponsorAdmin.id);

  // The invite-code route's happy path had no coverage at all — only the
  // blanket admin-guard sweep touched it, and only to check the 403 case.
  // Minting one for real also checks the same attribution.
  const mintedCodes = await api("/admin/invite-codes", {
    method: "POST",
    token: sponsorAdmin.token,
    body: { count: 2, label: `smoke_${stamp}` },
  });
  check("an admin can mint invite codes", mintedCodes.status, 201);
  check("  the requested count", mintedCodes.json.codes?.length, 2);
  check("  attributed to the minting admin", mintedCodes.json.codes?.[0]?.createdByUserId, sponsorAdmin.id);
  const mintNotAdmin = await api("/admin/invite-codes", {
    method: "POST",
    token: sponsored.token,
    body: { count: 1 },
  });
  check("a non-admin cannot mint invite codes", mintNotAdmin.status, 403);

  // Automated payouts are off, so those methods must refuse rather than
  // reach for credentials this deployment does not have.
  const autoPayout = await api("/me/wallet/withdraw", {
    method: "POST",
    token: sponsored.token,
    body: { amountCents: 10000, destination: { method: "PAYPAL", email: "nobody@smoke.example.com" } },
  });
  check("PayPal payout is refused while automated payouts are off", autoPayout.status, 400);
  check("  with automated_payouts_disabled", autoPayout.json.error, "automated_payouts_disabled");
  const afterRefusedPayout = await prisma.user.findUniqueOrThrow({ where: { id: sponsored.id } });
  check("  and the balance is given back, not stranded", afterRefusedPayout.walletBalanceCents, 10000);

  const eft = await api("/me/wallet/withdraw", {
    method: "POST",
    token: sponsored.token,
    body: {
      amountCents: 10000,
      destination: { method: "MANUAL", bankName: "Capitec", accountNumber: "1234567890", accountName: "Smoke Tester" },
    },
  });
  check("an EFT withdrawal is accepted", eft.status, 200);
  check("  and debits the wallet immediately", eft.json.balanceCents, 0);

  const queue = await api("/admin/withdrawals", { token: sponsorAdmin.token });
  check("it appears in the admin payout queue", queue.status, 200);
  const queued = (queue.json.withdrawals ?? []).find((w: any) => w.user?.id === sponsored.id);
  check("  with the bank details the user typed", queued?.manualAccountNumber, "1234567890");
  check("  and who to pay", queued?.manualAccountName, "Smoke Tester");

  const queueUnauth = await api("/admin/withdrawals", { token: sponsored.token });
  check("a normal user cannot read the payout queue", queueUnauth.status, 403);

  // Rejecting must give the money back by the same path a failed provider
  // payout uses — one reversal, one place.
  const rejected = await api(`/admin/withdrawals/${queued.id}/reject`, {
    method: "POST",
    token: sponsorAdmin.token,
    body: { reason: "smoke test" },
  });
  check("an admin can reject a queued payout", rejected.status, 200);
  const afterReject = await prisma.user.findUniqueOrThrow({ where: { id: sponsored.id } });
  check("  and the money goes back to the user", afterReject.walletBalanceCents, 10000);

  const secondEft = await api("/me/wallet/withdraw", {
    method: "POST",
    token: sponsored.token,
    body: {
      amountCents: 10000,
      destination: { method: "MANUAL", bankName: "Capitec", accountNumber: "1234567890", accountName: "Smoke Tester" },
    },
  });
  check("the user can request again after a rejection", secondEft.status, 200);
  const queue2 = await api("/admin/withdrawals", { token: sponsorAdmin.token });
  const queued2 = (queue2.json.withdrawals ?? []).find((w: any) => w.user?.id === sponsored.id);
  const eftPaid = await api(`/admin/withdrawals/${queued2.id}/mark-paid`, {
    method: "POST",
    token: sponsorAdmin.token,
    body: { reference: `EFT-${stamp}` },
  });
  check("marking it paid closes the record", eftPaid.status, 200);
  const afterPaid = await prisma.user.findUniqueOrThrow({ where: { id: sponsored.id } });
  check("  and moves no money — the wallet was already debited", afterPaid.walletBalanceCents, 0);

  const paidTwice = await api(`/admin/withdrawals/${queued2.id}/mark-paid`, {
    method: "POST",
    token: sponsorAdmin.token,
    body: { reference: `EFT-${stamp}` },
  });
  check("marking the same payout paid twice is refused", paidTwice.status, 400);

  section("Workout-file import is the pilot's evidence path");
  // Replaces the Strava sync for the pilot: a browser has no health store,
  // and exporting a file from a watch is a smaller ask than connecting a
  // third-party account. Covers running, cycling and swimming — steps and
  // sleep are daily totals, not activities, and have no file to export.
  //
  // The point of these is that an upload joins the SAME ingestion path as a
  // HealthKit sample: dedup, ownership and metric checks all apply because
  // they were never import-specific.
  const importer = await makeUser(9500, 10_000);
  // Created rather than found: relying on a race the suite happened to leave
  // lying around makes this depend on the order everything above it ran in.
  const importRace = await createRace("running_1d_individual", 1);
  // Entered through the real route rather than inserted, so the entry has
  // everything the ingestion path expects (timezone, fee ledger row, ...).
  const enterForImport = await api(`/races/${importRace.id}/enter`, { method: "POST", token: importer.token, body: {} });
  check("the importer can enter a running race", enterForImport.status, 201);
  const importEntry = await prisma.raceEntry.findFirstOrThrow({ where: { raceId: importRace.id, userId: importer.id } });

  const gpxFor = (points: number, stepMeters: number, stepSeconds: number, type = "running") => {
    const start = new Date(Date.now() - 3_600_000).getTime();
    const pts: string[] = [];
    for (let i = 0; i < points; i++) {
      const lat = -33.9 + (i * stepMeters) / 111_320;
      pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="18.42"><time>${new Date(start + i * stepSeconds * 1000).toISOString()}</time></trkpt>`);
    }
    return `<?xml version="1.0"?><gpx version="1.1" creator="Smoke Watch"><trk><type>${type}</type><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
  };

  const uploadFile = async (entryId: string, body: string, filename: string, token: string) => {
    const form = new FormData();
    form.append("file", new Blob([body], { type: "application/octet-stream" }), filename);
    const res = await fetch(`${API}/race-entries/${entryId}/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const goodGpx = gpxFor(40, 100, 25);
  const up1 = await uploadFile(importEntry.id, goodGpx, "morning-run.gpx", importer.token);
  check("a GPX file can be imported against a race entry", up1.status, 200);
  check("  and is recognised as the right sport", up1.json.imported?.metricKey, "running");
  check("  with a distance read off the track", Math.abs((up1.json.imported?.distanceMeters ?? 0) - 3900) < 100, true);

  // The dedup guard is the sourceBundleId, which is a hash of the bytes — so
  // the same file twice must not score twice. This is the same guard that
  // protects a Strava re-sync; it was never import-specific.
  const before = await prisma.raceHealthSample.count({ where: { raceEntryId: importEntry.id } });
  const up2 = await uploadFile(importEntry.id, goodGpx, "morning-run.gpx", importer.token);
  const after = await prisma.raceHealthSample.count({ where: { raceEntryId: importEntry.id } });
  check("re-uploading the identical file adds no new evidence", after, before);
  check("  and is not reported as an error", up2.status, 200);

  // A ride is not a run. Scoring it as one would be free distance.
  const wrongSport = await uploadFile(importEntry.id, gpxFor(40, 300, 25, "cycling"), "ride.gpx", importer.token);
  check("a cycling file is refused on a running race", wrongSport.status, 400);
  check("  with wrong_sport", wrongSport.json.error, "wrong_sport");

  const impossible = await uploadFile(importEntry.id, gpxFor(20, 2000, 1), "car.gpx", importer.token);
  check("a physically impossible file is refused", impossible.status, 400);
  check("  as implausible_activity", impossible.json.error, "implausible_activity");

  const junk = await uploadFile(importEntry.id, "this is not a workout", "notes.txt", importer.token);
  check("a file that is not a workout is refused", junk.status, 400);

  // An entry id is not a capability — the same rule the samples route follows.
  const importStranger = await makeUser(9501, 0);
  const crossImport = await uploadFile(importEntry.id, gpxFor(40, 100, 25), "theirs.gpx", importStranger.token);
  check("importing into someone else's race entry is refused", crossImport.status, 403);

  const anonImport = await fetch(`${API}/race-entries/${importEntry.id}/import`, { method: "POST" });
  check("importing without a session is refused", anonImport.status, 401);

  section("StreakPot check-in by file — the only way to check in on the web");
  // syncChallengeCheckIn reads the device health store, and a browser has
  // none. Without this route a web participant could stake money into a
  // challenge and then have no way to pass a single day of it.
  const potStart2 = new Date(Date.now() + 2_000);
  const runPot = await api("/challenges", {
    method: "POST",
    token: adminUser.token,
    body: {
      title: "Smoke Running Pot",
      durationDays: 2,
      startDate: potStart2.toISOString(),
      stakeCents: 2000,
      visibility: "PUBLIC",
      mode: "SOLO",
      metricRequirements: [{ metricKey: "running", dailyTarget: 3000 }],
    },
  });
  check("a running challenge can be created", runPot.status, 201);
  const runPotId = runPot.json.challenge.id;

  const runner = await makeUser(9600, 10_000);
  const joinRunner = await api(`/challenges/${runPotId}/join`, { method: "POST", token: runner.token, body: {} });
  check("the runner joins and stakes", joinRunner.status, 201);
  // Day 1 becomes YESTERDAY, local. That is the point: anchoring the
  // fixture activity to "now" leaves only whatever is left of today, which
  // just after local midnight is seconds — not enough for both a plausible
  // pace and a meaningful distance. A finished day always has 24 hours.
  // (Creation still had to be given a future startDate to pass validation.)
  const potTz = "Africa/Johannesburg";
  const yesterdayLocal = formatInTimeZone(new Date(Date.now() - 24 * 3_600_000), potTz, "yyyy-MM-dd");
  const utcOffset = formatInTimeZone(new Date(), potTz, "XXX");
  await prisma.challenge.update({
    where: { id: runPotId },
    data: { startDate: new Date(`${yesterdayLocal}T00:00:00${utcOffset}`) },
  });
  await startDueChallenges(new Date());
  const runnerParticipant = await prisma.challengeParticipant.findUniqueOrThrow({
    where: { challengeId_userId: { challengeId: runPotId, userId: runner.id } },
  });

  /**
   * A morning run on day 1. Fixed wall-clock position inside a finished
   * local day, so the fixture behaves identically at every hour the suite
   * might be run at — including the minutes either side of local midnight,
   * which is where the previous "an hour ago" version fell over.
   */
  const activityGpx = (type = "running", kmh = 10) => {
    const points = 30;
    const durationMs = 20 * 60_000;
    const startMs = new Date(`${yesterdayLocal}T08:00:00${utcOffset}`).getTime();
    const stepSeconds = durationMs / 1000 / (points - 1);
    const stepMeters = (kmh * 1000 * (durationMs / 3_600_000)) / (points - 1);
    const pts: string[] = [];
    for (let i = 0; i < points; i++) {
      const lat = -33.9 + (i * stepMeters) / 111_320;
      pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="18.42"><time>${new Date(startMs + i * stepSeconds * 1000).toISOString()}</time></trkpt>`);
    }
    return `<?xml version="1.0"?><gpx version="1.1" creator="Smoke Watch"><trk><type>${type}</type><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
  };

  const uploadTo = async (path: string, body: string, filename: string, token: string) => {
    const form = new FormData();
    form.append("file", new Blob([body], { type: "application/octet-stream" }), filename);
    const res = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const potImport = await uploadTo(
    `/challenge-participants/${runnerParticipant.id}/import`,
    activityGpx(),
    "run.gpx",
    runner.token
  );
  check("a workout file can be checked in against a challenge", potImport.status, 200);
  check("  and passes the day (3.3km >= 3km target)", potImport.json.dayResult, "PASSED");

  // The day is derived from WHEN the activity happened, in the participant's
  // timezone — never taken from the request. Otherwise someone could move a
  // workout onto whichever day they still needed.
  const expectedLocalDate = yesterdayLocal;
  check("  attributed to the day the activity happened", potImport.json.imported?.localDate, expectedLocalDate);

  const potEvidence = await prisma.challengeHealthSample.findMany({ where: { participantId: runnerParticipant.id } });
  check("  and the file is retained as evidence", potEvidence.length > 0, true);

  const potWrongSport = await uploadTo(
    `/challenge-participants/${runnerParticipant.id}/import`,
    activityGpx("cycling", 25),
    "ride.gpx",
    runner.token
  );
  check("a ride is refused on a running challenge", potWrongSport.status, 400);
  check("  with wrong_sport", potWrongSport.json.error, "wrong_sport");

  const potStranger = await makeUser(9601, 0);
  const potCross = await uploadTo(
    `/challenge-participants/${runnerParticipant.id}/import`,
    activityGpx(),
    "theirs.gpx",
    potStranger.token
  );
  check("checking in on someone else's participation is refused", potCross.status, 403);

  section("Static file serving cannot reach outside the web build");
  // The API and the web bundle share one origin, so @fastify/static's root
  // sits inside a directory that also contains .env and the compiled server.
  // @fastify/static <=10.1.1 carries two advisories about exactly this
  // (GHSA-8pvw-jcv7-9cmj, GHSA-83w8-p2f5-377r), and the fix is a Fastify 5
  // major. These assert what actually matters — that no encoding of "go up a
  // directory" reaches a real file — so the answer is a fact about this
  // deployment rather than a guess from a version number.
  //
  // Every one of these currently returns index.html via the SPA fallback,
  // which is correct: an unknown path is a client route, not a file.
  const traversals = [
    "/../.env",
    "/..%2f.env",
    "/%2e%2e/.env",
    "/..%5c.env",
    "/_expo/../../.env",
    "//.env",
    "/./../.env",
    "/../package.json",
    "/package.json",
    "/../src/lib/env.ts",
  ];
  for (const path of traversals) {
    const res = await fetch(`${API}${path}`);
    const body = res.status === 200 ? await res.text() : "";
    const leaked =
      body.includes("PAYSTACK_SECRET_KEY") ||
      body.includes("JWT_SECRET") ||
      body.includes("DATABASE_URL") ||
      body.includes(String.fromCharCode(34) + "dependencies" + String.fromCharCode(34));
    check(`${path} leaks nothing`, leaked, false);
  }

  section("The rate-limit bucket cannot be chosen by the caller");
  // keyGenerator used to be `req.headers.authorization ?? req.ip` — the raw
  // header, which the client picks. Sending a different random string each
  // request landed every one in a fresh bucket, so the global limit applied
  // to nobody willing to send `Authorization: Bearer <junk>`. Demonstrated
  // against a running server with the IP bucket already exhausted: 200 of
  // 200 rotating-header requests returned 200 while unheadered ones were
  // being 429'd.
  //
  // Tested at the function rather than over HTTP because loopback is
  // allowlisted outside production (so the smoke suite can sign up hundreds
  // of users), and the bug was entirely in this logic.
  const fakeVerifier = {
    verify: <T,>(token: string): T => {
      if (token === "valid-session") return { sub: "user-123" } as T;
      if (token === "valid-state") return { sub: "user-123", purpose: "strava_oauth" } as T;
      throw new Error("invalid token");
    },
  };
  const IP = "203.0.113.9";
  check("no header falls back to the IP", rateLimitKey(fakeVerifier, undefined, IP), IP);
  check("a junk bearer token falls back to the IP", rateLimitKey(fakeVerifier, "Bearer junk-" + Math.random(), IP), IP);
  check("  so two different junk tokens share one bucket", 
    rateLimitKey(fakeVerifier, "Bearer junkA", IP) === rateLimitKey(fakeVerifier, "Bearer junkB", IP), true);
  check("a non-Bearer header falls back to the IP", rateLimitKey(fakeVerifier, "Basic abc123", IP), IP);
  check("a valid session keys on the user, not the IP", rateLimitKey(fakeVerifier, "Bearer valid-session", IP), "user:user-123");
  check("an OAuth state token is not an identity", rateLimitKey(fakeVerifier, "Bearer valid-state", IP), IP);

  section("Strava OAuth binds its callback to the account that started it");
  // The state parameter used to be randomBytes(8) that was generated, sent
  // to Strava, and thrown away — never stored, never checked. That is OAuth
  // with no CSRF protection: an attacker authorises THEIR Strava account,
  // keeps the code, and gets a signed-in victim to open
  // /strava-callback?code=<theirs>. The victim posts it with the victim's
  // session and the attacker's Strava is bound to the victim's account —
  // which on web, where Strava is the only evidence source, is control of
  // what the victim's races score.
  const stravaVictim = await makeUser(9300, 0);
  const stravaAttacker = await makeUser(9301, 0);

  const authUrl = await api("/integrations/strava/authorize-url", { token: stravaAttacker.token });
  check("an authorize-url can be minted", authUrl.status, 200);
  const stravaAttackerState = new URL(authUrl.json.url).searchParams.get("state") ?? "";
  check("  and carries a state parameter", stravaAttackerState.length > 0, true);

  // The heart of it: the attacker's state, replayed against the victim's
  // session, must be refused BEFORE any code is exchanged with Strava.
  const csrf = await api("/integrations/strava/callback", {
    method: "POST",
    token: stravaVictim.token,
    body: { code: "attacker_code_would_go_here", state: stravaAttackerState },
  });
  check("another account's state is refused", csrf.status, 400);
  check("  with invalid_state, not a Strava error", csrf.json.error, "invalid_state");

  const noState = await api("/integrations/strava/callback", {
    method: "POST",
    token: stravaVictim.token,
    body: { code: "some_code" },
  });
  check("a callback with no state at all is refused", noState.status >= 400, true);

  const forged = await api("/integrations/strava/callback", {
    method: "POST",
    token: stravaVictim.token,
    body: { code: "some_code", state: "not-a-real-token" },
  });
  check("a forged state is refused", forged.status, 400);
  check("  as invalid_state", forged.json.error, "invalid_state");

  // A state token is signed with the same secret as a session token, so it
  // must not be usable as one just because it carries a sub.
  const asSession = await api("/me", { token: stravaAttackerState });
  check("a state token cannot be used as a session token", asSession.status, 401);

  section("A deposit is recoverable when the confirm never comes back");
  // Every deposit used to depend entirely on the browser making it back from
  // Paystack to call confirm. If it did not — tab closed on the success
  // screen, connection dropped, backgrounded tab discarded — Paystack had
  // the money and nothing in the system knew a deposit had been attempted.
  // These assert the DepositIntent row that makes it reconcilable exists and
  // is driven to a terminal state.
  const depositor = await makeUser(9200, 0, { realisticEmail: true });

  // Straight at the service, not the HTTP route: deposits are switched off
  // for the sponsored pilot and the route now (correctly) returns 403. The
  // Paystack code is still live and still has to work the day it is turned
  // back on, so it keeps its coverage — the gating itself is asserted in the
  // pilot money-model section above.
  const intentRes = { json: await createDeposit({ userId: depositor.id, amountCents: 5000 }) };
  check("a deposit intent can be created", typeof intentRes.json.reference === "string", true);

  const intentRow = await prisma.depositIntent.findUnique({ where: { reference: intentRes.json.reference } });
  check("  it is recorded before the user ever reaches Paystack", intentRow != null, true);
  check("  as PENDING", intentRow?.status, "PENDING");
  check("  for the right amount", intentRow?.amountCents, 5000);
  check("  owned by the depositor", intentRow?.userId, depositor.id);

  // The reconciler leaves fresh intents alone — the normal redirect confirm
  // has to get its chance first.
  const freshPass = await reconcilePendingDeposits();
  const stillFresh = await prisma.depositIntent.findUnique({ where: { reference: intentRes.json.reference } });
  check("a just-created intent is not touched by the reconciler", stillFresh?.status, "PENDING");
  check("  and is not even examined", freshPass.examined === 0 || !freshPass.credited, true);

  // Aged past the grace window, an unpaid checkout resolves rather than
  // sitting PENDING forever. (Nobody paid this test reference, so Paystack
  // reports it as abandoned/failed — which is the point: it must NOT credit.)
  const balanceBefore = (await prisma.user.findUniqueOrThrow({ where: { id: depositor.id } })).walletBalanceCents;
  await prisma.depositIntent.update({
    where: { reference: intentRes.json.reference },
    data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
  });
  await reconcilePendingDeposits();
  const aged = await prisma.depositIntent.findUnique({ where: { reference: intentRes.json.reference } });
  check("an unpaid intent past the cutoff stops being PENDING", aged?.status !== "PENDING", true);
  check("  and is never marked COMPLETED", aged?.status !== "COMPLETED", true);
  check("  with the reason recorded", typeof aged?.failureReason === "string", true);
  const balanceAfter = (await prisma.user.findUniqueOrThrow({ where: { id: depositor.id } })).walletBalanceCents;
  check("  and crucially credits nothing", balanceAfter, balanceBefore);

  section("A token outliving its account is 401, not 500");
  // JWTs are long-lived, so one routinely outlives a deleted account. The
  // middleware used to verify only the signature, leaving req.userId naming
  // a row that no longer existed — every handler below then dereferenced it
  // and returned 500 (or 404) on every request, forever, instead of the
  // client simply being signed out. Two "unreproducible" 500 storms during
  // manual testing turned out to be exactly this.
  const doomed = await makeUser(9100, 0);
  const doomedToken = doomed.token;
  await prisma.$transaction(async (tx) => {
    await tx.notificationLog.deleteMany({ where: { userId: doomed.id } });
    await tx.pushToken.deleteMany({ where: { userId: doomed.id } });
    await tx.ledgerEntry.deleteMany({ where: { userId: doomed.id } });
    await tx.raceEntry.deleteMany({ where: { userId: doomed.id } });
    await tx.challengeParticipant.deleteMany({ where: { userId: doomed.id } });
    await tx.userLeagueState.deleteMany({ where: { userId: doomed.id } });
    await tx.user.delete({ where: { id: doomed.id } });
  });

  for (const path of ["/me", "/me/leagues", "/me/wallet", "/me/ledger", "/races?scope=my_league", "/challenges?scope=mine"]) {
    const res = await api(path, { token: doomedToken });
    check(`${path} on a deleted account is 401`, res.status, 401);
  }

  section("Cross-user access — an id is not a capability");
  // The counterpart to the /admin sweep above. These routes all take an id
  // that identifies SOMEONE'S row, and an id is guessable/enumerable — so
  // each has to check ownership rather than treating possession of the id as
  // permission. Submitting samples against another person's race entry would
  // be the most direct way to cheat in the whole app.
  const victimEntry = await prisma.raceEntry.findFirstOrThrow({ where: { raceId: race.id, userId: users[0].id } });
  const attacker = users[5];

  const stealSamples = await api(`/race-entries/${victimEntry.id}/samples`, {
    method: "POST",
    token: attacker.token,
    body: { samples: [stepsSample(9999, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString())] },
  });
  check("submitting samples against someone else's race entry is refused", stealSamples.status, 403);

  const stealSync = await api(`/race-entries/${victimEntry.id}/sync-strava`, { method: "POST", token: attacker.token });
  check("syncing Strava into someone else's race entry is refused", stealSync.status, 403);

  const victimParticipant = await prisma.challengeParticipant.findFirstOrThrow({ where: { userId: finisher.id } });
  const stealCheckIn = await api(`/challenge-participants/${victimParticipant.id}/check-in`, {
    method: "POST",
    token: attacker.token,
    body: { localDate: "2026-08-26", samples: [stepsSample(9999, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString())] },
  });
  check("checking in on someone else's challenge participation is refused", stealCheckIn.status, 403);

  section("Push notifications — registration, ownership transfer, dedupe");
  const pushUserA = await makeUser(950, 0);
  const pushUserB = await makeUser(951, 0);
  const FAKE_TOKEN = `ExponentPushToken[smoke-${stamp}]`;

  const reg = await api("/push-tokens", { method: "POST", token: pushUserA.token, body: { token: FAKE_TOKEN, platform: "WEB" } });
  check("a device can register a push token", reg.status, 201);
  const storedA = await prisma.pushToken.findUnique({ where: { token: FAKE_TOKEN } });
  check("  stored against the registering user", storedA!.userId, pushUserA.id);
  check("  with the WEB platform (not just IOS/ANDROID)", storedA!.platform, "WEB");

  // The handed-on-device case: the same physical device signing in as
  // someone else must MOVE the token, not accumulate a second row — or the
  // new owner's device keeps delivering the previous owner's results.
  const reReg = await api("/push-tokens", { method: "POST", token: pushUserB.token, body: { token: FAKE_TOKEN, platform: "WEB" } });
  check("re-registering the same token as another user succeeds", reReg.status, 201);
  const allForToken = await prisma.pushToken.findMany({ where: { token: FAKE_TOKEN } });
  check("  still exactly one row, not two", allForToken.length, 1);
  check("  and it now belongs to the new user", allForToken[0]!.userId, pushUserB.id);

  // A token string is not a secret — one account must not be able to
  // deregister another's device by guessing it.
  const crossDelete = await api(`/push-tokens/${encodeURIComponent(FAKE_TOKEN)}`, { method: "DELETE", token: pushUserA.token });
  check("a different user CANNOT deregister someone else's token", crossDelete.status, 200);
  check("  the token survives that attempt", (await prisma.pushToken.findUnique({ where: { token: FAKE_TOKEN } })) !== null, true);

  const ownDelete = await api(`/push-tokens/${encodeURIComponent(FAKE_TOKEN)}`, { method: "DELETE", token: pushUserB.token });
  check("the owning user CAN deregister it", ownDelete.status, 200);
  check("  and it's gone", await prisma.pushToken.findUnique({ where: { token: FAKE_TOKEN } }), null);

  // sendOnce's dedupe guard is a unique constraint rather than a
  // check-then-act read, so two racing ticks can't both send.
  const first = await sendOnce(pushUserA.id, "challenge_checkin_reminder", `smoke-${stamp}:2026-08-26`, { title: "t", body: "b" });
  const second = await sendOnce(pushUserA.id, "challenge_checkin_reminder", `smoke-${stamp}:2026-08-26`, { title: "t", body: "b" });
  check("sendOnce sends the first time", first, true);
  check("  and refuses the duplicate", second, false);
  const differentDay = await sendOnce(pushUserA.id, "challenge_checkin_reminder", `smoke-${stamp}:2026-08-27`, { title: "t", body: "b" });
  check("  but a different day is a different notification", differentDay, true);

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nSMOKE ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
