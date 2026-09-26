import { z } from "zod";

export const SignUpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(1024),
  displayName: z.string().min(2).max(40),
  timezone: z.string().min(1), // IANA tz string from the device, e.g. Intl.DateTimeFormat().resolvedOptions().timeZone
  // Pilot invite gate — see InviteCode in schema.prisma. There is no public
  // signup route while this is required.
  inviteCode: z.string().min(1),
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use a phone number with country code, for example +27821234567").optional(),
  code: z.string().regex(/^\d{4,10}$/).optional(),
});

export const GenerateInviteCodesSchema = z.object({
  // How many fresh single-use codes to mint in one call.
  count: z.number().int().min(1).max(200).default(1),
  label: z.string().max(200).optional(),
  code: z
    .string()
    .trim()
    .min(4)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invite codes can only use letters, numbers, underscores and hyphens.")
    .optional(),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
  code: z.string().regex(/^\d{4,10}$/).optional(),
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
