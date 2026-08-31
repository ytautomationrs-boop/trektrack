import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Deletes everything scripts/smoke-races.ts created, and nothing else.
 *
 * Run after a smoke run:  npm run smoke:clean
 *
 * ## Why this script is careful
 *
 * An earlier version deleted every race a smoke user had entered, along with
 * all of that race's entries and ledger rows. When the smoke run had joined a
 * race a REAL user was already in — which it did, because it grabbed whatever
 * race happened to be open — the real user's entry and ledger row were
 * deleted too, while their wallet was never refunded. They were simply out
 * the entry fee with no record of it.
 *
 * Two independent guards now prevent that:
 *
 *  1. smoke-races.ts creates its own dedicated races rather than joining
 *     shared open ones, so real users are never in the same race.
 *  2. This script refuses to touch any race that contains a non-smoke entry,
 *     and refunds the smoke entries individually instead. Belt and braces —
 *     guard 1 should make this unreachable, but the cost of it being wrong is
 *     somebody's money.
 *
 * The same two guards apply to StreakPot challenges: a challenge is only
 * deleted whole when every participant in it is a smoke user.
 */

const prisma = new PrismaClient();
// Both are EXACT suffixes matched with endsWith, never a substring: a
// `contains` filter here once deleted three real dev fixtures.
// @smoke.example.com exists because Paystack rejects the .test TLD, so a
// user that has to reach Paystack needs a real one; example.com is
// IANA-reserved and can never be a genuine account.
const SMOKE_EMAIL_SUFFIXES = ["@smoke.test", "@smoke.example.com"];

async function main() {
  await deleteSmokeUsersAndTheirData();
  // Runs regardless of whether there were smoke users to delete: leftover
  // config and stranded races outlive the run that created them, so a
  // second `smoke:clean` should still tidy them rather than no-op.
  await restoreLeaguesAndClearStrandedRaces();
  await reportCounts();
}

