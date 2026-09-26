import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  friendship: { findFirst: vi.fn() },
  raceEntry: { findMany: vi.fn() },
  socialPost: { findMany: vi.fn(), findUniqueOrThrow:vi.fn() },
}));
vi.mock("../../lib/prisma.js", () => ({ prisma: db }));
vi.mock("../races/leagues.js", () => ({
  getLeagueStandings: vi.fn(async () => ({ standings: [], primaryMetricKey: "steps" })),
}));
vi.mock("../notifications/inbox.js", () => ({notifyActivity:vi.fn()}));
import { getPlayerProfile, socialInteractionPatch } from "./service.js";

// Emulate Prisma's selection against a record containing large media. The
// budget covers data read from the database as well as the HTTP response.
function project(record: any, select: any): any {
  if (!select || record == null) return record;
  if (Array.isArray(record)) return record.map((row) => project(row, select));
  return Object.fromEntries(Object.entries(select).filter(([, selection]) => selection).map(([key, selection]) => [
    key, selection === true ? record[key] : project(record[key], (selection as any).select),
  ]));
}

describe("player profile payload", () => {
  it("keeps displayed profile content without reading photo galleries or race participant payloads", async () => {
    const createdAt = new Date("2026-09-01T00:00:00Z");
    const avatar = `data:image/jpeg;base64,${"a".repeat(500_000)}`;
    const photo = `data:image/jpeg;base64,${"b".repeat(750_000)}`;
    const player = { id: "player", displayName: "Runner", avatarUrl: null, bio: "On the move", createdAt };
    const race = {
      id: "race", name: "Weekend run", metricKey: "running", status: "COMPLETED",
      league: { name: "Bronze", level: 1 }, entries: [{ user: { avatarUrl: avatar } }], squads: [],
    };
    const entry = { id: "entry", finishPosition: 1, pointsAwarded: 10, race };
    const posts = [
      { id: "photo-post", body: "Finished!", imageUrl: photo, createdAt, author: { avatarUrl: avatar }, comments: [{ user: { avatarUrl: avatar } }], raceEntry: null },
      { id: "result-post", body: "First place", imageUrl: null, createdAt, author: { avatarUrl: avatar }, comments: [], raceEntry: { race } },
    ];
    let relationBytes = 0;
    db.user.findUnique.mockResolvedValue(player);
    db.friendship.findFirst.mockResolvedValue(null);
    db.raceEntry.findMany.mockImplementation(async ({ select }) => {
      const rows = project([entry], select);
      relationBytes += JSON.stringify(rows).length;
      return rows;
    });
    db.socialPost.findMany.mockImplementation(async ({ select }) => {
      const rows = project(posts, select);
      relationBytes += JSON.stringify(rows).length;
      return rows;
    });

    const profile = await getPlayerProfile("viewer", "player");

    expect(profile.player.displayName).toBe("Runner");
    expect(profile.raceHistory[0]).toMatchObject({
      id: "entry", finishPosition: 1, pointsAwarded: 10,
      race: { name: "Weekend run", metricKey: "running", status: "COMPLETED", league: { name: "Bronze" } },
    });
    expect(profile.posts.map((post) => ({ id: post.id, body: post.body, race: post.raceResult?.race.name ?? null }))).toEqual([
      { id: "photo-post", body: "Finished!", race: null },
      { id: "result-post", body: "First place", race: "Weekend run" },
    ]);
    expect(relationBytes).toBeLessThan(4_000);
    expect(JSON.stringify(profile).length).toBeLessThan(4_000);
  });
});

it("social interaction responses do not query unchanged photos, game actions or race relations",async()=>{
 const record={id:'post',imageUrl:'x'.repeat(500000),event:{game:{actions:Array(1000).fill({})}},raceEntry:{},_count:{likes:2,comments:1,shares:0},likes:[{id:'like'}],comments:[{id:'c',body:'Nice!',createdAt:new Date(),user:{id:'u',displayName:'Runner',avatarUrl:'x'.repeat(500000)}}]};
 let selected:any;
 db.socialPost.findUniqueOrThrow.mockImplementation(async({select})=>{selected=project(record,select);return selected;});
 const patch=await socialInteractionPatch('post','viewer');
 expect(patch).toMatchObject({id:'post',likeCount:2,hasLiked:true});
 expect(patch.comments[0]?.body).toBe('Nice!');
 expect(JSON.stringify(selected).length).toBeLessThan(1000);
 expect(JSON.stringify(patch).length).toBeLessThan(1000);
});
