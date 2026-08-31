import { Platform, Share } from "react-native";
import { showAlert } from "./alert";

/**
 * Hands an invite code to the user, however this platform can manage it.
 *
 * `Share.share` is not the sure thing it is on native. react-native-web
 * forwards to `navigator.share`, which is undefined on desktop Chrome and
 * Firefox, on older Safari, and in any non-secure context — it then rejects
 * with "Share is not supported in this browser". It also rejects when the
 * user simply dismisses the share sheet.
 *
 * An invite code is the entire point of the interaction — without it nobody
 * else can join the race, squad or challenge that was just created — so a
 * rejection must never be swallowed. This existed as four hand-written
 * copies: two fell back to showing the code, two had `.catch(() => {})` and
 * silently did nothing at all.
 *
 * The ladder, best first:
 *
 *  1. the platform share sheet — one tap to whichever app they'd send it in
 *  2. the clipboard, on web, which is available in far more browsers than
 *     `navigator.share` is and still leaves them able to paste it straight
 *     into a message
 *  3. a dialog showing the code, which always works and never loses it
 */
export async function shareCode(opts: { message: string; title: string; code: string }) {
  try {
    await Share.share({ message: opts.message });
    return;
  } catch {
    // fall through
  }

  if (Platform.OS === "web") {
    try {
      await navigator.clipboard.writeText(opts.message);
      showAlert("Copied", `${opts.title}: ${opts.code}\n\nThe invite message is on your clipboard — paste it wherever you're sending it.`);
      return;
    } catch {
      // Clipboard needs a secure context and can be refused outright; the
      // dialog below still gets them the code.
    }
  }

  showAlert(opts.title, opts.code);
}
