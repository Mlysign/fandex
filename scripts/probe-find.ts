// Read-only probe of the Taste Match engine. Run:
//   npx tsx --env-file=.env scripts/probe-find.ts
import { get, initDb } from "@/lib/db";
import { find, searchTitles, FindRequest } from "@/lib/discovery";

function show(label: string, userId: string, req: FindRequest, n = 8) {
  const r = find(userId, req);
  console.log(`\n══ ${label} — total=${r.total} baseline=${r.baseline}`);
  for (const it of r.items.slice(0, n)) {
    const reasons = it.reasons.slice(0, 3).map((x) => `${x.contribution >= 0 ? "+" : ""}${x.label}`).join(", ");
    const yr = it.releaseDate?.slice(0, 4) ?? "----";
    console.log(`  ${it.score.toFixed(2).padStart(6)}  ${yr}  ${it.type.padEnd(5)}  ${it.title}  ⟪${reasons}⟫`);
  }
  return r;
}

function main() {
  initDb();
  const user = get<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  if (!user) { console.log("no users"); return; }
  const userId = user.id;

  const base = show("BASELINE (empty refine)", userId, {});
  console.log("\n  topPositive:", base.profileSummary.topPositive.slice(0, 8).map((r) => `${r.label}(${r.contribution})`).join(", "));
  console.log("  topNegative:", base.profileSummary.topNegative.slice(0, 8).map((r) => `${r.label}(${r.contribution})`).join(", "));

  // Seed test — pick the first known title that exists in the catalog.
  let seedId: string | null = null, seedTitle = "";
  for (const q of ["Fallout", "Dishonored", "Dark", "Lock, Stock", "Lord of the Rings", "Breaking Bad"]) {
    const m = searchTitles(q, 1);
    if (m.length) { seedId = m[0].id; seedTitle = m[0].title; break; }
  }
  if (seedId) show(`SEED: "more like ${seedTitle}"`, userId, { refine: { seeds: [seedId] } });
  else console.log("\n(no seed title matched in catalog)");

  // Dislike a tag (the user hates "funny").
  show(`DISLIKE tag=comedy`, userId, { refine: { dislikes: [{ kind: "tag", key: "comedy", label: "Comedy" }] } });

  // Filter test — games 1990..2005, sorted by match.
  const f = show("FILTER games 1990-2005", userId, { filters: { types: ["game"], yearMin: 1990, yearMax: 2005 } });
  const bad = f.items.filter((i) => i.type !== "game" || (i.releaseDate && (+i.releaseDate.slice(0, 4) < 1990 || +i.releaseDate.slice(0, 4) > 2005)));
  console.log(`  filter integrity: ${bad.length === 0 ? "OK ✓" : `VIOLATIONS: ${bad.length}`}`);

  // Membership — exclude library, so only unseen items surface.
  const ex = show("MEMBERSHIP library=exclude", userId, { filters: { membership: { library: "exclude" } } });
  const inLib = ex.items.filter((i) => i.libraryStatus);
  console.log(`  exclude integrity: ${inLib.length === 0 ? "OK ✓" : `LEAKED ${inLib.length} library items`}`);

  // Sort — platform rating.
  show("SORT platformRating", userId, { sort: "platformRating" }, 5);
}

main();
