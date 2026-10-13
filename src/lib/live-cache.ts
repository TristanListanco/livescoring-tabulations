import "server-only";
import { refresh, revalidateTag } from "next/cache";

/**
 * The public live results are cached and shared by everyone watching (see getLiveBoard in data.ts), so a crowd of
 * phones costs one database read per change rather than one each. This tag clears that cache.
 */
export const LIVE_BOARD_TAG = "live-board";

/**
 * After an action changes an activity: re-render the page the action came from, and clear the live results' cache,
 * so their next refresh reads the change (never a stale copy). Called right after the write, before the realtime
 * notice of it reaches the phones watching.
 */
export function changed() {
  revalidateTag(LIVE_BOARD_TAG, { expire: 0 });
  refresh();
}
