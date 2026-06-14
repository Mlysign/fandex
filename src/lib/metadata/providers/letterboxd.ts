import { MetadataProvider, MetaLink } from "../types";
import { getLetterboxdFilm, searchLetterboxdFilms, posterFromFilm, releaseDateFromFilm } from "@/lib/sources/letterboxd";
import { normalizeName } from "@/lib/merge";

function link(film: any): MetaLink {
  return {
    source: "letterboxd",
    sourceId: film.id,
    title: film.name,
    releaseDate: releaseDateFromFilm(film),
    rawData: { ...film, posterUrl: posterFromFilm(film) },
  };
}

export const letterboxdMetadata: MetadataProvider = {
  id: "letterboxd",
  mediaTypes: ["movie"],

  async fetchById(sourceId) {
    const film = await getLetterboxdFilm(sourceId);
    return film ? link(film) : null;
  },

  // Match by exact normalized name, else the first result; then fetch the full film.
  async searchByTitle(title) {
    const films = await searchLetterboxdFilms(title);
    const norm = normalizeName(title);
    const match = films.find((f) => normalizeName(f.name) === norm) ?? films[0];
    if (!match) return null;
    let full = match;
    try { full = await getLetterboxdFilm(match.id); } catch { /* use the search result */ }
    return link(full);
  },
};
