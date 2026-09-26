# Native Apple and Google sign-in

The iPhone app uses native provider sheets, a server-issued one-use nonce, and server-side ID-token validation. Existing password accounts are not automatically linked by email. New accounts still need the pilot invite code and a unique username. Existing phone-2FA accounts must use their established sign-in method; provider sign-in does not bypass it.

Sessions last 30 days and are restored from device storage. Security changes invalidate sessions through `authVersion`. New signup does not require SMS verification. Adding new sensitive-action 2FA is deferred.

## Server configuration

- `APPLE_SIGN_IN_ENABLED=true`
- `APPLE_CLIENT_ID=com.reecewheeler.asta`
- `APPLE_TEAM_ID` — Apple developer team
- `APPLE_AUTH_KEY_ID` — dedicated Sign in with Apple key ID
- `APPLE_AUTH_PRIVATE_KEY` — corresponding PKCS#8 key; actual newlines or escaped `\n`
- `GOOGLE_SIGN_IN_ENABLED=true` — only after consent configuration is ready for the intended audience
- `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` can override the public ASTA client IDs in `providers.ts`.

Provider buttons remain hidden until their enable flag/configuration is ready. The native Google URL scheme must match the iOS client ID. Apple requires the `com.apple.developer.applesignin` entitlement and a regenerated profile.

Never commit private keys. Apple refresh tokens are encrypted using a key derived from `JWT_SECRET`; changing that secret requires planning for existing encrypted tokens. Deleting an Apple-linked account revokes its Apple token before local deletion. Outstanding balances, payments or active competitions must be resolved first.

## Release checks

Verify Apple/Google sign-in on a physical iPhone using a permitted test account, including cancellation, signup, restart/session restoration and ownership verification. Public Google rollout is pending approved privacy/terms pages and consent configuration; do not publish review drafts as final policies.

The native Watch profile must include the paired Watch UDID. A successful simulator or generic build alone does not confirm physical-device installation. Rebuild and install the containing iPhone app after changing provisioning.

## Scheduled activity

Small start-reminder and empty-race cleanup tasks run independently of heavy scoring jobs. The server process must remain running for timely reminders. Notifications are deduplicated in the database. Empty newly-created races have a two-minute grace period before periodic cleanup; withdrawal by the last entrant removes the race immediately after recording the refund.
