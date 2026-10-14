/**
 * Stock research data, independent of where it comes from (see
 * lib/research/yahoo.ts for the current provider). Every amount says its
 * currency: a company can trade in one currency and report its accounts in
 * another (Infosys trades in INR, reports in USD). A value the provider
 * doesn't give is null, never a guess.
 */

export type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";
export const CHART_RANGES: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  price: number | null;
  changePct: number | null;
  currency: string | null;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** REGULAR (open), PRE, POST, CLOSED… as the exchange reports it. */
  marketState: string | null;
  /** When the price was set at the exchange. */
  quoteTime: string | null;
  /** Minutes the exchange delays this feed by (0 = real time), if known. */
  delayMinutes: number | null;
  sourceName: string | null;
}

export type StatKind = "money" | "pct" | "ratio" | "number" | "date" | "text";
export interface Stat {
  label: string;
  value: number | string | null;
  kind: StatKind;
  currency?: string;
  hint?: string;
}
export interface StatGroup {
  title: string;
  items: Stat[];
}

export interface Summary {
  quote: Quote;
  profile: { sector: string | null; industry: string | null; website: string | null; employees: number | null; country: string | null; summary: string | null } | null;
  groups: StatGroup[];
  /** The currency the company's accounts are in, when the provider says. */
  reportingCurrency: string | null;
  notes: string[];
}

export interface ChartPoint {
  t: string;
  close: number;
  volume: number | null;
}
export interface Chart {
  range: ChartRange;
  interval: string;
  currency: string;
  timezone: string | null;
  points: ChartPoint[];
}

export interface Period {
  date: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  totalDebt: number | null;
  cash: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
}
export interface Financials {
  currency: string | null;
  annual: Period[];
  quarterly: Period[];
}

export interface Earnings {
  history: { quarter: string; epsActual: number | null; epsEstimate: number | null; surprisePct: number | null; currency: string | null }[];
  next: { date: string | null; isEstimate: boolean; epsAvg: number | null; epsLow: number | null; epsHigh: number | null; revenueAvg: number | null; currency: string | null } | null;
  estimates: { period: string; endDate: string | null; epsAvg: number | null; revenueAvg: number | null; growth: number | null; analysts: number | null; currency: string | null }[];
}

export interface Ownership {
  insidersPct: number | null;
  institutionsPct: number | null;
  institutionsFloatPct: number | null;
  institutionsCount: number | null;
  institutions: { name: string; pctHeld: number | null; shares: number | null; reportDate: string | null }[];
  funds: { name: string; pctHeld: number | null; shares: number | null; reportDate: string | null }[];
  insiderTrades: { name: string; relation: string | null; text: string | null; shares: number | null; date: string | null }[];
  netInsiderShares6m: number | null;
}

export interface Analysts {
  recommendation: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  consensus: string | null;
  targets: { mean: number | null; median: number | null; high: number | null; low: number | null; analysts: number | null; currency: string } | null;
  changes: { date: string; firm: string; from: string | null; to: string | null; action: string | null }[];
}

export interface NewsItem {
  title: string;
  publisher: string | null;
  link: string;
  time: string | null;
}

/** What any research data source has to provide. */
export interface ResearchProvider {
  name: string;
  search(query: string): Promise<SearchHit[]>;
  summary(symbol: string): Promise<Summary>;
  chart(symbol: string, range: ChartRange): Promise<Chart>;
  financials(symbol: string): Promise<Financials>;
  earnings(symbol: string): Promise<Earnings>;
  ownership(symbol: string): Promise<Ownership>;
  analysts(symbol: string): Promise<Analysts>;
  news(symbol: string): Promise<NewsItem[]>;
}

/** The symbol doesn't exist or the provider has nothing for it. */
export class NotFoundError extends Error {}
