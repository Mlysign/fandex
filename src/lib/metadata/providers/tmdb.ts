import { MetadataProvider, MetaLink } from "../types";
import { getTmdbMovie, getTmdbShow, searchTmdbMovie, searchTmdbShow } from "@/lib/sources/tmdb";

function movieLink(data: any): MetaLink {
  return { source: "tmdb", sourceId: String(data.id), title: data.title, releaseDate: data.release_date ?? null, rawData: data };
}
function showLink(data: any): MetaLink {
  return { source: "tmdb", sourceId: String(data.id), title: data.name, releaseDate: data.first_air_date ?? null, rawData: data };
}

// TMDB — the canonical metadata catalog for movies & shows. `primary` so it's
// never title-searched during cross-enrichment (it's always resolved by id).
export const tmdbMetadata: MetadataProvider = {
  id: "tmdb",
  mediaTypes: ["movie", "show"],
  primary: true,

  async fetchById(sourceId, type) {
    const data = type === "movie" ? await getTmdbMovie(Number(sourceId)) : await getTmdbShow(Number(sourceId));
    if (!data) return null;
    return type === "movie" ? movieLink(data) : showLink(data);
  },

  async searchByTitle(title, type, opts) {
    // Search returns a bare list result (no credits/keywords), so resolve the id
    // then fetch the FULL detail — otherwise a title matched by name (a Trakt item
    // with no tmdb id) would be stored without director/cast and vanish from the
    // Insights people/studio facets. Mirrors fetchById once the id is known.
    const hit = type === "movie"
      ? await searchTmdbMovie(title, opts?.year ?? undefined)
      : await searchTmdbShow(title);
    if (!hit?.id) return null;
    const data = type === "movie" ? await getTmdbMovie(hit.id) : await getTmdbShow(hit.id);
    if (!data) return null;
    return type === "movie" ? movieLink(data) : showLink(data);
  },
};
