import "server-only";
import { db, PHOTO_BUCKET } from "@/lib/supabase/server";

/**
 * Every photo in these deleted activities' folders (their judges' and entries'). Called after the response has been
 * sent: nothing on the page waits for it, and the folders are listed at once rather than one after another.
 */
export async function removeActivityPhotos(activityIds: string[]): Promise<void> {
  const folders = await Promise.all(activityIds.map((id) => db().storage.from(PHOTO_BUCKET).list(id, { limit: 1000 })));
  const paths = folders.flatMap(({ data }, i) => (data ?? []).map((f) => `${activityIds[i]}/${f.name}`));
  // A thousand at a time, so an organizer's whole history can't make one request too big.
  for (let i = 0; i < paths.length; i += 1000) await db().storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 1000));
}
