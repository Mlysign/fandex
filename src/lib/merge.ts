import { Source, MediaLink, EnrichedItem, MediaType } from "@/types";

// ── Priority orders ────────────────────────────────────────────────

const TITLE_PRIORITY: Source[] = ["tmdb", "igdb", "steam", "rawg", "trakt"];
const DESCRIPTION_PRIORITY: Source[] = ["rawg", "tmdb", "steam"];
const RELEASE_DATE_PRIORITY: Source[] = ["steam", "igdb", "rawg", "tmdb", "trakt"];
const POSTER_PRIORITY: Source[] = ["tmdb", "rawg", "steam", "trakt"];

// ── Extractors per source ─────────────────────────────────────────

function extractTitle(source: Source, data: any): string | null {
  switch (source) {
    case "steam": return data.name ?? null;
    case "rawg": return data.name ?? null;
    case "tmdb": return data.title ?? data.name ?? null;
    case "trakt": return data.title ?? data.show?.title ?? null;
    case "igdb": return data.name ?? null;
    default: return null;
  }
}

function extractDescription(source: Source, data: any): string | null {
  switch (source) {
    case "rawg": return data.description_raw ?? data.description ?? null;
    case "tmdb": return data.overview ?? null;
    case "steam": return data.basic_info?.short_description ?? data.short_description ?? null;
    case "trakt": return data.overview ?? null;
    default: return null;
  }
}

function extractReleaseDate(source: Source, data: any): string | null {
  switch (source) {
    case "steam": {
      const r = data.release;
      if (!r) return null;
      if (r.steam_release_date) return new Date(r.steam_release_date * 1000).toISOString().split("T")[0];
      if (r.custom_release_date?.date) {
        const p = Date.parse(r.custom_release_date.date);
        if (!isNaN(p)) return new Date(p).toISOString().split("T")[0];
      }
      return null;
    }
    case "rawg": return data.released ?? null;
    case "tmdb": return data.release_date ?? data.first_air_date ?? null;
    case "trakt": return data.released ?? data.first_aired?.split("T")[0] ?? null;
    default: return null;
  }
}

function extractPoster(source: Source, data: any): string | null {
  switch (source) {
    case "tmdb":
      return data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
    case "rawg": return data.background_image ?? null;
    case "steam": {
      const appId = data.appid;
      return appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null;
    }
    case "trakt": return null; // Trakt doesn't provide images directly
    default: return null;
  }
}

function extractImages(source: Source, data: any): string[] {
  const imgs: string[] = [];
  switch (source) {
    case "steam": {
      const appId = data.appid;
      if (appId) imgs.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`);
      if (data.assets?.asset_url_format && data.assets?.hero_capsule) {
        const path = data.assets.asset_url_format.replace("${FILENAME}", data.assets.hero_capsule);
        imgs.push(`https://shared.fastly.steamstatic.com/store_item_assets/${path}`);
      }
      for (const s of (data.screenshots?.all_ages_screenshots ?? []).slice(0, 5)) {
        if (s.filename) imgs.push(`https://shared.fastly.steamstatic.com/store_item_assets/${s.filename}`);
      }
      break;
    }
    case "rawg": {
      if (data.background_image) imgs.push(data.background_image);
      for (const s of (data.short_screenshots ?? []).slice(0, 4)) {
        if (s.image) imgs.push(s.image);
      }
      break;
    }
    case "tmdb": {
      if (data.poster_path) imgs.push(`https://image.tmdb.org/t/p/w500${data.poster_path}`);
      if (data.backdrop_path) imgs.push(`https://image.tmdb.org/t/p/w780${data.backdrop_path}`);
      break;
    }
  }
  return imgs;
}

function extractTags(source: Source, data: any): string[] {
  switch (source) {
    case "steam": return data.resolvedTags ?? [];
    case "rawg": return (data.genres ?? []).map((g: any) => g.name).filter(Boolean);
    case "tmdb": return (data.genres ?? []).map((g: any) => g.name).filter(Boolean);
    default: return [];
  }
}

function extractPlatforms(source: Source, data: any): string[] {
  switch (source) {
    case "steam":
      return Object.entries(data.platforms ?? {})
        .filter(([k, v]) => ["windows", "mac", "linux"].includes(k) && v === true)
        .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
    case "rawg":
      return (data.platforms ?? []).map((p: any) => p.platform?.name).filter(Boolean);
    default: return [];
  }
}

function extractMetacritic(source: Source, data: any): number | null {
  switch (source) {
    case "rawg": return typeof data.metacritic === "number" ? data.metacritic : null;
    default: return null;
  }
}

