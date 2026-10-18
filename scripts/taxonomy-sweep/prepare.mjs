// The weekly taxonomy sweep, step one: gather what the sweep reads.
//
//   node scripts/taxonomy-sweep/prepare.mjs [--out data/taxonomy-sweep/YYYY-MM-DD]
//
// Writes, into the work folder (data/ is gitignored):
//   catalog.json    every pool title with its vector and raw facets, from fandex.org's
//                   catalog files (as fresh as the last site build, docs/website.md)
//   taxonomy.json   the live taxonomy (GET /v1/taxonomy)
//   dismissed.json  every proposal somebody said no to (taxonomy_suggestion_dismissed, read with Wrangler)
//   worklist.md     what the sweep is asked to look at, in a shape a person or a model reads:
//                   the rule-based proposals (lib/taxonomySweep.ts), the franchises, the titles in
//                   no franchise, the tags still in Other, the categories, the aliases, and the
//                   refs already decided (dismissed, or this sweep's own earlier no's)
//
// Nothing here writes to D1. The decisions go into actions.json by hand or by the
// scheduled task, and scripts/taxonomy-sweep/apply.mjs applies them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./hooks.mjs";

registerHooks({ resolve });

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const SITE = process.env.FANDEX_SITE ?? "https://fandex.org";
const day = new Date().toISOString().slice(0, 10);
const outArg = process.argv.indexOf("--out");
const OUT = path.resolve(REPO, outArg > 0 ? process.argv[outArg + 1] : path.join("data", "taxonomy-sweep", day));
fs.mkdirSync(OUT, { recursive: true });

const { runTaxonomySweep } = await import("~/lib/taxonomySweep");
const { surveyFranchises } = await import("~/lib/ipSurvey");
const { buildTagRows } = await import("~/lib/tagVocab");
const { categorizeTag, CATEGORIES } = await import("@/lib/tags");

// ── 1. The catalog and the taxonomy ─────────────────────────────────────────
const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};
const index = await getJson(`${SITE}/catalog/index.json`);
const items = [];
for (const p of index.pages) items.push(...(await getJson(`${SITE}/catalog/${p}`)).items);
const tax = await getJson(`${SITE}/v1/taxonomy`);
fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify({ builtAt: index.builtAt, items }));
fs.writeFileSync(path.join(OUT, "taxonomy.json"), JSON.stringify(tax));

