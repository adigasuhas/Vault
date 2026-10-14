import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { cleanSymbol, research, ResearchUnavailableError } from "@/lib/research";
import { CHART_RANGES, NotFoundError, type ChartRange } from "@/lib/research/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SECTIONS = ["summary", "chart", "financials", "earnings", "ownership", "analysts", "news"] as const;
type Section = (typeof SECTIONS)[number];

/** GET /api/research/:symbol?section=summary|chart|financials|earnings|ownership|analysts|news[&range=1Y]
 * Read-only company research. `summary` also says whether you hold the stock
 * in VAULT (your portfolio, kept apart from the company's ownership data). */
export const GET = authed<{ symbol: string }>(async (req, { userId, params }) => {
  const section = (req.nextUrl.searchParams.get("section") ?? "summary") as Section;
  if (!SECTIONS.includes(section)) return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  const limit = await rateLimit(`research:${userId}`, 120, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests at once. Wait a moment." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  try {
    const symbol = cleanSymbol(params.symbol);
    const range = (req.nextUrl.searchParams.get("range") ?? "1Y") as ChartRange;
    if (section === "chart" && !CHART_RANGES.includes(range)) return NextResponse.json({ error: "Unknown range." }, { status: 400 });
    const r =
      section === "chart" ? await research.chart(symbol, range)
      : section === "financials" ? await research.financials(symbol)
      : section === "earnings" ? await research.earnings(symbol)
      : section === "ownership" ? await research.ownership(symbol)
      : section === "analysts" ? await research.analysts(symbol)
      : section === "news" ? await research.news(symbol)
      : await research.summary(symbol);
    const holding =
      section === "summary"
        ? await db.stockHolding.findFirst({ where: { userId, ticker: symbol }, select: { id: true, quantity: true, avgBuyPrice: true, currency: true } })
        : null;
    return { data: r.data, fetchedAt: r.fetchedAt, stale: r.stale, source: r.source, ...(section === "summary" ? { holding: holding ? { id: holding.id, quantity: Number(holding.quantity), avgBuyPrice: Number(holding.avgBuyPrice), currency: holding.currency } : null } : {}) };
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ResearchUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
});
