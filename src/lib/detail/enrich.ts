import { query, get } from "@/lib/db";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import { linkSourceToItem } from "@/lib/matcher";
import { extractYear } from "@/lib/merge";
import type { MediaLink, EnrichedItem, Source, MediaType } from "@/types";
import { METADATA, metadataForType } from "@/lib/metadata/registry";
import type { MetaLink } from "@/lib/metadata/types";
import { isProviderCircuitOpen } from "@/lib/http";
import { TMDB_HOST } from "@/lib/sources/tmdb";
import { RAWG_HOST } from "@/lib/sources/rawg";
import { IGDB_HOST } from "@/lib/sources/igdb";

// ── Shared detail-enrichment pipeline ────────────────────────────────────────
//
// Extracted from /api/detail so the AUTHED endpoint and the PUBLIC page render
// from ONE pipeline. They previously diverged: the public page was built on a
// stored-data-only path and rendered a fraction of the data (no cast, trailers,
// where-to-watch or RT/IMDb scores) even though all of it is public. One code
// path means the public page can never silently fall behind again.
//
// Everything here is CATALOG data — third-party metadata about the item itself.
// Nothing in this module reads user_library / user_watchlist / user_item_state.
// The per-user overlay (rating, review, wishlist status) is layered on top by
// /api/detail and must never move down into here.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EnrichedItem minus EVERY per-user field. The public page builds THIS, so
// putting a rating/review/libraryStatus on it is a compile error rather than
// something we have to remember to strip.
//
// `platformSources` (which of the viewer's accounts hold the item) is per-user
// too, so it's omitted as well — the display components never read it; the view
// supplies `platformSources: []` at the boundary where it hands off to them.
export type PublicEnrichedItem = Omit<
  EnrichedItem,
  | "rating" | "ratings" | "review" | "reviewedAt"
  | "libraryStatus" | "libraryStatusSources" | "platformSources"
>;

export interface SourceIds {
  rawg: string | null;
  tmdb: string | null;
  trakt: string | null;
  steam: string | null;
  letterboxd: string | null;
}

export function readSourceIds(sp: URLSearchParams): SourceIds {
  return {
    rawg: sp.get("rawgId"),
    tmdb: sp.get("tmdbId"),
    trakt: sp.get("traktId"),
    steam: sp.get("steamId"),
    letterboxd: sp.get("letterboxdId"),
  };
}

// Resolve an existing media_item from any provided source id via media_links.
export function resolveBySourceIds(type: MediaType | null, ids: SourceIds): string | null {
  const candidates: { source: string; id: string }[] = [];
  if (ids.rawg) candidates.push({ source: "rawg", id: ids.rawg });
  if (ids.tmdb) candidates.push({ source: "tmdb", id: ids.tmdb });
  if (ids.trakt) candidates.push({ source: "trakt", id: ids.trakt });
  if (ids.steam) candidates.push({ source: "steam", id: ids.steam });
  if (ids.letterboxd) candidates.push({ source: "letterboxd", id: ids.letterboxd });

  // SM50 — a provider id is unique only within a media type (trakt movie 386 and
  // trakt show 386 are different works), so `type` is a real filter here, not a
  // formality. It stayed unused for a while and this is exactly the resolution
  // it was passed for. A caller with no type still gets the old behaviour: the
  // first row for that id, whichever type it belongs to.
  for (const { source, id } of candidates) {
    const link = type
      ? get<{ media_item_id: string }>(
          "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ? AND media_type = ?",
          [source, id, type]
        )
      : get<{ media_item_id: string }>(
          "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
          [source, id]
        );
    if (link) return link.media_item_id;
  }
  return null;
}

