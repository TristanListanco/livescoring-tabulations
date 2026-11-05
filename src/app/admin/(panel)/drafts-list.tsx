"use client";

import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteDraft } from "../actions";

export type DraftSummary = { id: string; kind: "event" | "pageant"; name: string; saved: string };

/** Activities still being set up: continue one where it was left, or delete it. */
export function DraftsList({ drafts }: { drafts: DraftSummary[] }) {
  return (
    <section aria-labelledby="drafts" className="mt-10">
      <h2 id="drafts" className="title-sm">
        Drafts
      </h2>
      <ul className="card mt-4 divide-y divide-line">
        {drafts.map((d) => {
          const name = d.name || (d.kind === "pageant" ? "Untitled pageant" : "Untitled event");
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
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
