import { z } from "zod";

export const DepositIntentSchema = z.object({
  amountCents: z.number().int().positive().max(1_000_000), // $10,000 sanity ceiling for the demo
  // Which callback the Paystack checkout should return to. Native gets the
  // streak:// scheme that expo-web-browser intercepts on-device; web gets a
  // real page on WEB_APP_URL, because a browser tab cannot intercept a
  // custom scheme. Defaults to native so existing mobile clients are
  // unaffected by this field existing.
  platform: z.enum(["native", "web"]).default("native"),
});

export const ConfirmDepositSchema = z.object({
  reference: z.string().min(1), // returned by POST /me/wallet/deposit/intent, carried back on the Paystack checkout redirect
});

// Two payout methods (see modules/wallet/service.ts requestWithdrawal) —
// the destination fields required differ per method, so this is a
// discriminated union rather than a flat object with everything optional.
export const WithdrawSchema = z.object({
  amountCents: z.number().int().positive(),
  destination: z.discriminatedUnion("method", [
    z.object({
      method: z.literal("PAYSTACK"),
      bankCode: z.string().min(1),
      accountNumber: z.string().min(1),
      // Paystack-resolved (via GET /me/wallet/payout-methods/paystack/resolve),
      // not free-typed — the mobile client shows this to the user for
      // confirmation before it's ever sent back here.
      accountName: z.string().min(1),
    }),
    z.object({
      method: z.literal("PAYPAL"),
      email: z.string().email(),
    }),
    // Pilot default. Paystack cannot resolve South African account names
    // (its /bank/resolve rejects ZAR outright — see paystackService.ts), so
    // unlike the PAYSTACK branch above there is nothing to verify the name
    // against and it is taken as typed. The admin sending the EFT is looking
    // at the same three fields the user entered.
    z.object({
      method: z.literal("MANUAL"),
      bankName: z.string().min(2).max(60),
      accountNumber: z.string().min(4).max(30),
      accountName: z.string().min(2).max(80),
    }),
  ]),
});

export const GrantSponsoredCreditSchema = z.object({
  email: z.string().email(),
  amountCents: z.number().int().positive().max(500_000),
  // Idempotency handle. The operator is a person at a terminal and the
  // failure mode is granting money twice, so the caller names the grant and
  // a repeat of the same name is refused rather than paid.
  grantRef: z.string().min(4).max(80),
  note: z.string().max(200).optional(),
});

export const ResolveManualWithdrawalSchema = z.object({
  reference: z.string().max(80).optional(),
  reason: z.string().max(200).optional(),
});

export const ResolvePaystackAccountSchema = z.object({
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
});

export type DepositIntentInput = z.infer<typeof DepositIntentSchema>;
export type ConfirmDepositInput = z.infer<typeof ConfirmDepositSchema>;
export type WithdrawInput = z.infer<typeof WithdrawSchema>;
export type ResolvePaystackAccountInput = z.infer<typeof ResolvePaystackAccountSchema>;
