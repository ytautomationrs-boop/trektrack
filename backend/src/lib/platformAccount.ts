import type { Prisma } from "@prisma/client";
import { PLATFORM_ACCOUNT_EMAIL } from "./constants.js";

type PlatformAccountClient = Pick<Prisma.TransactionClient, "user">;

export async function ensurePlatformAccount(db: PlatformAccountClient) {
  return db.user.upsert({
    where: { email: PLATFORM_ACCOUNT_EMAIL },
    update: {},
    create: {
      email: PLATFORM_ACCOUNT_EMAIL,
      passwordHash: "!platform-account-no-login!",
      displayName: "TrackTrek Platform",
      timezone: "Africa/Johannesburg",
    },
  });
}
