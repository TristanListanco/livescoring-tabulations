import "server-only";
import { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CorrectionView } from "./corrections";
import type { EntryDetails, EntryField } from "./entry-details";
import type { StandingRow } from "./pageant";
import { averageText, formatBound, formatScore, judgeSheet, rankEntries, scoreText, type JudgeSheetRow } from "./scoring";
import type { JudgeNote } from "./data";
import { SIGNATURE_BOX } from "./deliberation";
import { applyTieBreaks, breakFor, ordinal, tiesIn } from "./ties";
import type { Board, Deduction, Judge, JudgeSignature, Round, Signatory } from "./types";
import { INTER_ITALIC, INTER_LIGHT, INTER_REGULAR, INTER_SEMIBOLD } from "./pdf-fonts";

// Names wrap at spaces only; the default splits them mid-word ("Vil-lanueva").
Font.registerHyphenationCallback((word) => [word]);

// The panel's typeface, in the weights its pages use: light titles, regular text, semibold for what stands out.
Font.register({
  family: "Inter",
  fonts: [
    { src: INTER_LIGHT, fontWeight: 300 },
    { src: INTER_REGULAR, fontWeight: 400 },
    { src: INTER_SEMIBOLD, fontWeight: 600 },
    { src: INTER_ITALIC, fontWeight: 400, fontStyle: "italic" },
  ],
});

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
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Inter", fontSize: 9.5, color: C.prussian },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  photo: { width: 52, height: 52, borderRadius: 26, objectFit: "cover" },
  headerText: { flexGrow: 1, flexBasis: 0 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  eyebrow: { fontWeight: 600, fontSize: 9, color: C.regal },
  reportId: { fontWeight: 600, fontSize: 9, letterSpacing: 0.4 },
  reportLabel: { fontWeight: 400, color: C.muted },
  // As the panel's page titles: large and light, set a little tight.
  title: { fontWeight: 300, fontSize: 26, lineHeight: 1.15, letterSpacing: -0.5, marginTop: 6 },
  subtitle: { fontWeight: 400, fontSize: 14, marginTop: 3, color: C.regal },
  byline: { fontWeight: 600, fontSize: 12, marginTop: 8 },
  bylineRole: { fontWeight: 400, color: C.muted },
  meta: { marginTop: 6, color: C.muted, maxWidth: 480 },
  table: { marginTop: 22 },
  // As the panel's tables: small muted headings over a hairline, hairlines between the rows.
  headRow: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.prussian, color: C.muted, fontWeight: 600, fontSize: 8 },
  row: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.line, alignItems: "center" },
  // A judge's score sheet row: the scores, with a correction to one under them.
  sheetRow: { borderBottomWidth: 0.75, borderBottomColor: C.line },
  sheetCells: { flexDirection: "row", alignItems: "center" },
  note: { marginLeft: 46, marginRight: 6, marginTop: -3, marginBottom: 7, fontStyle: "italic", fontSize: 9, color: C.muted },
  podiumRow: { backgroundColor: C.podium, fontWeight: 600 },
  cell: { paddingVertical: 7, paddingHorizontal: 6 },
  rank: { width: 42 },
  number: { width: 34, color: C.muted },
  entry: { flexGrow: 3, flexBasis: 0 },
  detail: { flexGrow: 2, flexBasis: 0, color: C.muted },
  judge: { flexGrow: 1, flexBasis: 0, textAlign: "center" },
  // Wide enough for "100.0000%" at four decimal places.
  average: { width: 72, textAlign: "right", fontWeight: 600 },
  // As the panel's section titles: a size up from the text, and regular.
  sectionTitle: { fontWeight: 400, fontSize: 14, letterSpacing: -0.2, marginTop: 30 },
  sectionNote: { marginTop: 3, color: C.muted },
  // The sign-off: a group to a row (Certified correct, Tabulated by, Noted by), each name under its line.
  signOff: { marginTop: 30 },
  signGroup: { marginTop: 18 },
  signGroupTitle: { fontWeight: 600, fontSize: 9, color: C.muted, letterSpacing: 0.3 },
  signatures: { flexDirection: "row", flexWrap: "wrap" },
  signature: { width: "33.33%", paddingRight: 24, marginTop: 14 },
  // What's above the name, on its line: a drawn signature, "(Sgd.)", or nothing, to sign on paper. Always this tall, so
  // every name in a row lines up.
  signMark: { height: 34, justifyContent: "flex-end", alignItems: "flex-start", borderBottomWidth: 0.75, borderBottomColor: C.prussian, paddingBottom: 3 },
  signName: { fontWeight: 600, marginTop: 5, textTransform: "uppercase", letterSpacing: 0.2 },
  signed: { fontStyle: "italic" },
  signRole: { color: C.muted, marginTop: 2 },
  // A judge's drawn signature, at the width of a short signature line (600 × 200, scaled).
  drawn: { width: 105, height: 35, marginBottom: -6 },
  // Narrower than the total: "−12.50" at two decimal places.
  deducted: { width: 64, textAlign: "right" },
  deductionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  deductionWho: { width: 150, fontWeight: 600 },
  deductionWhy: { flexGrow: 1, flexBasis: 0 },
  deductionPoints: { width: 90, textAlign: "right", color: C.muted },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: C.muted },
  // A long label wraps rather than running into the page number.
  footerLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, marginRight: 16 },
  // Page numbers are filled in after the layout, which can't measure them: room for "· Page 10 of 12".
  footerPage: { width: 72 },
  footerEnd: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 3 },
  // A judge's notes: each entry in running order, beside what they noted on it.
  noteEntryNumber: { fontWeight: 400, color: C.muted },
  noteRow: { flexDirection: "row", gap: 12, paddingVertical: 7, borderBottomWidth: 0.75, borderBottomColor: C.line },
  noteEntry: { width: 170, fontWeight: 600 },
  noteBody: { flexGrow: 1, flexBasis: 0 },
});

