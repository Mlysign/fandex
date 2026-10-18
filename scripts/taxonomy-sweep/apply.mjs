// The weekly taxonomy sweep, step two: apply a list of decisions to live D1.
//
//   node scripts/taxonomy-sweep/apply.mjs <workdir>/actions.json [--apply]
//
// Reads the work folder prepare.mjs wrote (catalog.json, taxonomy.json,
// dismissed.json beside the actions file), checks every action against it,
// and prints what it would do. With --apply it backs up every row it touches,
// writes the statements and their undo under docs/archive/taxonomy-sweeps/,
// runs them with Wrangler, and appends this sweep's "no"s to decided.json so
// the next one does not ask again.
//
// The writes are the Scoring admin's own (worker/src/adminScoring.ts), with
// two differences on purpose: a row somebody made by hand is NEVER overwritten
// (ON CONFLICT DO NOTHING where the admin would update), and an attach is
// filed under source 'sweep', so the Franchises panel and the undo can tell
// the sweep's rows from Nils's. The taxonomy is read live by every device
// (/v1/taxonomy, asked twice a day), so nothing needs a deploy or a publish.
//
// Actions (every one carries a one-line `why`, kept in the report):
//   franchise-attach  { mediaItemId, franchise }         the title joins the franchise, made if new
//   franchise-detach  { mediaItemId, franchise }         a provider's membership is wrong
//   franchise-bundle  { alias, canonical, label? }       two franchise names are one franchise
//   franchise-name    { franchise, label }               the name people see
//   tag-category      { tagKeys[], categoryId }          tags not placed by hand move to a category
//   tag-alias         { members[], canonical, label? }   spellings of one tag
//   category-create   { id, label, weight?, ignored? }   a new category (hand-made categories only can be merged)
//   category-merge    { from, into }                     a hand-made category folds into another
//   skip              { ref }                            considered and declined; remembered

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./hooks.mjs";

registerHooks({ resolve });

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const [actionsFile, ...flags] = process.argv.slice(2);
if (!actionsFile) {
  console.error("usage: node scripts/taxonomy-sweep/apply.mjs <workdir>/actions.json [--apply]");
  process.exit(2);
}
const apply = flags.includes("--apply");
const WORK = path.dirname(path.resolve(actionsFile));
const day = path.basename(WORK).match(/^\d{4}-\d{2}-\d{2}$/) ? path.basename(WORK) : new Date().toISOString().slice(0, 10);

const { ipKey, tagKey } = await import("@/lib/facets");
const { CATEGORIES } = await import("@/lib/tags");
const { tagCategoryHex } = await import("@/lib/facetPalette");

const read = (name) => JSON.parse(fs.readFileSync(path.join(WORK, name), "utf8"));
const { items } = read("catalog.json");
const tax = read("taxonomy.json");
const dismissed = new Set(read("dismissed.json").map(([k, r]) => `${k}|${r}`));
const decidedFile = path.join(here, "decided.json");
const decided = fs.existsSync(decidedFile) ? JSON.parse(fs.readFileSync(decidedFile, "utf8")) : [];
const { actions } = JSON.parse(fs.readFileSync(actionsFile, "utf8"));
if (!Array.isArray(actions)) throw new Error("actions.json must hold {actions: [...]}");

const byId = new Map(items.map((i) => [i.vector.id, i.vector]));
const ipAlias = new Map(tax.ipAliases);
const tagAlias = new Map(tax.tagAliases);
const categories = new Map(tax.tagCategories.map((c) => [c.id, c]));
const codeCategories = new Set(CATEGORIES.map((c) => c.id));
const handTagOverrides = new Set(tax.tagCategoryOverrides.map(([k]) => k));
const tagKeysSeen = new Set();
for (const it of items) for (const f of it.facets) if (f.kind === "tag") tagKeysSeen.add(f.key);
const UUID = /^[0-9a-f-]{36}$/;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const canonicalIp = (raw) => { const k = ipKey(raw); if (!k) throw new Error(`empty franchise key from ${JSON.stringify(raw)}`); return ipAlias.get(k) ?? k; };
const canonicalTag = (raw) => { const k = tagKey(raw); if (!k) throw new Error(`empty tag key from ${JSON.stringify(raw)}`); return tagAlias.get(k) ?? k; };