export function loadLinks(mediaItemId: string): MediaLink[] {
  const linkRows = query<any>("SELECT * FROM media_links WHERE media_item_id = ?", [mediaItemId]);
  return linkRows.map((r: any) => ({
    id: r.id,
    mediaItemId: r.media_item_id,
    source: r.source as Source,
    sourceId: r.source_id,
    title: r.title,
    releaseDate: r.release_date,
    rawData: JSON.parse(r.raw_data),
    lastSynced: r.last_synced,
    projectionVersion: r.projection_version ?? 0,
  }));
}

// Wrap a normalized MetaLink as an in-memory MediaLink for merging.
export function toMediaLink(link: MetaLink, mediaItemId: string): MediaLink {
  return {
    id: `live-${link.source}`,
    mediaItemId,
    source: link.source,
    sourceId: link.sourceId,
    title: link.title,
    releaseDate: link.releaseDate,
    rawData: link.rawData,
    lastSynced: 0,
  };
}

// Build links live from the provided source ids (item not in DB), by fetching
// each known id through its MetadataProvider. The remaining sources are filled
// in by enrichMissingSources().
export async function buildLiveLinks(
  id: string,
  type: MediaType,
  title: string | null,
  ids: SourceIds
): Promise<MediaLink[]> {
  const links: MediaLink[] = [];
  for (const provider of metadataForType(type)) {
    const rawId = ids[provider.id as keyof SourceIds];
    if (rawId == null || !provider.fetchById) continue;
    try {
      const link = await provider.fetchById(String(rawId), type);
      if (link) links.push(toMediaLink(link, id));
    } catch { /* continue */ }
  }
  return links;
}

// ── Heal: refresh stored links that predate the current fetch shape ──────────
//
// H2a — this USED to sniff fields ("no external_ids/keywords → old blob →
// refetch"). Sniffing is fundamentally incompatible with the raw_data
// projection: a projected row is legitimately missing fields, so every row would
// read as stale and stampede TMDB with ~1,472 refetches. Staleness is now the
// EXPLICIT `projection_version` stamp — the only honest signal, since it says
// what shape a row was written in rather than guessing from its contents.

// The links a heal would refresh, per media type. TMDB carries movies/shows;
// games are the two-provider medium (IGDB + RAWG) and heal both. The `rawData`
// guard on the game links is deliberate and predates this — a game link with no
// blob has nothing to refresh in place.
type HealProvider = "tmdb" | "igdb" | "rawg";

function healableLinks(links: MediaLink[], type: MediaType): { link: MediaLink; provider: HealProvider }[] {
  const out: { link: MediaLink; provider: HealProvider }[] = [];
  if (type === "movie" || type === "show") {
    const tmdb = links.find((l) => l.source === "tmdb");
    if (tmdb) out.push({ link: tmdb, provider: "tmdb" });
  } else if (type === "game") {
    for (const provider of ["igdb", "rawg"] as const) {
      const link = links.find((l) => l.source === provider);
      if (link && link.rawData) out.push({ link, provider });
    }
  }
  return out;
}

const isStale = (l: MediaLink) => (l.projectionVersion ?? 0) < PROJECTION_VERSION;

// The host each provider's fetches actually go to. Imported from the source
// modules rather than restated, because http.ts's circuit breaker is keyed by
// host and a typo here would silently disable the check.
const PROVIDER_HOST: Record<"tmdb" | "igdb" | "rawg", string> = {
  tmdb: TMDB_HOST,
  igdb: IGDB_HOST,
  rawg: RAWG_HOST,
};

export interface HealOutcome {
  /** At least one stale link was refetched and persisted — the catalog improved. */
  healed: boolean;
  /**
   * A refresh was needed, could not be done (provider circuit open, or the
   * fetch didn't land inside the budget), and the item is left with NO
   * up-to-date link at all. Anything derived from it is therefore PROVISIONAL:
   * the caller must report "not yet", never a number computed from a row it
   * knows is thin, and never a final "no".
   *
   * Note the "no up-to-date link AT ALL" part. Games are a two-provider medium,
   * so a dead RAWG next to a live IGDB still leaves real facets to score from —
   * deferring those would trade a 66 s stall for a permanently missing badge,
   * which is the same complaint wearing different clothes. Only an item with
   * nothing fresh on it is genuinely unscoreable-for-now.
   *
   * This is also the distinction the old boolean return could not make at all:
   * `false` meant both "nothing needed doing" and "the provider is down", which
   * is how a dead RAWG turned into cards that were permanently score-less
   * rather than pending.
   */
  incomplete: boolean;
}

