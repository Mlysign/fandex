import { MediaType } from "@/types";
import { MetadataProvider, MetaLink } from "../types";
import { getTraktMovieSummary, getTraktShowSummary, searchTraktPublic, traktConfigured } from "@/lib/sources/trakt";
import { normalizeName } from "@/lib/merge";

function link(data: any): MetaLink {
  return {
    source: "trakt",
    sourceId: String(data.ids?.trakt ?? ""),
    title: data.title,
    releaseDate: data.released ?? data.first_aired?.split("T")[0] ?? null,
    rawData: data,
  };
}

// Trakt as a metadata catalog — its public summary/search endpoints need only
// the client id (no user token), and extended=full carries runtime,
// certification, community rating + votes, tagline, status, network and
// trailer that no other movie/show source provides in one place.
export const traktMetadata: MetadataProvider = {
  id: "trakt",
  mediaTypes: ["movie", "show"],
  configured: traktConfigured,

  async fetchById(sourceId, type) {
    const data = type === "movie" ? await getTraktMovieSummary(sourceId) : await getTraktShowSummary(sourceId);
    return data?.ids?.trakt ? link(data) : null;
  },

  async searchByTitle(title, type: MediaType) {
    const results = await searchTraktPublic(title, type === "movie" ? "movie" : "show");
    const norm = normalizeName(title);
    const items = results.map((r) => r.movie ?? r.show).filter(Boolean);
    const match = items.find((m) => normalizeName(m.title ?? "") === norm) ?? items[0];
    return match?.ids?.trakt ? link(match) : null;
  },
};
