// S8 — request-body schemas for the API routes. Each route parses its body with
// `parseJsonBody(req, <Schema>)` (see validate.ts); unknown keys are stripped,
// wrong types 400 instead of blowing up deeper as a 500/type-confusion.
//
// Schemas mirror the hand-written body types they replace — kept intentionally
// lenient where the routes were lenient (all-optional DELETE/refine bodies), and
// only tightened where a bad value is a real footgun (rating range, enums).

import { z } from "zod";

// ── Shared primitives (single source of truth for the domain enums) ──────────
export const zMediaType = z.enum(["game", "movie", "show"]);
export const zSource = z.enum(["steam", "rawg", "tmdb", "trakt", "igdb", "letterboxd"]);
// Anything that can mint a session, which is every Source plus the identity-only
// providers. Mirrors the `AuthProvider` type; see src/types/index.ts for why the
// two enums stay separate.
export const zAuthProvider = z.enum([...zSource.options, "google", "discord"]);
export const zFacetRole = z.enum([
  "director", "writer", "creator", "cast",       // PersonRole
  "developer", "publisher", "studio", "network", // CompanyRole
]);
export const zSortKey = z.enum(["releaseDate", "popularity", "rating", "fandexScore"]);

// Cross-source id map, e.g. { tmdb: 603, trakt: "the-matrix" }. Flat, string keys.
export const zIds = z.record(z.string(), z.union([z.string(), z.number()]).nullable());

const zFacetRef = z.object({
  kind: z.string(),
  role: zFacetRole.optional(),
  key: z.string(),
  label: z.string().optional(),
});

const zMembership = z.object({
  library: z.enum(["include", "exclude", "only"]).optional(),
  wishlist: z.enum(["include", "exclude", "only"]).optional(),
  // A2 (H1.6c): "Already-rated" — filter by whether the user has a personal
  // rating on the item (rating != null), distinct from being in-library.
  rated: z.enum(["include", "exclude", "only"]).optional(),
});

const zFacetKey = z.object({ kind: z.string(), role: zFacetRole.optional(), key: z.string() });

export const zDiscoverFilters = z.object({
  types: z.array(zMediaType).optional(),
  yearMin: z.number().optional(),
  yearMax: z.number().optional(),
  communityMin: z.number().optional(),
  communityMax: z.number().optional(),
  runtimeMin: z.number().optional(),
  runtimeMax: z.number().optional(),
  sources: z.array(z.string()).optional(),
  membership: zMembership.optional(),
  includeFacets: z.array(zFacetKey).optional(),
  excludeFacets: z.array(zFacetKey).optional(),
});

export const zDiscoverRefine = z.object({
  seeds: z.array(z.string()).optional(),
  negSeeds: z.array(z.string()).optional(),
  likes: z.array(zFacetRef).optional(),
  dislikes: z.array(zFacetRef).optional(),
});

// ── Route body schemas ───────────────────────────────────────────────────────

// POST /api/watchlist — add to wishlist (+ platform write-back).
export const WatchlistPostSchema = z.object({
  type: zMediaType,
  ids: zIds,
  title: z.string().nullish(),
  releaseDate: z.string().nullish(),
  posterUrl: z.string().nullish(),
  targetProvider: zSource.optional(),
});

// DELETE /api/watchlist — remove from wishlist. Tolerant: resolves the item from
// mediaItemId or ids; an empty body is a no-op (allowEmpty at the call site).
export const WatchlistDeleteSchema = z.object({
  source: zSource.optional(),
  mediaItemId: z.string().optional(),
  ids: zIds.optional(),
});

// POST /api/library — rate and/or mark watched/played.
export const LibraryPostSchema = z.object({
  mediaItemId: z.string().optional(),
  rating: z.number().min(0).max(10).nullish(),
  status: z.string().nullish(),
  type: zMediaType.optional(),
  title: z.string().nullish(),
  releaseDate: z.string().nullish(),
  posterUrl: z.string().nullish(),
  ids: zIds.optional(),
});

// DELETE /api/library — clear rating/status. Tolerant like the watchlist DELETE.
export const LibraryDeleteSchema = z.object({
  mediaItemId: z.string().optional(),
  ids: zIds.optional(),
});

// POST / DELETE /api/hidden — "stop showing me this" (2026-09-03). Same tolerant
// identity shape as the two DELETEs above: a card may not carry the local uuid.
export const HiddenPostSchema = z.object({
  mediaItemId: z.string().optional(),
  ids: zIds.optional(),
});

// POST /api/episodes — mark/un-mark watched episodes of one show (MB14).
// Two shapes, one schema: an explicit `episodes` list, or a bare `season` meaning
// "the whole season" (resolved server-side from the catalog, so the client never
// has to enumerate 24 episodes just to tick a season header). `episodes` wins
// when both are sent.
export const EpisodesPostSchema = z.object({
  mediaItemId: z.string().min(1),
  watched: z.boolean(),
  season: z.number().int().min(0).optional(),
  episodes: z
    .array(z.object({ season: z.number().int().min(0), episode: z.number().int().min(0) }))
    .max(500)
    .optional(),
});

// POST /api/sync — trigger a provider sync. Missing body defaults to "all".
// `provider` starts a fresh run (a source id or "all"); `providers` is P6's
// resume list — the remaining provider ids the client re-invokes with.
export const SyncPostSchema = z.object({
  provider: z.union([zSource, z.literal("all")]).optional(),
  providers: z.array(z.string()).optional(),
});

