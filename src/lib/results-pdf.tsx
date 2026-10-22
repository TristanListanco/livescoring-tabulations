import "server-only";
import { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CorrectionView } from "./corrections";
import type { StandingRow } from "./pageant";
import { averageText, formatBound, formatScore, judgeSheet, rankEntries, rulesSummary, scoreText, type JudgeSheetRow } from "./scoring";
import type { JudgeNote } from "./data";
import { SIGNATURE_BOX } from "./deliberation";
import { applyTieBreaks, breakFor, ordinal, tiesIn } from "./ties";
import type { ActivitySignoff, Board, Deduction, Judge, JudgeSignature, Round, Signatory } from "./types";

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
  byline: { fontFamily: "Helvetica-Bold", fontSize: 13, marginTop: 6 },
  bylineRole: { fontFamily: "Helvetica", color: C.muted },
  meta: { marginTop: 6, color: C.muted, maxWidth: 480 },
  table: { marginTop: 22 },
  headRow: { flexDirection: "row", backgroundColor: C.prussian, color: C.mint, fontFamily: "Helvetica-Bold", fontSize: 9 },
  row: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.line, alignItems: "center" },
  // A judge's score sheet row: the scores, with a correction to one under them.
  sheetRow: { borderBottomWidth: 0.75, borderBottomColor: C.line },
  sheetCells: { flexDirection: "row", alignItems: "center" },
  note: { marginLeft: 46, marginRight: 6, marginTop: -3, marginBottom: 7, fontFamily: "Helvetica-Oblique", fontSize: 9, color: C.muted },
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
  // A judge's drawn signature, at the width of a short signature line (600 × 200, scaled).
  drawn: { width: 105, height: 35, marginBottom: -10 },
  // Narrower than the total: "−12.50" at two decimal places.
  deducted: { width: 64, textAlign: "right" },
  deductionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  deductionWho: { width: 150, fontFamily: "Helvetica-Bold" },
  deductionWhy: { flexGrow: 1, flexBasis: 0 },
  deductionPoints: { width: 90, textAlign: "right", color: C.muted },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted },
  // A long label wraps rather than running into the page number.
  footerLabel: { flexShrink: 1, marginRight: 16 },
  footerPage: { flexShrink: 0 },
  footerEnd: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 3 },
  // A judge's notes: each entry in running order, beside what they noted on it.
  noteEntryNumber: { fontFamily: "Helvetica", color: C.muted },
  noteRow: { flexDirection: "row", gap: 12, paddingVertical: 7, borderBottomWidth: 0.75, borderBottomColor: C.line },
  noteEntry: { width: 170, fontFamily: "Helvetica-Bold" },
  noteBody: { flexGrow: 1, flexBasis: 0 },
});

/** The organizer as printed on the sheet: their name and photo (JPEG bytes). */
export type ReportOrganizer = { name: string; photo: Buffer | null };

/**
 * `reportId`: the scores' report ID, or null on a sheet that isn't part of the results (the judges' notes).
 * `signatures`: the judges' signatures from the deliberation (an event without live scoring); absent otherwise.
 * `signoff`: the organizer's signature on a deliberated session's results, given as they ended it. `signatories`: the
 * activity's signature lines (the Board of Tabulators and whoever else signs its results).
 */
type ReportInfo = {
  generatedAt: string;
  reportId: string | null;
  organizer: ReportOrganizer | null;
  signatories?: Signatory[];
  signatures?: JudgeSignature[] | null;
  signoff?: ActivitySignoff | null;
};

/**
 * The sheet's header: the organizer's photo, what kind of sheet it is ("Official results"), the report ID, the title,
 * and what the sheet covers. `byline`: whose sheet it is, on a judge's score sheet.
 */
function Header({
  info,
  eyebrow = "Official results",
  title,
  subtitle,
  byline,
  meta,
}: {
  info: ReportInfo;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  byline?: React.ReactNode;
  meta: string;
}) {
  const { reportId, organizer } = info;
  return (
    <View style={s.header}>
      {/* react-pdf's Image takes no alt text; the organizer's name is printed beside it. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {organizer?.photo && <Image style={s.photo} src={{ data: organizer.photo, format: "jpg" }} />}
      <View style={s.headerText}>
        <View style={s.topRow}>
          <Text style={s.eyebrow}>{eyebrow}</Text>
          {reportId && (
            <Text style={s.reportId}>
              <Text style={s.reportLabel}>Report ID </Text>
              {reportId}
            </Text>
          )}
        </View>
        <Text style={s.title}>{title}</Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        {byline && <Text style={s.byline}>{byline}</Text>}
        {/* One string: react-pdf spaces mixed text children unevenly. */}
        <Text style={s.meta}>{(organizer ? `Organized by ${organizer.name}. ` : "") + meta}</Text>
      </View>
    </View>
  );
}

