import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { checkableActivity } from "@/lib/data";
import { SheetCheck } from "./sheet-check";

export const metadata: Metadata = { title: "Check a results sheet", robots: { index: false } };

/**
 * Where anyone with a results sheet (an accounting firm verifying the results, say) checks it against the activity's
 * results as they stand now: the address is printed on every results sheet. Archived activities too: their sheets still
 * count. Says whether a sheet matches, never a score.
 */
export default async function VerifyPage({ params }: PageProps<"/verify/[publicId]">) {
  const activity = await checkableActivity((await params).publicId);
  if (!activity) notFound();
  return (
    <div className="min-h-dvh bg-mint text-prussian">
      <header className="mx-auto max-w-2xl px-4 pt-8 sm:px-6">
        <Link href="/" className="text-lg text-regal">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-8 pb-16 sm:px-6">
        <h1 className="title">Check a results sheet</h1>
        <p className="mt-2 text-lg font-semibold">{activity.name}</p>
        <p className="mt-4 max-w-[65ch] text-prussian/80">
          Every results sheet carries a report ID worked out from every score on it. Type it, or choose the sheet&apos;s CSV, to see whether it matches
          these results as they stand now. Nothing here shows a score.
        </p>
        <SheetCheck publicId={activity.publicId} />
      </main>
    </div>
  );
}
