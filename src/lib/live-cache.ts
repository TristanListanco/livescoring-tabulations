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
 * After an action changes an activity: re-render the page the action came from, and, given the activity's public id,
 * clear its live results' cache. That's belt and braces: each cached board is keyed by when its activity last changed
 * (see getLiveBoard), and every write that changes what a board shows moves that, so a refresh after it never reads a
 * stale copy either way. Without a public id nothing else is cleared: clearing every activity's results for one
 * activity's change (a device approved, an entry renamed) only made every room's audience reload at once on a busy day.
 */
export function changed(publicId?: string) {
  if (publicId) revalidateTag(liveBoardTag(publicId), { expire: 0 });
  refresh();
}
