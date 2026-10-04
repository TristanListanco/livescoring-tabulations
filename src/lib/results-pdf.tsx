import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatAverage, formatScore, rangeLabel, rankEntries } from "./scoring";
import type { Board } from "./types";

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
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.regal },
  reportId: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 0.5 },
  reportLabel: { fontFamily: "Helvetica", color: C.muted },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, marginTop: 4 },
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
  average: { width: 64, textAlign: "right", fontFamily: "Helvetica-Bold" },
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

type ReportInfo = { generatedAt: string; reportId: string; organizer: string | null };

function ResultsDocument({ board, info }: { board: Board; info: ReportInfo }) {
  const { generatedAt, reportId, organizer } = info;
  const { activity, judges } = board;
  const rows = rankEntries(board.entries, judges, board.scores);
  const decimals =
    activity.decimals === 0 ? "whole numbers" : `${activity.decimals} decimal place${activity.decimals > 1 ? "s" : ""}`;

  return (
    <Document title={`${activity.name} results`} author="LiveScoring" creator="LiveScoring">
      <Page size="A4" orientation={judges.length > 4 ? "landscape" : "portrait"} style={s.page}>
        <View style={s.topRow}>
          <Text style={s.eyebrow}>Official results</Text>
          <Text style={s.reportId}>
            <Text style={s.reportLabel}>Report ID </Text>
            {reportId}
          </Text>
        </View>
        <Text style={s.title}>{activity.name}</Text>
        {/* One string: react-pdf spaces mixed text children unevenly. */}
        <Text style={s.meta}>
          {(organizer ? `Organized by ${organizer}. ` : "") +
            `Scores from ${rangeLabel(activity)}, ${decimals}. ${judges.length} judges, ${board.entries.length} entries. ` +
            `Ranked by the average of all judges' scores; equal averages share a rank. Generated ${generatedAt}.`}
        </Text>

        <View style={s.table}>
          <View style={s.headRow} fixed>
            <Text style={[s.cell, s.rank]}>Rank</Text>
            <Text style={[s.cell, s.number, { color: C.mint }]}>No.</Text>
            <Text style={[s.cell, s.entry]}>Entry</Text>
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
                    {v === undefined ? "—" : formatScore(v, activity.decimals)}
                  </Text>
                );
              })}
              <Text style={[s.cell, s.average]}>{formatAverage(row.averageHundredths)}</Text>
            </View>
          ))}
        </View>

        <View wrap={false}>
          <Text style={s.sectionTitle}>Certified correct</Text>
          <Text style={s.sectionNote}>
            {"Each judge submitted every score above from their own device with a personal access code, and submitted scores are final. " +
              "(Sgd.) marks each judge's verified sign-off."}
          </Text>
          <View style={s.signatures}>
            {judges.map((j) => (
              <View key={j.id} style={s.signature}>
                <Text style={s.signName}>{j.name}</Text>
                <Text style={s.signed}>(Sgd.)</Text>
                <Text style={s.signRole}>Judge</Text>
              </View>
            ))}
            <View style={s.signature}>
              <View style={s.signLine} />
              <Text style={s.signName}> </Text>
              <Text style={s.signRole}>Tabulator</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{`${activity.name}, report ${reportId}, generated ${generatedAt}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderResultsPdf(
  board: Board,
  { timeZone, reportId, organizer }: { timeZone?: string; reportId: string; organizer: string | null },
): Promise<Buffer> {
  let zone: string | undefined = timeZone;
  try {
    if (zone) new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = undefined;
  }
  const generatedAt = new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(new Date());
  return renderToBuffer(<ResultsDocument board={board} info={{ generatedAt, reportId, organizer }} />);
}
