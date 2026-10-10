// The Worker's API, typed. One function per route the app uses; the route table
// is worker/src/index.ts and the shapes are the ones its handlers build.

import type { ScoringConfigValues } from '@/lib/scoringDefaults';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { API_URL } from '~/lib/config';

export class ApiError extends Error {
  /** The parsed error body, for the errors that carry more than a code (a merge needing a decision). */
  body: Record<string, unknown> = {};
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

// The session token, held in memory for the life of the process. AuthProvider
// loads it from secure storage on start and sets it here; every request to the
// Worker then carries it. A bearer header, not a cookie: it cannot be attached
// by another site, so the Worker asks for no CSRF check on it.
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, 'offline', e instanceof Error ? e.message : 'Network request failed');
  }
  if (!res.ok) {
    let code = `http-${res.status}`;
    let message: string | undefined;
    let extra: Record<string, unknown> = {};
    try {
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body.error === 'string') code = body.error;
      if (typeof body.message === 'string') message = body.message;
      extra = body;
    } catch { /* not JSON: keep the status */ }
    const err = new ApiError(res.status, code, message);
    err.body = extra;
    throw err;
  }
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Shapes ───────────────────────────────────────────────────────────────────

export type MediaType = 'game' | 'movie' | 'show';

export interface Facet {
  kind: 'tag' | 'person' | 'company' | 'ip';
  key: string;
  label: string;
  role?: string;
  category?: string;
  prominence?: number;
}

/** The scalar half of a pool item. worker/src/catalog/derive.ts → ItemVector. */
export interface ItemVector {
  id: string;
  type: MediaType;
  title: string;
  slug: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  year: number | null;
  communityScore: number | null;
  communityAvg: number | null;
  communityVotes: number;
  runtimeMinutes: number | null;
  addedAt: number;
  sources: { source: string; sourceId: string }[];
}

export interface CommunityRating { source: string; label: string; score: number; outOf: number; votes?: number | null; url?: string | null }

/** The merged detail. A subset of the site's EnrichedItem: the fields the app renders. */
export interface MergedItem {
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  description: string | null;
  tagline: string | null;
  tags: string[];
  platforms: string[];
  images: string[];
  communityRatings: CommunityRating[];
  runtimeMinutes: number | null;
  certification: string[];
  status: string | null;
  developer: string | null;
  publisher: string | null;
  director?: string | null;
  network: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  cast?: { name: string; character: string | null; profileUrl?: string | null }[];
  trailerYoutubeKey: string | null;
  steamTrailerUrl?: string | null;
  storeLinks: { name: string; url: string; source: string; affiliate?: boolean }[];
  streamingProviders: { name: string; logoPath: string | null; providerId: number }[];
  streamingLink: string | null;
  /** flatrate | free | ads | rent | buy: how the region's providers offer it. */
  streamingOfferType?: string | null;
  dates: { source: string; date: string }[];
  // The rest of the site's EnrichedItem. The Worker has always sent these; the
  // app's first item page did not read them.
  keywords?: string[];
  metacritic?: number | null;
  steamReviewLabel?: string | null;
  collection?: string | null;
  originalLanguage?: string | null;
  country?: string | null;
  budget?: number | null;
  revenue?: number | null;
  nextEpisode?: { name: string | null; airDate: string | null; season: number | null; episode: number | null } | null;
  gameModes?: string[];
  playtimeHours?: number | null;
  timeToBeat?: { hastily: number | null; normally: number | null; completely: number | null } | null;
  dlc?: string[];
}

export interface ItemDetail {
  id: string;
  type: MediaType;
  slug: string | null;
  inPool: boolean;
  updatedAt: number;
  region: string;
  vector: ItemVector;
  facets: Facet[];
  merged: MergedItem;
}

export interface DeltaCursor { since: number; after: string }
export interface DeltaPage {
  items: { updatedAt: number; vector: ItemVector; facets: Facet[] }[];
  next: DeltaCursor;
  done: boolean;
  poolCount: number | null;
  serverTime: number;
}