// ── 1. Check every action, build the statements ─────────────────────────────
const sql = [];
const undo = [];
const report = { "franchise-attach": [], "franchise-detach": [], "franchise-bundle": [], "franchise-name": [], "tag-category": [], "tag-alias": [], "category-create": [], "category-merge": [], skip: [] };
const problems = [];
const touched = { item_ip_override: [], ip_alias: [], tag_alias: [], tag_category_override: [], facet_label_override: [], tag_category: [] };
const createdCategories = new Set();
const LIMITS = { "franchise-attach": 200, "franchise-detach": 30, "franchise-bundle": 50, "franchise-name": 30, "tag-category": 400, "tag-alias": 80, "category-create": 3, "category-merge": 3 };
const counts = {};

for (const [n, a] of actions.entries()) {
  const at = `action ${n + 1} (${a.kind})`;
  if (typeof a.why !== "string" || !a.why.trim()) { problems.push(`${at}: needs a why`); continue; }
  counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  if (LIMITS[a.kind] && counts[a.kind] > LIMITS[a.kind]) { problems.push(`${at}: more than ${LIMITS[a.kind]} of this kind in one sweep`); continue; }
  try {
    if (a.kind === "franchise-attach" || a.kind === "franchise-detach") {
      if (!UUID.test(a.mediaItemId ?? "")) throw new Error("mediaItemId must be a title id");
      const v = byId.get(a.mediaItemId);
      if (!v) throw new Error(`no title ${a.mediaItemId} in the catalog`);
      const key = canonicalIp(a.franchise);
      const mode = a.kind === "franchise-attach" ? "add" : "remove";
      if (dismissed.has(`franchise-member|${a.mediaItemId}>${key}`)) throw new Error(`denied in Review: ${v.title} → ${key}`);
      const label = (a.label ?? a.franchise).trim();
      sql.push(`INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source, updated_at) VALUES (${q(a.mediaItemId)}, ${q(key)}, ${q(label)}, '${mode}', 'sweep', unixepoch()) ON CONFLICT (media_item_id, ip_key) DO NOTHING;`);
      undo.push(`DELETE FROM item_ip_override WHERE media_item_id = ${q(a.mediaItemId)} AND ip_key = ${q(key)} AND source = 'sweep';`);
      touched.item_ip_override.push([a.mediaItemId, key]);
      report[a.kind].push(`${v.title} (${v.type}, ${v.year ?? "----"}) ${mode === "add" ? "→" : "out of"} ${label} [${key}]: ${a.why}`);
    } else if (a.kind === "franchise-bundle") {
      const alias = ipKey(a.alias);
      const target = canonicalIp(a.canonical);
      if (!alias || alias === target) throw new Error("alias and canonical are one key");
      if (dismissed.has(`franchise-merge|${alias}>${target}`)) throw new Error(`denied in Review: ${alias} → ${target}`);
      sql.push(`UPDATE ip_alias SET canonical_key = ${q(target)}, updated_at = unixepoch() WHERE canonical_key = ${q(alias)};`);
      sql.push(`INSERT INTO ip_alias (alias_key, canonical_key, updated_at) VALUES (${q(alias)}, ${q(target)}, unixepoch()) ON CONFLICT (alias_key) DO NOTHING;`);
      undo.push(`DELETE FROM ip_alias WHERE alias_key = ${q(alias)} AND canonical_key = ${q(target)};`);
      touched.ip_alias.push(alias);
      if (a.label) {
        sql.push(`INSERT INTO facet_label_override (kind, key, label, updated_at) VALUES ('ip', ${q(target)}, ${q(a.label.trim())}, unixepoch()) ON CONFLICT (kind, key) DO NOTHING;`);
        undo.push(`DELETE FROM facet_label_override WHERE kind = 'ip' AND key = ${q(target)} AND label = ${q(a.label.trim())};`);
        touched.facet_label_override.push(["ip", target]);
      }
      ipAlias.set(alias, target);
      report[a.kind].push(`${a.alias} [${alias}] into ${a.canonical} [${target}]${a.label ? ` as "${a.label}"` : ""}: ${a.why}`);
    } else if (a.kind === "franchise-name") {
      const key = canonicalIp(a.franchise);
      if (typeof a.label !== "string" || !a.label.trim()) throw new Error("label required");
      sql.push(`INSERT INTO facet_label_override (kind, key, label, updated_at) VALUES ('ip', ${q(key)}, ${q(a.label.trim())}, unixepoch()) ON CONFLICT (kind, key) DO NOTHING;`);
      undo.push(`DELETE FROM facet_label_override WHERE kind = 'ip' AND key = ${q(key)} AND label = ${q(a.label.trim())};`);
      touched.facet_label_override.push(["ip", key]);
      report[a.kind].push(`${key} shown as "${a.label.trim()}": ${a.why}`);
    } else if (a.kind === "tag-category") {
      if (!Array.isArray(a.tagKeys) || !a.tagKeys.length) throw new Error("tagKeys required");
      if (!categories.has(a.categoryId) && !createdCategories.has(a.categoryId)) throw new Error(`no category ${a.categoryId} (create it first in this list)`);
      const keys = [];
      for (const raw of a.tagKeys) {
        const k = tagKey(raw);
        if (!tagKeysSeen.has(k) && !tagKeysSeen.has(canonicalTag(raw))) { problems.push(`${at}: no tag ${JSON.stringify(raw)} in the catalog (skipped)`); continue; }
        if (handTagOverrides.has(k)) { problems.push(`${at}: ${k} was placed by hand (skipped)`); continue; }
        keys.push(k);
      }
      if (!keys.length) throw new Error("every tag was placed by hand or unknown, nothing moved (skipped)");
      for (const k of keys) {
        sql.push(`INSERT INTO tag_category_override (tag_key, category_id, updated_at) VALUES (${q(k)}, ${q(a.categoryId)}, unixepoch()) ON CONFLICT (tag_key) DO NOTHING;`);
        undo.push(`DELETE FROM tag_category_override WHERE tag_key = ${q(k)} AND category_id = ${q(a.categoryId)};`);
        touched.tag_category_override.push(k);
      }
      report[a.kind].push(`${keys.length} tags → ${a.categoryId} (${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", …" : ""}): ${a.why}`);
    } else if (a.kind === "tag-alias") {
      if (!Array.isArray(a.members) || !a.members.length) throw new Error("members required");
      const target = canonicalTag(a.canonical);
      const members = [...new Set(a.members.map((m) => tagKey(m)))].filter((m) => m && m !== target);
      if (!members.length) throw new Error("no member differs from the canonical");
      for (const m of members) {
        sql.push(`UPDATE tag_alias SET canonical_key = ${q(target)}, updated_at = unixepoch() WHERE canonical_key = ${q(m)};`);
        sql.push(`INSERT INTO tag_alias (alias_key, canonical_key, updated_at) VALUES (${q(m)}, ${q(target)}, unixepoch()) ON CONFLICT (alias_key) DO NOTHING;`);
        undo.push(`DELETE FROM tag_alias WHERE alias_key = ${q(m)} AND canonical_key = ${q(target)};`);
        touched.tag_alias.push(m);
        tagAlias.set(m, target);
      }
      if (a.label) {
        sql.push(`INSERT INTO facet_label_override (kind, key, label, updated_at) VALUES ('tag', ${q(target)}, ${q(a.label.trim())}, unixepoch()) ON CONFLICT (kind, key) DO NOTHING;`);
        undo.push(`DELETE FROM facet_label_override WHERE kind = 'tag' AND key = ${q(target)} AND label = ${q(a.label.trim())};`);
        touched.facet_label_override.push(["tag", target]);
      }
      report[a.kind].push(`${members.join(", ")} → ${target}${a.label ? ` as "${a.label}"` : ""}: ${a.why}`);
    } else if (a.kind === "category-create") {
      if (!/^[a-z0-9-]{1,64}$/.test(a.id ?? "")) throw new Error("id must be lowercase-kebab");
      if (categories.has(a.id)) throw new Error(`category ${a.id} exists`);
      if (typeof a.label !== "string" || !a.label.trim()) throw new Error("label required");
      const weight = a.weight ?? 1;
      if (typeof weight !== "number" || weight < 0) throw new Error("weight must be a number of zero or more");
      sql.push(`INSERT INTO tag_category (id, label, color, weight, ignored, sort_order, updated_at) VALUES (${q(a.id)}, ${q(a.label.trim())}, ${q(tagCategoryHex(a.id))}, ${weight}, ${a.ignored ? 1 : 0}, (SELECT COUNT(*) FROM tag_category), unixepoch()) ON CONFLICT (id) DO NOTHING;`);
      undo.push(`DELETE FROM tag_category WHERE id = ${q(a.id)};`);
      touched.tag_category.push(a.id);
      createdCategories.add(a.id);
      report[a.kind].push(`${a.id} "${a.label.trim()}" (weight ${weight}${a.ignored ? ", ignored" : ""}): ${a.why}`);
    } else if (a.kind === "category-merge") {
      if (!categories.has(a.from) || !(categories.has(a.into) || createdCategories.has(a.into))) throw new Error("from and into must be categories");
      if (codeCategories.has(a.from)) throw new Error(`${a.from} is a category the code places tags in; it cannot be merged away`);
      // The override rows move first (the delete would cascade them away), then the category goes.
      sql.push(`UPDATE OR REPLACE tag_category_override SET category_id = ${q(a.into)}, updated_at = unixepoch() WHERE category_id = ${q(a.from)};`);
      sql.push(`DELETE FROM tag_category WHERE id = ${q(a.from)};`);
      touched.tag_category.push(a.from);
      report[a.kind].push(`${a.from} into ${a.into}: ${a.why}`);
    } else if (a.kind === "skip") {
      if (typeof a.ref !== "string" || !a.ref) throw new Error("ref required");
      report.skip.push(`${a.ref}: ${a.why}`);
    } else {
      throw new Error("unknown kind");
    }
  } catch (e) {
    problems.push(`${at}: ${e.message}`);
  }
}