const roleOf = (judge: Judge) => (judge.isChair ? "Chair, Board of Judges" : "Judge");

/**
 * The judges' sign-offs and the signatories' signature lines. `inline`: all in one row, the judge's name level with
 * the signatories' (a judge's score sheet, which one judge signs); otherwise the judges, then the signatories.
 */
function SignOff({
  judges,
  signatories,
  note,
  inline = false,
  signatures,
  signoff,
}: {
  judges: Board["judges"];
  signatories: Signatory[];
  note: string;
  inline?: boolean;
  /** From the deliberation: a judge who drew their signature has it above their name rather than "(Sgd.)". */
  signatures?: JudgeSignature[] | null;
  /** The organizer's signature, after the judges', on a deliberated session's results. */
  signoff?: ActivitySignoff | null;
}) {
  const mark = (drawing: string | null | undefined) =>
    drawing ? (
      <Svg viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`} style={s.drawn}>
        <Path d={drawing} stroke={C.prussian} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    ) : null;
  const organizerSigned = signoff && (
    <View key="organizer" style={s.signature}>
      {mark(signoff.method === "drawn" ? signoff.drawing : null)}
      <Text style={s.signName}>{signoff.signedBy}</Text>
      {signoff.method !== "drawn" && <Text style={s.signed}>(Sgd.)</Text>}
      <Text style={s.signRole}>Organizer</Text>
    </View>
  );
  const signed = judges.map((j) => {
    const drawing = signatures?.find((sig) => sig.judgeId === j.id && sig.method === "drawn")?.drawing;
    return (
      <View key={j.id} style={s.signature}>
        {/* Without a drawing, level with the signatories' names, under their signature lines. */}
        {drawing ? mark(drawing) : inline && <View style={{ height: s.signLine.height }} />}
        <Text style={s.signName}>{j.name}</Text>
        {!drawing && <Text style={s.signed}>(Sgd.)</Text>}
        <Text style={s.signRole}>{roleOf(j)}</Text>
      </View>
    );
  });
  const lines =
    signatories.length > 0 ? (
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
    );
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>Certified correct</Text>
      <Text style={s.sectionNote}>{note}</Text>
      {inline ? (
        <View style={s.signatures}>
          {signed}
          {lines}
        </View>
      ) : (
        <>
          <View style={s.signatures}>
            {signed}
            {organizerSigned}
          </View>
          <View style={s.signatures}>{lines}</View>
        </>
      )}
    </View>
  );
}

/** `perSheet`: count pages within each judge's sheet rather than the whole document, so each sheet stands alone. */
function Footer({ label, info, perSheet = false }: { label: string; info: ReportInfo; perSheet?: boolean }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerLabel}>{`${label}${info.reportId ? `, report ${info.reportId}` : ""}, generated ${info.generatedAt}`}</Text>
      <View style={s.footerEnd}>
        {/* What made the sheet, quietly: Tabulous's mark and name, before the page number. */}
        <Svg viewBox="0 0 48 48" style={{ width: 8, height: 8 }}>
          <Path d="M12 11v26M20 11v26M28 11v26M36 11v26M5.5 33.5 42.5 14.5" stroke={C.muted} strokeWidth={5} strokeLinecap="round" fill="none" />
        </Svg>
        <Text
          style={s.footerPage}
          render={({ pageNumber, totalPages, subPageNumber, subPageTotalPages }) =>
            `Tabulous · ${perSheet ? `Page ${subPageNumber} of ${subPageTotalPages}` : `Page ${pageNumber} of ${totalPages}`}`
          }
        />
      </View>
    </View>
  );
}

/**
 * The sign-off's note. `corrections`: the ones that changed a score on this sheet; null when they can't be known
 * (before migration 019), when submitted scores were simply final.
 */
const signNote = (corrections: CorrectionView[] | null, signatures?: JudgeSignature[] | null) =>
  "Each judge submitted every score above from their approved device with a personal access code" +
  (corrections === null
    ? ", and submitted scores are final. "
    : corrections.length === 0
      ? ". No score was changed after it was submitted. "
      : corrections.every((c) => c.decidedBy === "judge")
        ? ". The corrections listed above changed a submitted score: each judge corrected their own before signing, saying why. "
        : corrections.every((c) => c.decidedBy !== "judge")
          ? ". The corrections listed above changed a submitted score with the agreement of every other judge on the panel (or, for a judge alone on theirs, the organizer's approval). "
          : ". The corrections listed above changed a submitted score, each with its reason and who decided it. ") +
  (signatures?.length ? SIGNED_IN_DELIBERATION : "(Sgd.) marks each judge's verified sign-off.");

/** How the judges signed, after deliberating (an event without live scoring). */
const SIGNED_IN_DELIBERATION =
  "Each judge then reviewed their scores in deliberation and signed on their approved device: drawn by hand, or (Sgd.) where they signed off without a touchscreen.";

/** The corrections that changed scores on a sheet: who, which entry, before and after, why, and who decided. */
function CorrectionsList({ corrections }: { corrections: CorrectionView[] }) {
  if (corrections.length === 0) return null;
  return (
    <View>
      <Text style={s.sectionTitle} minPresenceAhead={48}>
        Score corrections
      </Text>
      <Text style={s.sectionNote}>
        {corrections.every((c) => c.decidedBy === "judge")
          ? "Submitted scores that changed: each judge corrected their own, saying why."
          : "Submitted scores that changed: each judge asked, saying why, and the others agreed."}
      </Text>
      {corrections.map((c) => (
        <View key={c.id} style={s.deductionRow} wrap={false}>
          <Text style={s.deductionWho}>{`${c.judgeName}, No. ${c.entryNumber} ${c.entryName}`}</Text>
          <Text style={s.deductionWhy}>{`${c.from} to ${c.to}. ${c.reason}`}</Text>
          <Text style={s.deductionPoints}>{c.decidedBy === "judge" ? "Corrected by the judge" : c.decidedBy === "organizer" ? "Organizer approved" : "Every other judge agreed"}</Text>
        </View>
      ))}
    </View>
  );
}

/** One activity's results, or one pageant sub-activity's (`part`: its name). */
function ResultsDocument({ board, info, part, corrections }: { board: Board; info: ReportInfo; part?: string; corrections: CorrectionView[] | null }) {
  const { activity, judges } = board;
  // Ties the judges broke in the deliberation place in the chair's order; any other tie shares its rank.
  const ranked = rankEntries(board.entries, judges, board.scores, activity);
  const rows = applyTieBreaks(ranked, board.tieBreaks ?? []);
  const broken = tiesIn(ranked).flatMap((tie) => {
    const settled = breakFor(tie, board.tieBreaks ?? []);
    return settled ? [{ tie, settled }] : [];
  });
  const nameOf = new Map(board.entries.map((e) => [e.id, e.name]));
  const noun = part ? "candidates" : "entries";
  const label = part ? `${activity.name}, ${part}` : activity.name;

  return (
    <Document title={`${label} results`} author="Tabulous" creator="Tabulous">
      <Page size="A4" orientation={judges.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <Header
          info={info}
          title={activity.name}
          subtitle={part}
          meta={
            `${rulesSummary(activity)} ${judges.length} judges, ${board.entries.length} ${noun}. ` +
            `Ranked by the average of all judges' scores; ${broken.length ? "a tie the judges broke places as they ordered it (see below), any other" : "equal averages"} share${broken.length ? "s" : ""} a rank. Generated ${info.generatedAt}.`
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

        {broken.length > 0 && (
          <View>
            <Text style={s.sectionTitle} minPresenceAhead={48}>
              Ties broken
            </Text>
            <Text style={s.sectionNote}>Entries with the same average, put in order by the chair of the board of judges during the deliberation, saying why.</Text>
            {broken.map(({ tie, settled }) => (
              <View key={tie.key} style={s.deductionRow} wrap={false}>
                <Text style={s.deductionWho}>{`Tie for ${ordinal(tie.rank)}: ${settled.entryIds.map((id) => nameOf.get(id) ?? "an entry").join(", then ")}`}</Text>
                <Text style={s.deductionWhy}>{settled.reason}</Text>
                <Text style={s.deductionPoints}>{judges.find((j) => j.id === settled.judgeId)?.name ?? "The chair"}</Text>
              </View>
            ))}
          </View>
        )}
        <CorrectionsList corrections={corrections ?? []} />
        <SignOff
          judges={judges}
          signatories={info.signatories ?? []}
          note={signNote(corrections, info.signatures) + (info.signoff ? ` ${info.signoff.signedBy} signed the results as organizer and ended the session.` : "")}
          signatures={info.signatures}
          signoff={info.signoff}
        />
        <Footer label={label} info={info} />
      </Page>
    </Document>
  );
}