/** The organizer as printed on the sheet: their name and photo (JPEG bytes). */
export type ReportOrganizer = { name: string; photo: Buffer | null };
/** An event's entry details for the results: the fields, and each entry's values by entry id. */
export type EntryDetailsSheet = { fields: EntryField[]; byEntry: Record<string, EntryDetails> };

/**
 * `reportId`: the scores' report ID, or null on a sheet that isn't part of the results (the judges' notes).
 * `signatures`: the judges' signatures from the deliberation (an event without live scoring); absent otherwise.
 * `signatories`: the
 * activity's signature lines (the Board of Tabulators and whoever else signs its results).
 */
type ReportInfo = {
  generatedAt: string;
  reportId: string | null;
  organizer: ReportOrganizer | null;
  signatories?: Signatory[];
  signatures?: JudgeSignature[] | null;
};

/**
 * The sheet's header: the organizer's photo, what kind of sheet it is ("Official results"), the report ID and the title.
 * `byline`: whose sheet it is, on a judge's score sheet. `meta`: only what the sheet needs read before its table (what
 * its marks mean); when it was generated is in the footer.
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
  meta?: string;
}) {
  const { reportId, organizer } = info;
  return (
    <View style={s.header}>
      {/* react-pdf's Image takes no alt text. */}
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
        {meta && <Text style={s.meta}>{meta}</Text>}
      </View>
    </View>
  );
}

const roleOf = (judge: Judge) => (judge.isChair ? "Chair, Board of Judges" : "Judge");

/**
 * One person on the sign-off: above their name a drawn signature or "(Sgd.)" (a judge, who signed in Tabulous) or
 * nothing (a line to sign on paper: the signatories), then their name in capitals and their role.
 */
type Signer = { key: string; name: string; role?: string | null; signed?: { drawing: string | null } };

