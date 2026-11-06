// The weekly taxonomy sweep: turn the sorted Other tags into tag-category actions.
//
//   node scripts/taxonomy-sweep/join-other.mjs <work folder> [--check]
//
// prepare.mjs writes every tag in Other to other.txt, and past CHUNK lines also to
// other-NN.txt chunks. Each is sorted per other-brief.md into a `.out.tsv` beside it
// (key<TAB>category, one line per input line, same order). This checks every output
// against its input (count and key at each line) and, without --check, appends one
// tag-category action per category to <work folder>/actions.json (creating it if
// there is none). It refuses while any output is missing, misaligned, names a
// category that does not exist, or holds a `NEW:` id: decide those first (an
// existing id, or a category-create in actions.json ahead of the moves).
import fs from "node:fs";
import path from "node:path";

const [dir, ...flags] = process.argv.slice(2);
if (!dir) { console.error("usage: node scripts/taxonomy-sweep/join-other.mjs <work folder> [--check]"); process.exit(2); }
const WORK = path.resolve(dir);
const lines = (f) => fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.length);
const chunks = fs.readdirSync(WORK).filter((f) => /^other-\d+\.txt$/.test(f)).sort();
const inputs = chunks.length ? chunks : fs.existsSync(path.join(WORK, "other.txt")) ? ["other.txt"] : [];
if (!inputs.length) { console.log("no other.txt: Other was empty when prepare.mjs ran"); process.exit(0); }

const tax = JSON.parse(fs.readFileSync(path.join(WORK, "taxonomy.json"), "utf8"));
const actionsFile = path.join(WORK, "actions.json");
const existing = fs.existsSync(actionsFile) ? JSON.parse(fs.readFileSync(actionsFile, "utf8")) : { actions: [] };
const known = new Set(tax.tagCategories.map((c) => c.id));
for (const a of existing.actions) if (a.kind === "category-create") known.add(a.id);
known.delete("other");

const problems = [];
const byCategory = new Map();
for (const f of inputs) {
  const out = path.join(WORK, f.replace(/\.txt$/, ".out.tsv"));
  if (!fs.existsSync(out)) { problems.push(`${f}: no ${path.basename(out)}`); continue; }
  const inp = lines(path.join(WORK, f));
  const res = lines(out);
  if (inp.length !== res.length) problems.push(`${f}: ${inp.length} tags in, ${res.length} lines out`);
  inp.forEach((l, i) => {
    const key = l.split(" | ")[0];
    const [k, cat] = (res[i] ?? "").split("\t");
    if (k !== key) { problems.push(`${f} line ${i + 1}: expected ${JSON.stringify(key)}, got ${JSON.stringify(k)}`); return; }
    if (!known.has(cat)) { problems.push(`${f} line ${i + 1}: ${key} → ${JSON.stringify(cat)} is not a category${cat?.startsWith("NEW:") ? " (decide it: an existing id, or a category-create in actions.json)" : ""}`); return; }
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(key);
  });
}
if (problems.length) {
  console.error(`${problems.length} problem(s):\n${problems.slice(0, 40).join("\n")}${problems.length > 40 ? "\n…" : ""}`);
  process.exit(1);
}
const counts = Object.fromEntries([...byCategory].map(([c, k]) => [c, k.length]));
console.log(`clean: ${[...byCategory.values()].reduce((n, k) => n + k.length, 0)} tags`, counts);
if (flags.includes("--check")) process.exit(0);
if (existing.actions.some((a) => a.kind === "tag-category" && a.fromOther)) { console.error("actions.json already holds the Other moves; not added twice"); process.exit(1); }
for (const [cat, tagKeys] of byCategory) {
  const label = tax.tagCategories.find((c) => c.id === cat)?.label ?? cat;
  existing.actions.push({ kind: "tag-category", categoryId: cat, tagKeys, fromOther: true, why: `Sorted out of Other into ${label}, each tag read with its titles (other-brief.md).` });
}
fs.writeFileSync(actionsFile, JSON.stringify(existing, null, 1));
console.log(`appended ${byCategory.size} tag-category actions to ${path.relative(process.cwd(), actionsFile)}`);