export interface CalendarCard {
  source: 'tmdb' | 'igdb';
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platforms?: string[];
  overview?: string;
  genres: string[];
  voteCount: number;
  voteAverage: number | null;
  popularity: number | null;
}

export interface CalendarMonth {
  month: string;
  region: string;
  builtAt: number;
  stale: boolean;
  data: { partial: boolean; items: CalendarCard[] };
}

export interface GameSearchResult {
  source: 'igdb';
  sourceId: string;
  type: 'game';
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  votes: number;
  rating: number | null;
}

export interface Health { ok: boolean; time: number; today: { fetches: number; userWrites: number } }

export interface SessionUser { userId: string; provider: string; displayName: string | null }
export interface SignInResult { outcome: 'signed-in' | 'created' | 'linked' | 'merged'; token: string; user: SessionUser }

export interface Profile {
  user: { id: string; createdAt: number; country: string | null; platforms: string[] | null; mediaTypes: string[] | null };
  identities: { provider: string; displayName: string | null; avatarUrl: string | null }[];
  /** Present and true for an admin only: the /dev pages are theirs to open. */
  admin?: boolean;
}

export interface ItemStateRow {
  mediaItemId: string;
  source: string;
  relation: 'wishlist' | 'library' | 'ignored';
  status: string | null;
  rating: number | null;
  review: string | null;
  reviewedAt: number | null;
  addedAt: number;
  updatedAt: number;
}

export interface EpisodeStateRow {
  mediaItemId: string;
  season: number;
  episode: number;
  watchedAt: number | null;
  sources: string[];
}

export interface StatePage<T> { rows: T[]; limit: number; done: boolean }

/** Row counts and the newest change per kind. Cheap; decides whether a pull is needed. */
export interface StateCounts {
  items: number; itemsUpdatedAt: number;
  episodes: number; episodesUpdatedAt: number;
  hidden: number; hiddenUpdatedAt: number;
}

// ── Routes ───────────────────────────────────────────────────────────────────

