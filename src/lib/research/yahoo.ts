import YahooFinance from "yahoo-finance2";
import { NotFoundError, type Analysts, type Chart, type ChartRange, type Earnings, type Financials, type NewsItem, type Ownership, type Period, type Quote, type ResearchProvider, type SearchHit, type StatGroup, type Summary } from "@/lib/research/types";

/**
 * Yahoo Finance, through the unofficial yahoo-finance2 library (already used
 * for VAULT's prices). It has no API key, no SLA and no published rate
 * limits, and Yahoo's terms allow personal use only, so responses are cached
 * (lib/research) and every field is treated as optional.
 *
 * Checked against live responses (Oct 2026):
 * - Financial statements come from fundamentalsTimeSeries; the older
 *   statement modules have been mostly empty since Nov 2024.
 * - Statements are in the company's reporting currency (financialCurrency),
 *   which can differ from its trading currency (Infosys: USD vs INR).
 * - Ratios Yahoo computes across the two (EV/EBITDA, EV/revenue,
 *   price/sales) are wrong when they differ, so they are dropped then.
 * - The `earnings` module's financials chart mislabels currencies; unused.
 */

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const opts = { validateResult: false } as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? v * (v < 1e12 ? 1000 : 1) : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const RANGE: Record<ChartRange, { days: number; interval: "5m" | "15m" | "1d" | "1wk" }> = {
  "1D": { days: 1, interval: "5m" },
  "1W": { days: 7, interval: "15m" },
  "1M": { days: 31, interval: "1d" },
  "3M": { days: 92, interval: "1d" },
  "6M": { days: 183, interval: "1d" },
  "1Y": { days: 366, interval: "1d" },
  "5Y": { days: 365 * 5 + 2, interval: "1wk" },
};

function toQuote(symbol: string, p: Any, sd: Any, q?: Any): Quote {
  return {
    symbol,
    name: str(p?.longName) ?? str(p?.shortName) ?? symbol,
    exchange: str(p?.exchangeName) ?? str(q?.fullExchangeName) ?? "",
    currency: str(p?.currency) ?? str(sd?.currency) ?? "",
    price: num(p?.regularMarketPrice),
    change: num(p?.regularMarketChange),
    // price.regularMarketChangePercent is a fraction (0.024 = 2.4%).
    changePct: num(p?.regularMarketChangePercent) != null ? num(p.regularMarketChangePercent)! * 100 : null,
    previousClose: num(p?.regularMarketPreviousClose) ?? num(sd?.previousClose),
    open: num(p?.regularMarketOpen) ?? num(sd?.open),
    dayHigh: num(p?.regularMarketDayHigh) ?? num(sd?.dayHigh),
    dayLow: num(p?.regularMarketDayLow) ?? num(sd?.dayLow),
    volume: num(p?.regularMarketVolume) ?? num(sd?.volume),
    avgVolume: num(sd?.averageVolume),
    marketCap: num(p?.marketCap) ?? num(sd?.marketCap),
    yearHigh: num(sd?.fiftyTwoWeekHigh),
    yearLow: num(sd?.fiftyTwoWeekLow),
    marketState: str(p?.marketState),
    quoteTime: iso(p?.regularMarketTime),
    delayMinutes: num(q?.exchangeDataDelayedBy) ?? num(p?.exchangeDataDelayedBy),
    sourceName: str(q?.quoteSourceName) ?? str(p?.quoteSourceName),
  };
}

async function summaryModules(symbol: string, modules: string[]): Promise<Any> {
  try {
    const r = await yf.quoteSummary(symbol, { modules: modules as never }, opts);
    if (!r || !(r as Any).price) throw new NotFoundError(`Nothing found for ${symbol}.`);
    return r;
  } catch (e) {
    if (e instanceof NotFoundError) throw e;
    const msg = (e as Error).message ?? "";
    if (/not found|No fundamentals|Quote not found|404/i.test(msg)) throw new NotFoundError(`Nothing found for ${symbol}.`);
    throw e;
  }
}

