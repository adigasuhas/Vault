import YahooFinance from "yahoo-finance2";

// yahoo-finance2 v3 requires an instantiated client rather than a default
// singleton — `new YahooFinance()` — see the package's UPGRADING guide.
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface StockQuote {
  price: number;
  previousClose: number | null;
}

/** Fetches a live stock quote (current price + prior trading day's close,
 * the latter powering "today's gain/loss"). Returns null (rather than
 * throwing) on holidays, delistings, or transient provider failures so a
 * bad ticker never aborts a run. */
export async function fetchStockQuote(ticker: string): Promise<StockQuote | null> {
  try {
    const quote = (await yahooFinance.quote(ticker)) as {
      regularMarketPrice?: number;
      regularMarketPreviousClose?: number;
    } | null;
    const price = quote?.regularMarketPrice;
    if (typeof price !== "number") return null;
    const previousClose = typeof quote?.regularMarketPreviousClose === "number" ? quote.regularMarketPreviousClose : null;
    return { price, previousClose };
  } catch {
    return null;
  }
}

/** Back-compat convenience wrapper for callers that only need the price. */
export async function fetchStockPrice(ticker: string): Promise<number | null> {
  const quote = await fetchStockQuote(ticker);
  return quote?.price ?? null;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

/** Yahoo Finance's internal short exchange codes (the `exchange` field on a
 * search result, distinct from the human-readable `exchDisp`) for the
 * exchanges offered in the "Search In" filter. */
export const STOCK_EXCHANGES = [
  { code: "NSI", label: "NSE (India)" },
  { code: "BSE", label: "BSE (India)" },
  { code: "NMS", label: "NASDAQ (US)" },
  { code: "NYQ", label: "NYSE (US)" },
  { code: "LSE", label: "LSE (UK)" },
  { code: "HKG", label: "Hong Kong" },
  { code: "JPX", label: "Tokyo" },
  { code: "TOR", label: "Toronto" },
] as const;

export type StockExchangeCode = (typeof STOCK_EXCHANGES)[number]["code"];

/** Looks up tickers by company name or partial symbol — lets a user find the
 * exact Yahoo Finance symbol (e.g. "RELIANCE.NS") without knowing it upfront.
 * Returns the top 5 closest equity/ETF matches, ranked by Yahoo's own
 * relevance score. When `exchange` is given, only matches on that exchange
 * are considered — without it, results skew toward large US listings and
 * bury the ones on smaller exchanges (e.g. NSE) further down. Returns []
 * (rather than throwing) on empty queries or transient provider failures. */
export async function searchStocks(query: string, exchange?: string): Promise<StockSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    // Cast a wider net when filtering to one exchange, since Yahoo's overall
    // top matches are dominated by US listings that would otherwise get
    // filtered out before the desired exchange's results surface.
    const result = await yahooFinance.search(trimmed, { quotesCount: exchange ? 25 : 10, newsCount: 0 });
    return result.quotes
      .filter(
        (q): q is typeof q & { symbol: string; isYahooFinance: true } =>
          "isYahooFinance" in q &&
          q.isYahooFinance === true &&
          "symbol" in q &&
          typeof q.symbol === "string" &&
          (q.quoteType === "EQUITY" || q.quoteType === "ETF") &&
          (!exchange || ("exchange" in q && q.exchange === exchange))
      )
      .slice(0, 5)
      .map((q) => ({
        symbol: q.symbol,
        name: ("longname" in q && q.longname) || ("shortname" in q && q.shortname) || q.symbol,
        exchange: ("exchDisp" in q && q.exchDisp) || ("exchange" in q && q.exchange) || "",
      }));
  } catch {
    return [];
  }
}

let amfiNavCache: { fetchedAt: number; bySchemeCode: Map<string, number> } | null = null;
const AMFI_CACHE_TTL_MS = 60 * 60 * 1000; // re-parse at most once per hour across calls in the same run

/** AMFI publishes a single flat-file with every Indian mutual fund's daily NAV — free, no API key. */
async function getAmfiNavMap(): Promise<Map<string, number>> {
  if (amfiNavCache && Date.now() - amfiNavCache.fetchedAt < AMFI_CACHE_TTL_MS) {
    return amfiNavCache.bySchemeCode;
  }

  const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt");
  if (!res.ok) throw new Error(`AMFI feed returned ${res.status}`);
  const text = await res.text();

  const bySchemeCode = new Map<string, number>();
  for (const line of text.split("\n")) {
    const fields = line.split(";");
    // Format: Scheme Code;ISIN Div Payout;ISIN Growth;Scheme Name;Net Asset Value;Date
    if (fields.length < 6) continue;
    const [schemeCode, , , , nav] = fields;
    const parsedNav = Number(nav);
    if (schemeCode && !Number.isNaN(parsedNav)) {
      bySchemeCode.set(schemeCode.trim(), parsedNav);
    }
  }

  amfiNavCache = { fetchedAt: Date.now(), bySchemeCode };
  return bySchemeCode;
}

export async function fetchMutualFundNav(schemeCode: string): Promise<number | null> {
  try {
    const map = await getAmfiNavMap();
    return map.get(schemeCode) ?? null;
  } catch {
    return null;
  }
}
