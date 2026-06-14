import { MetadataProvider, MetaLink } from "../types";
import { searchSteamByName, getSteamAppDetails, getSteamTagMap, resolveTagNames, extractSteamDate } from "@/lib/sources/steam";

async function toLink(appid: number, data: any): Promise<MetaLink> {
  const tagMap = await getSteamTagMap();
  if (data.tagids) data.resolvedTags = resolveTagNames(data.tagids, tagMap);
  return {
    source: "steam",
    sourceId: String(appid),
    title: data.name ?? `App ${appid}`,
    releaseDate: extractSteamDate(data),
    rawData: { ...data, appid },
  };
}

export const steamMetadata: MetadataProvider = {
  id: "steam",
  mediaTypes: ["game"],

  async fetchById(sourceId) {
    const appid = Number(sourceId);
    const details = await getSteamAppDetails([appid]);
    const data = details[appid];
    return data ? toLink(appid, data) : null;
  },

  async searchByTitle(title) {
    const found = await searchSteamByName(title);
    return found ? toLink(found.appid, found.data) : null;
  },
};