function SignBlock({ signer }: { signer: Signer }) {
  const drawing = signer.signed?.drawing;
  return (
    <View style={s.signature}>
      <View style={s.signMark}>
        {drawing ? (
          <Svg viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`} style={s.drawn}>
            <Path d={drawing} stroke={C.prussian} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : (
          signer.signed && <Text style={s.signed}>(Sgd.)</Text>
        )}
      </View>
      <Text style={s.signName}>{signer.name || " "}</Text>
      {signer.role && <Text style={s.signRole}>{signer.role}</Text>}
    </View>
  );
}

/** A group of the sign-off, its heading and its people a row at a time, kept together on one page. */
function SignGroup({ title, signers }: { title: string; signers: Signer[] }) {
  if (signers.length === 0) return null;
  return (
    <View style={s.signGroup} wrap={false}>
      <Text style={s.signGroupTitle}>{title}</Text>
      <View style={s.signatures}>
        {signers.map((signer) => (
          <SignBlock key={signer.key} signer={signer} />
        ))}
      </View>
    </View>
  );
}

/**
 * Who stands behind the sheet, in two groups: Certified correct (the judges, or on a judge's own score sheet that
 * judge) and Tabulated by (the activity's signatories, who sign on paper).
 */
function SignOff({
  judges,
  signatories,
  signatures,
}: {
  judges: Board["judges"];
  signatories: Signatory[];
  /** From the deliberation: a judge who drew their signature has it above their name rather than "(Sgd.)". */
  signatures?: JudgeSignature[] | null;
}) {
  const certified: Signer[] = judges.map((j) => ({
    key: j.id,
    name: j.name,
    role: roleOf(j),
    signed: { drawing: signatures?.find((sig) => sig.judgeId === j.id && sig.method === "drawn")?.drawing ?? null },
  }));
  const tabulated: Signer[] = signatories.length
    ? signatories.map((p, i) => ({ key: `signatory-${i}`, name: p.name, role: p.designation }))
    : [{ key: "tabulator", name: "", role: "Tabulator" }];
  return (
    <View style={s.signOff}>
      <SignGroup title="Certified correct" signers={certified} />
      <SignGroup title="Tabulated by" signers={tabulated} />
    </View>
  );
}

/** `perSheet`: count pages within each judge's sheet rather than the whole document, so each sheet stands alone. */
function Footer({ info, perSheet = false }: { info: ReportInfo; perSheet?: boolean }) {
  return (
    <View style={s.footer} fixed>
      {/* When it was made: the sheet and its report ID are already in its header. */}
      <Text style={s.footerLabel}>{`Generated ${info.generatedAt}`}</Text>
      <View style={s.footerEnd}>
        {/* What made the sheet, quietly: Tabulous's mark and name, before the page number. */}
        <Svg viewBox="0 0 48 48" style={{ width: 8, height: 8 }}>
          <Path d="M12 11v26M20 11v26M28 11v26M36 11v26M5.5 33.5 42.5 14.5" stroke={C.muted} strokeWidth={5} strokeLinecap="round" fill="none" />
        </Svg>
        <Text>Tabulous</Text>
        <Text
          style={s.footerPage}
          render={({ pageNumber, totalPages, subPageNumber, subPageTotalPages }) =>
            `· ${perSheet ? `Page ${subPageNumber} of ${subPageTotalPages}` : `Page ${pageNumber} of ${totalPages}`}`
          }
        />
      </View>
    </View>
  );
}

/** The corrections that changed scores on a sheet: who, which entry, before and after, why, and who decided. */
function CorrectionsList({ corrections }: { corrections: CorrectionView[] }) {
  if (corrections.length === 0) return null;
  return (
    <View>
      <Text style={s.sectionTitle} minPresenceAhead={48}>
        Score corrections
      </Text>
      {corrections.map((c) => (
        <View key={c.id} style={s.deductionRow} wrap={false}>
          <Text style={s.deductionWho}>{`${c.judgeName}, No. ${c.entryNumber} ${c.entryName}`}</Text>
          <Text style={s.deductionWhy}>{`${c.from} to ${c.to}. ${c.reason}`}</Text>
          {/* Who agreed to it, where someone other than the judge did. */}
          <Text style={s.deductionPoints}>{c.decidedBy === "organizer" ? "Organizer approved" : c.decidedBy === "judge" ? "" : "Every other judge agreed"}</Text>
        </View>
      ))}
    </View>
  );
}

/** One activity's results, or one pageant sub-activity's (`part`: its name). */
function ResultsDocument({
  board,
  info,
  part,
  corrections,
  details,
}: {
  board: Board;
  info: ReportInfo;
  part?: string;
  corrections: CorrectionView[] | null;
  /** An event's entry details, a column each after the entry's name (see entry-details.ts). */
  details: EntryDetailsSheet | null;
}) {
  const { activity, judges } = board;
  const fields = details?.fields ?? [];
  // Ties the judges broke in the deliberation place in the chair's order; any other tie shares its rank.
  const ranked = rankEntries(board.entries, judges, board.scores, activity);
  const rows = applyTieBreaks(ranked, board.tieBreaks ?? []);
  const broken = tiesIn(ranked).flatMap((tie) => {
    const settled = breakFor(tie, board.tieBreaks ?? []);
    return settled ? [{ tie, settled }] : [];
  });
  const nameOf = new Map(board.entries.map((e) => [e.id, e.name]));
  const label = part ? `${activity.name}, ${part}` : activity.name;

  return (
    <Document title={`${label} results`} author="Tabulous" creator="Tabulous">
      <Page size="A4" orientation={judges.length + fields.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <Header info={info} title={activity.name} subtitle={part} />

        <View style={s.table}>
          <View style={s.headRow} fixed>
            <Text style={[s.cell, s.rank]}>Rank</Text>
            <Text style={[s.cell, s.number]}>No.</Text>
            <Text style={[s.cell, s.entry]}>{part ? "Candidate" : "Entry"}</Text>
            {fields.map((f) => (
              <Text key={f.id} style={[s.cell, s.detail]}>
                {f.name}
              </Text>
            ))}
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
              {fields.map((f) => (
                <Text key={f.id} style={[s.cell, s.detail]}>
                  {details?.byEntry[row.entry.id]?.[f.id] ?? ""}
                </Text>
              ))}
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
        <SignOff judges={judges} signatories={info.signatories ?? []} signatures={info.signatures} />
        <Footer info={info} />
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
  const label = part ? `${activity.name}, ${part}` : activity.name;
  const total = criteria.length === 0 ? "Score" : activity.criteriaDisplay === "ten" ? "Total (of 10)" : "Total";
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
          >{`Corrected from ${fix.from}${fix.decidedBy === "judge" ? "" : fix.decidedBy === "organizer" ? " (the organizer approved)" : " (every other judge agreed)"}: ${fix.reason}`}</Text>
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
            />

            <View style={s.table}>
              <View style={s.headRow} fixed>
                <Text style={[s.cell, s.number]}>No.</Text>
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
                <SignOff judges={[judge]} signatories={info.signatories ?? []} signatures={info.signatures} />
              </View>
            </View>

            <Footer info={info} perSheet />
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
  // A cut counts only a share of the preliminary, so a deduction there takes less off the total than its points.
  const deductionNote =
    deducting && sheet.kind !== "preliminary"
      ? `Deductions are points off the preliminary score, which counts for ${formatBound(Math.round(prelimShare * 100) / 100)}% here, so each point takes ${formatBound(Math.round(prelimShare * 100) / 10000)} off the total.`
      : "";
  const numberOf = new Map(sheet.rows.map((r) => [r.entry.id, r]));
  const listed = [...sheet.deductions].sort((a, b) => (numberOf.get(a.entryId)?.number ?? 0) - (numberOf.get(b.entryId)?.number ?? 0));
  const meta = [deductionNote, tieBroken.size ? "Candidates marked * were tied; the organizer decided their order." : ""].filter(Boolean).join(" ");

  return (
    <Document title={`${activity.name}, ${sheet.title}`} author="Tabulous" creator="Tabulous">
      <Page size="A4" orientation={sheet.weights.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <Header info={info} title={activity.name} subtitle={sheet.title} meta={meta} />

        <View style={s.table}>
          <View style={s.headRow} fixed>
            {statusHead && <Text style={[s.cell, s.rank]}>{statusHead}</Text>}
            <Text style={[s.cell, s.rank]}>Rank</Text>
            <Text style={[s.cell, s.number]}>No.</Text>
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

        <SignOff judges={judges} signatories={info.signatories ?? []} />
        <Footer info={info} />
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
    details = null,
  }: {
    timeZone?: string;
    reportId: string;
    organizer: ReportOrganizer | null;
    signatories: Signatory[];
    part?: string;
    corrections?: CorrectionView[] | null;
    signatures?: JudgeSignature[] | null;
    details?: EntryDetailsSheet | null;
  },
): Promise<Buffer> {
  return renderToBuffer(
    <ResultsDocument
      board={board}
      part={part}
      corrections={corrections}
      details={details}
      info={{ generatedAt: generatedAt(timeZone), reportId, organizer, signatories, signatures }}
    />,
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
              meta="For the organizer's reference, not part of the results."
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
            <Footer info={info} />
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
