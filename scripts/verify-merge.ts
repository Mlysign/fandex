import Database from "better-sqlite3";
import { mergeLinks } from "@/lib/merge";
import { MediaLink, Source, MediaType } from "@/types";

const db = new Database("data/rr.db", { readonly: true });

function loadLinks(mediaItemId: string): MediaLink[] {
  const rows = db.prepare("SELECT * FROM media_links WHERE media_item_id = ?").all(mediaItemId) as any[];
  return rows.map((r) => ({
    id: r.id, mediaItemId: r.media_item_id, source: r.source as Source, sourceId: r.source_id,
    title: r.title, releaseDate: r.release_date, rawData: JSON.parse(r.raw_data), lastSynced: r.last_synced,
  }));
}

// Which source produced a given merged value? (for attribution)
function whoHas(links: MediaLink[], pred: (rawData: any) => any): string[] {
  return links.filter((l) => { const v = pred(l.rawData); return v != null && v !== "" && !(Array.isArray(v) && v.length === 0); }).map((l) => l.source);
}

function report(label: string, links: MediaLink[], type: MediaType) {
  const merged = mergeLinks(links, type);
  console.log(`\n========== ${label} (${links.map((l) => l.source).join(" + ")}) ==========`);
  console.log("title:        ", JSON.stringify(merged.title));
  console.log("releaseDate:  ", merged.releaseDate, "| per-source dates:", JSON.stringify(merged.dates));
  console.log("description:  ", (merged.description ?? "").slice(0, 70), `… [${merged.description?.length ?? 0} chars]`);
  console.log("posterUrl:    ", merged.posterUrl);
  console.log("developer:    ", merged.developer, "| publisher:", merged.publisher);
  console.log("director:     ", merged.director, "| cast:", (merged.cast ?? []).slice(0, 3).map((c) => c.name).join(", "));
  console.log("tags:         ", (merged.tags ?? []).slice(0, 8).join(", "));
  console.log("platforms:    ", (merged.platforms ?? []).join(", "));
  console.log("images:       ", (merged.images ?? []).length, "imgs");
  console.log("store links:  ", (merged.storeLinks ?? []).map((l) => l.name).join(", "));
  console.log("streaming:    ", (merged.streamingProviders ?? []).map((p) => p.name).join(", ") || "(none)");
  console.log("sources merged:", merged.sources.map((s) => s.source).join(", "));
}

// ── 1) TMDB + Trakt (real data) ───────────────────────────────────────────────
const movieId = process.argv[2];
if (movieId) {
  const links = loadLinks(movieId);
  report("MOVIE", links, "movie");
}

// ── 2) RAWG + synthetic IGDB ──────────────────────────────────────────────────
const gameId = process.argv[3];
if (gameId) {
  const realLinks = loadLinks(gameId).filter((l) => l.source === "rawg" || l.source === "steam");
  const igdbLink: MediaLink = {
    id: "synthetic-igdb", mediaItemId: gameId, source: "igdb", sourceId: "999999",
    title: "ILL", releaseDate: null, lastSynced: 0,
    rawData: {
      id: 999999, name: "ILL",
      summary: "A first-person survival horror experience set in a grotesque, body-horror world where flesh and machinery fuse — this IGDB summary is long enough to win the description pick when RAWG's is short.",
      first_release_date: 1893456000, // 2030-01-01 (deliberately distinct from RAWG's date)
      url: "https://www.igdb.com/games/ill",
      cover: { image_id: "co_ill_cover" },
      screenshots: [{ image_id: "sc_ill_1" }, { image_id: "sc_ill_2" }],
      genres: [{ name: "Horror" }, { name: "Shooter" }],
      platforms: [{ name: "PlayStation 5" }, { name: "PC (Microsoft Windows)" }],
      involved_companies: [
        { developer: true, publisher: false, company: { name: "Team Clout (IGDB-dev)" } },
        { developer: false, publisher: true, company: { name: "Mol Studio (IGDB-pub)" } },
      ],
    },
  };
  console.log("\nRAWG raw fields present:",
    "released=", whoHas(realLinks, (d) => d.released).length > 0,
    "developers=", JSON.stringify(realLinks.find((l) => l.source === "rawg")?.rawData?.developers?.map((x: any) => x.name) ?? "none"));
  report("GAME", [...realLinks, igdbLink], "game");
  console.log("\n-> IGDB-attributed signals to confirm:");
  const merged = mergeLinks([...realLinks, igdbLink], "game");
  console.log("   igdb date present in dates[]:", merged.dates.some((d) => d.source === "igdb"));
  console.log("   IGDB store link present:     ", merged.storeLinks.some((l) => l.name === "IGDB"));
  console.log("   igdb in merged sources:      ", merged.sources.some((s) => s.source === "igdb"));
  console.log("   PS5 platform (igdb-only):    ", (merged.platforms ?? []).includes("PlayStation 5"));
}

db.close();
