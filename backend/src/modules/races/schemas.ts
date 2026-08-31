import { z } from "zod";
import { HealthSampleInputSchema } from "../health/schemas.js";

/**
 * Note what a race creator does NOT get to set: the entry fee, the prize
 * schedule, the field size, or which league it runs in. All four are
 * platform configuration read from RacePrizeSchedule at creation time. A
 * creator picking their own fee or prize would make the prize a function of
 * what entrants put in, which is precisely the structure this model exists
 * to avoid.
 */

export const EnterRaceSchema = z
  .object({
    // Squad races only. Exactly one of these three, and none of them for an
    // individual race.
    //
    // squadId alone only works for a squad whose captain marked it OPEN;
    // an invite-only squad needs squadInviteCode. See
    // modules/races/service.ts resolveSquadSlot.
    squadId: z.string().optional(),
    squadInviteCode: z.string().min(4).max(32).optional(),
    squadName: z.string().min(2).max(30).optional(),
    // Only read when founding a squad. Omitted means INVITE_ONLY — a captain
    // opts in to letting strangers take a seat, rather than opting out.
    squadJoinPolicy: z.enum(["INVITE_ONLY", "OPEN"]).optional(),
    // Explicit opt-in to enter a race below the caller's own current league
    // for this metric — the 'my league is empty right now' fallback. Without
    // this, entering a lower-league race is refused with lower_league_available
    // rather than a flat wrong_league, so the client can offer this flag as a
    // follow-up rather than a dead end.
    acceptLowerLeague: z.boolean().default(false),
  })
  .refine(
    (b) => [b.squadId, b.squadInviteCode, b.squadName].filter(Boolean).length <= 1,
    {
      message: "Pass only one of squadId, squadInviteCode or squadName.",
      path: ["squadId"],
    }
  )
  .refine((b) => !(b.squadJoinPolicy && !b.squadName), {
    message: "squadJoinPolicy only applies when founding a squad with squadName.",
    path: ["squadJoinPolicy"],
  });

export const SubmitRaceSamplesSchema = z.object({
  samples: z.array(HealthSampleInputSchema).min(1).max(200),
});

export const ListRacesQuerySchema = z.object({
  // Defaults to the caller's own league, which is the only one they can
  // enter. `all` lets the discover screen show what exists above them as
  // aspiration without implying it is joinable.
  scope: z.enum(["my_league", "all"]).default("my_league"),
  metricKey: z.string().optional(),
  format: z.enum(["INDIVIDUAL", "SQUAD"]).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export const OpenLeagueSchema = z.object({
  // Opening a league below its recommended qualified-user count is a real
  // decision with a real consequence (races that cannot fill), so it takes
  // an explicit flag rather than being the default behaviour.
  force: z.boolean().default(false),
});

export const DisqualifySchema = z.object({
  reason: z.string().min(3).max(500),
});

export type EnterRaceInput = z.infer<typeof EnterRaceSchema>;
export type ListRacesQuery = z.infer<typeof ListRacesQuerySchema>;

/**
 * Creating a race.
 *
 * The five things a creator chooses — name, metric, duration, format,
 * visibility — and nothing else. Metric is a single value, not a list: a
 * race cannot combine metrics because there is no non-arbitrary way to
 * weight (say) swum metres against run metres in one ranked ordering.
 */
export const CreateRaceSchema = z.object({
  name: z.string().trim().min(3).max(50),
  metricKey: z.enum(["steps", "running", "cycling", "swimming"]),
  // Exactly two options. There is no custom duration: every extra duration
  // is another pool that has to reach its own exact headcount.
  durationDays: z.union([z.literal(1), z.literal(7)]),
  format: z.enum(["INDIVIDUAL", "SQUAD"]),
  // PUBLIC is accepted but rejected server-side with a clear message —
  // public races are platform-opened so that one shared queue per league
  // actually fills. Modelled here rather than omitted so the client can
  // show the option and explain why it is unavailable.
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  // Squad races only: the creator founds the first squad.
  squadName: z.string().trim().min(2).max(30).optional(),
  squadJoinPolicy: z.enum(["INVITE_ONLY", "OPEN"]).optional(),
});

export type CreateRaceInput = z.infer<typeof CreateRaceSchema>;
