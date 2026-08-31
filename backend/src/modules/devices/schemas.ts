import { z } from "zod";

export const RegisterDeviceSchema = z.object({
  platform: z.enum(["IOS", "ANDROID"]),
  deviceModel: z.string().min(1),
  osVersion: z.string().min(1),
  attestationProvider: z.enum(["APP_ATTEST", "PLAY_INTEGRITY"]),
  // The mobile app performs the actual App Attest / Play Integrity
  // handshake natively and hands the server only the outcome — the server
  // never sees raw attestation keys/nonces in this simplified demo flow.
  // A production build would verify the attestation object/token server
  // side against Apple/Google before trusting `passed`.
  passed: z.boolean(),
  isEmulatorSuspected: z.boolean().default(false),
  isJailbrokenOrRooted: z.boolean().default(false),
});

export const RegisterHealthConnectionSchema = z.object({
  provider: z.enum(["HEALTHKIT", "HEALTH_CONNECT"]),
  grantedScopes: z.array(z.string()).min(1),
});
