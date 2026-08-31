// Mirrors backend/src/lib/constants.ts by hand — platform-wide policy
// values. Race field sizes and entry fees are NOT here: they are per-format,
// per-league configuration served by the API, never hardcoded in the client.
export const WITHDRAWAL_MIN_CENTS = 10_000; // R100 minimum
