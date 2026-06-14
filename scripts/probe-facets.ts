// Read-only probe: validates extractFacets (raw_data paths for people/companies)
// and analyzeLibraryFacets against the live DB. Run:
//   npx tsx --env-file=.env scripts/probe-facets.ts
import { query, get, initDb } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { extractFacets } from "@/lib/facets";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import { MediaLink, MediaType } from "@/types";

function loadLinks(mediaItemId: string): { type: MediaType; title: string; links: MediaLink[] } {
  const mi = get<{ type: MediaType; title: string }>(`SELECT type, title FROM media_items WHERE id = ?`, [mediaItemId])!;
  const rows = query<any>(`SELECT source, source_id, raw_data, release_date FROM media_links WHERE media_item_id = ?`, [mediaItemId]);
  const links: MediaLink[] = rows.map((r) => ({
    id: "", mediaItemId, source: r.source, sourceId: r.source_id, title: null,
    releaseDate: r.release_date, rawData: JSON.parse(r.raw_data ?? "{}"), lastSynced: 0,
  }));
  return { type: mi.type, title: mi.title, links };
}

function sampleId(type: MediaType, source: string): string | null {
  const r = get<{ id: string }>(
    `SELECT mi.id FROM media_items mi JOIN media_links ml ON ml.media_item_id = mi.id
     WHERE mi.type = ? AND ml.source = ? LIMIT 1`,
    [type, source]
  );
  return r?.id ?? null;
}

function probeItem(label: string, id: string | null) {
  if (!id) { console.log(`\n${label}: no sample found`); return; }
  const { type, title, links } = loadLinks(id);
  const merged = mergeLinks(links, type);
  const facets = extractFacets(links, type, merged);
  const byRole = (kind: string, role?: string) =>
    facets.filter((f) => f.kind === kind && (role ? f.role === role : true)).map((f) => f.label);
  console.log(`\n══ ${label}: ${title} (${type}) — sources: ${links.map((l) => l.source).join(",")}`);
  console.log("  directors:", byRole("person", "director").join(", ") || "—");
  console.log("  creators: ", byRole("person", "creator").join(", ") || "—");
  console.log("  writers:  ", byRole("person", "writer").slice(0, 6).join(", ") || "—");
  console.log("  cast:     ", byRole("person", "cast").slice(0, 6).join(", ") || "—");
  console.log("  devs:     ", byRole("company", "developer").join(", ") || "—");
  console.log("  pubs:     ", byRole("company", "publisher").join(", ") || "—");
  console.log("  studios:  ", byRole("company", "studio").join(", ") || "—");
  console.log("  networks: ", byRole("company", "network").join(", ") || "—");
  console.log("  tags:     ", byRole("tag").slice(0, 10).join(", ") || "—");
}

function main() {
  initDb();
  console.log("=== extractFacets spot-checks ===");
  probeItem("MOVIE", sampleId("movie", "tmdb"));
  probeItem("SHOW", sampleId("show", "tmdb"));
  probeItem("GAME(steam)", sampleId("game", "steam"));
  probeItem("GAME(rawg)", sampleId("game", "rawg"));

  console.log("\n=== analyzeLibraryFacets ===");
  const user = get<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  if (!user) { console.log("no users"); return; }
  const a = getLibraryFacetAnalysis(user.id);
  console.log(`ratedItemCount=${a.ratedItemCount} libraryItems=${a.libraryItemCount} baseline=${a.baseline.toFixed(2)}`);
  console.log("byType:", JSON.stringify(a.byType), "byStatus:", JSON.stringify(a.byStatus));
  const counts: Record<string, number> = {};
  for (const f of a.facets) { const k = `${f.kind}:${f.role ?? "-"}`; counts[k] = (counts[k] ?? 0) + 1; }
  console.log("unique facets by kind/role:", JSON.stringify(counts));
  console.log("\nTop 12 facets by avg (min count 4):");
  for (const f of a.facets.filter((x) => x.count >= 4).slice(0, 12))
    console.log(`  ${f.avg.toFixed(1)} ×${f.count}  ${f.kind}/${f.role ?? "-"}  ${f.label}`);
  console.log("\nBottom 6 facets by avg (min count 4):");
  for (const f of a.facets.filter((x) => x.count >= 4).slice(-6))
    console.log(`  ${f.avg.toFixed(1)} ×${f.count}  ${f.kind}/${f.role ?? "-"}  ${f.label}`);
}

main();
