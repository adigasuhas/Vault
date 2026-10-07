import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { buildReport, reportToCsv, REPORT_TYPES, type ReportType } from "@/lib/reports";
import { ReportPdf } from "@/lib/pdf/ReportDocument";
import { ValidationError } from "@/lib/validate";
import { monthKey } from "@/lib/dates";
import { userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /api/reports/:type?from=YYYY-MM&to=YYYY-MM[&accountId][&format=json|csv|pdf] */
export const GET = authed<{ type: string }>(async (req, { userId, params }) => {
  if (!REPORT_TYPES.includes(params.type as ReportType)) throw new ValidationError("Unknown report.");
  const sp = req.nextUrl.searchParams;
  const current = monthKey(await userToday(userId));
  const from = MONTH.test(sp.get("from") ?? "") ? sp.get("from")! : current;
  const to = MONTH.test(sp.get("to") ?? "") ? sp.get("to")! : from;
  const report = await buildReport(userId, params.type as ReportType, { from, to, accountId: sp.get("accountId") });
  const format = sp.get("format") ?? "json";
  const name = `vault-${params.type}-${from}${to !== from ? `_${to}` : ""}`;

  if (format === "csv") {
    return new NextResponse(reportToCsv(report), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
    });
  }
  if (format === "pdf") {
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const buffer = await renderToBuffer(<ReportPdf report={report} userName={user?.name ?? user?.email} generatedAt={new Date()} />);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` },
    });
  }
  return { report };
});
