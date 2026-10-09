"use client";

import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteDraft } from "../actions";

export type DraftSummary = { id: string; kind: "event" | "pageant"; name: string; saved: string };

/** Activities still being set up: continue one where it was left, or delete it. */
export function DraftsList({ drafts }: { drafts: DraftSummary[] }) {
  return (
    <section aria-labelledby="drafts" className="mt-8">
      <h2 id="drafts" className="text-xl font-bold">
        Drafts
      </h2>
      <p className="hint mt-1">Saved while setting up. Creating the activity clears its draft.</p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {drafts.map((d) => {
          const name = d.name || (d.kind === "pageant" ? "Untitled pageant" : "Untitled event");
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold wrap-anywhere">{name}</p>
                <p className="hint">
                  {d.kind === "pageant" ? "Pageant" : "Event"} · Saved {d.saved}
                </p>
              </div>
              <Link href={`/admin/new?draft=${d.id}`} className="btn btn-quiet btn-sm">
                Continue<span className="sr-only"> {name}</span>
              </Link>
              <ConfirmDialog
                triggerLabel={
                  <>
                    Delete<span className="sr-only"> the draft of {name}</span>
                  </>
                }
                triggerClassName="btn btn-sm text-danger hover:bg-danger/10"
                title={`Delete the draft of ${name}?`}
                tone="danger"
                confirmLabel="Delete draft"
                onConfirm={() => deleteDraft(d.id)}
              >
                Everything saved in it is lost. This can&apos;t be undone.
              </ConfirmDialog>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
