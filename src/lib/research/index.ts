import { db } from "@/lib/db";
import { yahooProvider } from "@/lib/research/yahoo";
import { NotFoundError, type ChartRange, type ResearchProvider } from "@/lib/research/types";

/**
 * Stock research for the app, through one provider (swap `provider` to change
 * source). Responses are cached in ResearchCache so pages don't call the
 * provider on every view; when the provider fails, the last good copy is
 * served and marked stale. Read-only: nothing here touches user data.
 */

const provider: ResearchProvider = yahooProvider;
export const PROVIDER_NAME = provider.name;

const MIN = 60_000;
/** How long each kind of data is reused. Quotes move; accounts don't. */
const TTL = {
  search: 2 * MIN,
  summary: 5 * MIN,
  "chart:1D": 5 * MIN,
  "chart:1W": 15 * MIN,
  chart: 60 * MIN,
  financials: 24 * 60 * MIN,
  earnings: 6 * 60 * MIN,
  ownership: 24 * 60 * MIN,
  analysts: 6 * 60 * MIN,
  news: 30 * MIN,
} as const;
/** A "nothing found" is remembered briefly, so a bad symbol isn't retried on every keystroke. */
const NOT_FOUND_TTL = 10 * MIN;

export interface Fetched<T> {
  data: T;
  fetchedAt: string;
  /** Served from cache because the provider failed. */
  stale: boolean;
  source: string;
}

export class ResearchUnavailableError extends Error {}

const SYMBOL = /^[A-Za-z0-9.^=\-&]{1,20}$/;
export function cleanSymbol(s: string) {
  const v = decodeURIComponent(s).trim().toUpperCase();
  if (!SYMBOL.test(v)) throw new NotFoundError("That isn't a valid ticker symbol.");
  return v;
}

export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Fetched<T>> {
  const hit = await db.researchCache.findUnique({ where: { key } });
  const age = hit ? Date.now() - hit.fetchedAt.getTime() : Infinity;
  const notFound = hit && (hit.data as { __notFound?: string }).__notFound;
  if (hit && age < (notFound ? NOT_FOUND_TTL : ttl)) {
    if (notFound) throw new NotFoundError(notFound);
    return { data: hit.data as T, fetchedAt: hit.fetchedAt.toISOString(), stale: false, source: PROVIDER_NAME };
  }
  try {
    const data = await load();
    const row = await db.researchCache.upsert({ where: { key }, update: { data: data as object, fetchedAt: new Date() }, create: { key, data: data as object } });
    return { data, fetchedAt: row.fetchedAt.toISOString(), stale: false, source: PROVIDER_NAME };
  } catch (e) {
    if (e instanceof NotFoundError) {
      await db.researchCache.upsert({ where: { key }, update: { data: { __notFound: e.message }, fetchedAt: new Date() }, create: { key, data: { __notFound: e.message } } });
      throw e;
    }
    console.error(`research: ${key} failed`, (e as Error).message);
    // The provider is down or limiting us: the last good copy is better than nothing.
    if (hit && !notFound) return { data: hit.data as T, fetchedAt: hit.fetchedAt.toISOString(), stale: true, source: PROVIDER_NAME };
    throw new ResearchUnavailableError(`${PROVIDER_NAME} isn't responding right now. Try again in a minute.`);
  }
}

export const research = {
  search: (q: string) => cached(`search:${q.trim().toLowerCase()}`, TTL.search, () => provider.search(q)),
  summary: (s: string) => cached(`summary:${s}`, TTL.summary, () => provider.summary(s)),
  chart: (s: string, r: ChartRange) => cached(`chart:${s}:${r}`, r === "1D" ? TTL["chart:1D"] : r === "1W" ? TTL["chart:1W"] : TTL.chart, () => provider.chart(s, r)),
  financials: (s: string) => cached(`financials:${s}`, TTL.financials, () => provider.financials(s)),
  earnings: (s: string) => cached(`earnings:${s}`, TTL.earnings, () => provider.earnings(s)),
  ownership: (s: string) => cached(`ownership:${s}`, TTL.ownership, () => provider.ownership(s)),
  analysts: (s: string) => cached(`analysts:${s}`, TTL.analysts, () => provider.analysts(s)),
  news: (s: string) => cached(`news:${s}`, TTL.news, () => provider.news(s)),
};