const total = Object.entries(report).filter(([k]) => k !== "skip").reduce((n, [, l]) => n + l.length, 0);
console.log(`${actions.length} actions: ${Object.entries(report).map(([k, l]) => `${l.length} ${k}`).join(", ")}; ${sql.length} statements`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
}
const fatal = problems.filter((p) => !/\(skipped\)$/.test(p));
if (fatal.length) {
  console.log("\nNothing applied: fix the problems above (a problem ending in \"(skipped)\" only drops that tag).");
  process.exit(1);
}
if (!total) { console.log("Nothing to apply."); process.exit(0); }

// ── 2. The record, written before anything runs ─────────────────────────────
const ARCHIVE = path.join(REPO, "docs", "archive", "taxonomy-sweeps");
fs.mkdirSync(ARCHIVE, { recursive: true });
const stamp = `${day}${fs.existsSync(path.join(ARCHIVE, `${day}.sql`)) ? `-${new Date().toISOString().slice(11, 16).replace(":", "")}` : ""}`;
const head = `-- Taxonomy sweep ${stamp} (scripts/taxonomy-sweep). Applied with: npx wrangler d1 execute fandex --remote --file ../docs/archive/taxonomy-sweeps/${stamp}.sql (from worker/).`;
const md = [`# Taxonomy sweep, ${stamp}`, "", `${total} changes, ${report.skip.length} things looked at and left alone. Undo: \`${stamp}-undo.sql\` beside this file.`, ""];
for (const [kind, lines] of Object.entries(report)) {
  if (!lines.length) continue;
  md.push(`## ${kind} (${lines.length})`, "");
  for (const l of lines) md.push(`- ${l}`);
  md.push("");
}
if (problems.length) md.push("## Skipped", "", ...problems.map((p) => `- ${p}`), "");

