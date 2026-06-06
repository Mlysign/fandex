import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
