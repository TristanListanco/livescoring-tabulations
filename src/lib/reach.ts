import type { ActionResult } from "./types";

export const UNREACHABLE: ActionResult = {
  ok: false,
  error: "That didn't reach the server. Check this screen's connection and try again.",
};

/**
 * Calls a server action from a control used during the show. On flaky venue Wi-Fi the request itself can
 * fail, which would otherwise throw and take the whole screen down; here it comes back as an ordinary error
 * the control can show next to itself. Not for actions that redirect: a redirect arrives as a thrown signal
 * this would swallow.
 */
export async function reach(call: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await call();
  } catch {
    return UNREACHABLE;
  }
}