type FetchOutcome =
  | { kind: "fresh"; meta: MetaLink }
  // The provider answered and has no such item — refetching will never help.
  | { kind: "miss" }
  // Threw (including the breaker's ProviderUnavailableError). Cheap and already
  // failure-isolated; worth asking again later, but it says nothing about latency.
  | { kind: "unavailable" }
  // Didn't land inside the budget. This is the EXPENSIVE outcome and the only
  // one that writes the host off for the rest of the request — a throw can be
  // one bad id (rawgGet throws on a 404), a timeout is the provider itself.
  | { kind: "timeout" };

const TIMED_OUT = Symbol("heal-timed-out");

/**
 * A per-REQUEST heal budget. Create one per request and pass it to every
 * healLinks call in that request; omit it entirely (the default) for the
 * unbounded behavior every caller had before, which is what /api/detail and the
 * sync-shaped paths still want.
 *
 * Two bounds, because either alone is insufficient:
 *  - `deadlineAt` caps the WHOLE request, so 24 slow-but-alive calls can't
 *    add up to minutes;
 *  - `perCallMs` caps ONE call, so the first dead provider can't swallow the
 *    entire budget and starve every later item — including the items on a
 *    healthy provider sitting behind it in the same batch.
 * And `down` remembers hosts that already timed out here, so the second, third
 * and twenty-fourth game in a batch cost nothing at all rather than `perCallMs`
 * each. http.ts's breaker needs three hard failures to latch; within one request
 * one timeout is already enough evidence to stop paying.
 */
export interface HealBudget {
  deadlineAt: number;
  perCallMs: number;
  down: Set<string>;
}

// >10× a measured healthy fetchById (~180 ms for an IGDB heal), so a merely slow
// provider still completes, while a dead one is written off after ONE call
// instead of once per item.
export const DEFAULT_HEAL_CALL_MS = 2_500;

// …and never more than this share of the whole budget, whatever the constant
// says. Without it a small total (a test, or a tuned-down HEAL_BUDGET_MS) lets
// the FIRST dead call spend everything, and the healthy provider sitting behind
// it in the same batch gets deferred for no reason — the exact starvation the
// per-call cap exists to prevent.
const MAX_CALL_SHARE = 4;

export function createHealBudget(totalMs: number, perCallMs = DEFAULT_HEAL_CALL_MS): HealBudget {
  return {
    deadlineAt: Date.now() + totalMs,
    perCallMs: Math.min(perCallMs, totalMs / MAX_CALL_SHARE),
    down: new Set(),
  };
}

// Fetch one stale link's fresh blob, giving up after `budgetMs`.
//
// Giving up does NOT cancel the request — it can't; `fetchById` owns its own
// abort signal (httpFetch's per-attempt timeout). So the in-flight call is left
// to finish and, if it eventually lands, still PERSISTED: the heal is a backfill
// that only has to succeed once ever, and throwing away a result we already paid
// for would make an outage's recovery slower for no benefit. The request-local
// `link.rawData` is deliberately NOT mutated on that late path — the caller has
// already scored without it and must not see the object change underneath it.
async function fetchFresh(
  provider: "tmdb" | "igdb" | "rawg",
  link: MediaLink,
  type: MediaType,
  budgetMs: number
): Promise<FetchOutcome> {
  const pending = METADATA[provider]?.fetchById?.(link.sourceId, type);
  if (!pending) return { kind: "miss" };

  // Attached NOW, so a rejection that arrives after we stop waiting is already
  // handled and can never surface as an unhandled rejection.
  const settled: Promise<FetchOutcome> = pending.then(
    (meta): FetchOutcome => (meta ? { kind: "fresh", meta } : { kind: "miss" }),
    (): FetchOutcome => ({ kind: "unavailable" })
  );
  if (!Number.isFinite(budgetMs)) return settled;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(budgetMs, 0));
  });
  const winner = await Promise.race([settled, expiry]);
  clearTimeout(timer);
  if (winner !== TIMED_OUT) return winner;

  void settled.then((late) => { if (late.kind === "fresh") storeRefreshed(link, type, late.meta); });
  return { kind: "timeout" };
}

