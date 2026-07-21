"use client";

// next/image custom loader (PR10, 2026-07-21 memory incident).
//
// WHY THIS EXISTS: every image the app renders already lives on a CDN that can
// resize it for us — TMDB (`/t/p/w500/…`), RAWG (`/media/resize/420/-/…`),
// IGDB (`/upload/t_cover_big/…`). Routing those through `/_next/image` made the
// Node process download the upstream bytes into a Buffer and re-encode them
// through sharp/libvips on every cache miss, for no size win we couldn't get
// from the CDN for free.
//
// That was survivable until the poster set grew a RAWG tail: RAWG poster URLs
// are stored as FULL-SIZE ORIGINALS (`normalize.ts` → `d.background_image`,
// no resize segment — 726/726 rows in prod), and those run 43 KB to 3.8 MB.
// A game detail page renders up to 9 of them (hero + thumbnail strip), so one
// crawler hit could pull ~10 MB of JPEG and hand libvips ~25 MB of decoded
// bitmap PER IMAGE — on a container capped at 0.4 vCPU, with no concurrency
// limit in front of the optimizer. Hence the RSS ramp to 7.5 GB (native
// memory: `--max-old-space-size` doesn't bound sharp) and the wall of
// "upstream image response timed out" errors, which were the event loop
// starving under encode work, not TMDB being slow.
//
// So: ask the CDN for the size we actually want and let the browser fetch it
// directly. No upstream buffering, no sharp, no optimizer disk cache, and
// image bytes stop transiting Railway egress entirely.
//
// Host safety is unaffected: `sanitizePosterUrl` (S12) still gates which hosts
// can be persisted, and the CSP `img-src` allowlist still gates what the
// browser will load. `remotePatterns` no longer applies (nothing reaches the
// optimizer) — it stays in next.config.ts as the documented allowlist.

// The width next/image asks for is already generous: it emits a srcset from
// `deviceSizes`/`imageSizes` and the browser then picks a candidate at least
// DPR× the CSS slot. So `floor` (largest bucket <= width, never below the
// smallest) lands on a variant that still covers the slot at ~1x-1.3x, while
// `ceil` would round a 200px card at DPR2 all the way up to a 780px poster.
function floorBucket(buckets: number[], width: number): number {
  let out = buckets[0];
  for (const b of buckets) if (b <= width) out = b;
  return out;
}

/** Smallest bucket >= width, else the largest bucket. */
function ceilBucket(buckets: number[], width: number): number {
  return buckets.find((b) => b >= width) ?? buckets[buckets.length - 1];
}

// TMDB serves any bucket from the same stored path, so the `w500` we happened
// to persist is not a ceiling. Capped at w780 deliberately: `original` is
// unbounded (multi-MB), and the largest slot the app renders is a ~45vw poster,
// which even at DPR 2 is comfortably served by 780px.
// Uses floorBucket: TMDB serves JPEG, which runs ~2-3x heavier than the WebP the
// built-in optimizer used to emit, so rounding up is what would actually cost
// users bytes here (measured: w500 7.4 KB vs w780 27 KB for the same poster).
const TMDB_WIDTHS = [92, 154, 185, 342, 500, 780];

// RAWG's `/media/resize/{w}/-/{path}` accepts arbitrary widths (verified);
// these buckets just keep the variant set small and CDN-cache-friendly.
// Uses ceilBucket, unlike TMDB: the alternative here is not a smaller variant
// but the multi-MB ORIGINAL, so every bucket is already a >10x win and there is
// no reason to trade sharpness for the last few KB.
const RAWG_WIDTHS = [200, 320, 420, 640, 828, 1280];

// IGDB uses named size tokens rather than pixel widths.
const IGDB_SIZES: [number, string][] = [
  [90, "t_thumb"],
  [264, "t_cover_big"],
  [528, "t_cover_big_2x"],
  [1280, "t_720p"],
];

/**
 * Rewrite a media-CDN URL to the CDN's own variant for `width`.
 * Anything unrecognized (Steam capsules are already fixed-size, local assets,
 * data: URLs) passes through untouched.
 */
export function cdnImageUrl(src: string, width: number): string {
  // TMDB — https://image.tmdb.org/t/p/{size}/{file}.jpg
  const tmdb = src.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)[^/]+\/(.+)$/);
  if (tmdb) return `${tmdb[1]}w${floorBucket(TMDB_WIDTHS, width)}/${tmdb[2]}`;

  // RAWG — https://media.rawg.io/media/{path}. Already-sized URLs (`resize/`,
  // `crop/`) are left alone so we never stack two transforms.
  const rawg = src.match(/^(https:\/\/media\.rawg\.io\/media\/)(?!resize\/|crop\/)(.+)$/);
  if (rawg) return `${rawg[1]}resize/${ceilBucket(RAWG_WIDTHS, width)}/-/${rawg[2]}`;

  // IGDB — https://images.igdb.com/igdb/image/upload/{t_size}/{id}.jpg
  const igdb = src.match(/^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_[^/]+\/(.+)$/);
  if (igdb) {
    const size = IGDB_SIZES.find(([w]) => w >= width)?.[1] ?? "t_1080p";
    return `${igdb[1]}${size}/${igdb[2]}`;
  }

  return src;
}

export default function cdnImageLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  return cdnImageUrl(src, width);
}
