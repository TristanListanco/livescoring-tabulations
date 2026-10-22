"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { cleanSignature } from "@/lib/deliberation";
import { listNames } from "@/lib/names";
import { averageText, type RankedRow } from "@/lib/scoring";
import { ordinal } from "@/lib/ties";
import type { ActionResult, Activity, Judge } from "@/lib/types";
import { useMediaQuery } from "@/lib/use-media-query";

/** A tie the chair broke, as the organizer reads it before signing: the place, the order, why and who. */
export type BrokenTie = { place: number; names: string[]; reason: string; by: string | null };

/**
 * Once every judge has signed (and every tie is broken), the organizer's last step, over everything else and with the
 * page behind it blurred: the results as they'll be published, who signed, and the organizer's own signature (drawn on
 * a touchscreen, or "(Sgd.)") with their password, which ends the session. It can't be put aside: ending is the only way
 * on, and a session that has ended can be deliberated again.
 */
export function FinalSignOff({
  activity,
  ranking,
  ties,
  judges,
  onEnd,
}: {
  activity: Activity;
  ranking: RankedRow[];
  ties: BrokenTie[];
  judges: Judge[];
  onEnd: (password: string, signature: string | null) => Promise<ActionResult>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const passwordId = useId();
  const touch = useMediaQuery("(any-pointer: coarse)");
  const [drawing, setDrawing] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const signed = touch ? cleanSignature(drawing) !== null : agreed;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const end = () =>
    startTransition(async () => {
      setError(null);
      const result = await onEnd(password, touch ? drawing : null).catch(() => ({ ok: false as const, error: "That didn't go through. Check your connection and try again." }));
      if (!result.ok) setError(result.error);
    });

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Not to be put aside: Escape does nothing here.
      onCancel={(e) => e.preventDefault()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-mint p-0 text-prussian shadow-[0_24px_64px_rgb(11_37_69/0.35)] backdrop:bg-prussian/40 backdrop:backdrop-blur-md"
    >
      <form
        className="px-6 py-6 sm:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (signed && password && !pending) end();
        }}
      >
        <h2 id={titleId} className="text-2xl font-bold tracking-tight">
          Every judge has signed
        </h2>
        <p className="mt-1 text-prussian/75">Check the results, then sign them to end the session. They go on the live results page once you do.</p>

        <table className="mt-5 w-full text-left">
          <caption className="sr-only">The results as they&apos;ll be published</caption>
          <thead className="border-b border-line text-sm text-prussian/70">
            <tr>
              <th className="py-2 pr-3 font-semibold">Rank</th>
              <th className="py-2 pr-3 font-semibold">Entry</th>
              <th className="py-2 text-right font-semibold">Average</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {ranking.map((row) => (
              <tr key={row.entry.id} className="border-b border-line">
                <td className="py-2 pr-3 font-bold">{row.rank ?? "—"}</td>
                <td className="py-2 pr-3">
                  <span className="text-prussian/70">No. {row.number}</span> <span className="font-semibold">{row.entry.name}</span>
                </td>
                <td className="py-2 text-right font-semibold">{averageText(row.average, activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {ties.length > 0 && (
          <ul aria-label="Ties the chair broke" className="mt-4 space-y-1.5 text-sm">
            {ties.map((tie) => (
              <li key={tie.place}>
                <span className="font-semibold">Tie for {ordinal(tie.place)}:</span> {tie.names.join(", then ")}. &ldquo;{tie.reason}&rdquo;
                {tie.by && <span className="text-prussian/70"> Broken by {tie.by}.</span>}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-sm text-prussian/75">Signed by {listNames(judges)}.</p>

        <fieldset className="mt-6 border-t border-line pt-5">
          <legend className="sr-only">Your signature</legend>
          <p className="font-semibold">Your signature</p>
          {touch ? (
            <SignaturePad value={drawing} onChange={setDrawing} onDark={false} />
          ) : (
            <label className="mt-2 flex items-start gap-3">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-5 shrink-0 accent-regal" />
              <span>
                I&apos;ve checked the results and sign them. The results PDF shows <span className="font-semibold">(Sgd.)</span> beside my name.
              </span>
            </label>
          )}
          {touch && drawing && cleanSignature(drawing) === null && <p className="mt-1 text-sm text-prussian/70">Keep going: that&apos;s not a signature yet.</p>}
          <label htmlFor={passwordId} className="label mt-5">
            Your password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field max-w-sm"
          />
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 font-semibold text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={!signed || !password || pending} className="btn btn-primary mt-6 w-full sm:w-auto">
          {pending ? "Ending…" : "Sign and end the session"}
        </button>
      </form>
    </dialog>
  );
}