/**
 * Each judge's score sheet, one after another: every entry in running order with the score that judge gave it, and
 * with criteria scoring the points for each criterion. Each sheet is signed by its judge and the signatories, and
 * carries the report ID of the results sheet it goes with. `part`: a pageant sub-activity's name.
 */
function JudgeSheetsDocument({ board, info, part, corrected }: { board: Board; info: ReportInfo; part?: string; corrected: Map<string, CorrectionView> }) {
  const { activity, judges } = board;
  const criteria = activity.scoringMode === "criteria" ? activity.criteria : [];
  const noun = part ? "candidates" : "entries";
  const label = part ? `${activity.name}, ${part}` : activity.name;
  const total = criteria.length === 0 ? "Score" : activity.criteriaDisplay === "ten" ? "Total (of 10)" : "Total";
  const meta = `${rulesSummary(activity)} ${board.entries.length} ${noun}, in running order. Generated ${info.generatedAt}.`;
  const row = (judge: Judge, r: JudgeSheetRow) => {
    const fix = corrected.get(`${judge.id}|${r.entry.id}`);
    return (
      <View key={r.entry.id} style={s.sheetRow} wrap={false}>
        <View style={s.sheetCells}>
          <Text style={[s.cell, s.number]}>{r.number}</Text>
          <Text style={[s.cell, s.entry]}>{r.entry.name}</Text>
          {r.points.map((v, i) => (
            <Text key={criteria[i].id} style={[s.cell, s.judge]}>
              {v === null ? "—" : formatScore(v, activity.decimals)}
            </Text>
          ))}
          <Text style={[s.cell, s.average]}>{r.value === null ? "—" : scoreText(r.value, activity)}</Text>
        </View>
        {fix && (
          <Text
            style={s.note}
          >{`Corrected from ${fix.from} (${fix.decidedBy === "judge" ? "by the judge" : fix.decidedBy === "organizer" ? "the organizer approved" : "every other judge agreed"}): ${fix.reason}`}</Text>
        )}
      </View>
    );
  };

  return (
    <Document title={`${label}, judges' score sheets`} author="Tabulous" creator="Tabulous">
      {judges.map((judge) => {
        const rows = judgeSheet(board, judge.id);
        // The last rows go with the sign-off, so a sheet that runs over never leaves the signatures alone on a page.
        const kept = rows.slice(-2);
        return (
          <Page key={judge.id} size="A4" orientation={criteria.length > 4 ? "landscape" : "portrait"} style={s.page}>
            <Header
              info={info}
              eyebrow="Judge's score sheet"
              title={activity.name}
              subtitle={part}
              byline={
                <>
                  {judge.name}
                  <Text style={s.bylineRole}>{`, ${roleOf(judge)}`}</Text>
                </>
              }
              meta={meta}
            />

            <View style={s.table}>
              <View style={s.headRow} fixed>
                <Text style={[s.cell, s.number, { color: C.mint }]}>No.</Text>
                <Text style={[s.cell, s.entry]}>{part ? "Candidate" : "Entry"}</Text>
                {criteria.map((c) => (
                  <Text key={c.id} style={[s.cell, s.judge]}>
                    {`${c.name} (${formatBound(c.max)})`}
                  </Text>
                ))}
                <Text style={[s.cell, s.average]}>{total}</Text>
              </View>
              {rows.slice(0, rows.length - kept.length).map((r) => row(judge, r))}
              <View wrap={false}>
                {kept.map((r) => row(judge, r))}
                <SignOff
                  inline
                  judges={[judge]}
                  signatories={info.signatories ?? []}
                  signatures={info.signatures}
                  note={
                    `${judge.name} submitted every score above from their approved device with a personal access code` +
                    ([...corrected.keys()].some((k) => k.startsWith(`${judge.id}|`))
                      ? "; a corrected score changed only with the others' agreement, as marked. "
                      : ", and submitted scores are final. ") +
                    (info.signatures?.length
                      ? "They then reviewed these scores in deliberation and signed on their approved device: drawn by hand, or (Sgd.) without a touchscreen."
                      : "(Sgd.) marks the judge's verified sign-off.")
                  }
                />
              </View>
            </View>

            <Footer label={`${judge.name}'s score sheet`} info={info} perSheet />
          </Page>
        );
      })}
    </Document>
  );
}

