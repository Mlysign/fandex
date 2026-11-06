// The weekly taxonomy sweep: are the bundles hooked up correctly?
//
//   node scripts/taxonomy-sweep/check-bundles.mjs <work folder>
//
// Reads the folder's taxonomy.json and catalog.json (prepare.mjs writes both)
// and checks the tag and franchise bundles the way the app reads them: an alias
// resolves in ONE hop (lib/fandexScore.ts applyTagAliases, applyIpFacets), and
// a category or a chosen name is read under the CANONICAL key only.
//
// Errors (exit 1), each a bundle that does not do what it says:
//   chain        alias → x where x is itself an alias: the titles stop at x
//   self         alias → itself
// To decide (exit 0), each a bundle counting somewhere its spelling says it should not:
//   category     a bundled spelling was placed in one category, its main tag counts in
//                another (the main tag's wins, for the whole bundle). Decide where the
//                bundle belongs: a tag-category for a main tag with no row of its own,
//                or a `skip` with ref `bundle-category|<main tag>` to keep it as it is
//                (a main tag placed by hand is kept unless it is plainly wrong).
//                Refs in decided.json are not listed again.
// Counted only: dead chosen names on a bundled spelling, bundles into a key no title
// carries, and spellings no title carries any more.
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./hooks.mjs";

registerHooks({ resolve });
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/taxonomy-sweep/check-bundles.mjs <work folder>"); process.exit(2); }
const WORK = path.resolve(dir);
const tax = JSON.parse(fs.readFileSync(path.join(WORK, "taxonomy.json"), "utf8"));
const { items } = JSON.parse(fs.readFileSync(path.join(WORK, "catalog.json"), "utf8"));
const decidedFile = path.join(here, "decided.json");
const decided = new Set((fs.existsSync(decidedFile) ? JSON.parse(fs.readFileSync(decidedFile, "utf8")) : []).map((d) => d.ref));
const { buildTagRows } = await import("~/lib/tagVocab");

// The category each tag counts in, as the app resolves it (override, else the code's rules).
const raw = new Map();
const byKey = new Map();
const carried = { tag: new Set(), ip: new Set() };
items.forEach((it, n) => {
  const seen = new Set();
  for (const f of it.facets) {
    if (f.kind === "tag" || f.kind === "ip") carried[f.kind].add(f.key);
    if (f.kind !== "tag" || seen.has(f.key)) continue;
    seen.add(f.key);
    const cur = raw.get(f.key);
    if (cur) cur.count++; else raw.set(f.key, { label: f.label, count: 1, category: f.category ?? "other" });
    (byKey.get(f.key) ?? byKey.set(f.key, []).get(f.key)).push(n);
  }
});
raw.items = byKey;
const counts = new Map(buildTagRows(raw, tax).map((r) => [r.key, r]));
const overrides = new Map(tax.tagCategoryOverrides);
const labels = new Set(tax.facetLabels.map(([kind, key]) => `${kind}|${key}`));

const errors = [];
const toDecide = [];
let deadLabels = 0, emptyTargets = 0, stale = 0;
for (const [kind, list] of [["tag", tax.tagAliases], ["ip", tax.ipAliases]]) {
  const alias = new Map(list);
  for (const [a, c] of alias) {
    if (a === c) errors.push(`self: ${kind} ${a} is bundled into itself`);
    else if (alias.has(c)) errors.push(`chain: ${kind} ${a} → ${c} → ${alias.get(c)}; ${a}'s titles stop at ${c}`);
    if (labels.has(`${kind}|${a}`)) deadLabels++;
    if (!carried[kind].has(a)) stale++;
    if (kind !== "tag" || !overrides.has(a)) continue;
    const counts_in = counts.get(c)?.category;
    if (!counts_in || overrides.get(a) === counts_in || decided.has(`bundle-category|${c}`)) continue;
    const sample = (byKey.get(c) ?? []).slice(0, 2).map((n) => items[n].vector.title).join("; ");
    toDecide.push(`${c} | counts in ${counts_in} (${overrides.has(c) ? "its own row" : "no row of its own"}) | spelling "${a}" was placed in ${overrides.get(a)} | ${counts.get(c)?.count ?? 0} titles: ${sample}`);
  }
  for (const c of new Set(alias.values())) if (!carried[kind].has(c) && !labels.has(`${kind}|${c}`)) emptyTargets++;
}

console.log(`${tax.tagAliases.length} tag bundles, ${tax.ipAliases.length} franchise bundles. Counted only: ${deadLabels} chosen names on a bundled spelling, ${emptyTargets} bundles into a key no title carries, ${stale} spellings no title carries now.`);
if (toDecide.length) {
  console.log(`\n${toDecide.length} bundle(s) to decide: main tag | where it counts | where a spelling was placed | titles`);
  for (const t of toDecide) console.log(`  ${t}`);
}
for (const e of errors) console.log(`ERROR ${e}`);
console.log(errors.length ? `\n${errors.length} error(s): fix them in the Scoring admin or by SQL with an undo` : `\nno chain, no self-bundle; ${toDecide.length} to decide`);
process.exit(errors.length ? 1 : 0);
