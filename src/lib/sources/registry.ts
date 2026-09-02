import type { MediaType, Source } from "@/types";
import type { MediaSource } from "./types";
import { HIDDEN_PROVIDERS } from "./catalog";
import { rawgSource } from "./adapters/rawg";
import { traktSource } from "./adapters/trakt";
import { letterboxdSource } from "./adapters/letterboxd";
import { steamSource } from "./adapters/steam";
import { tmdbSource } from "./adapters/tmdb";

// The single registry every consumer derives from. All four connectable
// platforms are registered; their capabilities + auth + write paths are driven
// through this map instead of per-provider `if` branches. (Bulk pull/enrichment
// sync is still migrating — see each adapter's NOTE.)
// ⚠️ RAWG was REMOVED here on 2026-09-02 (Nils's call), not hidden. Being absent
// from this map is what actually stops the library pull; `HIDDEN_PROVIDERS` only
// hides UI, and `sync/index.ts` reads `SOURCES` directly.
//
// Its adapter file stays on disk so the decision is reversible, and `rawg`
// remains a legal `Source` so the 603 stored links keep resolving.
//
// ⚠️ **No purge script, deliberately.** Measured on prod before removing:
// 2,801 games, of which 2,198 never had a RAWG link and 587 have RAWG plus
// another source — but **16 are RAWG-only, and all 16 are in the user's own
// library**. Dropping the links (the way `purge-igdb.mjs` does, where none of
// the 100 orphans were acted on) would strand every one of them. Retiring the
// provider costs nothing; deleting its rows is a separate decision with a real
// price, and nobody has asked for it.
//
// ⚠️ Removing a provider from this map REQUIRES adding it to
// `IDENTITY_ONLY_PROVIDERS` in the same change, or every existing identity for
// it reads as "never synced, therefore overdue" forever and fires a doomed
// POST /api/sync on every /library load. Same trap google hit.
export const SOURCES: Partial<Record<Source, MediaSource>> = {
  trakt: traktSource,
  letterboxd: letterboxdSource,
  steam: steamSource,
  tmdb: tmdbSource,
};

export function getSource(id: Source | string): MediaSource | undefined {
  return SOURCES[id as Source];
}

// All registered sources that handle a given media type — the single source of
// truth for "which platforms can hold a wishlist for a movie/show/game".
export function sourcesForType(type: MediaType | string): MediaSource[] {
  return Object.values(SOURCES).filter(
    (s): s is MediaSource => !!s && s.mediaTypes.includes(type as MediaType) && !HIDDEN_PROVIDERS.has(s.id)
  );
}