function extractSteamReviewLabel(source: Source, data: any): string | null {
  if (source !== "steam") return null;
  return data.reviews?.summary_filtered?.review_score_label ?? null;
}

function extractDeveloper(source: Source, data: any): string | null {
  switch (source) {
    case "rawg": return data.developers?.[0]?.name ?? null;
    case "steam": return data.basic_info?.developers?.[0]?.name ?? null;
    default: return null;
  }
}

function extractPublisher(source: Source, data: any): string | null {
  switch (source) {
    case "rawg": return data.publishers?.[0]?.name ?? null;
    case "steam": return data.basic_info?.publishers?.[0]?.name ?? null;
    default: return null;
  }
}

function extractTrailer(source: Source, data: any): { youtubeKey: string | null; steamUrl: string | null } {
  if (source === "tmdb") {
    const t = (data.videos?.results ?? []).find(
      (v: any) => v.site === "YouTube" && v.type === "Trailer" && v.official
    ) ?? (data.videos?.results ?? []).find(
      (v: any) => v.site === "YouTube" && v.type === "Trailer"
    ) ?? (data.videos?.results ?? []).find((v: any) => v.site === "YouTube");
    return { youtubeKey: t?.key ?? null, steamUrl: null };
  }
  if (source === "steam" && (data.trailers?.highlights?.length ?? 0) > 0) {
    return { youtubeKey: null, steamUrl: `https://store.steampowered.com/app/${data.appid}` };
  }
  return { youtubeKey: null, steamUrl: null };
}

function extractStoreLinks(source: Source, data: any, mediaType: MediaType): { name: string; url: string; source: Source }[] {
  const links: { name: string; url: string; source: Source }[] = [];
  switch (source) {
    case "steam":
      if (data.appid) links.push({ name: "Steam", url: `https://store.steampowered.com/app/${data.appid}`, source: "steam" });
      break;
    case "rawg":
      if (data.slug) links.push({ name: "RAWG", url: `https://rawg.io/games/${data.slug}`, source: "rawg" });
      for (const s of data.stores ?? []) {
        if (s.url) links.push({ name: s.store.name, url: s.url, source: "rawg" });
      }
      if (data.website) links.push({ name: "Official site", url: data.website, source: "rawg" });
      break;
    case "tmdb":
      if (data.id && mediaType === "movie") links.push({ name: "TMDB", url: `https://www.themoviedb.org/movie/${data.id}`, source: "tmdb" });
      if (data.id && mediaType === "show") links.push({ name: "TMDB", url: `https://www.themoviedb.org/tv/${data.id}`, source: "tmdb" });
      if (data.homepage) links.push({ name: "Official site", url: data.homepage, source: "tmdb" });
      break;
  }
  return links;
}

function extractStreamingProviders(source: Source, data: any): { name: string; logoPath: string | null; providerId: number }[] {
  if (source !== "tmdb") return [];
  const de = data["watch/providers"]?.results?.DE;
  const providers = de?.flatrate ?? de?.buy ?? de?.rent ?? [];
  return providers.map((p: any) => ({
    name: p.provider_name,
    logoPath: p.logo_path ?? null,
    providerId: p.provider_id,
  }));
}

// ── Main merge function ───────────────────────────────────────────

