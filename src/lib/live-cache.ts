import "server-only";
import { refresh, revalidateTag } from "next/cache";

/**
 * The public live results are cached and shared by everyone watching (see getLiveBoard in data.ts), so a crowd of
 * phones costs one database read per change rather than one each. Each activity's results carry their own tag, so a
 * score in one activity leaves the others' cached: with many activities running at once (breakout sessions), a
 * single tag for all would be cleared by every score anywhere, and nothing would stay cached. LIVE_BOARD_TAG clears
 * them all.
 */
export const LIVE_BOARD_TAG = "live-board";
export const liveBoardTag = (publicId: string) => `live-board:${publicId}`;

/**
 * After an action changes an activity: re-render the page the action came from, and clear the live results' cache,
 * so their next refresh reads the change (never a stale copy). Called right after the write, before the realtime
 * notice of it reaches the phones watching. With the activity's public id only its own results are cleared; the
 * occasional action without it clears every activity's.
 */
export function changed(publicId?: string) {
  revalidateTag(publicId ? liveBoardTag(publicId) : LIVE_BOARD_TAG, { expire: 0 });
  refresh();
}
