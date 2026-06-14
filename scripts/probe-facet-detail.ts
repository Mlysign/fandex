// Read-only probe of the facet detail pipeline (catalog lookup + person bio +
// you-vs-crowd stats). Run: npx tsx --env-file=.env scripts/probe-facet-detail.ts
import { get, initDb } from "@/lib/db";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetStat } from "@/lib/libraryAnalysis";

async function show(userId: string, f: FacetStat) {
  const d = await buildFacetDetail(userId, { kind: f.kind, role: f.role, key: f.key, label: f.label });
  const s = d.stats;
  console.log(`\n══ ${f.label} (${f.kind}/${f.role ?? "-"})`);
  console.log(`  you=${s.userAvg} over ${s.userCount} · crowd=${s.communityAvg} · delta=${s.delta} · baseline=${s.baseline} · catalog=${s.totalCount} (crowd-all=${s.catalogCommunityAvg})`);
  if (d.person) {
    console.log(`  BIO: ${d.person.name}, age ${d.person.age}, ${d.person.knownForDepartment}, born ${d.person.birthday} in ${d.person.placeOfBirth}`);
    console.log(`       ${(d.person.biography ?? "").slice(0, 110)}…`);
  } else if (f.kind === "person") {
    console.log("  BIO: (none resolved)");
  }
  console.log("  top titles:");
  for (const it of d.items.slice(0, 5)) console.log(`    ${it.rating != null ? it.rating.toFixed(1) : " · "}  comm=${it.communityScore ?? "-"}  ${it.libraryStatus ?? "unseen"}  ${it.title}`);
}

async function main() {
  initDb();
  const user = get<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  if (!user) { console.log("no users"); return; }
  const a = getLibraryFacetAnalysis(user.id);

  const pick = (kind: string, role?: string) =>
    a.facets.filter((f) => f.kind === kind && (!role || f.role === role) && f.count >= 3).sort((x, y) => y.count - x.count)[0];

  const cast = pick("person", "cast");
  const director = pick("person", "director");
  const tag = pick("tag");
  const studio = pick("company", "studio");
  const dev = pick("company", "developer") ?? pick("company", "publisher");

  for (const f of [cast, director, tag, studio, dev]) if (f) await show(user.id, f);
}

main();