/**
 * A pageant standings sheet: the preliminary's results, a cut, or the final results. Each column is a sub-activity
 * with what it counts for; each candidate's figure there is their average as a percentage of its maximum score.
 * `placed`: the candidates who went through (or the final placements), in order, once the cut is confirmed.
 */
export type StandingsSheet = {
  /** subactivity: one sub-activity's standings, its parts as the columns. */
  kind: "preliminary" | "subactivity" | "cut" | "final";
  title: string;
  weights: { round: Round; weight: number }[];
  rows: StandingRow[];
  placed: string[] | null;
  /** Candidates whose tie the organizer broke, marked on the sheet. */
  tieBroken: string[];
  /** The deductions the totals take off (the preliminary's), listed under the table with their reasons. */
  deductions: Deduction[];
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
    if (sheet.kind === "preliminary" || sheet.kind === "subactivity") return null;
    if (sheet.kind === "final") return placeOf.has(id) ? String(placeOf.get(id)) : "—";
    return placeOf.has(id) ? "Through" : "—";
  };
  const statusHead = sheet.kind === "final" ? "Place" : sheet.kind === "cut" ? "Result" : null;
  // Deductions come off the preliminary score: all of it on the preliminary's sheet, its share on a cut that counts it.
  const deducting = sheet.rows.some((r) => r.deducted > 0);
  const prelimShare = sheet.weights.filter((w) => w.round.segment === "preliminary").reduce((n, w) => n + w.weight, 0);
  const deductionNote = !deducting
    ? ""
    : sheet.kind === "preliminary"
      ? " Deductions for violations are points off the preliminary score, listed below."
      : ` Deductions for violations are points off the preliminary score, which counts for ${formatBound(Math.round(prelimShare * 100) / 100)}% here, so each point takes ${formatBound(Math.round(prelimShare * 100) / 10000)} off the total. They're listed below.`;
  const numberOf = new Map(sheet.rows.map((r) => [r.entry.id, r]));
  const listed = [...sheet.deductions].sort((a, b) => (numberOf.get(a.entryId)?.number ?? 0) - (numberOf.get(b.entryId)?.number ?? 0));
  const meta =
    `Ranked by ${counts}. Each ${sheet.kind === "subactivity" ? "part" : "sub-activity"} counts as a candidate's average as a percentage of its maximum score.` +
    deductionNote +
    ` ${judges.length} judges, ${sheet.rows.length} candidates.` +
    (tieBroken.size ? " Candidates marked * were tied; the organizer decided their order." : "") +
    ` Generated ${info.generatedAt}.`;

  return (
    <Document title={`${activity.name}, ${sheet.title}`} author="Tabulous" creator="Tabulous">
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
            {deducting && <Text style={[s.cell, s.deducted]}>Deductions</Text>}
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
                {deducting && <Text style={[s.cell, s.deducted]}>{row.deducted > 0 ? `\u2212${row.deducted.toFixed(places)}` : "—"}</Text>}
                <Text style={[s.cell, s.average]}>{pct(row.total)}</Text>
              </View>
            );
          })}
        </View>

        {deducting && listed.length > 0 && (
          <View>
            <Text style={s.sectionTitle} minPresenceAhead={48}>
              Deductions
            </Text>
            <Text style={s.sectionNote}>Points off the preliminary score, for violations during the preliminary.</Text>
            {listed.map((d) => {
              const row = numberOf.get(d.entryId);
              return (
                <View key={d.id} style={s.deductionRow}>
                  <Text style={s.deductionWho}>{row ? `No. ${row.number} ${row.entry.name}` : "—"}</Text>
                  <Text style={s.deductionWhy}>{d.reason}</Text>
                  <Text style={s.deductionPoints}>{`${formatBound(d.points)} ${d.points === 1 ? "point" : "points"}`}</Text>
                </View>
              );
            })}
          </View>
        )}

        <SignOff
          judges={judges}
          signatories={info.signatories ?? []}
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
  { timeZone, reportId, organizer, signatories }: { timeZone?: string; reportId: string; organizer: ReportOrganizer | null; signatories: Signatory[] },
): Promise<Buffer> {
  return renderToBuffer(<StandingsDocument board={board} sheet={sheet} info={{ generatedAt: generatedAt(timeZone), reportId, organizer, signatories }} />);
}

