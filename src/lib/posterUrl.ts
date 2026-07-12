// S12: poster URLs submitted on the watchlist POST are stored and later
// reflected back to clients. Only accept https URLs on the known media-CDN hosts
// (the same set as next.config `images.remotePatterns`, plus IGDB) so a caller
// can't get an arbitrary/`javascript:`/http URL persisted and echoed. Anything
// else → null (the item just falls back to its placeholder poster).
const ALLOWED_POSTER_HOSTS = new Set([
  "image.tmdb.org", // TMDB posters + person profiles
  "media.rawg.io", // RAWG game art
  "images.igdb.com", // IGDB cover/artwork
]);

export function sanitizePosterUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  // Steam serves art from several *.steamstatic.com CDN subdomains.
  if (ALLOWED_POSTER_HOSTS.has(host) || host.endsWith(".steamstatic.com")) {
    return u.toString();
  }
  return null;
}
