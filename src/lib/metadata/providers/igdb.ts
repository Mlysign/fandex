import { MetadataProvider, MetaLink } from "../types";
import { getIgdbGame, searchIgdbGames, igdbReleaseDate, igdbConfigured } from "@/lib/sources/igdb";
import { normalizeName, extractYear } from "@/lib/merge";

function link(game: any): MetaLink {
  return { source: "igdb", sourceId: String(game.id), title: game.name, releaseDate: igdbReleaseDate(game), rawData: game };
}

// IGDB game_type enum — derived/non-canonical kinds we should avoid matching
// when a base game is available (8 remake, 9 remaster, 11 port, 3 bundle).
const DERIVED_GAME_TYPES = new Set([3, 8, 9, 11]);

// Several IGDB entries can share a title — the original plus ports, remasters,
// editions and bundles (e.g. "BioShock" exists as the 2007 main game AND as
// 2008/2010/2014 ports, all named exactly "BioShock"). Plain title equality
// picks whichever IGDB ranks first, which is often a port. Score candidates so
// the canonical base game wins: exact title, then base-game signals (no
// parent_game/version_parent, game_type=main), then proximity to the known
// release year.
function scoreCandidate(game: any, normTitle: string, year: number | null): number {
  let score = 0;
  if (normalizeName(game.name ?? "") === normTitle) score += 100;

  // Canonical base game has no parent and isn't a derived edition.
  if (game.parent_game == null && game.version_parent == null) score += 50;
  if (game.game_type === 0) score += 30;
  else if (DERIVED_GAME_TYPES.has(game.game_type)) score -= 25;

  // Year proximity — the original is the closest to the date our other sources
  // (RAWG/Steam) report; ports/remasters are years later.
  if (year != null) {
    const gy = extractYear(igdbReleaseDate(game));
    if (gy != null) score += gy === year ? 40 : -Math.min(Math.abs(gy - year), 15);
  }
  return score;
}

// IGDB is a metadata-only catalog (no per-user data via its API). It contributes
// rich game metadata — especially per-region upcoming release dates. No-ops when
// Twitch credentials aren't configured.
export const igdbMetadata: MetadataProvider = {
  id: "igdb",
  mediaTypes: ["game"],
  configured: igdbConfigured,

  async fetchById(sourceId) {
    if (!igdbConfigured()) return null;
    const game = await getIgdbGame(Number(sourceId));
    return game ? link(game) : null;
  },

  async searchByTitle(title, _type, opts) {
    if (!igdbConfigured()) return null;
    const games = await searchIgdbGames(title);
    if (!games.length) return null;
    const norm = normalizeName(title);
    const year = opts?.year ?? null;
    // Highest-scoring candidate (canonical base game preferred over ports/etc).
    const match = games.reduce((best, g) =>
      scoreCandidate(g, norm, year) > scoreCandidate(best, norm, year) ? g : best
    );
    // Re-fetch by id so the stored payload includes time_to_beat.
    const full = await getIgdbGame(match.id).catch(() => null);
    return link(full ?? match);
  },
};
