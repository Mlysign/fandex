import type { NextConfig } from "next";

// S6 — the resource-restricting CSP. Validated in Report-Only against the live
// app (no violations across landing/discover/detail-with-trailer/library/insights),
// now ENFORCED in production. `report-uri` is kept so any resource a future change
// adds that this policy blocks is logged (via /api/csp-report) rather than
// silently breaking. Dev keeps only frame-ancestors (see headers()) — the full
// policy would block Next's HMR websocket + eval.
const CSP_RESOURCE_POLICY = [
  "default-src 'self'",
  // Next injects inline bootstrap/hydration scripts (no nonce by default).
  "script-src 'self' 'unsafe-inline'",
  // Tailwind's sheet is same-origin; next/font + inline style="" attributes need inline.
  "style-src 'self' 'unsafe-inline'",
  // Optimized posters come from /_next/image (self); the detail-page hero <img>
  // loads raw from the poster CDNs. data:/blob: cover inline/placeholder data.
  "img-src 'self' data: blob: https://image.tmdb.org https://media.rawg.io https://images.igdb.com https://cdn.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://*.steamstatic.com",
  "font-src 'self'",
  // The client only calls its own /api (same origin).
  "connect-src 'self'",
  // The only third-party embed is the YouTube trailer iframe.
  "frame-src https://www.youtube.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Violations POST here → logged server-side (see /api/csp-report) so the
  // rollout can be validated from the Railway logs, not just the browser console.
  "report-uri /api/csp-report",
].join("; ");

const nextConfig: NextConfig = {
  // Self-host build: emit `.next/standalone` (a minimal server.js + only the
  // traced node_modules) so the Docker runtime image stays small and needs no
  // `npm install`. See Dockerfile. server.js honors PORT/HOSTNAME (Railway sets PORT).
  output: "standalone",
  // better-sqlite3 loads a compiled native addon (.node) that @vercel/nft's static
  // trace can miss → force it into the standalone bundle so the server can open the DB.
  outputFileTracingIncludes: {
    "/**": ["node_modules/better-sqlite3/build/Release/*.node"],
  },
  turbopack: { root: __dirname },
  images: {
    // Must cover every host sanitizePosterUrl() (S12) admits — an un-listed host
    // makes next/image throw at render, not just fail to load. Kept in sync with
    // that allowlist: tmdb / rawg / igdb / steamstatic (+ the two steam CDNs).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "media.rawg.io" },
      { protocol: "https", hostname: "images.igdb.com" },
      { protocol: "https", hostname: "*.steamstatic.com" },
    ],
    // Cost controls (2026-07-20, post-P13b crawler wave): poster CDN URLs are
    // per-item and effectively immutable, so cache optimized variants for 31
    // days (default is 4h) — this drives both the on-disk optimizer cache and
    // the served Cache-Control, so browsers/crawlers stop re-fetching.
    minimumCacheTTL: 2678400,
    // Pin webp only — AVIF costs ~50% more encode CPU per variant and would
    // double the variant cache for marginal size wins on small posters.
    formats: ["image/webp"],
    // Pin the default quality allowlist explicitly.
    qualities: [75],
    // The app never renders a poster larger than ~45vw × 768px @2x ≈ 700w (see
    // the `sizes` attrs in PosterCard/CalendarView/etc.), so drop the
    // 1200–3840w device buckets — each was a variant sharp could be made to
    // render (and cache, and serve) per poster. Revisit if a full-viewport
    // <Image> is ever added.
    deviceSizes: [640, 750, 828, 1080],
  },
  // S6: security headers. nosniff, clickjacking (X-Frame-Options +
  // frame-ancestors), referrer leakage, HSTS, and powerful-feature gating.
  // Permissions-Policy restricts only features the app never uses — autoplay/
  // encrypted-media stay permitted so the YouTube trailer embed keeps working.
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
      // Enforce the full resource-restricting CSP in production (validated in
      // Report-Only). Dev keeps only frame-ancestors — the full policy would block
      // Next's HMR websocket + eval.
      { key: "Content-Security-Policy", value: isProd ? CSP_RESOURCE_POLICY : "frame-ancestors 'none'" },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