async function deleteSmokeUsersAndTheirData() {
  const smokeUsers = await prisma.user.findMany({
    where: { OR: SMOKE_EMAIL_SUFFIXES.map((suffix) => ({ email: { endsWith: suffix } })) },
    select: { id: true },
  });
  const smokeIds = new Set(smokeUsers.map((u) => u.id));
  console.log(`smoke users found: ${smokeIds.size}`);
  if (smokeIds.size === 0) return;

  const touchedRaceIds = [
    ...new Set(
      (
        await prisma.raceEntry.findMany({
          where: { userId: { in: [...smokeIds] } },
          select: { raceId: true },
        })
      ).map((e) => e.raceId)
    ),
  ];

  // Split the races into ones that are purely smoke (safe to delete whole)
  // and ones a real user is also in (must be left standing).
  const races = await prisma.race.findMany({
    where: { id: { in: touchedRaceIds } },
    include: { entries: { select: { id: true, userId: true } } },
  });

  const pureSmokeRaceIds: string[] = [];
  const sharedRaces: typeof races = [];
  for (const race of races) {
    if (race.entries.every((e) => smokeIds.has(e.userId))) pureSmokeRaceIds.push(race.id);
    else sharedRaces.push(race);
  }

  if (sharedRaces.length > 0) {
    console.warn(
      `\n!! ${sharedRaces.length} race(s) contain non-smoke entrants and will NOT be deleted.\n` +
        `   Only the smoke entries in them are removed; real entries and their ledger rows stay put.\n` +
        `   Race ids: ${sharedRaces.map((r) => r.id).join(", ")}\n`
    );
  }

  // Reverse the platform's side of anything the smoke suite did, so the
  // platform account is left exactly where it started.
  //
  // Sponsorship grants count: each one DEBITS the platform, so a run that
  // pretends to sponsor R100 leaves the platform R100 down forever unless it
  // is reversed here.
  //
  // Matched by PAIRING with the smoke user's own SPONSORED_CREDIT row via
  // externalRef, not by a naming convention on the ref itself. This used to
  // match only refs starting with "smoke_grant_" — the prefix smoke-races.ts
  // happens to use — which meant a sponsorship granted through the real
  // admin console (using a realistic ref like "email:amount:date", exactly
  // what a human operator types) was never reversed. The user still got
  // deleted by the broad email-suffix match below, and the platform's debit
  // was permanently orphaned — no user left to reconcile it against. Caught
  // in practice: -R250 stuck on the platform account with no code path back.
  const smokeSponsoredRefs = (
    await prisma.ledgerEntry.findMany({
      where: { type: "SPONSORED_CREDIT", userId: { in: [...smokeIds] } },
      select: { externalRef: true },
    })
  )
    .map((r) => r.externalRef)
    .filter((ref): ref is string => ref != null);

  const platformRows = await prisma.ledgerEntry.findMany({
    where: {
      OR: [
        { raceId: { in: pureSmokeRaceIds }, type: { in: ["RACE_ENTRY_REVENUE", "RACE_PRIZE_EXPENSE"] } },
        { type: "SPONSORED_CREDIT_EXPENSE", externalRef: { in: smokeSponsoredRefs } },
      ],
    },
    select: { userId: true, amountCents: true },
  });
  const platformDelta = new Map<string, number>();
  for (const row of platformRows) {
    platformDelta.set(row.userId, (platformDelta.get(row.userId) ?? 0) + row.amountCents);
  }

  const smokeEntryIds = (
    await prisma.raceEntry.findMany({
      where: { OR: [{ raceId: { in: pureSmokeRaceIds } }, { userId: { in: [...smokeIds] } }] },
      select: { id: true },
    })
  ).map((e) => e.id);

  // StreakPot. Same posture as races above: a challenge is only deleted whole
  // if every participant in it is a smoke user, so a real person's stake and
  // its ledger rows are never swept up in a test cleanup.
  const touchedChallengeIds = [
    ...new Set(
      (
        await prisma.challengeParticipant.findMany({
          where: { userId: { in: [...smokeIds] } },
          select: { challengeId: true },
        })
      ).map((p) => p.challengeId)
    ),
  ];
  const challenges = await prisma.challenge.findMany({
    // Challenges a smoke user CREATED are included too, even with no smoke
    // participants: Challenge.creatorId is a required FK, so leaving one
    // behind would block deleting its creator.
    where: { OR: [{ id: { in: touchedChallengeIds } }, { creatorId: { in: [...smokeIds] } }] },
    include: { participants: { select: { userId: true } } },
  });

  const pureSmokeChallengeIds: string[] = [];
  const sharedChallenges: typeof challenges = [];
  for (const c of challenges) {
    if (c.participants.every((p) => smokeIds.has(p.userId))) pureSmokeChallengeIds.push(c.id);
    else sharedChallenges.push(c);
  }
  if (sharedChallenges.length > 0) {
    console.warn(
      `\n!! ${sharedChallenges.length} challenge(s) contain non-smoke participants and will NOT be deleted.\n` +
        `   Only the smoke participants in them are removed.\n` +
        `   Challenge ids: ${sharedChallenges.map((c) => c.id).join(", ")}\n`
    );
  }

  await prisma.$transaction(async (tx) => {
    // StreakPot first — DailyCheckIn/DailyMetricResult hang off participants,
    // and Challenge.creatorId is a required FK into User, so all of it has to
    // clear before the user rows below.
    const smokeParticipantIds = (
      await tx.challengeParticipant.findMany({
        where: { OR: [{ userId: { in: [...smokeIds] } }, { challengeId: { in: pureSmokeChallengeIds } }] },
        select: { id: true },
      })
    ).map((p) => p.id);
    const smokeCheckInIds = (
      await tx.dailyCheckIn.findMany({ where: { participantId: { in: smokeParticipantIds } }, select: { id: true } })
    ).map((c) => c.id);

    await tx.dailyMetricResult.deleteMany({ where: { checkInId: { in: smokeCheckInIds } } });
    await tx.dailyCheckIn.deleteMany({ where: { id: { in: smokeCheckInIds } } });
    await tx.challengeParticipant.deleteMany({ where: { id: { in: smokeParticipantIds } } });
    await tx.challengeInvite.deleteMany({
      where: { OR: [{ challengeId: { in: pureSmokeChallengeIds } }, { inviterId: { in: [...smokeIds] } }] },
    });
    await tx.challengeMetricRequirement.deleteMany({ where: { challengeId: { in: pureSmokeChallengeIds } } });
    await tx.ledgerEntry.deleteMany({ where: { challengeId: { in: pureSmokeChallengeIds } } });
    await tx.challenge.deleteMany({ where: { id: { in: pureSmokeChallengeIds } } });

    // Notifications and push tokens are per-user with no wider blast radius.
    await tx.notificationLog.deleteMany({ where: { userId: { in: [...smokeIds] } } });
    await tx.pushToken.deleteMany({ where: { userId: { in: [...smokeIds] } } });
    // Matched on EITHER the code or the label prefix. makeInviteCode()
    // writes its own "smoke_"-prefixed code directly via Prisma, bypassing
    // HTTP entirely — but a code minted through the real admin route (as the
    // route's own happy-path test now does) gets a random hex code from the
    // server and only the LABEL carries the smoke_ marker. Matching on code
    // alone silently left every code minted that way to accumulate forever.
    await tx.inviteCode.deleteMany({
      where: { OR: [{ code: { startsWith: "smoke_" } }, { label: { startsWith: "smoke_" } }] },
    });

    await tx.raceAnomalyFlag.deleteMany({ where: { raceEntryId: { in: smokeEntryIds } } });
    await tx.raceHealthSample.deleteMany({ where: { raceEntryId: { in: smokeEntryIds } } });
    await tx.racePointEntry.deleteMany({
      where: { OR: [{ userId: { in: [...smokeIds] } }, { raceId: { in: pureSmokeRaceIds } }] },
    });
    // Withdrawals FIRST: each one holds an FK to the LedgerEntry deleted
    // just below, so removing the ledger row first violates
    // Withdrawal_ledgerEntryId_fkey and aborts the whole cleanup.
    await tx.withdrawal.deleteMany({ where: { userId: { in: [...smokeIds] } } });
    // Deposit intents are FK-cascaded on the user, but delete them here too
    // so the count reported at the end reflects an actually-clean database.
    await tx.depositIntent.deleteMany({ where: { userId: { in: [...smokeIds] } } });

    // Ledger: smoke users' own rows, plus platform rows for pure-smoke races.
    // Never rows belonging to a real user. The sponsorship pair is included
    // via the platform-side clause, matched by pairing with smokeSponsoredRefs
    // (computed above from the smoke user's own SPONSORED_CREDIT rows) — NOT
    // by the "smoke_grant_" prefix, for the same reason the balance-reversal
    // query above was fixed to stop using it: a grant made through the real
    // admin console carries a realistic reference, not that prefix, and this
    // query deciding what to DELETE is a separate concern from the one above
    // deciding what to REVERSE. Fixing only the reversal query left the
    // platform's balance correct but its SPONSORED_CREDIT_EXPENSE row behind
    // forever — a stale, orphaned-looking entry with no way to trace back to
    // a user that no longer exists, sitting in an otherwise-clean ledger.
    await tx.ledgerEntry.deleteMany({
      where: {
        OR: [
          { userId: { in: [...smokeIds] } },
          { raceId: { in: pureSmokeRaceIds }, type: { in: ["RACE_ENTRY_REVENUE", "RACE_PRIZE_EXPENSE"] } },
          { type: "SPONSORED_CREDIT_EXPENSE", externalRef: { in: smokeSponsoredRefs } },
        ],
      },
    });
    await tx.raceEntry.deleteMany({ where: { id: { in: smokeEntryIds } } });
    await tx.raceSquad.deleteMany({ where: { raceId: { in: pureSmokeRaceIds } } });
    await tx.userLeagueState.deleteMany({ where: { userId: { in: [...smokeIds] } } });
    await tx.race.deleteMany({ where: { id: { in: pureSmokeRaceIds } } });
    await tx.user.deleteMany({ where: { id: { in: [...smokeIds] } } });

    for (const [userId, delta] of platformDelta) {
      await tx.user.update({ where: { id: userId }, data: { walletBalanceCents: { decrement: delta } } });
    }
  });

  console.log(
    `deleted ${smokeIds.size} users, ${pureSmokeRaceIds.length} races, ${smokeEntryIds.length} entries, ` +
      `${pureSmokeChallengeIds.length} challenges`
  );
  for (const [userId, delta] of platformDelta) {
    console.log(`reversed R${delta / 100} from platform account ${userId}`);
  }

}

