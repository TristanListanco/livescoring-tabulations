import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { StandingRow } from "./pageant";
import { averageText, formatBound, rankEntries, rulesSummary, scoreText } from "./scoring";
import type { Board, Round, Signatory } from "./types";

// Names wrap at spaces only; the default splits them mid-word ("Vil-lanueva").
Font.registerHyphenationCallback((word) => [word]);

const C = {
  prussian: "#0b2545",
  regal: "#134074",
  powder: "#8da9c4",
  mint: "#eef4ed",
  podium: "#e3ebf2",
  line: "#c8d6e2",
  muted: "#4b5f78",
};

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 10, color: C.prussian },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  photo: { width: 52, height: 52, borderRadius: 26, objectFit: "cover" },
  headerText: { flexGrow: 1, flexBasis: 0 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.regal },
  reportId: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 0.5 },
  reportLabel: { fontFamily: "Helvetica", color: C.muted },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, marginTop: 4 },
  subtitle: { fontFamily: "Helvetica-Bold", fontSize: 14, marginTop: 2, color: C.regal },
  meta: { marginTop: 6, color: C.muted, maxWidth: 480 },
  table: { marginTop: 22 },
  headRow: { flexDirection: "row", backgroundColor: C.prussian, color: C.mint, fontFamily: "Helvetica-Bold", fontSize: 9 },
  row: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.line, alignItems: "center" },
  podiumRow: { backgroundColor: C.podium, fontFamily: "Helvetica-Bold" },
  cell: { paddingVertical: 7, paddingHorizontal: 6 },
  rank: { width: 42 },
  number: { width: 34, color: C.muted },
  entry: { flexGrow: 3, flexBasis: 0 },
  judge: { flexGrow: 1, flexBasis: 0, textAlign: "center" },
  // Wide enough for "100.0000%" at four decimal places.
  average: { width: 72, textAlign: "right", fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 30 },
  sectionNote: { marginTop: 3, color: C.muted },
  signatures: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  signature: { width: "33.33%", paddingRight: 24, marginTop: 30 },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: C.prussian, height: 22 },
  signName: { fontFamily: "Helvetica-Bold", marginTop: 5 },
  signed: { fontFamily: "Helvetica-Oblique", marginTop: 3 },
  signRole: { color: C.muted, marginTop: 2 },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted },
});

/** The organizer as printed on the sheet: their name, photo (JPEG bytes) and the people who sign. */
export type ReportOrganizer = { name: string; photo: Buffer | null; signatories: Signatory[] };

type ReportInfo = { generatedAt: string; reportId: string; organizer: ReportOrganizer | null };

/** The sheet's header: the organizer's photo, "Official results", the report ID, the title and what the sheet is. */
function Header({ info, title, subtitle, meta }: { info: ReportInfo; title: string; subtitle?: string; meta: string }) {
  const { reportId, organizer } = info;
  return (
    <View style={s.header}>
      {/* react-pdf's Image takes no alt text; the organizer's name is printed beside it. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {organizer?.photo && <Image style={s.photo} src={{ data: organizer.photo, format: "jpg" }} />}
      <View style={s.headerText}>
        <View style={s.topRow}>
          <Text style={s.eyebrow}>Official results</Text>
          <Text style={s.reportId}>
            <Text style={s.reportLabel}>Report ID </Text>
            {reportId}
          </Text>
        </View>
        <Text style={s.title}>{title}</Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        {/* One string: react-pdf spaces mixed text children unevenly. */}
        <Text style={s.meta}>{(organizer ? `Organized by ${organizer.name}. ` : "") + meta}</Text>
      </View>
    </View>
  );
}

