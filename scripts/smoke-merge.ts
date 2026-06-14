// Live end-to-end merge smoke test: fetch real payloads through the actual
// metadata providers, run them through the real mergeLinks, and print the
// fields the detail page renders. Source modules read their API keys at
// module-load time, so env MUST be loaded before these imports — run with:
//   npx tsx --env-file=.env scripts/smoke-merge.ts
import { mergeLinks } from "@/lib/merge";
import { METADATA } from "@/lib/metadata/registry";
import { MediaLink, MediaType, Source } from "@/types";

async function buildLinks(type: MediaType, ids: Partial<Record<Source, string>>): Promise<MediaLink[]> {
  const links: MediaLink[] = [];
  for (const [source, id] of Object.entries(ids)) {
    const provider = METADATA[source as Source];
    if (!provider?.fetchById) continue;
    try {
      const link = await provider.fetchById(id, type);
      if (link) {
        links.push({ id: `live-${source}`, mediaItemId: "x", source: source as Source, sourceId: link.sourceId, title: link.title, releaseDate: link.releaseDate, rawData: link.rawData, lastSynced: 0 });
        console.log(`  ✓ ${source} fetched (${JSON.stringify(link.rawData).length} bytes)`);
      } else console.log(`  ✗ ${source} returned null`);
    } catch (e: any) { console.log(`  ✗ ${source} error: ${e.message}`); }
  }
  return links;
}

function report(label: string, m: ReturnType<typeof mergeLinks>) {
  console.log(`\n══════ ${label} ══════`);
  console.log("title:        ", m.title);
  console.log("tagline:      ", m.tagline);
  console.log("releaseDate:  ", m.releaseDate, "| dates:", m.dates.map((d) => `${d.source}:${d.date}`).join(" "));
  console.log("runtime:      ", m.runtimeMinutes, "| certification:", m.certification, "| status:", m.status);
  console.log("collection:   ", m.collection, "| lang:", m.originalLanguage, "| country:", m.country);
  console.log("network:      ", m.network, "| seasons:", m.seasonCount, "| episodes:", m.episodeCount);
  console.log("nextEpisode:  ", JSON.stringify(m.nextEpisode));
  console.log("budget/rev:   ", m.budget, "/", m.revenue);
  console.log("playtime:     ", m.playtimeHours, "| timeToBeat:", JSON.stringify(m.timeToBeat));
  console.log("storeLinks:   ", m.storeLinks.map((l) => l.name).join(", "));
  console.log("director:     ", m.director, "| dev:", m.developer, "| pub:", m.publisher);
  console.log("gameModes:    ", m.gameModes.join(", ") || "—");
  console.log("dlc:          ", m.dlc.join(", ") || "—");
  console.log("community:    ", m.communityRatings.map((r) => `${r.label} ${r.score}/${r.outOf}${r.votes ? `(${r.votes})` : ""}`).join("  ") || "—");
  console.log("tags:         ", m.tags.slice(0, 10).join(", "));
  console.log("images:       ", m.images.length, "| trailer:", m.trailerYoutubeKey ?? m.steamTrailerUrl ?? "—");
  console.log("storeLinks:   ", m.storeLinks.map((l) => l.name).join(", "));
  console.log("streaming:    ", m.streamingProviders.map((p) => p.name).join(", ") || "—");
  console.log("imdbId:       ", m.imdbId);
}

async function main() {
  // Dune: Part Two — tmdb 693134, trakt 537449
  console.log("Fetching MOVIE (Dune: Part Two)…");
  const movieLinks = await buildLinks("movie", { tmdb: "693134", trakt: "537449" });
  report("MOVIE", mergeLinks(movieLinks, "movie"));

  // Breaking Bad — tmdb 1396, trakt 1388
  console.log("\nFetching SHOW (Breaking Bad)…");
  const showLinks = await buildLinks("show", { tmdb: "1396", trakt: "1388" });
  report("SHOW", mergeLinks(showLinks, "show"));

  // Elden Ring — rawg 326243, steam 1245620, igdb base game 119133
  console.log("\nFetching GAME (Elden Ring)…");
  const gameLinks = await buildLinks("game", { rawg: "326243", steam: "1245620", igdb: "119133" });
  report("GAME", mergeLinks(gameLinks, "game"));
}

main();
