import "server-only";
import { checkBotId } from "botid/server";
import { log } from "./log";

/** What a sign-in refused as automated is told: a person can simply try again. */
export const BOT_REFUSED = "That sign-in looked automated, so it was stopped. Reload the page and try again.";

/**
 * Whether a sign-in (an organizer's password, a judge's code) comes from a bot, by Vercel BotID: an invisible check run
 * in the browser (see instrumentation-client.ts) and confirmed here. Only where the app is served by Vercel: a laptop
 * running the show on the venue Wi-Fi (`npm start`), local development and the web tests aren't, and there the sign-in
 * limits per address and per account (sign-in-limits.ts) guard it alone. A check that can't be made lets the sign-in
 * through to those limits, logged: no one is locked out at the show because Vercel couldn't be reached.
 */
export async function signInByBot(where: "admin" | "judge"): Promise<boolean> {
  if (process.env.VERCEL !== "1") return false;
  try {
    const { isBot } = await checkBotId();
    if (isBot) log("warn", "bot_refused", { where });
    return isBot;
  } catch (error) {
    log("warn", "bot_check_failed", { where, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
