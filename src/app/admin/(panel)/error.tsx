"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The admin's safety net. If a screen fails (a request lost on venue Wi-Fi, a database hiccup), the header
 * stays, the operator learns that submitted scores are safe, and can retry just this part of the page.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="max-w-xl rounded-2xl border border-line bg-white px-6 py-8">
      <h1 className="text-2xl font-bold">This screen hit a problem</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-prussian/80">
        Scores that judges have already submitted are saved. It&apos;s usually the connection: try again, and if it keeps happening, check this
        screen&apos;s Wi-Fi.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Try again
        </button>
        <Link href="/admin" className="btn btn-quiet">
          Back to activities
        </Link>
      </div>
      {error.digest && <p className="hint tabular mt-4">Reference for the administrator: {error.digest}</p>}
    </div>
  );
}