const q = (params: Record<string, string | number | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<Health>('/v1/health'),

  item: (id: string, region?: string) => request<ItemDetail>(`/v1/items/${id}${q({ region })}`),

  /** Find or fetch a provider title. The only call that can make the Worker ask a provider. */
  resolve: (source: string, type: string, id: string) =>
    request<{ id: string; created: boolean }>(`/v1/resolve/${source}/${type}/${id}`),

  catalogDelta: (cursor: DeltaCursor, limit?: number, count = false) =>
    request<DeltaPage>(`/v1/catalog/delta${q({ since: cursor.since, after: cursor.after, limit, count: count ? 1 : undefined })}`),

  calendar: (month: string, region?: string) => request<CalendarMonth>(`/v1/calendar/${month}${q({ region })}`),

  /** Which of these films open on another day in `region` than the one date the device holds. At most 200 ids. */
  releaseDates: (region: string, ids: string[]) =>
    request<{ region: string; dates: Record<string, string> }>('/v1/catalog/release-dates', json('POST', { region, ids })),

  searchGames: (query: string) => request<{ results: GameSearchResult[] }>(`/v1/search/games${q({ q: query })}`),

  // ── Sign-in ──
  /** The Trakt token is sent once so the Worker can ask Trakt whose it is. It is not stored there. */
  signInWithTrakt: (accessToken: string) => request<SignInResult>('/v1/auth/trakt', json('POST', { accessToken })),
  /** Signs out EVERY device: the Worker revokes all of the account's sessions. */
  logout: () => request<{ ok: boolean }>('/v1/auth/logout', { method: 'POST' }),

  // ── Your rows ──
  me: () => request<Profile>('/v1/me'),
  stateCounts: () => request<StateCounts>('/v1/me/state/counts'),
  stateItems: (after?: { mediaItemId: string; source: string; relation: string }) =>
    request<StatePage<ItemStateRow>>(
      `/v1/me/state/items${q({ afterItem: after?.mediaItemId, afterSource: after?.source, afterRelation: after?.relation })}`,
    ),
  stateEpisodes: (after?: { mediaItemId: string; season: number; episode: number }) =>
    request<StatePage<EpisodeStateRow>>(
      `/v1/me/state/episodes${q({ afterItem: after?.mediaItemId, afterSeason: after?.season, afterEpisode: after?.episode })}`,
    ),
  stateHidden: () => request<{ rows: { mediaItemId: string; hiddenAt: number }[] }>('/v1/me/state/hidden'),
  catalogPlatforms: (region: string) =>
    request<{ region: string; games: Record<string, string[]>; streaming: Record<string, string[]> }>(`/v1/catalog/platforms${q({ region })}`),
  taxonomy: () => request<TaxonomyJson>('/v1/taxonomy'),
  adminSaveScoring: (config: ScoringConfigValues) => request<TaxonomyJson>('/v1/admin/scoring', json('PUT', config)),
  adminSaveCategoryWeights: (updates: { id: string; weight: number; ignored: boolean }[]) =>
    request<TaxonomyJson>('/v1/admin/categories', json('PUT', { updates })),
  adminSaveCategory: (c: { id: string; label: string; color: string; weight: number; ignored: boolean }) =>
    request<TaxonomyJson>('/v1/admin/categories', json('POST', c)),
  adminDeleteCategory: (id: string) => request<TaxonomyJson>(`/v1/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminTagOverrides: (tagKeys: string[], categoryId: string) =>
    request<TaxonomyJson>('/v1/admin/tag-overrides', json('POST', { tagKeys, categoryId })),
  /** `tag` folds tags into one tag, `ip` folds franchises into one franchise. */
  adminAddAliases: (kind: 'tag' | 'ip', canonical: string, members: string[], displayLabel?: string) =>
    request<TaxonomyJson>(`/v1/admin/${kind}-aliases`, json('POST', { canonical, members, displayLabel })),
  adminDeleteAlias: (kind: 'tag' | 'ip', alias: string) =>
    request<TaxonomyJson>(`/v1/admin/${kind}-aliases${q({ alias })}`, { method: 'DELETE' }),
  adminDeleteBundle: (kind: 'tag' | 'ip', canonical: string) =>
    request<TaxonomyJson>(`/v1/admin/${kind}-aliases${q({ canonical })}`, { method: 'DELETE' }),
  adminSetLabel: (kind: 'tag' | 'ip', key: string, label: string) => request<TaxonomyJson>('/v1/admin/labels', json('POST', { kind, key, label })),
  adminClearLabel: (kind: 'tag' | 'ip', key: string) => request<TaxonomyJson>(`/v1/admin/labels${q({ kind, key })}`, { method: 'DELETE' }),
  /** Attach a title to a franchise by name, or overrule a provider that put it in one. */
  adminIpOverride: (o: { mediaItemId: string; mode: 'add' | 'remove'; label: string; ipKey?: string }) =>
    request<TaxonomyJson>('/v1/admin/ip-overrides', json('POST', o)),
  adminClearIpOverride: (mediaItemId: string, ipKey: string) =>
    request<TaxonomyJson>(`/v1/admin/ip-overrides${q({ mediaItemId, ipKey })}`, { method: 'DELETE' }),
  pageview: (path: string, ref: string) => request<{ ok: boolean }>('/v1/t/pv', { ...json('POST', { path, ref }), keepalive: true }),
  adminAnalytics: (days: number) => request<AnalyticsSnapshot>(`/v1/admin/analytics${q({ days })}`),
  adminUsers: (days: number) => request<UsersSnapshot>(`/v1/admin/users${q({ days })}`),
  showEpisodes: (id: string) => request<ShowEpisodes>(`/v1/shows/${id}/episodes`),
  savePrefs: (prefs: PrefsPatch) => request<Profile>('/v1/me/prefs', json('PUT', prefs)),
  exportAccount: () => request<Record<string, unknown>>('/v1/me/export'),
  deleteAccount: () => request<{ deleted: boolean }>('/v1/me', { method: 'DELETE' }),
  disconnect: (provider: string) =>
    request<{ ok: true; removedRows: number; token: string; user: SessionUser }>(`/v1/me/identities/${provider}`, { method: 'DELETE' }),

  /** Which of these provider ids the catalog holds. Never fetches. At most 2,000 refs. */
  lookup: (refs: ProviderRef[]) => request<LookupResult>('/v1/lookup', json('POST', { refs })),

  /**
   * Explicit upserts and explicit deletes, at most 2,000 rows. The Worker never
   * infers a delete, so what is sent here is the whole of what changes.
   */
  writeState: (write: StateWrite) => request<StateWriteResult>('/v1/me/state', json('PUT', write)),
};

export interface ProviderRef { source: string; type: string; id: string }
export interface LookupResult {
  found: (ProviderRef & { mediaItemId: string })[];
  missing: ProviderRef[];
}

export interface ItemStateKey { mediaItemId: string; source: string; relation: 'wishlist' | 'library' | 'ignored' }
export interface ItemStateUpsert extends ItemStateKey {
  status: string | null;
  rating: number | null;
  review: string | null;
  reviewedAt: number | null;
  /** Left out, the Worker keeps the row's own added date, or stamps now for a new row. */
  addedAt?: number | null;
}
export interface EpisodeStateKey { mediaItemId: string; season: number; episode: number }
export interface EpisodeStateUpsert extends EpisodeStateKey { watchedAt: number | null; sources: string[] }

export interface StateWrite {
  items?: { upsert?: ItemStateUpsert[]; delete?: ItemStateKey[] };
  episodes?: { upsert?: EpisodeStateUpsert[]; delete?: EpisodeStateKey[] };
  hidden?: { add?: string[]; remove?: string[] };
}
export interface StateWriteResult { ok: true; applied: Record<string, number>; skipped: number }


/** The episode catalog for one show. Empty lists for a show resolved after the seed. */
export interface ShowEpisodes {
  item: { id: string; type: string };
  seasons: { season: number; name: string | null; episodeCount: number; airDate: string | null }[];
  episodes: { season: number; episode: number; title: string | null; airDate: string | null; runtimeMinutes: number | null }[];
}

/** A field left out is left alone; null clears it. */
export interface PrefsPatch { country?: string | null; platforms?: string[] | null; mediaTypes?: string[] | null }

/** /v1/admin/users. The Worker's src/admin.ts is where each number is defined. */
export interface UsersSnapshot {
  days: number;
  totals: { users: number; library: number; wishlist: number; ignored: number; rated: number; meanRating: number | null };
  perUserAverages: { library: number; wishlist: number; rated: number };
  byType: { type: string; library: number; wishlist: number; rated: number }[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  providers: { provider: string; users: number }[];
  countries: { country: string; users: number }[];
  engagement: {
    active1: number; active7: number; active30: number; active90: number; activeInRange: number;
    neverSeen: number; stickiness: number | null;
  };
  collectionSizes: { bucket: string; users: number }[];
  signups: { day: string; count: number }[];
  writeActivity: { day: string; count: number }[];
  signedInPageviews: { day: string; count: number }[];
  users: { id: string; createdAt: number; lastSeenAt: number | null; library: number; wishlist: number; rated: number; providers: string[] }[];
  generatedAt: string;
}

/** /v1/admin/analytics. The Worker's src/telemetry.ts is where each number is defined. */
export interface AnalyticsSnapshot {
  gates: { pageviews30d: number; adsGate: number; adsPct: number; wau: number; freemiumGate: number; freemiumPct: number };
  series: { day: string; anon: number; authed: number; total: number }[];
  topPages: { pathKey: string; count: number }[];
  referrers: { refClass: string; count: number }[];
  users: { total: number; dau: number; wau: number; mau: number; activeInRange: number; signups: { day: string; count: number }[] };
  crawler: { blockedInRange: number; sharePct: number | null; busiestDay: { day: string; count: number } | null; since: string | null };
  excluded: { pageviews: number; throughDay: string; inRange: boolean };
  gap: { from: string; through: string } | null;
  days: number;
  generatedAt: string;
}