if (!apply) {
  console.log(`\nDry run. The report would be docs/archive/taxonomy-sweeps/${stamp}.md; add --apply to run the ${sql.length} statements.`);
  console.log(md.join("\n"));
  process.exit(0);
}

// Back up the rows the statements can change, so the undo can put them back.
const WORKER = path.join(REPO, "worker");
const WRANGLER = path.join(WORKER, "node_modules", "wrangler", "bin", "wrangler.js");
function d1(args) {
  const out = execFileSync(process.execPath, [WRANGLER, "d1", "execute", "fandex", "--remote", "--json", ...args], { cwd: WORKER, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("[")));
}
const query = (s) => d1(["--command", s.replace(/\s+/g, " ")])[0].results;
const backup = {};
if (touched.ip_alias.length) backup.ip_alias = query(`SELECT * FROM ip_alias WHERE alias_key IN (${touched.ip_alias.map(q).join(",")}) OR canonical_key IN (${touched.ip_alias.map(q).join(",")})`);
if (touched.tag_alias.length) backup.tag_alias = query(`SELECT * FROM tag_alias WHERE alias_key IN (${touched.tag_alias.map(q).join(",")}) OR canonical_key IN (${touched.tag_alias.map(q).join(",")})`);
if (touched.tag_category.length) {
  backup.tag_category = query(`SELECT * FROM tag_category WHERE id IN (${touched.tag_category.map(q).join(",")})`);
  backup.tag_category_override_by_category = query(`SELECT * FROM tag_category_override WHERE category_id IN (${touched.tag_category.map(q).join(",")})`);
}
const restore = [];
for (const r of backup.ip_alias ?? []) restore.push(`INSERT INTO ip_alias (alias_key, canonical_key, updated_at) VALUES (${q(r.alias_key)}, ${q(r.canonical_key)}, ${r.updated_at}) ON CONFLICT (alias_key) DO UPDATE SET canonical_key = excluded.canonical_key;`);
for (const r of backup.tag_alias ?? []) restore.push(`INSERT INTO tag_alias (alias_key, canonical_key, updated_at) VALUES (${q(r.alias_key)}, ${q(r.canonical_key)}, ${r.updated_at}) ON CONFLICT (alias_key) DO UPDATE SET canonical_key = excluded.canonical_key;`);
for (const r of backup.tag_category ?? []) restore.push(`INSERT INTO tag_category (id, label, color, weight, ignored, sort_order, updated_at) VALUES (${q(r.id)}, ${q(r.label)}, ${q(r.color)}, ${r.weight}, ${r.ignored}, ${r.sort_order}, ${r.updated_at}) ON CONFLICT (id) DO NOTHING;`);
for (const r of backup.tag_category_override_by_category ?? []) restore.push(`INSERT INTO tag_category_override (tag_key, category_id, updated_at) VALUES (${q(r.tag_key)}, ${q(r.category_id)}, ${r.updated_at}) ON CONFLICT (tag_key) DO UPDATE SET category_id = excluded.category_id;`);

