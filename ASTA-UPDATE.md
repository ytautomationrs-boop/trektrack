# ASTA app update

The app retains the name ASTA. The supplied outline font is compiled to a 44 KB TrueType font and used only for uppercase headings; body text remains Figtree. Fonts and device-only photo, keyboard and share plugins load without blocking startup.

## Phone installation

The camera crash fix adds iOS camera and photo privacy descriptions and native plugins. This requires a new Xcode build installed on the phone; a server deployment cannot update an already installed native binary. Open `mobile/ios/App/App.xcodeproj`, select the phone, and Run. Before building after a fresh checkout, run `npm ci` and `npx cap sync ios` inside `mobile`.

## Notifications

The in-app inbox stores invites, DMs, likes, comments, follows, and game start/finish alerts. Apple push delivery is implemented but requires a paid Apple Developer team, an APNs signing key and push provisioning. Personal Team installations continue to build with push signing disabled.

For a paid team, enable Push Notifications in the App target's Signing & Capabilities and set user-defined build setting `ASTA_PUSH_ENTITLEMENTS` to `App/Push.entitlements` for Debug and Release. The project supplies development/production `ASTA_APNS_ENVIRONMENT` respectively. Set Hostinger environment variables `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the .p8 contents, actual or escaped newlines), and `APNS_BUNDLE_ID=com.asta.app`. Never commit the private key. Rebuild/install, then select Enable phone notifications in the inbox. Both Xcode sandbox and production tokens are supported. Without these credentials the inbox works; the UI does not claim phone notifications are enabled.

## Games and sharing

Hosts start full events and control a persisted timer, pause/resume, scoring, undo and finish. Tennis/padel use advantage, sets and a 6-all tiebreak; squash and volleyball use sets with win-by-two; rugby union and basketball offer their scoring values. Football, netball, touch rugby and custom sports support appropriate basic point increments. Hiking is timed without points. This is a manual scoreboard: it does not referee game rules, penalties, substitutions or sport-specific match clocks.

Completed games can be posted to ASTA with an optional compressed photo. Device sharing uses the system share sheet, with destinations determined by installed apps. A browser can download the generated result image.

## Speed and validation

Events open from existing list previews; event detail/join responses omit large embedded participant avatars. Joining locks only the relevant event and returns one refreshed result. Conversations query the latest message per partner instead of reading repeated user/photo data; threads fetch the latest 100 messages and optimistically show sends. Photos are resized/compressed before upload and new photos are stored separately with cacheable URLs. Page transitions use short opacity/translation animations and honor Reduce Motion. Focused polling stops when screens are not active.

Game mutations use row locks, version checks and operation IDs to avoid duplicate points. Tests cover scoring, host/full-event restrictions, join limits, duplicate/stale operations, pause behavior and HTTP cache/session behavior. Actual camera capture and APNs delivery still require testing on the rebuilt physical device.