// POST /api/settings — profile settings (currently just country).
// Both fields are OPTIONAL and the route acts on whichever arrived: the country
// select and the platforms picker save independently, and requiring both would
// make either save clobber the other with a stale value from the same render.
export const SettingsPostSchema = z.object({
  country: z.string().min(1).optional(),
  platforms: z.array(z.string()).optional(),
  mediaTypes: z.array(z.string()).optional(),
});

// DELETE /api/account — H4.6 erasure. The literal is the type-to-confirm value
// from the dialog; requiring it server-side means an accidental or forged
// DELETE with an empty body 400s instead of erasing an account.
export const AccountDeleteSchema = z.object({
  confirm: z.literal("DELETE"),
});

// POST /api/auth/disconnect — remove a connected identity.
//
// zAuthProvider, not zSource: this acts on user_identities, which can hold an
// identity-only provider (Google) that is not a media source. Using zSource
// here would 400 a Google disconnect. The /api/sync target above keeps zSource
// deliberately — google must never be a sync target. → src/types/index.ts
export const DisconnectPostSchema = z.object({
  provider: zAuthProvider,
});

// POST /api/auth/rawg — RAWG email/password login.
export const RawgLoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/discover/find — Taste Match query. Fully optional (lenient default).
export const FindSchema = z.object({
  q: z.string().optional(),
  refine: zDiscoverRefine.optional(),
  filters: zDiscoverFilters.optional(),
  sort: zSortKey.optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  excludeIgnored: z.boolean().optional(),
});

// POST /api/discover/fetch-more — grow the local catalog from top tags.
export const FetchMoreSchema = z.object({
  refine: zDiscoverRefine.optional(),
});

// POST /api/discover/facet-fetch — pull a facet's external set for search.
// `label` is required by FacetRefIn (used downstream), so default it to "".
export const FacetFetchSchema = z.object({
  facets: z
    .array(z.object({
      kind: z.string(),
      role: zFacetRole.optional(),
      key: z.string(),
      label: z.string().default(""),
    }))
    .optional(),
  types: z.array(zMediaType).optional(),
  membership: zMembership.optional(),
});

// ── H5.4 /dev/scoring (admin-only) ────────────────────────────────────────
const zRoleWeights = z.record(z.string(), z.number());

// PUT /api/dev/scoring — save role weights + C/K/top-N selection counts.
export const ScoringConfigPutSchema = z.object({
  roleWeights: zRoleWeights,
  priorStrength: z.number().positive(),
  mappingConstantUp: z.number().positive(),
  mappingConstantDown: z.number().positive(),
  topTagsPositive: z.number().int().min(0),
  topTagsNegative: z.number().int().min(0),
  topPeople: z.number().int().min(0),
  topCompanies: z.number().int().min(0),
  topIps: z.number().int().min(0),
});

// POST /api/dev/scoring/categories — create/edit one tag_category row.
export const TagCategoryPostSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "id must be lowercase-kebab"),
  label: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex value"),
  weight: z.number().min(0),
  ignored: z.boolean(),
});

// PUT /api/dev/scoring/categories — batch weight/ignored save (the Weights
// panel's "Save weights" button; label/color/id are untouched).
export const TagCategoryWeightsPutSchema = z.object({
  updates: z.array(z.object({ id: z.string(), weight: z.number().min(0), ignored: z.boolean() })),
});

// POST /api/dev/scoring/overrides — reassign one tag key to a category.
export const TagCategoryOverridePostSchema = z.object({
  tagKey: z.string().min(1),
  categoryId: z.string().min(1),
});

// POST /api/dev/scoring/preview — score a sample item with draft weights.
export const ScoringPreviewSchema = z.object({
  config: ScoringConfigPutSchema,
  categoryWeights: z.array(z.object({ id: z.string(), weight: z.number().min(0), ignored: z.boolean() })),
  itemId: z.string().optional(),
});

// POST /api/dev/scoring/franchises — one franchise correction per call.
// A discriminated union so each action carries exactly the fields it needs and
// no others: `attach` takes a free-text label (normalized through ipKey on the
// way in), while `detach`/`clear` address an EXISTING facet by its key.
export const FranchiseActionSchema = z.discriminatedUnion("action", [
  // `displayLabel` (2026-09-03) rides along with the bundle so the name is chosen
  // in the same click that folds the two franchises together.
  z.object({ action: z.literal("bundle"), alias: z.string().min(1), canonical: z.string().min(1), displayLabel: z.string().min(1).max(200).optional() }),
  z.object({ action: z.literal("unbundle"), alias: z.string().min(1) }),
  z.object({ action: z.literal("dissolve"), canonical: z.string().min(1) }),
  z.object({ action: z.literal("attach"), mediaItemId: z.string().min(1), label: z.string().min(1).max(200) }),
  z.object({ action: z.literal("detach"), mediaItemId: z.string().min(1), ipKey: z.string().min(1), label: z.string().max(200).optional() }),
  z.object({ action: z.literal("clear"), mediaItemId: z.string().min(1), ipKey: z.string().min(1) }),
]);

// POST /api/dev/scoring/aliases — bundle member tag spellings under one canonical.
//
// `displayLabel` (2026-09-03) rides along with the bundle rather than needing a
// second request, so choosing a name is part of the same click that folds the
// tags. Optional: an omitted one leaves whatever name the facet already shows.
export const TagAliasPostSchema = z.object({
  canonical: z.string().min(1),
  members: z.array(z.string().min(1)).min(1),
  displayLabel: z.string().min(1).max(200).optional(),
});

// POST /api/dev/scoring/labels — which spelling of a facet people see.
export const FacetLabelPostSchema = z.object({
  kind: z.enum(["tag", "ip"]),
  key: z.string().min(1),
  label: z.string().min(1).max(200),
});
