import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { reportToCsv } from "@/lib/reports";
import { ReportPdf } from "@/lib/pdf/ReportDocument";
import { ValidationError } from "@/lib/validate";
import { ASSET_TYPES, INVESTMENT_REPORTS, buildInvestmentReport, type InvestmentReportType } from "@/lib/investment-reports";
import type { InvestmentKind } from "@/lib/category-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/investments/reports?type=portfolio|trades|transactions|categories|performance
 *  [&from=YYYY-MM-DD&to=YYYY-MM-DD][&assetTypes=STOCK,OTHER][&categoryIds=id,__none__][&format=json|csv|pdf] */
export const GET = authed(async (req, { userId }) => {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") as InvestmentReportType;
  if (!INVESTMENT_REPORTS.includes(type)) throw new ValidationError("Unknown report.");
  const list = (k: string) => (sp.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const assetTypes = list("assetTypes").filter((k): k is InvestmentKind => (ASSET_TYPES as string[]).includes(k));
  const report = await buildInvestmentReport(userId, {
    type,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    assetTypes,
    categoryIds: list("categoryIds").slice(0, 50),
  });
  const format = sp.get("format") ?? "json";
  const { fileName, ...body } = report;
  if (format === "csv") {
    return new NextResponse(reportToCsv(body), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}.csv"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "pdf") {
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const buffer = await renderToBuffer(<ReportPdf report={body} userName={user?.name ?? user?.email} generatedAt={new Date()} />);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}.pdf"`, "Cache-Control": "no-store" },
    });
  }
  return { report: body };
});
