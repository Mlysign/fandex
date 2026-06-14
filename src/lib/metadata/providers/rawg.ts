import { MetadataProvider, MetaLink } from "../types";
import { getRawgGame, searchRawg } from "@/lib/sources/rawg";
import { normalizeName } from "@/lib/merge";

function link(data: any): MetaLink {
  return { source: "rawg", sourceId: String(data.id), title: data.name, releaseDate: data.released ?? null, rawData: data };
}

export const rawgMetadata: MetadataProvider = {
  id: "rawg",
  mediaTypes: ["game"],

  async fetchById(sourceId) {
    const data = await getRawgGame(Number(sourceId));
    return data ? link(data) : null;
  },

  // Match by exact normalized name, then fetch the full game.
  async searchByTitle(title) {
    const results = await searchRawg(title);
    const norm = normalizeName(title);
    const exact = results.results?.find((r: any) => normalizeName(r.name) === norm);
    if (!exact) return null;
    const full = await getRawgGame(exact.id);
    return link(full);
  },
};