/** Results as a PDF: an event's, or (with `part`, its name) one pageant sub-activity's. */
/** `corrections`: the applied corrections to this sheet's scores; null before migration 019. */
export function renderResultsPdf(
  board: Board,
  {
    timeZone,
    reportId,
    organizer,
    signatories,
    part,
    corrections = null,
    signatures = null,
    signoff = null,
  }: {
    timeZone?: string;
    reportId: string;
    organizer: ReportOrganizer | null;
    signatories: Signatory[];
    part?: string;
    corrections?: CorrectionView[] | null;
    signatures?: JudgeSignature[] | null;
    signoff?: ActivitySignoff | null;
  },
): Promise<Buffer> {
  return renderToBuffer(
    <ResultsDocument board={board} part={part} corrections={corrections} info={{ generatedAt: generatedAt(timeZone), reportId, organizer, signatories, signatures, signoff }} />,
  );
}

/**
 * The judges' score sheets that go with a results sheet: an event's, or (with `part`) one pageant sub-activity's.
 * `corrections`: applied corrections to these scores; each corrected score says what it was and why. The judges' notes
 * are a PDF of their own (renderNotesPdf).
 */
export function renderJudgeSheetsPdf(
  board: Board,
  {
    timeZone,
    reportId,
    organizer,
    signatories,
    part,
    corrections = [],
    signatures = null,
  }: {
    timeZone?: string;
    reportId: string;
    organizer: ReportOrganizer | null;
    signatories: Signatory[];
    part?: string;
    corrections?: CorrectionView[];
    signatures?: JudgeSignature[] | null;
  },
): Promise<Buffer> {
  const corrected = new Map(corrections.map((c) => [`${c.judgeId}|${c.entryId}`, c]));
  return renderToBuffer(
    <JudgeSheetsDocument board={board} part={part} corrected={corrected} info={{ generatedAt: generatedAt(timeZone), reportId, organizer, signatories, signatures }} />,
  );
}