export function mergeLinks(mediaLinks: MediaLink[], type: MediaType): Omit<EnrichedItem, "id" | "type" | "platformSources"> {
  const bySource = new Map<Source, any>();
  for (const link of mediaLinks) {
    bySource.set(link.source, link.rawData);
  }

  // ── Single-value fields (priority order) ──────────────────────

  const title = pickFirst(TITLE_PRIORITY, bySource, extractTitle) ?? "Unknown";
  const description = pickLongest(DESCRIPTION_PRIORITY, bySource, extractDescription);
  const releaseDate = pickFirst(RELEASE_DATE_PRIORITY, bySource, extractReleaseDate);
  const posterUrl = pickFirst(POSTER_PRIORITY, bySource, extractPoster);
  const metacritic = pickFirstValue(["rawg"] as Source[], bySource, extractMetacritic);
  const steamReviewLabel = pickFirstValue(["steam"] as Source[], bySource, extractSteamReviewLabel);
  const developer = pickFirst(["rawg", "steam", "igdb"] as Source[], bySource, extractDeveloper);
  const publisher = pickFirst(["rawg", "steam", "igdb"] as Source[], bySource, extractPublisher);

  // ── Multi-value fields (union) ────────────────────────────────

  const images = dedup(
    ["steam", "tmdb", "rawg"].flatMap((s) => {
      const d = bySource.get(s as Source);
      return d ? extractImages(s as Source, d) : [];
    })
  );

  const tags = dedup(
    ["rawg", "steam", "tmdb"].flatMap((s) => {
      const d = bySource.get(s as Source);
      return d ? extractTags(s as Source, d) : [];
    })
  );

  const platforms = dedup(
    ["steam", "rawg", "igdb"].flatMap((s) => {
      const d = bySource.get(s as Source);
      return d ? extractPlatforms(s as Source, d) : [];
    })
  );

  // ── Per-source dates ──────────────────────────────────────────

  const dates: { source: Source; date: string }[] = [];
  for (const s of RELEASE_DATE_PRIORITY) {
    const d = bySource.get(s);
    if (!d) continue;
    const date = extractReleaseDate(s, d);
    if (date) dates.push({ source: s, date });
  }
  // Deduplicate dates that are the same value
  const uniqueDates = dates.filter((d, i) => dates.findIndex((x) => x.date === d.date) === i);

  // ── Trailer ───────────────────────────────────────────────────

  let trailerYoutubeKey: string | null = null;
  let steamTrailerUrl: string | null = null;
  for (const s of ["tmdb", "steam"] as Source[]) {
    const d = bySource.get(s);
    if (!d) continue;
    const t = extractTrailer(s, d);
    if (t.youtubeKey && !trailerYoutubeKey) trailerYoutubeKey = t.youtubeKey;
    if (t.steamUrl && !steamTrailerUrl) steamTrailerUrl = t.steamUrl;
  }

  // ── Store links ───────────────────────────────────────────────

  const allStoreLinks = ["steam", "rawg", "tmdb"].flatMap((s) => {
    const d = bySource.get(s as Source);
    return d ? extractStoreLinks(s as Source, d, type) : [];
  });
  // Deduplicate by name
  const storeLinks = allStoreLinks.filter((l, i) => allStoreLinks.findIndex((x) => x.name === l.name) === i);

  // ── Streaming providers ───────────────────────────────────────

  const streamingProviders = extractStreamingProviders("tmdb", bySource.get("tmdb") ?? {});

  // ── External links ────────────────────────────────────────────

  const links: { label: string; url: string }[] = [];
  for (const sl of storeLinks) {
    links.push({ label: sl.name, url: sl.url });
  }

  // ── Sources summary ───────────────────────────────────────────

  // sources: use the actual mediaLinks array passed in for correct sourceIds
  const sources = mediaLinks.map((l) => ({
    source: l.source,
    sourceId: l.sourceId,
    data: l.rawData,
  }));

  return {
    title,
    releaseDate,
    posterUrl,
    dates: uniqueDates,
    images: images.slice(0, 12),
    tags: tags.slice(0, 12),
    platforms: platforms.slice(0, 10),
    description,
    metacritic,
    steamReviewLabel,
    developer,
    publisher,
    trailerYoutubeKey,
    steamTrailerUrl,
    storeLinks,
    streamingProviders,
    links,
    sources,
  };
}

// ── Merge for canonical record (used when upserting media_items) ──

export function mergeForCanonical(links: { source: Source; data: any }[]): {
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
} {
  const bySource = new Map(links.map((l) => [l.source, l.data]));
  return {
    title: pickFirst(TITLE_PRIORITY, bySource, extractTitle) ?? "Unknown",
    releaseDate: pickFirst(RELEASE_DATE_PRIORITY, bySource, extractReleaseDate),
    posterUrl: pickFirst(POSTER_PRIORITY, bySource, extractPoster),
  };
}

// ── Normalization for matching ────────────────────────────────────

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function extractYear(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

// ── Helpers ───────────────────────────────────────────────────────

function pickFirst<T>(
  priority: Source[],
  bySource: Map<Source, any>,
  extractor: (s: Source, d: any) => T | null
): T | null {
  for (const s of priority) {
    const d = bySource.get(s);
    if (!d) continue;
    const val = extractor(s, d);
    if (val !== null && val !== undefined) return val;
  }
  return null;
}

function pickFirstValue<T>(
  priority: Source[],
  bySource: Map<Source, any>,
  extractor: (s: Source, d: any) => T | null
): T | null {
  return pickFirst(priority, bySource, extractor);
}

function pickLongest(
  priority: Source[],
  bySource: Map<Source, any>,
  extractor: (s: Source, d: any) => string | null
): string | null {
  // Among sources at the same or adjacent priority, pick the longest non-empty string
  let best: string | null = null;
  for (const s of priority) {
    const d = bySource.get(s);
    if (!d) continue;
    const val = extractor(s, d);
    if (val && (!best || val.length > best.length)) best = val;
  }
  return best;
}

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    if (!x || seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}
