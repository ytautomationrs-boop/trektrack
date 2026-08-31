import { z } from "zod";

export const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(40),
  timezone: z.string().min(1), // IANA tz string from the device, e.g. Intl.DateTimeFormat().resolvedOptions().timeZone
  // Pilot invite gate — see InviteCode in schema.prisma. There is no public
  // signup route while this is required.
  inviteCode: z.string().min(1),
});

export const GenerateInviteCodesSchema = z.object({
  // How many fresh single-use codes to mint in one call.
  count: z.number().int().min(1).max(200).default(1),
  label: z.string().max(200).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
