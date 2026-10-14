import { NextResponse } from "next/server";
import { authed } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { research, ResearchUnavailableError } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** GET /api/research/search?q=infosys: listed companies matching a name or
 * ticker, with their latest price where the provider has one. */
export const GET = authed(async (req, { userId }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return { hits: [] };
  const limit = await rateLimit(`research:${userId}`, 120, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many searches at once. Wait a moment." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  try {
    const r = await research.search(q);
    return { hits: r.data, fetchedAt: r.fetchedAt, stale: r.stale, source: r.source };
  } catch (e) {
    if (e instanceof ResearchUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
});