async function restoreLeaguesAndClearStrandedRaces() {
  // A smoke run force-opens league 2; put it back so config is as it was.
  await prisma.leagueLevel.updateMany({
    where: { level: { gt: 1 }, isOpen: true },
    data: { isOpen: false, openedAt: null },
  });

  // Re-closing those leagues strands any race the lifecycle job opened in
  // them: a race in a CLOSED league can never be entered, so a FILLING one
  // with no entrants is unreachable by construction and just accumulates —
  // every smoke run was leaving a few behind (24 had built up before this
  // was added).
  //
  // Deliberately narrow: only zero-entry races, only in closed leagues.
  // A race anyone has actually entered is never touched here, and neither is
  // anything in league 1, which stays open and legitimately holds the
  // platform's standing public races.
  const strandedRaces = await prisma.race.findMany({
    where: {
      status: "FILLING",
      entries: { none: {} },
      league: { isOpen: false },
    },
    select: { id: true },
  });
  await deleteRaces(strandedRaces.map((r) => r.id), "unreachable race(s) left in now-closed leagues");

  // Duplicate empty races in OPEN leagues.
  //
  // ensureOpenRaces maintains exactly one FILLING race per (type, league) —
  // it skips the bucket entirely when one already exists. So a second empty
  // FILLING race in the same bucket cannot have come from normal operation;
  // it's a smoke run that called createRace directly. Keeping the oldest per
  // bucket preserves precisely what the lifecycle job would maintain, and
  // deletes only the surplus.
  //
  // Still restricted to ZERO-entry races, so nothing anyone has entered is
  // ever in scope.
  const emptyOpen = await prisma.race.findMany({
    where: { status: "FILLING", entries: { none: {} }, league: { isOpen: true } },
    select: { id: true, raceTypeKey: true, leagueLevel: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const keptPerBucket = new Set<string>();
  const surplus: string[] = [];
  for (const race of emptyOpen) {
    const bucket = `${race.raceTypeKey}:${race.leagueLevel}`;
    if (keptPerBucket.has(bucket)) surplus.push(race.id);
    else keptPerBucket.add(bucket);
  }
  await deleteRaces(surplus, "surplus empty race(s) beyond the one per type/league the lifecycle job maintains");
}

async function deleteRaces(ids: string[], label: string) {
  if (ids.length === 0) return;
  await prisma.$transaction([
    prisma.raceSquad.deleteMany({ where: { raceId: { in: ids } } }),
    prisma.ledgerEntry.deleteMany({ where: { raceId: { in: ids } } }),
    prisma.race.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`removed ${ids.length} ${label}`);
}

async function reportCounts() {
  const [users, remainingRaces, entries, challenges] = await Promise.all([
    prisma.user.count(),
    prisma.race.count(),
    prisma.raceEntry.count(),
    prisma.challenge.count(),
  ]);
  console.log(
    `\nafter cleanup — users ${users}, races ${remainingRaces}, entries ${entries}, ` +
      `challenges ${challenges}; leagues above 1 re-closed`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
