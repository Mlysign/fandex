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
    if (type === "movie") {
      const data = await searchTmdbMovie(title, opts?.year ?? undefined);
      return data ? movieLink(data) : null;
    }
    const data = await searchTmdbShow(title);
    return data ? showLink(data) : null;
  },
};