/** One statement period from a fundamentalsTimeSeries row. */
export function period(r: Any): Period {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (num(r?.[k]) != null) return num(r[k]);
    return null;
  };
  const ocf = pick("operatingCashFlow", "cashFlowFromContinuingOperatingActivities");
  const capex = pick("capitalExpenditure");
  return {
    date: iso(r?.date)?.slice(0, 10) ?? "",
    revenue: pick("totalRevenue", "operatingRevenue"),
    operatingIncome: pick("operatingIncome"),
    netIncome: pick("netIncome", "netIncomeCommonStockholders"),
    eps: pick("dilutedEPS", "basicEPS"),
    totalAssets: pick("totalAssets"),
    totalLiabilities: pick("totalLiabilitiesNetMinorityInterest"),
    equity: pick("stockholdersEquity", "commonStockEquity"),
    totalDebt: pick("totalDebt"),
    cash: pick("cashAndCashEquivalents", "cashCashEquivalentsAndShortTermInvestments"),
    operatingCashFlow: ocf,
    capex,
    freeCashFlow: pick("freeCashFlow") ?? (ocf != null && capex != null ? ocf + capex : null),
  };
}

/** The summary from raw quoteSummary modules. Pure, so the currency rules
 * are unit-tested. */
export function buildSummary(symbol: string, r: Any, quoteRaw: Any): Summary {
  const p = r.price, sd = r.summaryDetail ?? {}, fd = r.financialData ?? {}, ks = r.defaultKeyStatistics ?? {}, ap = r.assetProfile ?? null;
  const quote = toQuote(symbol, p, sd, quoteRaw);
  const tc = quote.currency;
  const rc = str(fd.financialCurrency);
  const mixed = !!rc && !!tc && rc !== tc;
  const notes: string[] = [];
  if (mixed) notes.push(`${quote.name} trades in ${tc} but reports its accounts in ${rc}. Statement figures are in ${rc}; ratios that would mix the two (EV/EBITDA, EV/revenue, price/sales) aren't shown.`);
  const groups: StatGroup[] = [
    {
      title: "Valuation",
      items: [
        { label: "Market cap", value: quote.marketCap, kind: "money", currency: tc },
        { label: "Enterprise value", value: num(ks.enterpriseValue), kind: "money", currency: tc },
        { label: "P/E (trailing)", value: num(sd.trailingPE), kind: "ratio" },
        { label: "P/E (forward)", value: num(sd.forwardPE) ?? num(ks.forwardPE), kind: "ratio" },
        { label: "P/B", value: num(ks.priceToBook), kind: "ratio" },
        ...(mixed ? [] : [
          { label: "EV/EBITDA", value: num(ks.enterpriseToEbitda), kind: "ratio" as const },
          { label: "Price/sales", value: num(sd.priceToSalesTrailing12Months), kind: "ratio" as const },
        ]),
        { label: "EPS (trailing)", value: num(ks.trailingEps), kind: "money", currency: tc },
      ],
    },
    {
      title: "Profitability",
      items: [
        { label: "Gross margin", value: num(fd.grossMargins), kind: "pct" },
        { label: "Operating margin", value: num(fd.operatingMargins), kind: "pct" },
        { label: "Profit margin", value: num(fd.profitMargins) ?? num(ks.profitMargins), kind: "pct" },
        { label: "Return on equity", value: num(fd.returnOnEquity), kind: "pct" },
        { label: "Return on assets", value: num(fd.returnOnAssets), kind: "pct" },
      ],
    },
    {
      title: "Financial health",
      items: [
        { label: "Total cash", value: num(fd.totalCash), kind: "money", currency: rc ?? undefined },
        { label: "Total debt", value: num(fd.totalDebt), kind: "money", currency: rc ?? undefined },
        // Yahoo gives debt/equity as a percentage (102 = 1.02×).
        { label: "Debt / equity", value: num(fd.debtToEquity) != null ? num(fd.debtToEquity)! / 100 : null, kind: "ratio" },
        { label: "Current ratio", value: num(fd.currentRatio), kind: "ratio" },
        { label: "Quick ratio", value: num(fd.quickRatio), kind: "ratio" },
      ],
    },
    {
      title: "Growth (latest quarter, year on year)",
      items: [
        { label: "Revenue growth", value: num(fd.revenueGrowth), kind: "pct" },
        { label: "Earnings growth", value: num(fd.earningsGrowth), kind: "pct" },
      ],
    },
    {
      title: "Cash flow (trailing 12 months)",
      items: [
        { label: "Operating cash flow", value: num(fd.operatingCashflow), kind: "money", currency: rc ?? undefined },
        { label: "Free cash flow", value: num(fd.freeCashflow), kind: "money", currency: rc ?? undefined },
      ],
    },
    {
      title: "Dividends",
      items: [
        { label: "Dividend yield", value: num(sd.dividendYield), kind: "pct" },
        { label: "Dividend per share (annual)", value: num(sd.dividendRate), kind: "money", currency: tc },
        { label: "Payout ratio", value: num(sd.payoutRatio), kind: "pct" },
        { label: "Ex-dividend date", value: iso(sd.exDividendDate)?.slice(0, 10) ?? null, kind: "date" },
      ],
    },
    {
      title: "Trading",
      items: [
        { label: "52-week high", value: quote.yearHigh, kind: "money", currency: tc },
        { label: "52-week low", value: quote.yearLow, kind: "money", currency: tc },
        { label: "Average volume", value: quote.avgVolume, kind: "number" },
        { label: "Beta", value: num(sd.beta) ?? num(ks.beta), kind: "ratio" },
        { label: "Shares outstanding", value: num(ks.sharesOutstanding), kind: "number" },
      ],
    },
  ];
  return {
    quote,
    profile: ap ? { sector: str(ap.sector), industry: str(ap.industry), website: str(ap.website), employees: num(ap.fullTimeEmployees), country: str(ap.country), summary: str(ap.longBusinessSummary) } : null,
    groups,
    reportingCurrency: rc,
    notes,
  } satisfies Summary;
}