// ── 2. The no's: dismissed in Review, and this sweep's own earlier decisions ──
const WRANGLER = path.join(REPO, "worker", "node_modules", "wrangler", "bin", "wrangler.js");
let dismissed = [];
try {
  const out = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "fandex", "--remote", "--json", "--command", "SELECT kind, ref FROM taxonomy_suggestion_dismissed"], { cwd: path.join(REPO, "worker"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  dismissed = JSON.parse(out.slice(out.indexOf("[")))[0].results.map((r) => [r.kind, r.ref]);
} catch (e) {
  console.error(`could not read the dismissals from D1 (${e.message.split("\n")[0]}); the worklist carries none`);
}
fs.writeFileSync(path.join(OUT, "dismissed.json"), JSON.stringify(dismissed));
const decidedFile = path.join(here, "decided.json");
const decided = fs.existsSync(decidedFile) ? JSON.parse(fs.readFileSync(decidedFile, "utf8")) : [];

// ── 3. The surveys the Review tab makes, over the same data ─────────────────
const titles = items.map((i) => ({
  id: i.vector.id, title: i.vector.title, type: i.vector.type,
  ips: i.facets.filter((f) => f.kind === "ip").map((f) => ({ key: f.key, label: f.label })),
}));
// lib/tagVocab.ts's rawTagCounts, over JSON instead of SQLite.
const raw = new Map();
const itemsByKey = new Map();
items.forEach((it, n) => {
  const seen = new Set();
  for (const f of it.facets) {
    if (f.kind !== "tag" || seen.has(f.key)) continue;
    seen.add(f.key);
    const cur = raw.get(f.key);
    if (cur) cur.count++; else raw.set(f.key, { label: f.label, count: 1, category: f.category ?? "other" });
    const list = itemsByKey.get(f.key);
    if (list) list.push(n); else itemsByKey.set(f.key, [n]);
  }
});
raw.items = itemsByKey;
const tagRows = buildTagRows(raw, tax);
const survey = surveyFranchises(titles, tax);
const report = runTaxonomySweep({ tags: tagRows, titles, tax, dismissed });
fs.writeFileSync(path.join(OUT, "rules.json"), JSON.stringify(report));

// ── 4. The worklist ─────────────────────────────────────────────────────────
const byId = new Map(items.map((i) => [i.vector.id, i]));
const placed = new Set();
for (const f of survey) for (const m of f.members) placed.add(m.mediaItemId);
const TYPE = { movie: "film", show: "show", game: "game", book: "book", boardgame: "board game" };
const line = (it) => `${it.vector.id} | ${TYPE[it.vector.type] ?? it.vector.type} | ${it.vector.year ?? "----"} | ${it.vector.title}`;
const unplaced = items.filter((i) => !placed.has(i.vector.id)).sort((a, b) => a.vector.type.localeCompare(b.vector.type) || a.vector.title.localeCompare(b.vector.title));
const liveCategories = new Map(tax.tagCategories.map((c) => [c.id, c]));
const otherTags = tagRows.filter((t) => !t.overridden && (categorizeTag(t.key) === "other") && t.count >= 3);
const sampleTitles = (key) => (itemsByKey.get(key) ?? []).slice(0, 3).map((n) => items[n].vector.title).join("; ");
const codeCategories = new Set(CATEGORIES.map((c) => c.id));

const md = [];
md.push(`# Taxonomy sweep worklist, ${day}`);
md.push("");
md.push(`Catalog built ${index.builtAt}: ${items.length} titles (${Object.entries(items.reduce((n, i) => ((n[i.vector.type] = (n[i.vector.type] ?? 0) + 1), n), {})).map(([t, n]) => `${n} ${t}`).join(", ")}). ${survey.length} franchises, ${survey.filter((f) => f.members.length === 1).length} of them holding one title. ${tagRows.length} tags, ${tagRows.filter((t) => t.category === "other").length} in Other (${otherTags.length} of those on three titles or more and not placed by hand). ${dismissed.length} proposals denied in Review, ${decided.length} refs decided by earlier sweeps.`);
md.push("");
md.push("Every id below is a catalog title id. A franchise is named by its canonical key (after bundles). Categories are listed by id.");
md.push("");
md.push("## Categories");
md.push("");
md.push("id | label | weight | ignored | made by");
for (const c of tax.tagCategories) md.push(`${c.id} | ${c.label} | ${c.weight} | ${c.ignored ? "yes" : "no"} | ${codeCategories.has(c.id) ? "the code (never merge away)" : "hand"}`);
md.push("");
md.push("## What the rules already propose (lib/taxonomySweep.ts)");
md.push("");
md.push("Accepting these is the Review tab's job and the cheapest win; a sweep may apply the ones it agrees with.");
md.push("");
for (const s of report.suggestions) {
  if (s.kind === "tag-category") md.push(`- tag-category ${s.ref}: ${s.tags.length} tags → ${s.categoryId}${s.createsCategory ? " (creates it)" : ""}, ${s.itemsAffected} appearances. ${s.why} Tags: ${s.tags.slice(0, 40).map((t) => t.key).join(", ")}${s.tags.length > 40 ? ", …" : ""}`);
  else if (s.kind === "franchise-merge") md.push(`- franchise-merge ${s.ref}: "${s.aliasLabel}" (${s.aliasSize}: ${s.aliasSample.join("; ")}) into "${s.canonicalLabel}" (${s.canonicalSize}: ${s.canonicalSample.join("; ")}). ${s.why}`);
  else if (s.kind === "franchise-member") md.push(`- franchise-member ${s.ref}: ${s.itemTitle} (${s.itemType}) → ${s.ipLabel} (${s.franchiseSize} titles). ${s.why}`);
  else if (s.kind === "franchise-new") md.push(`- franchise-new ${s.ref}: ${s.title} [${s.signal}]: ${s.members.map((m) => `${m.title} (${m.type}, ${m.mediaItemId})`).join("; ")}. ${s.why}`);
}
md.push("");
md.push("## Franchises (canonical key | shown name | titles | media | bundled names | three titles)");
md.push("");
for (const f of survey) md.push(`${f.key} | ${f.label} | ${f.members.length} | ${f.types.join(",")} | ${f.aliases.join(", ") || "-"} | ${f.members.slice(0, 3).map((m) => m.title).join("; ")}`);
md.push("");
md.push(`## Titles in no franchise (${unplaced.length}): id | medium | year | title`);
md.push("");
md.push("Look for: adaptations of one work across media (a book and its film), remakes and sequels no provider links, a series the titles' names spell out, and titles that belong to a franchise above (Nosferatu is Dracula). A title that is simply alone stays alone.");
md.push("");
for (const it of unplaced) md.push(line(it));
md.push("");
md.push(`## Tags still in Other, three titles or more (${otherTags.length}): key | titles | three of them`);
md.push("");
md.push("Place each in a category above, propose a new category only for a cluster of twenty or more tags no category fits, and fold spellings of one tag into one (tag-alias). A tag that says nothing about taste (store plumbing, a release fact) goes to meta.");
md.push("");
for (const t of otherTags) md.push(`${t.key} | ${t.count} | ${sampleTitles(t.key)}`);
md.push("");
md.push("## Existing tag aliases (spelling → tag)");
md.push("");
for (const [a, c] of tax.tagAliases) md.push(`${a} → ${c}`);
md.push("");
md.push("## Already decided, never propose again");
md.push("");
md.push("Denied in Review (kind | ref):");
for (const [k, r] of dismissed) md.push(`- ${k} | ${r}`);
md.push("");
md.push("Decided by an earlier sweep (ref | why):");
for (const d of decided) md.push(`- ${d.ref} | ${d.why}`);
md.push("");
fs.writeFileSync(path.join(OUT, "worklist.md"), md.join("\n"));

fs.writeFileSync(path.join(OUT, "actions.example.json"), JSON.stringify({
  note: "The shape apply.mjs reads. Every action carries a one-line why. Keys are plain names; apply.mjs normalises them.",
  actions: [
    { kind: "franchise-attach", mediaItemId: "00000000-0000-0000-0000-000000000000", franchise: "Dracula", why: "Nosferatu is the Dracula story under another name." },
    { kind: "franchise-bundle", alias: "The Terminator", canonical: "Terminator", why: "The same franchise with and without the article." },
    { kind: "franchise-name", franchise: "land of oz", label: "Oz", why: "The name people use." },
    { kind: "tag-category", tagKeys: ["deckbuilding", "roguelike deckbuilder"], categoryId: "mechanics", why: "How a game plays, not what it is about." },
    { kind: "tag-alias", members: ["sci fi", "scifi"], canonical: "science fiction", why: "One tag spelled three ways." },
    { kind: "category-create", id: "setting-era", label: "Era", weight: 1, why: "Forty tags name a period and no category holds them." },
    { kind: "category-merge", from: "modes", into: "mode", why: "Two hand-made categories with one meaning." },
    { kind: "skip", ref: "franchise-new|limbo", why: "The game and the film share a word and nothing else." },
  ],
}, null, 2));

console.log(`work folder: ${path.relative(REPO, OUT)}`);
console.log(`${items.length} titles, ${survey.length} franchises, ${unplaced.length} in none; ${tagRows.length} tags, ${otherTags.length} Other tags on 3+ titles; ${report.suggestions.length} rule proposals; ${dismissed.length} dismissed, ${decided.length} decided`);
console.log(`worklist: ${(fs.statSync(path.join(OUT, "worklist.md")).size / 1024).toFixed(0)} KB`);
