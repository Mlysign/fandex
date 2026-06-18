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
    remotePatterns: [
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "media.rawg.io" },
      { protocol: "https", hostname: "*.steamstatic.com" },
    ],
  },
};

export default nextConfig;