export const yahooProvider: ResearchProvider = {
  name: "Yahoo Finance",

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const r = await yf.search(q, { quotesCount: 10, newsCount: 0 }, opts);
    const hits = ((r as Any).quotes ?? []).filter((x: Any) => x.isYahooFinance && x.symbol && ["EQUITY", "ETF", "MUTUALFUND", "INDEX"].includes(x.quoteType));
    const symbols: string[] = hits.map((x: Any) => x.symbol);
    const quotes: Any[] = symbols.length ? ((await yf.quote(symbols, {}, opts).catch(() => [])) as Any[]) : [];
    const bySymbol = new Map(quotes.map((x) => [x.symbol, x]));
    return hits.map((x: Any): SearchHit => {
      const qq = bySymbol.get(x.symbol);
      return {
        symbol: x.symbol,
        name: str(x.longname) ?? str(x.shortname) ?? x.symbol,
        exchange: str(x.exchDisp) ?? str(x.exchange) ?? "",
        type: str(x.typeDisp) ?? str(x.quoteType) ?? "",
        price: num(qq?.regularMarketPrice),
        changePct: num(qq?.regularMarketChangePercent),
        currency: str(qq?.currency),
      };
    });
  },

  async summary(symbol) {
    const r = await summaryModules(symbol, ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"]);
    const quoteRaw = (await yf.quote(symbol, {}, opts).catch(() => null)) as Any;
    return buildSummary(symbol, r, quoteRaw);
  },

  async chart(symbol, range) {
    const cfg = RANGE[range];
    // A little extra so a weekend or holiday still leaves points in range.
    const pad = cfg.interval === "5m" ? 4 : cfg.interval === "15m" ? 3 : 0;
    const r = (await yf.chart(symbol, { period1: new Date(Date.now() - (cfg.days + pad) * 86_400_000), interval: cfg.interval }, opts)) as Any;
    let points = ((r?.quotes ?? []) as Any[])
      .filter((x) => num(x.close) != null)
      .map((x) => ({ t: iso(x.date)!, close: num(x.close)!, volume: num(x.volume) }));
    if (range === "1D" && points.length) {
      // Only the latest trading session, by the exchange's own calendar day.
      const tz = r?.meta?.exchangeTimezoneName as string | undefined;
      const dayOf = (t: string) => (tz ? new Date(t).toLocaleDateString("en-CA", { timeZone: tz }) : t.slice(0, 10));
      const last = dayOf(points.at(-1)!.t);
      points = points.filter((x) => dayOf(x.t) === last);
    }
    if (!points.length) throw new NotFoundError(`No price history for ${symbol}.`);
    return { range, interval: cfg.interval, currency: str(r?.meta?.currency) ?? "", timezone: str(r?.meta?.exchangeTimezoneName), points } satisfies Chart;
  },

  async financials(symbol) {
    const [fd, annual, quarterly] = await Promise.all([
      yf.quoteSummary(symbol, { modules: ["financialData"] }, opts).catch(() => null) as Promise<Any>,
      yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 6 * 365 * 86_400_000), type: "annual", module: "all" }, opts).catch(() => []) as Promise<Any[]>,
      yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 3 * 365 * 86_400_000), type: "quarterly", module: "all" }, opts).catch(() => []) as Promise<Any[]>,
    ]);
    const clean = (rows: Any[]) => rows.map(period).filter((x) => x.date && (x.revenue != null || x.netIncome != null || x.totalAssets != null)).sort((a, b) => a.date.localeCompare(b.date));
    return { currency: str(fd?.financialData?.financialCurrency), annual: clean(annual), quarterly: clean(quarterly) } satisfies Financials;
  },

  async earnings(symbol) {
    const r = (await yf.quoteSummary(symbol, { modules: ["earningsHistory", "earningsTrend", "calendarEvents"] }, opts).catch(() => null)) as Any;
    const ce = r?.calendarEvents?.earnings;
    const trend: Any[] = r?.earningsTrend?.trend ?? [];
    return {
      history: ((r?.earningsHistory?.history ?? []) as Any[])
        .map((h) => ({ quarter: iso(h.quarter)?.slice(0, 10) ?? "", epsActual: num(h.epsActual), epsEstimate: num(h.epsEstimate), surprisePct: num(h.surprisePercent) != null ? num(h.surprisePercent)! * 100 : null, currency: str(h.currency) }))
        .filter((h) => h.quarter)
        .sort((a, b) => a.quarter.localeCompare(b.quarter)),
      next: ce
        ? {
            date: iso(ce.earningsDate?.[0]),
            isEstimate: ce.isEarningsDateEstimate === true,
            epsAvg: num(ce.earningsAverage), epsLow: num(ce.earningsLow), epsHigh: num(ce.earningsHigh),
            revenueAvg: num(ce.revenueAverage),
            currency: str(trend[0]?.earningsEstimate?.earningsCurrency) ?? str(trend[0]?.revenueEstimate?.revenueCurrency),
          }
        : null,
      estimates: trend
        .filter((t) => ["0q", "+1q", "0y", "+1y"].includes(t.period))
        .map((t) => ({
          period: t.period === "0q" ? "This quarter" : t.period === "+1q" ? "Next quarter" : t.period === "0y" ? "This year" : "Next year",
          endDate: iso(t.endDate)?.slice(0, 10) ?? null,
          epsAvg: num(t.earningsEstimate?.avg),
          revenueAvg: num(t.revenueEstimate?.avg),
          growth: num(t.growth) != null ? num(t.growth)! * 100 : null,
          analysts: num(t.earningsEstimate?.numberOfAnalysts),
          currency: str(t.earningsEstimate?.earningsCurrency) ?? str(t.revenueEstimate?.revenueCurrency),
        })),
    } satisfies Earnings;
  },

  async ownership(symbol) {
    const r = (await yf.quoteSummary(symbol, { modules: ["majorHoldersBreakdown", "institutionOwnership", "fundOwnership", "insiderTransactions", "netSharePurchaseActivity"] }, opts).catch(() => null)) as Any;
    const holders = (list: Any[] | undefined) =>
      (list ?? []).slice(0, 10).map((h) => ({ name: str(h.organization) ?? "—", pctHeld: num(h.pctHeld) != null ? num(h.pctHeld)! * 100 : null, shares: num(h.position), reportDate: iso(h.reportDate)?.slice(0, 10) ?? null }));
    const mh = r?.majorHoldersBreakdown;
    return {
      insidersPct: num(mh?.insidersPercentHeld) != null ? num(mh.insidersPercentHeld)! * 100 : null,
      institutionsPct: num(mh?.institutionsPercentHeld) != null ? num(mh.institutionsPercentHeld)! * 100 : null,
      institutionsFloatPct: num(mh?.institutionsFloatPercentHeld) != null ? num(mh.institutionsFloatPercentHeld)! * 100 : null,
      institutionsCount: num(mh?.institutionsCount),
      institutions: holders(r?.institutionOwnership?.ownershipList),
      funds: holders(r?.fundOwnership?.ownershipList),
      // Values are left out on purpose: for companies listed in two places
      // they can be in a different currency from the price.
      insiderTrades: ((r?.insiderTransactions?.transactions ?? []) as Any[]).slice(0, 15).map((t) => ({ name: str(t.filerName) ?? "—", relation: str(t.filerRelation), text: str(t.transactionText), shares: num(t.shares), date: iso(t.startDate)?.slice(0, 10) ?? null })),
      netInsiderShares6m: num(r?.netSharePurchaseActivity?.netInfoShares),
    } satisfies Ownership;
  },

  async analysts(symbol) {
    const r = (await yf.quoteSummary(symbol, { modules: ["recommendationTrend", "financialData", "price"] }, opts).catch(() => null)) as Any;
    const changes = (await yf.quoteSummary(symbol, { modules: ["upgradeDowngradeHistory"] }, opts).catch(() => null)) as Any;
    const t = (r?.recommendationTrend?.trend ?? []).find((x: Any) => x.period === "0m");
    const fd = r?.financialData;
    return {
      recommendation: t ? { period: "This month", strongBuy: t.strongBuy ?? 0, buy: t.buy ?? 0, hold: t.hold ?? 0, sell: t.sell ?? 0, strongSell: t.strongSell ?? 0 } : null,
      consensus: str(fd?.recommendationKey),
      targets: fd && num(fd.targetMeanPrice) != null ? { mean: num(fd.targetMeanPrice), median: num(fd.targetMedianPrice), high: num(fd.targetHighPrice), low: num(fd.targetLowPrice), analysts: num(fd.numberOfAnalystOpinions), currency: str(r?.price?.currency) ?? "" } : null,
      changes: ((changes?.upgradeDowngradeHistory?.history ?? []) as Any[]).slice(0, 12).map((h) => ({ date: iso(h.epochGradeDate)?.slice(0, 10) ?? "", firm: str(h.firm) ?? "—", from: str(h.fromGrade), to: str(h.toGrade), action: str(h.action) })),
    } satisfies Analysts;
  },

  async news(symbol) {
    let r = (await yf.search(symbol, { quotesCount: 0, newsCount: 8 }, opts)) as Any;
    // Exchange-suffixed symbols (INFY.NS) often have no news of their own;
    // the company's base ticker usually does.
    if (!r?.news?.length && symbol.includes(".")) r = (await yf.search(symbol.split(".")[0], { quotesCount: 0, newsCount: 8 }, opts)) as Any;
    return ((r?.news ?? []) as Any[])
      .filter((n) => str(n.title) && str(n.link) && /^https?:\/\//.test(n.link))
      .map((n): NewsItem => ({ title: n.title, publisher: str(n.publisher), link: n.link, time: iso(n.providerPublishTime) }));
  },
};
