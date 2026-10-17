"use client";

import { useAutoRetry } from "@/components/reconnecting";

/**
 * A judge's screen that couldn't load (the connection, or the server): it reconnects by itself, and says so calmly,
 * since nothing they've submitted is lost.
 */
export default function JudgeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const tries = useAutoRetry(retry, error);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-prussian px-6 text-center text-mint">
      <div role="status" aria-live="polite" className="max-w-sm">
        <h1 className="text-2xl font-bold">Reconnecting…</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-mint/80">
          Scores you&apos;ve submitted are saved. This screen comes back by itself as soon as the connection does.
        </p>
      </div>
      <button type="button" onClick={() => retry()} className="btn mt-6 border border-mint/40 text-mint hover:bg-white/10">
        Try now
      </button>
      {tries >= 3 && <p className="mt-4 text-sm text-mint/70">Still trying. If it doesn&apos;t come back, check this device&apos;s Wi-Fi.</p>}
    </main>
  );
}
