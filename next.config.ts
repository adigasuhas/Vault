import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy.
 *
 * `script-src` still allows `'unsafe-inline'` because the App Router injects
 * inline hydration/bootstrap scripts and this build has no nonce plumbing yet
 * (nonce-based CSP needs `proxy.ts` — tracked for Phase 2). Everything else is
 * locked to same-origin; the only third party is DiceBear avatar images.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://api.dicebear.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The PDF report route reads TTF font files off disk at render time
  // (@react-pdf/renderer + fontkit). Force them into the serverless trace.
  outputFileTracingIncludes: {
    "/api/reports/*": ["./src/lib/pdf/fonts/**"],
  },
  // Retired sections keep working links.
  async redirects() {
    return [
      { source: "/runway", destination: "/analytics#runway", permanent: false },
      { source: "/planner", destination: "/budget", permanent: false },
      { source: "/loans", destination: "/payments", permanent: false },
      { source: "/transfers", destination: "/accounts?tab=transfers", permanent: false },
      { source: "/reports", destination: "/analytics?tab=reports", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