/**
 * Refresh every stale link on an item, and report whether anything that needed
 * refreshing was left un-refreshed.
 *
 * `budget` is opt-in, and omitting it means unbounded — exactly the behavior
 * every existing caller had. Latency-sensitive callers pass one; the
 * detail/sync-shaped callers keep waiting, because they would rather be slow
 * than lose an item's metadata. That mirrors the split http.ts already draws
 * with `budgetMs`, one layer up: per-source FAILURE isolation is not per-source
 * LATENCY isolation, and a loop that awaits an enricher per item is a provider
 * path however it is named.
 */
export async function healLinks(
  links: MediaLink[],
  type: MediaType,
  budget?: HealBudget
): Promise<HealOutcome> {
  const out: HealOutcome = { healed: false, incomplete: false };
  const healable = healableLinks(links, type);
  // Fresh BEFORE we start — a second provider already at the current projection
  // version means this item is scoreable whatever happens below.
  let anyFresh = healable.some(({ link }) => !isStale(link));
  let missed = false;

  for (const { link, provider } of healable.filter(({ link }) => isStale(link))) {
    const host = PROVIDER_HOST[provider];
    // Already known down — across requests (the breaker) or within this one.
    // Skip without paying anything, and SAY SO: the call would fail fast either
    // way, but the caller can't tell a fast failure from a clean no-op, and
    // that ambiguity is what left cards permanently blank.
    if (isProviderCircuitOpen(host) || budget?.down.has(host)) { missed = true; continue; }

    let callMs = Infinity;
    if (budget) {
      const left = budget.deadlineAt - Date.now();
      if (left <= 0) { missed = true; continue; }
      callMs = Math.min(left, budget.perCallMs);
    }

    const result = await fetchFresh(provider, link, type, callMs);
    if (result.kind === "fresh") {
      link.rawData = result.meta.rawData;
      storeRefreshed(link, type, result.meta);
      out.healed = true;
      anyFresh = true;
    } else if (result.kind === "timeout") {
      missed = true;
      budget?.down.add(host);
    } else if (result.kind === "unavailable") {
      missed = true;
    }
    // "miss" is a settled answer — the provider has no such item, so there is
    // nothing to come back for and the caller may treat what it has as final.
  }

  out.incomplete = missed && !anyFresh;
  return out;
}

// Refresh a stored movie/show's TMDB link in-memory when it predates the
// current fetch shape. Returns whether the stored data was replaced.
//
// Kept as-is for the callers that only care whether something changed
// (/api/detail, /api/facet/mine) — they run unbounded, exactly as before.
export async function ensureTmdbDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "movie" && type !== "show") return false;
  return (await healLinks(links, type)).healed;
}

