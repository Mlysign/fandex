import type { NextConfig } from "next";

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
  },
  // S6 (partial): the security headers that can't break rendering — sniffing,
  // clickjacking, referrer leakage, transport security, and powerful-feature
  // gating. Deliberately NOT shipping the resource-restricting CSP directives
  // (script-src/style-src/img-src) yet: a slightly-wrong value blank-screens the
  // app, and that needs live browser verification. The CSP here carries only
  // `frame-ancestors` (clickjacking) which restricts no resource loads.
  // Permissions-Policy restricts only features the app never uses — autoplay/
  // encrypted-media are left permitted so the YouTube trailer embed keeps working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