fs.writeFileSync(path.join(ARCHIVE, `${stamp}.sql`), `${head}\n${sql.join("\n")}\n`);
fs.writeFileSync(path.join(ARCHIVE, `${stamp}-undo.sql`), `-- Undo for ${stamp}.sql: the sweep's rows out, the rows it changed back as they were.\n${[...undo, ...restore].join("\n")}\n`);
fs.writeFileSync(path.join(ARCHIVE, `${stamp}.md`), md.join("\n"));
const backupDir = path.join(REPO, "data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, `taxonomy-sweep-${stamp}.json`), JSON.stringify({ actions, backup }));

// ── 3. Run it ───────────────────────────────────────────────────────────────
d1(["--file", path.join(ARCHIVE, `${stamp}.sql`), "--yes"]);
const after = query("SELECT (SELECT COUNT(*) FROM item_ip_override WHERE source = 'sweep') sweep_rows, (SELECT COUNT(*) FROM ip_alias) ip_aliases, (SELECT COUNT(*) FROM tag_alias) tag_aliases, (SELECT COUNT(*) FROM tag_category_override) overrides, (SELECT COUNT(*) FROM tag_category) categories")[0];
console.log(`applied. D1 now: ${JSON.stringify(after)}`);

// The no's, remembered. A ref is whatever the worklist called the thing.
const known = new Set(decided.map((d) => d.ref));
for (const a of actions) if (a.kind === "skip" && !known.has(a.ref)) decided.push({ ref: a.ref, why: a.why, on: day });
fs.writeFileSync(decidedFile, `${JSON.stringify(decided, null, 1)}\n`);
console.log(`report: docs/archive/taxonomy-sweeps/${stamp}.md, undo beside it; ${report.skip.length} no's remembered in scripts/taxonomy-sweep/decided.json`);
