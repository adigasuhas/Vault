import path from "path";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/currencies";
import type { Report, ColumnKind } from "@/lib/reports";

// The built-in Helvetica has no glyph for the rupee sign (U+20B9) and other
// non-Latin currency symbols — it rendered "₹" as a superscript "¹" in every
// INR report (finding F11). Noto Sans covers them. The TTFs are traced into the
// serverless bundle via `outputFileTracingIncludes` in next.config.ts.
const FONT_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");
Font.register({
  family: "Noto Sans",
  fonts: [
    { src: path.join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]); // don't hyphenate

const INK = "#15171A";
const MUTED = "#6B6A64";
const RULE = "#E3DFD6";
const BRASS = "#9C7A2E";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontSize: 9, fontFamily: "Noto Sans", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 14, borderBottom: `1.5 solid ${INK}` },
  brand: { fontSize: 15, fontWeight: 700, letterSpacing: 4 },
  brandRule: { width: 26, height: 2, backgroundColor: BRASS, marginTop: 5 },
  meta: { textAlign: "right", color: MUTED, fontSize: 8, lineHeight: 1.5 },
  title: { fontSize: 17, fontWeight: 700, marginTop: 18 },
  subtitle: { fontSize: 9, color: MUTED, marginTop: 3 },
  statsRow: { flexDirection: "row", marginTop: 16, marginBottom: 6, borderTop: `0.75 solid ${RULE}`, borderBottom: `0.75 solid ${RULE}` },
  stat: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRight: `0.75 solid ${RULE}` },
  statLast: { flex: 1, paddingVertical: 10, paddingHorizontal: 8 },
  statLabel: { fontSize: 7, color: MUTED, marginBottom: 4, letterSpacing: 0.6, textTransform: "uppercase" },
  statValue: { fontSize: 12, fontWeight: 700 },
  table: { marginTop: 14 },
  th: { fontSize: 7, fontWeight: 700, color: MUTED, letterSpacing: 0.5, textTransform: "uppercase" },
  headRow: { flexDirection: "row", paddingBottom: 5, borderBottom: `0.75 solid ${INK}` },
  row: { flexDirection: "row", paddingVertical: 4.5, borderBottom: `0.5 solid ${RULE}` },
  totalRow: { flexDirection: "row", paddingVertical: 6, borderTop: `1 solid ${INK}`, marginTop: -0.5 },
  cell: { fontSize: 8.5, paddingRight: 6 },
  num: { textAlign: "right" },
  neg: { color: "#B4432F" },
  notes: { marginTop: 14, fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

function fmt(kind: ColumnKind, v: string | number | null | undefined, currency: string) {
  if (v == null || v === "") return "–";
  if (kind === "money" && typeof v === "number") return formatMoney(Math.round(v * 100) / 100, currency);
  if (kind === "pct" && typeof v === "number") return `${v.toFixed(1)}%`;
  return String(v);
}

/** Column flex weights: text columns get more room than figures. */
function weight(kind: ColumnKind, key: string) {
  if (key === "description" || key === "summary") return 3;
  if (kind === "text" || kind === "status") return 1.6;
  return 1.1;
}

/** Renders any Report (see src/lib/reports.ts) as an A4 statement. */
export function ReportPdf({ report, userName, generatedAt }: { report: Report; userName?: string; generatedAt: Date }) {
  const cols = report.columns.filter((c) => c.key !== "id");
  return (
    <Document title={`VAULT · ${report.title}`} author="VAULT">
      <Page size="A4" orientation={cols.length > 6 ? "landscape" : "portrait"} style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>VAULT</Text>
            <View style={styles.brandRule} />
          </View>
          <View style={styles.meta}>
            {userName ? <Text>{userName}</Text> : null}
            <Text>Currency: {report.currency}</Text>
            <Text>Generated {generatedAt.toISOString().slice(0, 10)}</Text>
          </View>
        </View>
        <Text style={styles.title}>{report.title}</Text>
        <Text style={styles.subtitle}>{report.subtitle}</Text>
        {report.summary.length > 0 && (
          <View style={styles.statsRow}>
            {report.summary.map((s, i) => (
              <View key={s.label} style={i === report.summary.length - 1 ? styles.statLast : styles.stat}>
                <Text style={styles.statLabel}>{s.label}</Text>
                <Text style={styles.statValue}>{fmt(s.kind, s.value, report.currency)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.table}>
          <View style={styles.headRow} fixed>
            {cols.map((c) => (
              <Text key={c.key} style={[styles.th, styles.cell, { flex: weight(c.kind, c.key) }, c.kind === "money" || c.kind === "pct" || c.kind === "number" ? styles.num : {}]}>
                {c.label}
              </Text>
            ))}
          </View>
          {report.rows.length === 0 ? (
            <Text style={[styles.cell, { paddingVertical: 10, color: MUTED }]}>No entries in this period.</Text>
          ) : (
            report.rows.map((r, i) => (
              <View key={i} style={styles.row} wrap={false}>
                {cols.map((c) => {
                  const v = r[c.key];
                  const numeric = c.kind === "money" || c.kind === "pct" || c.kind === "number";
                  return (
                    <Text key={c.key} style={[styles.cell, { flex: weight(c.kind, c.key) }, numeric ? styles.num : {}, typeof v === "number" && v < 0 && c.kind === "money" ? styles.neg : {}]}>
                      {fmt(c.kind, v, report.currency)}
                    </Text>
                  );
                })}
              </View>
            ))
          )}
          {report.totals && (
            <View style={styles.totalRow} wrap={false}>
              {cols.map((c) => (
                <Text key={c.key} style={[styles.cell, { flex: weight(c.kind, c.key), fontWeight: 700 }, c.kind === "money" || c.kind === "pct" || c.kind === "number" ? styles.num : {}]}>
                  {report.totals![c.key] == null || report.totals![c.key] === "" ? "" : fmt(c.kind, report.totals![c.key], report.currency)}
                </Text>
              ))}
            </View>
          )}
        </View>
        {report.notes?.length ? <Text style={styles.notes}>{report.notes.join("  ")}</Text> : null}
        <View style={styles.footer} fixed>
          <Text>VAULT · {report.title} · {report.subtitle}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