/** The judges' sign-offs and the signatories' signature lines. */
function SignOff({ judges, signatories, note }: { judges: Board["judges"]; signatories: Signatory[]; note: string }) {
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>Certified correct</Text>
      <Text style={s.sectionNote}>{note}</Text>
      <View style={s.signatures}>
        {judges.map((j) => (
          <View key={j.id} style={s.signature}>
            <Text style={s.signName}>{j.name}</Text>
            <Text style={s.signed}>(Sgd.)</Text>
            <Text style={s.signRole}>{j.isChair ? "Chair, Board of Judges" : "Judge"}</Text>
          </View>
        ))}
      </View>
      <View style={s.signatures}>
        {signatories.length > 0 ? (
          signatories.map((p, i) => (
            <View key={i} style={s.signature}>
              <View style={s.signLine} />
              <Text style={s.signName}>{p.name}</Text>
              {p.designation && <Text style={s.signRole}>{p.designation}</Text>}
            </View>
          ))
        ) : (
          <View style={s.signature}>
            <View style={s.signLine} />
            <Text style={s.signName}> </Text>
            <Text style={s.signRole}>Tabulator</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Footer({ label, info }: { label: string; info: ReportInfo }) {
  return (
    <View style={s.footer} fixed>
      <Text>{`${label}, report ${info.reportId}, generated ${info.generatedAt}`}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

const SIGN_NOTE =
  "Each judge submitted every score above from their approved device with a personal access code, and submitted scores are final. " +
  "(Sgd.) marks each judge's verified sign-off.";

/** One activity's results, or one pageant sub-activity's (`part`: its name). */
function ResultsDocument({ board, info, part }: { board: Board; info: ReportInfo; part?: string }) {
  const { activity, judges } = board;
  const rows = rankEntries(board.entries, judges, board.scores, activity);
  const noun = part ? "candidates" : "entries";
  const label = part ? `${activity.name}, ${part}` : activity.name;

  return (
    <Document title={`${label} results`} author="LiveScoring" creator="LiveScoring">
      <Page size="A4" orientation={judges.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <Header
          info={info}
          title={activity.name}
          subtitle={part}
          meta={
            `${rulesSummary(activity)} ${judges.length} judges, ${board.entries.length} ${noun}. ` +
            `Ranked by the average of all judges' scores; equal averages share a rank. Generated ${info.generatedAt}.`
          }
        />

        <View style={s.table}>
          <View style={s.headRow} fixed>
            <Text style={[s.cell, s.rank]}>Rank</Text>
            <Text style={[s.cell, s.number, { color: C.mint }]}>No.</Text>
            <Text style={[s.cell, s.entry]}>{part ? "Candidate" : "Entry"}</Text>
            {judges.map((j) => (
              <Text key={j.id} style={[s.cell, s.judge]}>
                {j.name}
              </Text>
            ))}
            <Text style={[s.cell, s.average]}>Average</Text>
          </View>
          {rows.map((row) => (
            <View key={row.entry.id} style={row.rank !== null && row.rank <= 3 ? [s.row, s.podiumRow] : s.row} wrap={false}>
              <Text style={[s.cell, s.rank]}>{row.rank ?? "—"}</Text>
              <Text style={[s.cell, s.number]}>{row.number}</Text>
              <Text style={[s.cell, s.entry]}>{row.entry.name}</Text>
              {judges.map((j) => {
                const v = row.scores.get(j.id);
                return (
                  <Text key={j.id} style={[s.cell, s.judge]}>
                    {v === undefined ? "—" : scoreText(v, activity)}
                  </Text>
                );
              })}
              <Text style={[s.cell, s.average]}>{averageText(row.average, activity)}</Text>
            </View>
          ))}
        </View>

        <SignOff judges={judges} signatories={info.organizer?.signatories ?? []} note={SIGN_NOTE} />
        <Footer label={label} info={info} />
      </Page>
    </Document>
  );
}

/**
 * A pageant standings sheet: the preliminary's results, a cut, or the final results. Each column is a sub-activity
 * with what it counts for; each candidate's figure there is their average as a percentage of its maximum score.
 * `placed`: the candidates who went through (or the final placements), in order, once the cut is confirmed.
 */
export type StandingsSheet = {
  kind: "preliminary" | "cut" | "final";
  title: string;
  weights: { round: Round; weight: number }[];
  rows: StandingRow[];
  placed: string[] | null;
  /** Candidates whose tie the organizer broke, marked on the sheet. */
  tieBroken: string[];
};

function StandingsDocument({ board, info, sheet }: { board: Board; info: ReportInfo; sheet: StandingsSheet }) {
  const { activity, judges } = board;
  const places = activity.resultDecimals;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(places)}%`);
  const counts = sheet.weights.map((w) => `${w.round.name} ${formatBound(Math.round(w.weight * 100) / 100)}%`).join(", ");
  const placed = sheet.placed ?? [];
  const placeOf = new Map(placed.map((id, i) => [id, i + 1]));
  // Placed candidates first in their confirmed order (ties broken by the organizer), then the rest as ranked.
  const rows = sheet.placed ? [...sheet.rows].sort((a, b) => (placeOf.get(a.entry.id) ?? Infinity) - (placeOf.get(b.entry.id) ?? Infinity)) : sheet.rows;
  const tieBroken = new Set(sheet.placed ? sheet.tieBroken : []);
  const status = (id: string) => {
    if (sheet.kind === "preliminary") return null;
    if (sheet.kind === "final") return placeOf.has(id) ? String(placeOf.get(id)) : "—";
    return placeOf.has(id) ? "Through" : "—";
  };
  const statusHead = sheet.kind === "final" ? "Place" : sheet.kind === "cut" ? "Result" : null;
  const meta =
    `Ranked by ${counts}. Each sub-activity counts as a candidate's average as a percentage of its maximum score. ` +
    `${judges.length} judges, ${sheet.rows.length} candidates.` +
    (tieBroken.size ? " Candidates marked * were tied; the organizer decided their order." : "") +
    ` Generated ${info.generatedAt}.`;

  return (
    <Document title={`${activity.name}, ${sheet.title}`} author="LiveScoring" creator="LiveScoring">
      <Page size="A4" orientation={sheet.weights.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <Header info={info} title={activity.name} subtitle={sheet.title} meta={meta} />

        <View style={s.table}>
          <View style={s.headRow} fixed>
            {statusHead && <Text style={[s.cell, s.rank]}>{statusHead}</Text>}
            <Text style={[s.cell, s.rank]}>Rank</Text>
            <Text style={[s.cell, s.number, { color: C.mint }]}>No.</Text>
            <Text style={[s.cell, s.entry]}>Candidate</Text>
            {sheet.weights.map((w) => (
              <Text key={w.round.id} style={[s.cell, s.judge]}>
                {`${w.round.name} (${formatBound(Math.round(w.weight * 100) / 100)}%)`}
              </Text>
            ))}
            <Text style={[s.cell, s.average]}>Total</Text>
          </View>
          {rows.map((row) => {
            const through = placeOf.has(row.entry.id);
            return (
              <View key={row.entry.id} style={through ? [s.row, s.podiumRow] : s.row} wrap={false}>
                {statusHead && <Text style={[s.cell, s.rank]}>{status(row.entry.id)}</Text>}
                <Text style={[s.cell, s.rank]}>{row.rank === null ? "—" : `${row.rank}${tieBroken.has(row.entry.id) ? "*" : ""}`}</Text>
                <Text style={[s.cell, s.number]}>{row.number}</Text>
                <Text style={[s.cell, s.entry]}>{row.entry.name}</Text>
                {sheet.weights.map((w) => (
                  <Text key={w.round.id} style={[s.cell, s.judge]}>
                    {pct(row.parts.get(w.round.id))}
                  </Text>
                ))}
                <Text style={[s.cell, s.average]}>{pct(row.total)}</Text>
              </View>
            );
          })}
        </View>

        <SignOff
          judges={judges}
          signatories={info.organizer?.signatories ?? []}
          note={
            "Each figure above comes from the judges' scores in that sub-activity, each submitted from an approved device with a personal access code; " +
            "submitted scores are final. The sub-activities' own results sheets list every score. (Sgd.) marks each judge's verified sign-off."
          }
        />
        <Footer label={`${activity.name}, ${sheet.title}`} info={info} />
      </Page>
    </Document>
  );
}

function generatedAt(timeZone?: string): string {
  let zone: string | undefined = timeZone;
  try {
    if (zone) new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = undefined;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(new Date());
}

/** A pageant standings sheet as a PDF. */
export function renderStandingsPdf(
  board: Board,
  sheet: StandingsSheet,
  { timeZone, reportId, organizer }: { timeZone?: string; reportId: string; organizer: ReportOrganizer | null },
): Promise<Buffer> {
  return renderToBuffer(<StandingsDocument board={board} sheet={sheet} info={{ generatedAt: generatedAt(timeZone), reportId, organizer }} />);
}

/** Results as a PDF: an event's, or (with `part`, its name) one pageant sub-activity's. */
export function renderResultsPdf(
  board: Board,
  { timeZone, reportId, organizer, part }: { timeZone?: string; reportId: string; organizer: ReportOrganizer | null; part?: string },
): Promise<Buffer> {
  return renderToBuffer(<ResultsDocument board={board} part={part} info={{ generatedAt: generatedAt(timeZone), reportId, organizer }} />);
}
