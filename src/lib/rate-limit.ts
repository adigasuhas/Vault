import { db } from "@/lib/db";

/**
 * Fixed-window rate limiter.
 *
 * Counters live in Postgres (RateLimitBucket), so every server instance —
 * each serverless function on Vercel, every container behind a load
 * balancer — shares them, and they survive redeploys. One atomic upsert per
 * check: a window that has ended starts again at 1. If the database can't be
 * reached, an in-memory counter for this instance stands in rather than
 * locking everyone out.
 */

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function result(count: number, resetAt: number, limit: number, now: number): RateLimitResult {
  if (count > limit) return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
  return { ok: true, remaining: limit - count, retryAfterSeconds: 0 };
}

function memoryLimit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return result(1, now + windowMs, limit, now);
  }
  bucket.count += 1;
  return result(bucket.count, bucket.resetAt, limit, now);
}

/**
 * @param key      identifier for the caller (e.g. `login:ip:<ip>` or `login:email:<email>`)
 * @param limit    max requests allowed per window
 * @param windowMs window length in milliseconds
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    // Times come from the app, not the database's NOW(): the column holds UTC
    // without a zone, and NOW() follows the session's time zone.
    const at = new Date(now);
    const fresh = new Date(now + windowMs);
    const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES (${key}, 1, ${fresh})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${at} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${at} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    // Now and then, clear windows that ended long ago.
    if (now - lastSweep > 10 * 60_000) {
      lastSweep = now;
      db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(now - 24 * 60 * 60_000) } } }).catch(() => {});
    }
    const row = rows[0];
    return result(Number(row.count), new Date(row.resetAt).getTime(), limit, now);
  } catch (e) {
    console.error("rate limit: database unavailable, using this instance's counter", e);
    return memoryLimit(key, limit, windowMs, now);
  }
}

/** Clears a caller's counter after a successful action (so a legit login doesn't burn the budget). */
export async function rateLimitReset(key: string) {
  memory.delete(key);
  await db.rateLimitBucket.deleteMany({ where: { key } }).catch(() => {});
}

/**
 * Client IP for rate limiting, read only from a source that can't be forged.
 *
 * Request headers like `X-Forwarded-For` are set by whoever sends the request,
 * so they are trusted only as far as `TRUST_PROXY` says a proxy in front of
 * the app controls them:
 *
 *   vercel      Vercel's edge overwrites X-Forwarded-For (auto when VERCEL=1)
 *   netlify     x-nf-client-connection-ip (auto when NETLIFY=true)
 *   cloudflare  cf-connecting-ip (only if the origin is reachable solely via Cloudflare)
 *   <n>         n reverse proxies (nginx, Caddy, a load balancer) each append
 *               to X-Forwarded-For; the client is the n-th entry from the right
 *   none        no trusted proxy (the default elsewhere)
 *
 * Without a trusted source every caller shares one "unknown" bucket. That is
 * strict (a burst from anyone throttles everyone) but can't be bypassed; the
 * per-account limits still apply on top.
 */
export function clientIp(req: Request): string {
  const mode = trustProxyMode();
  const h = req.headers;
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;

  let ip: string | null = null;
  if (mode === "vercel") ip = first(h.get("x-vercel-forwarded-for")) ?? first(h.get("x-forwarded-for")) ?? first(h.get("x-real-ip"));
  else if (mode === "netlify") ip = first(h.get("x-nf-client-connection-ip"));
  else if (mode === "cloudflare") ip = first(h.get("cf-connecting-ip"));
  else if (typeof mode === "number") {
    const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    ip = hops.length >= mode ? hops[hops.length - mode] : null;
  }

  if (ip && isPlausibleIp(ip)) return ip;
  warnUntrusted(mode);
  return "unknown";
}

type TrustMode = "vercel" | "netlify" | "cloudflare" | "none" | number;

function trustProxyMode(): TrustMode {
  const raw = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (raw === "vercel" || raw === "netlify" || raw === "cloudflare" || raw === "none") return raw;
  if (/^[1-9]$/.test(raw)) return Number(raw);
  if (raw === "true") return 1;
  if (process.env.VERCEL === "1") return "vercel";
  if (process.env.NETLIFY === "true") return "netlify";
  return "none";
}

function isPlausibleIp(s: string): boolean {
  return s.length <= 45 && /^[0-9a-fA-F:.]+$/.test(s);
}

let warned = false;
function warnUntrusted(mode: TrustMode) {
  if (warned || process.env.NODE_ENV !== "production") return;
  warned = true;
  console.warn(
    mode === "none"
      ? "[rate-limit] TRUST_PROXY is not set, so all clients share one rate-limit bucket. Set it for your host (see .env.example)."
      : `[rate-limit] TRUST_PROXY=${mode} but the expected client-IP header was missing; falling back to a shared bucket.`
  );
}
