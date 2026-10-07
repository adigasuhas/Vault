/**
 * Minimal fixed-window rate limiter.
 *
 * In-memory only: it protects a single instance and resets on redeploy. That is
 * enough to blunt credential-stuffing against one Vercel function, but a
 * multi-instance deployment needs a shared store (Upstash Redis / Vercel KV) —
 * tracked for the Phase 2 auth hardening.
 */

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key      identifier for the caller (e.g. `login:<ip>` or `login:<email>`)
 * @param limit    max requests allowed per window
 * @param windowMs window length in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** Clears a caller's counter after a successful action (so a legit login doesn't burn the budget). */
export function rateLimitReset(key: string) {
  store.delete(key);
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
