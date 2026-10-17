"use client";

import { useAutoRetry } from "@/components/reconnecting";

/** The live results, when they couldn't load: they reconnect by themselves. */
export default function LiveError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useAutoRetry(retry, error);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-prussian px-6 text-center text-mint">
      <div role="status" aria-live="polite">
        <h1 className="text-2xl font-bold">Reconnecting…</h1>
        <p className="mt-2 text-[15px] text-mint/80">The results come back by themselves in a moment.</p>
      </div>
    </main>
  );
}
