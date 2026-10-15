import type { JudgeNote } from "@/lib/data";
import type { Entry, Judge } from "@/lib/types";

/**
 * What the judges noted on each entry, in running order, for the organizer. Judges write them on their scoring
 * screens; each judge only ever sees their own. `notes`: null before migration 018.
 */
export function NotesTab({ entries, judges, notes, pageant }: { entries: Entry[]; judges: Judge[]; notes: JudgeNote[] | null; pageant: boolean }) {
  const noun = pageant ? "candidate" : "entry";
  if (notes === null) {
    return (
      <p role="note" className="note max-w-2xl">
        Judges&apos; notes need the latest database update. Run <code>supabase/migrations/018_judge_notes.sql</code> in the Supabase SQL editor.
      </p>
    );
  }
  const judgeOrder = new Map(judges.map((j, i) => [j.id, i]));
  const nameOf = new Map(judges.map((j) => [j.id, j.name]));
  const rows = [...entries]
    .sort((a, b) => a.position - b.position)
    .map((entry, i) => ({
      entry,
      number: i + 1,
      notes: notes.filter((n) => n.entryId === entry.id).sort((a, b) => (judgeOrder.get(a.judgeId) ?? 0) - (judgeOrder.get(b.judgeId) ?? 0)),
    }))
    .filter((r) => r.notes.length > 0);
  const writers = new Set(notes.map((n) => n.judgeId)).size;

  if (rows.length === 0) {
    return (
      <p className="hint max-w-2xl">
        No notes yet. Judges can keep a note on each {noun} from their scoring screen, and they show up here and on the judges&apos; score sheets.
      </p>
    );
  }
  return (
    <div className="max-w-3xl">
      <p className="hint">
        {notes.length} {notes.length === 1 ? "note" : "notes"} from {writers} {writers === 1 ? "judge" : "judges"}, in running order. Each judge sees only
        their own; the judges&apos; score sheets print them too.
      </p>
      <ol className="mt-4 divide-y divide-line border-y border-line">
        {rows.map(({ entry, number, notes: forEntry }) => (
          <li key={entry.id} className="py-5">
            <h2 className="font-bold">
              <span className="tabular mr-2 font-semibold text-prussian/70">{number}</span>
              {entry.name}
            </h2>
            <ul className="mt-3 space-y-3">
              {forEntry.map((n) => (
                <li key={n.judgeId} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <p className="font-semibold">{nameOf.get(n.judgeId) ?? "A judge no longer on the panel"}</p>
                  <p className="whitespace-pre-line text-prussian/85">{n.body}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
