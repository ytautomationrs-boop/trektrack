# ASTA app update

The app retains the name ASTA and its existing header wordmark. Other headings use Montserrat SemiBold without forced uppercase; body text remains Figtree. The compressed web heading font is about 59 KB. Fonts and device-only photo, keyboard and share plugins load without blocking startup.

## Phone installation

The camera crash fix adds iOS camera and photo privacy descriptions and native plugins. This requires a new Xcode build installed on the phone; a server deployment cannot update an already installed native binary. Open `mobile/ios/App/App.xcodeproj`, select the phone, and Run. Before building after a fresh checkout, run `npm ci` and `npx cap sync ios` inside `mobile`.

## Notifications

The in-app inbox stores invites, DMs, likes, comments, follows, and game start/finish alerts. Apple push delivery is configured with the paid Apple Developer team, an APNs signing key in Hostinger environment settings, and signed push provisioning. A real test notification was received on the user’s iPhone. This project now requires the paid team for its default push-enabled signing configuration.

Push Notifications is enabled in the App target using `App/Push.entitlements` for Debug and Release. The project supplies development/production `ASTA_APNS_ENVIRONMENT` respectively. Set Hostinger environment variables `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the .p8 contents, actual or escaped newlines), and `APNS_BUNDLE_ID=com.reecewheeler.asta`. Never commit the private key. Rebuild/install, then select Enable phone notifications in the inbox. Both Xcode sandbox and production tokens are supported. Without these credentials the inbox works; the UI does not claim phone notifications are enabled.

## Games and sharing

Hosts start full events and control a persisted timer, pause/resume, scoring, undo and finish. Tennis/padel use advantage, sets and a 6-all tiebreak; squash and volleyball use sets with win-by-two; rugby union and basketball offer their scoring values. Football, netball, touch rugby and custom sports support appropriate basic point increments. Hiking is timed without points. This is a manual scoreboard: it does not referee game rules, penalties, substitutions or sport-specific match clocks.

Completed games can be posted to ASTA with an optional compressed photo. Device sharing uses the system share sheet, with destinations determined by installed apps. A browser can download the generated result image.

## Speed and validation

Events open from existing list previews; event detail/join responses omit large embedded participant avatars. Joining locks only the relevant event and returns one refreshed result. Conversations query the latest message per partner instead of reading repeated user/photo data; threads fetch the latest 100 messages and optimistically show sends. Photos are resized/compressed before upload and new photos are stored separately with cacheable URLs. Page transitions use short opacity/translation animations and honor Reduce Motion. Focused polling stops when screens are not active.

Game mutations use row locks, version checks and operation IDs to avoid duplicate points. Tests cover scoring, host/full-event restrictions, join limits, duplicate/stale operations, pause behavior and HTTP cache/session behavior. Actual camera capture and APNs delivery still require testing on the rebuilt physical device.


## September 25: messaging, fast scoring, Watch, profiles

The latest-conversation PostgreSQL query now binds its partner expression once in a CTE. A real PGlite regression test reproduces Prisma's separate bound parameters. Scoring uses a conditional JSON write with retries instead of an interactive transaction per point. The phone queues taps immediately, persists pending operations per account/event, and retries uncertain saves with the same operation ID. Undo/pause/finish wait for pending saves. Unsaved points can be explicitly discarded; re-open a game after restarting to resume its queue.

Completed joined/hosted games move into Past events and appear automatically in the profile Games grid. Posts use a three-column thumbnail grid. Public profile game results obey the event's visibility. Headings use Montserrat SemiBold with no forced uppercase; the ASTA wordmark and body font remain unchanged. The web heading font is compressed and never blocks initial rendering.

The `ASTAWatch` watchOS 10+ companion is embedded in the iPhone target. Start a full game as host on iPhone, then open ASTA on Apple Watch and select it. Sport-specific buttons submit through WatchConnectivity and native iPhone networking while the phone is in the background. The phone must be nearby and connected to the server; this is not a standalone cellular Watch client. Pending watch points persist and can be retried without duplicating scores. Signing out clears the phone-side Keychain token and invalidates the watch session. Private credentials never go to the watch.

Apple rejected the former generic `com.asta.app` identifier as unavailable. The registered identifier is now `com.reecewheeler.asta`, with watch companion `com.reecewheeler.asta.watchkitapp`, team `K2B23SBUZ8`. The new build installs alongside an old differently identified app and requires signing in again. Do not delete the old app automatically.

Validation: backend and mobile TypeScript checks; 40 unit/integration tests, including real PostgreSQL conversation parameters, scoring permissions/concurrency/idempotency, queued/offline score retries; signed iPhone/Watch build; isolated browser check of three rapid taps under 1.5-second network delay, Past events and 390px profile grid. The user confirmed receipt of a real test push on iPhone after server configuration and device registration. Physical Watch scoring still requires device validation; no watch was connected during this update.

## Profile settings, social responsiveness and branding — 26 September
- Profile → Settings includes push categories, password/email changes, optional verified-phone 2FA, support/legal links and the relocated competition guide.
- Security changes require the current password (and SMS when enabled), atomically increment session version, and sign out existing phone/Watch sessions.
- Twilio Verify integration is prepared; SMS is intentionally unavailable until server credentials are configured. Setup and limitations are in DEPLOYMENT.md.
- Social/messages header remains fixed while the feed scrolls. Likes, comments and shares give immediate feedback, show pending status and restore the prior display on failure. Mutation responses omit unchanged photos and game/race details. Short transform-only press animations respect Reduce Motion.
- The supplied white symbol appears at launch/sign-in; the supplied italic ASTA wordmark appears in the header. Competition cards prominently show the fixed prize pool and retain the fee and prize breakdown.
- Validation: backend/mobile typechecks, 60 automated tests including MFA/session revocation and repeatable schema migration; iPhone-width browser checks with a deliberately delayed 3-second social API showed immediate likes/comments and a fixed Messages button.

Release verified live: the new frontend and auth config are served, the schema-dependent login check responds normally, and the Settings API rejects unauthenticated requests. Signed iPhone build succeeded. The original Xcode project and bundled web assets are synchronized; installation is deferred at the user's request. SMS delivery remains unconfigured. Button animations share one app-wide Reduce Motion listener.
