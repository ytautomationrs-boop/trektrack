import { sendApplePush } from "./apns.js";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";

/**
 * Push notifications, sent through Expo's push service.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **A send must never break the thing that triggered it.** Every entry
 *    point here swallows its own errors and logs instead. A race must still
 *    resolve and pay out if Expo is down, a token is stale, or the network
 *    blips — the notification is the least important part of that
 *    transaction, and it runs inside lifecycle jobs that move real money.
 *
 * 2. **Never notify twice for the same thing.** Most sends are triggered by
 *    a claimed state transition (the conditional updateMany in the lifecycle
 *    jobs), which happens exactly once by construction. Sends driven by a
 *    periodic SCAN instead — the daily check-in reminder — go through
 *    `sendOnce`, which uses a unique constraint as the guard so two
 *    overlapping ticks race on an INSERT rather than a check-then-act read.
 */

// accessToken is optional: Expo only requires it if the project has "enhanced
// security for push notifications" enabled. Sending without one works for a
// standard project, so this stays unset-friendly rather than a hard boot
// requirement.
const expo = new Expo(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {});

export type NotificationKind =
  | "race_locked"
  | "race_resolved"
  | "challenge_starting"
  | "challenge_checkin_reminder"
  | "challenge_resolved"
  | "challenge_eliminated"
  // Goes to ADMINS, not to the person withdrawing — during the pilot a
  // payout is an EFT somebody has to actually send.
  | "admin_withdrawal_requested";

type Payload = {
  title: string;
  body: string;
  /** Deep-link hint the client can route on. Never put anything secret here — push payloads are not confidential. */
  data?: Record<string, string>;
};

/**
 * Sends to every device a user has registered. No-ops silently when they
 * have none, which is the normal case for a web user who declined the
 * browser permission prompt.
 */
export async function notifyUser(userId: string, kind: NotificationKind, payload: Payload): Promise<void> {
  try {
    const owner=await prisma.user.findUnique({where:{id:userId},select:{notificationPreferences:true}});
    const prefs=(owner?.notificationPreferences ?? {}) as Record<string,boolean>;
    const category=String(kind).includes('message')?'messages':/friend|invite|follow/.test(kind)?'invites':String(kind).includes('like')?'likes':/comment|share/.test(kind)?'comments':'competitions';
    if(prefs.push===false || prefs[category]===false)return;
    const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
    if (tokens.length === 0) return;

    const appleResults = await Promise.allSettled(tokens.filter(t=>t.token.startsWith('apns:')).map(t=>sendApplePush(t.token.slice(5),payload.title,payload.body,{kind,...payload.data})));
    for(const result of appleResults)if(result.status==='rejected')console.error('[push] Apple delivery failed:',result.reason?.message);
    const messages: ExpoPushMessage[] = tokens.filter(t=>!t.token.startsWith('apns:'))
      .map((t) => t.token)
      .filter((token) => {
        if (Expo.isExpoPushToken(token)) return true;
        // A malformed token can only have come from a client bug or a
        // hand-inserted row; drop it rather than letting Expo reject the
        // whole chunk it lands in.
        void pruneTokens([token]);
        return false;
      })
      .map((to) => ({ to, sound: "default" as const, title: payload.title, body: payload.body, data: { kind, ...payload.data } }));

    if (messages.length === 0) return;

    const tickets: ExpoPushTicket[] = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
      tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
    }
    await handleTickets(messages, tickets);
  } catch (err) {
    // Deliberately swallowed — see the module comment. A failed notification
    // must not roll back a payout.
    console.error(`[push] send failed for user ${userId} (${kind}):`, err);
  }
}

/** Same as notifyUser, but sends to several users concurrently. */
export async function notifyUsers(userIds: string[], kind: NotificationKind, payload: Payload): Promise<void> {
  await Promise.all(userIds.map((id) => notifyUser(id, kind, payload)));
}

/**
 * Sends at most once per (user, kind, dedupeKey) — for notifications driven
 * by a periodic scan rather than a one-time state transition.
 *
 * The INSERT is the guard, not a preceding SELECT: two concurrent ticks both
 * attempt it, Postgres lets exactly one through the unique constraint, and
 * the loser treats P2002 as "already sent" rather than an error.
 */
export async function sendOnce(userId: string, kind: NotificationKind, dedupeKey: string, payload: Payload): Promise<boolean> {
  try {
    await prisma.notificationLog.create({ data: { userId, kind, dedupeKey } });
  } catch (err) {
    const alreadySent = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (alreadySent) return false;
    console.error(`[push] dedupe check failed for user ${userId} (${kind}/${dedupeKey}):`, err);
    return false;
  }
  await notifyUser(userId, kind, payload);
  return true;
}

/**
 * Expo reports a permanently-invalid token as `DeviceNotRegistered` — the
 * app was uninstalled, or the browser's push subscription was revoked.
 * Those tokens will never work again, so they are deleted rather than
 * retried forever.
 */
async function handleTickets(messages: ExpoPushMessage[], tickets: ExpoPushTicket[]): Promise<void> {
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status !== "error") return;
    if (ticket.details?.error === "DeviceNotRegistered") {
      const to = messages[i]?.to;
      if (typeof to === "string") dead.push(to);
    } else {
      console.error("[push] ticket error:", ticket.message, ticket.details);
    }
  });
  await pruneTokens(dead);
}

async function pruneTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
  } catch (err) {
    console.error("[push] failed to prune dead tokens:", err);
  }
}