/**
 * The judges' notes, a PDF of their own, laid out like the judges' score sheets: a page for each judge, with every entry
 * in running order and what they noted on it. Under the organizer's logo, as the results are. For the organizer's
 * reference, not part of the results, so it has no report ID or signatures.
 */
function NotesDocument({ board, notes, info }: { board: Board; notes: JudgeNote[]; info: ReportInfo }) {
  const { activity, judges } = board;
  const noun = activity.kind === "pageant" ? "candidate" : "entry";
  const entries = [...board.entries].sort((a, b) => a.position - b.position).map((entry, i) => ({ entry, number: entry.number ?? i + 1 }));
  const meta = `What this judge noted on each ${noun}, for the organizer's reference; not part of the results. In running order. Generated ${info.generatedAt}.`;

  return (
    <Document title={`${activity.name}, judges' notes`} author="Tabulous" creator="Tabulous">
      {judges.map((judge) => {
        const mine = new Map(notes.filter((n) => n.judgeId === judge.id).map((n) => [n.entryId, n.body]));
        return (
          <Page key={judge.id} size="A4" style={s.page}>
            <Header
              info={info}
              eyebrow="Judge's notes"
              title={activity.name}
              byline={
                <>
                  {judge.name}
                  <Text style={s.bylineRole}>{`, ${roleOf(judge)}`}</Text>
                </>
              }
              meta={meta}
            />
            {mine.size === 0 && <Text style={s.sectionNote}>{`${judge.name} didn't write a note on any ${noun}.`}</Text>}
            {entries.map(({ entry, number }) => (
              <View key={entry.id} style={s.noteRow} wrap={false}>
                <Text style={s.noteEntry}>
                  <Text style={s.noteEntryNumber}>{`No. ${number}  `}</Text>
                  {entry.name}
                </Text>
                <Text style={mine.has(entry.id) ? s.noteBody : [s.noteBody, { color: C.muted }]}>{mine.get(entry.id) ?? "No note."}</Text>
              </View>
            ))}
            <Footer label={`${activity.name}, ${judge.name}'s notes`} info={info} />
          </Page>
        );
      })}
    </Document>
  );
}

/** The judges' notes on an activity's entries as a PDF (see NotesDocument). */
export function renderNotesPdf(
  board: Board,
  notes: JudgeNote[],
  { timeZone, organizer }: { timeZone?: string; organizer: ReportOrganizer | null },
): Promise<Buffer> {
  return renderToBuffer(<NotesDocument board={board} notes={notes} info={{ generatedAt: generatedAt(timeZone), reportId: null, organizer }} />);
}