// Persist a blob we just refetched because the stored one was stale, so the row
// heals ONCE instead of refetching on every read.
//
// H2b makes this load-bearing. Discover now writes a `thin` list-payload row per
// browsed item, stamped version 0 = "refetch on first detail read". Without a
// write-back that stamp never advances, so every view of every browsed item
// would hit TMDB again, forever — the refresh above was in-memory only, which
// was survivable when the only stale rows were a handful of pre-H2a leftovers
// and is not survivable once the catalog grows with everything anyone browses.
//
// Guarded on a uuid `mediaItemId`: the live paths (buildLiveLinks) put a SOURCE
// id there for an item with no row, and those must stay unstored.
function storeRefreshed(link: MediaLink, type: MediaType, fresh: MetaLink): void {
  if (!UUID_RE.test(link.mediaItemId) || !fresh.title) return;
  try {
    linkSourceToItem(link.mediaItemId, {
      source: link.source, sourceId: link.sourceId, type,
      title: fresh.title, releaseDate: fresh.releaseDate ?? link.releaseDate, rawData: fresh.rawData,
    });
  } catch { /* a failed heal just means we refetch next time — never break the read */ }
}

// Refresh stored game links (igdb/rawg) in-memory when they predate the current
// fetch shape. Same H2a change as ensureTmdbDetail: this used to sniff for
// `time_to_beat`/`screenshots`, which the projection would make look
// permanently stale. Now keyed on the explicit projection_version stamp.
export async function ensureGameDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "game") return false;
  return (await healLinks(links, type)).healed;
}

// Which links the Fandex Score is computed from (2026-07-30). NOT the same set
// the page renders: by the time /api/detail scores, its live array has been
// mutated in place by the ensure*Detail heals AND had title-matched sources
// PUSHED onto it by enrichMissingSources, which never writes them to the DB. So
// scoring that array meant the detail page scored a facet set no other surface
// could see, and disagreed with Home/Library/facet pages for the same item —
// visible once T2's raw-sum aggregate stopped dividing facet count back out.
//
// Re-reading here rather than snapshotting before the heal is deliberate: the
// heals persist, so this picks up the fresher data too. A live item (no uuid)
// has nothing persisted to read and nothing to disagree with, so it keeps
// scoring what it has.
export function linksForScoring(mediaItemId: string | null, liveLinks: MediaLink[]): MediaLink[] {
  return mediaItemId ? loadLinks(mediaItemId) : liveLinks;
}

export interface EnrichmentOutcome {
  source: Source;
  outcome: "already-linked" | "linked" | "no-match" | "not-configured" | "error" | "skipped-primary";
}

// Title-search every non-primary metadata provider for this type that isn't
// already linked, and add what matches. (TMDB is `primary` — resolved by id, not
// guessed by name — so it's skipped here.) Returns one outcome per consulted
// provider so the debug view can show why a source is absent.
export async function enrichMissingSources(
  itemType: string,
  itemTitle: string,
  mediaItemId: string,
  links: MediaLink[],
  hasSources: Set<string>
): Promise<EnrichmentOutcome[]> {
  const outcomes: EnrichmentOutcome[] = [];
  // The earliest year among the already-linked sources is the best proxy for
  // the *original* release — ports/remasters/re-releases come later. Passing it
  // lets a provider disambiguate same-titled entries (e.g. IGDB returning a
  // BioShock port instead of the 2007 original).
  const knownYear = links
    .map((l) => extractYear(l.releaseDate))
    .filter((y): y is number => y != null)
    .reduce<number | null>((min, y) => (min == null || y < min ? y : min), null);
  for (const provider of metadataForType(itemType)) {
    if (hasSources.has(provider.id)) { outcomes.push({ source: provider.id, outcome: "already-linked" }); continue; }
    if (provider.primary || !provider.searchByTitle) { outcomes.push({ source: provider.id, outcome: "skipped-primary" }); continue; }
    if (provider.configured && !provider.configured()) { outcomes.push({ source: provider.id, outcome: "not-configured" }); continue; }
    try {
      const link = await provider.searchByTitle(itemTitle, itemType as MediaType, { year: knownYear });
      if (link) {
        links.push(toMediaLink(link, mediaItemId));
        outcomes.push({ source: provider.id, outcome: "linked" });
      } else {
        outcomes.push({ source: provider.id, outcome: "no-match" });
      }
    } catch {
      outcomes.push({ source: provider.id, outcome: "error" });
    }
  }
  return outcomes;
}
