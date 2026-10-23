// Fold duplicate titles and split mis-merged ones, on D1, from a plan file.
//
//   node worker/scripts/regroup-items.mjs <plan.json> --local|--remote [--persist-to <dir>]
//        [--apply] [--snapshot <out.sql>]
//
// fold-items.mjs (2026-10-15) deletes a duplicate and its links. That is right
// for a port whose links are all redundant, and wrong for the cases RV11 found
// (2026-10-23): a title whose Steam and RAWG links belong to ANOTHER title
// (/game/final-fantasy-vii held the Remake's RAWG and a 2026 Steam release on a
// cancelled Super Famicom concept), or a RAWG-only twin whose RAWG link the kept
// title lacks. So this one moves links, and re-derives every title it touched
// with the Worker's own deriveItem, the way a link write does.
//
// The plan, by slug (type game unless an op says otherwise):
//
//   drops:   [{ link: "igdb:210434", aliasTo: "tony-hawks-pro-skater-4-2002" }]
//            Run first. The link goes; its id answers as aliasTo (provider_aliases).
//   moves:   [{ link: "steam:482400", to: "system-shock-2023" }]
//            The link moves, and so do the rows on its old title whose source
//            is the link's source (a Steam row IS that Steam app).
//   folds:   [{ from: "doom-1995", to: "doom" }]
//            After the moves and drops. Each link left on `from` moves to `to`
//            when `to` has no link of that source, else it goes and its id is
//            aliased to `to`. User rows move under fold-items' rule: moved when
//            the kept title has none for that account, source and relation,
//            dropped when it has the same status and rating, REFUSED otherwise.
//   deletes: [{ slug: "dead-space", redirectTo: "dead-space-2008-2" }]
//            A title that was only ever a wrong match: its remaining links go
//            with no alias, so a later resolve makes them a title of their own.
//            Refuses if a user row is still on it.
//
// Without --apply it reads, plans and writes the files, and changes nothing:
//   data/backups/regroup-<where>-<stamp>.json       every row it read
//   data/backups/regroup-<where>-<stamp>.sql        the change
//   data/backups/regroup-<where>-<stamp>.undo.sql   puts every row back
//   data/backups/regroup-<where>-<stamp>.report.md  what each title becomes
// --snapshot writes the rows it read as INSERTs, which is how a local D1 is
// given the same titles to rehearse on.
//
// Both files end by dropping the kept pool count and every user's kept counts
// (worker/src/keptCounts.ts): a device holding more titles than the pool
// downloads its catalog again, which is how a phone forgets the folded rows.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { resolve as aliasResolve } from "../../scripts/alias-hooks.mjs";

registerHooks({ resolve: aliasResolve });
const { deriveItem, buildVector, DERIVE_VERSION } = await import("../src/catalog/derive.ts");
const { normalizeName } = await import("../../src/lib/normalize.ts");
const { extractCrossIds } = await import("../../src/lib/matcherPure.ts");

const args = process.argv.slice(2);
const planFile = args[0];
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const where = flag("--remote") ? "--remote" : flag("--local") ? "--local" : null;
if (!planFile || !where) {
  console.error("usage: node worker/scripts/regroup-items.mjs <plan.json> --local|--remote [--persist-to dir] [--apply] [--snapshot out.sql]");
  process.exit(2);
}
const persist = opt("--persist-to");
const WORKER = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const ROOT = path.resolve(WORKER, "..");
const WRANGLER = path.join(WORKER, "node_modules", "wrangler", "bin", "wrangler.js");

// Wrangler's own script under node, with no shell: through `npx.cmd` Windows
// splits a SQL argument at its spaces (fold-items.mjs).
function d1(extra) {
  const base = ["d1", "execute", "fandex", where, "--json", ...(persist ? ["--persist-to", persist] : [])];
  const out = execFileSync(process.execPath, [WRANGLER, ...base, ...extra], { cwd: WORKER, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("[")));
}
let rowsRead = 0;
function query(sql) {
  const [r] = d1(["--command", sql.replace(/\s+/g, " ")]);
  rowsRead += r.meta?.rows_read ?? 0;
  return r.results;
}
const UUID = /^[0-9a-f-]{36}$/;
const SLUG = /^[a-z0-9-]+$/;
const list = (ids) => {
  for (const id of ids) if (!UUID.test(id)) throw new Error(`not an item id: ${id}`);
  return ids.map((id) => `'${id}'`).join(",");
};
/** A SQL literal. Strings double their quotes; everything else is a number or NULL. */
function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(`not a number: ${v}`); return String(v); }
  return `'${String(v).replace(/'/g, "''")}'`;
}
const insert = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`;
const linkKey = (l) => `${l.source}:${l.source_id}:${l.media_type}`;

// ── 1. The plan, slugs made ids ─────────────────────────────────────────────
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
const type = plan.type ?? "game";
const moves = plan.moves ?? [], drops = plan.drops ?? [], folds = plan.folds ?? [], deletes = plan.deletes ?? [];
const slugs = new Set([...moves.map((m) => m.to), ...drops.map((d) => d.aliasTo).filter(Boolean),
  ...folds.flatMap((f) => [f.from, f.to]), ...deletes.flatMap((d) => [d.slug, d.redirectTo].filter(Boolean))]);
for (const s of slugs) if (!SLUG.test(s)) throw new Error(`not a slug: ${s}`);
const bySlug = new Map(query(`SELECT id, slug FROM media_items WHERE type = ${q(type)} AND slug IN (${[...slugs].map(q).join(",")})`).map((r) => [r.slug, r.id]));
const missing = [...slugs].filter((s) => !bySlug.has(s));
if (missing.length) throw new Error(`no ${type} holds these slugs: ${missing.join(", ")}`);
const idOf = (s) => bySlug.get(s);

const parseLink = (s) => {
  const m = /^([a-z]+):([0-9A-Za-z_-]+)$/.exec(s);
  if (!m) throw new Error(`not a link: ${s}`);
  return { source: m[1], source_id: m[2], media_type: type };
};
const opLinks = [...moves, ...drops].map((o) => parseLink(o.link));
const linkOwners = query(`SELECT media_item_id, source, source_id FROM media_links WHERE media_type = ${q(type)} AND (${
  opLinks.map((l) => `(source = ${q(l.source)} AND source_id = ${q(l.source_id)})`).join(" OR ") || "0"})`);
if (linkOwners.length !== opLinks.length) throw new Error(`some links in the plan are not held: found ${linkOwners.length} of ${opLinks.length}`);

const removed = new Set([...folds.map((f) => idOf(f.from)), ...deletes.map((d) => idOf(d.slug))]);
const ids = [...new Set([...bySlug.values(), ...linkOwners.map((l) => l.media_item_id)])];
for (const f of folds) if (removed.has(idOf(f.to))) throw new Error(`${f.to} is a fold target and is itself removed`);
if (removed.size !== folds.length + deletes.length) throw new Error("a title is folded or deleted twice");

// ── 2. Read every row that can change ───────────────────────────────────────
const L = list(ids);
const before = {
  media_items: query(`SELECT * FROM media_items WHERE id IN (${L})`),
  media_links: query(`SELECT * FROM media_links WHERE media_item_id IN (${L})`),
  item_doc: query(`SELECT * FROM item_doc WHERE media_item_id IN (${L})`),
  media_external_ids: query(`SELECT * FROM media_external_ids WHERE media_item_id IN (${L})`),
  provider_aliases: query(`SELECT * FROM provider_aliases WHERE media_item_id IN (${L})`),
  item_ip_override: query(`SELECT * FROM item_ip_override WHERE media_item_id IN (${L})`),
  user_item_state: query(`SELECT * FROM user_item_state WHERE media_item_id IN (${L})`),
};
const R = list([...removed]);
for (const [table, cond] of [
  ["user_episode_state", `media_item_id IN (${R})`],
  ["user_hidden_items", `media_item_id IN (${R})`],
  ["taxonomy_suggestion_dismissed", `substr(ref, 1, 36) IN (${R})`],
]) {
  const [{ n }] = query(`SELECT COUNT(*) n FROM ${table} WHERE ${cond}`);
  if (n) throw new Error(`${n} row(s) in ${table} point at a title this removes. Decide those by hand first.`);
}
const itemById = new Map(before.media_items.map((r) => [r.id, r]));
if (itemById.size !== ids.length) throw new Error("a title vanished between reads");
for (const r of before.media_items) if (r.type !== type) throw new Error(`${r.slug} is a ${r.type}, not a ${type}`);

// ── 3. Simulate ─────────────────────────────────────────────────────────────
const links = new Map(before.media_links.map((l) => [linkKey(l), { ...l }]));
const userRows = new Map(before.user_item_state.map((r) => [`${r.user_id}|${r.media_item_id}|${r.source}|${r.relation}`, { ...r }]));
const sql = [];
const aliasesAdded = [];
const notes = [];
const touched = new Set();
const slugOf = (id) => itemById.get(id).slug;
const sameFact = (a, b) => a.status === b.status && (a.rating ?? null) === (b.rating ?? null);

/** Move user rows from one title to another under the fold rule; `pick` filters which. */
function moveUserRows(from, to, pick = () => true, why = "") {
  for (const [k, r] of [...userRows]) {
    if (r.media_item_id !== from || !pick(r)) continue;
    const at = `user_id = ${q(r.user_id)} AND media_item_id = ${q(from)} AND source = ${q(r.source)} AND relation = ${q(r.relation)}`;
    const otherKey = `${r.user_id}|${to}|${r.source}|${r.relation}`;
    const other = userRows.get(otherKey);
    if (!other) {
      sql.push(`UPDATE user_item_state SET media_item_id = ${q(to)}, updated_at = unixepoch() WHERE ${at};`);
      userRows.delete(k);
      userRows.set(otherKey, { ...r, media_item_id: to });
      notes.push(`row ${r.source}/${r.relation} ${r.status ?? "-"} ${r.rating ?? "-"}: ${slugOf(from)} → ${slugOf(to)}${why}`);
    } else if (sameFact(r, other)) {
      sql.push(`DELETE FROM user_item_state WHERE ${at};`);
      userRows.delete(k);
      notes.push(`row ${r.source}/${r.relation} ${r.status ?? "-"} ${r.rating ?? "-"} on ${slugOf(from)}: the same fact as on ${slugOf(to)}, dropped`);
    } else {
      throw new Error(`${r.source}/${r.relation} on ${slugOf(from)} is ${r.status} ${r.rating ?? "-"}, on ${slugOf(to)} ${other.status} ${other.rating ?? "-"}: which wins is a person's call`);
    }
  }
}
function moveLink(l, to, why) {
  const from = l.media_item_id;
  if (from === to) throw new Error(`${linkKey(l)} is already on ${slugOf(to)}`);
  sql.push(`UPDATE media_links SET media_item_id = ${q(to)} WHERE source = ${q(l.source)} AND source_id = ${q(l.source_id)} AND media_type = ${q(l.media_type)};`);
  l.media_item_id = to;
  touched.add(from); touched.add(to);
  notes.push(`link ${l.source}:${l.source_id}: ${slugOf(from)} → ${slugOf(to)}${why}`);
}
function dropLink(l, aliasTo, why) {
  sql.push(`DELETE FROM media_links WHERE source = ${q(l.source)} AND source_id = ${q(l.source_id)} AND media_type = ${q(l.media_type)};`);
  links.delete(linkKey(l));
  touched.add(l.media_item_id);
  if (aliasTo) {
    sql.push(`INSERT OR IGNORE INTO provider_aliases (source, source_id, media_type, media_item_id) VALUES (${q(l.source)}, ${q(l.source_id)}, ${q(l.media_type)}, ${q(aliasTo)});`);
    aliasesAdded.push({ source: l.source, source_id: l.source_id, media_type: l.media_type });
  }
  notes.push(`link ${l.source}:${l.source_id} on ${slugOf(l.media_item_id)}: dropped${aliasTo ? `, answers as ${slugOf(aliasTo)}` : ", no alias"}${why}`);
}
const linksOf = (id) => [...links.values()].filter((l) => l.media_item_id === id);
const findLink = (s) => { const p = parseLink(s); const l = links.get(linkKey(p)); if (!l) throw new Error(`${s} is gone before its op`); return l; };

// Drops first, so a title can lose its wrong IGDB link and take the right one.
for (const d of drops) dropLink(findLink(d.link), d.aliasTo ? idOf(d.aliasTo) : null, "");
for (const m of moves) {
  const l = findLink(m.link), from = l.media_item_id, to = idOf(m.to);
  if (linksOf(to).some((o) => o.source === l.source)) throw new Error(`${m.to} already has a ${l.source} link; drop it first`);
  if (linksOf(from).filter((o) => o.source === l.source).length > 1) throw new Error(`${slugOf(from)} has two ${l.source} links; whose rows are whose is unclear`);
  moveLink(l, to, "");
  moveUserRows(from, to, (r) => r.source === l.source, ` (with the ${l.source} link)`);
}
const redirects = [];
for (const f of folds) {
  const from = idOf(f.from), to = idOf(f.to);
  for (const l of linksOf(from)) {
    if (linksOf(to).some((o) => o.source === l.source)) dropLink(l, to, ` (folded into ${f.to})`);
    else moveLink(l, to, " (fold)");
  }
  moveUserRows(from, to, () => true, " (fold)");
  redirects.push({ type, from: f.from, to: f.to });
}
for (const d of deletes) {
  const id = idOf(d.slug);
  for (const l of linksOf(id)) dropLink(l, null, ` (${d.slug} was only a wrong match)`);
  if ([...userRows.values()].some((r) => r.media_item_id === id)) throw new Error(`a user row is still on ${d.slug}`);
  if (d.redirectTo) redirects.push({ type, from: d.slug, to: d.redirectTo });
}
// Redirects into a title that is itself folded later in the plan follow the chain.
for (const r of redirects) {
  let to = r.to, hops = 0;
  while (removed.has(idOf(to))) { to = redirects.find((x) => x.from === to)?.to; if (!to || ++hops > 9) throw new Error(`redirect chain from ${r.from} ends nowhere`); }
  r.to = to;
}
const removedLeft = [...removed].filter((id) => linksOf(id).length);
if (removedLeft.length) throw new Error(`links still on removed titles: ${removedLeft.map(slugOf).join(", ")}`);

// Removed titles: their rows, by name (fold-items: never trust the cascade).
for (const id of removed) {
  sql.push(`UPDATE provider_aliases SET media_item_id = ${q(idOf(redirects.find((r) => r.from === slugOf(id))?.to ?? slugOf(id)))} WHERE media_item_id = ${q(id)};`);
  const target = redirects.find((r) => r.from === slugOf(id));
  if (target) sql.push(`UPDATE OR IGNORE item_ip_override SET media_item_id = ${q(idOf(target.to))} WHERE media_item_id = ${q(id)};`);
  for (const t of ["item_ip_override", "item_doc", "media_external_ids", "provider_aliases"]) sql.push(`DELETE FROM ${t} WHERE media_item_id = ${q(id)};`);
  sql.push(`DELETE FROM media_items WHERE id = ${q(id)};`);
}

// ── 4. Re-derive every kept title that changed ──────────────────────────────
const report = [];
const parsed = (l) => { let data = {}; try { data = JSON.parse(l.raw_data); } catch { /* derives as empty, like ingest.ts */ } return { source: l.source, sourceId: l.source_id, releaseDate: l.release_date, lastSynced: l.last_synced, data }; };
const docBefore = new Map(before.item_doc.map((d) => [d.media_item_id, d]));
for (const id of touched) {
  if (removed.has(id)) continue;
  const row = itemById.get(id);
  const ls = linksOf(id).map(parsed);
  if (!ls.length) throw new Error(`${row.slug} would be left with no link`);
  const derived = deriveItem(type, ls);
  const vector = buildVector(derived, { id, slug: row.slug, createdAt: row.created_at });
  const gained = [...userRows.values()].some((r) => r.media_item_id === id) || folds.some((f) => idOf(f.to) === id);
  sql.push(`UPDATE media_items SET title = ${q(derived.canonical.title)}, norm_title = ${q(normalizeName(derived.canonical.title))}, release_date = ${q(derived.canonical.releaseDate)}, poster_url = ${q(derived.canonical.posterUrl)}, vote_count = ${q(derived.voteCount)}, vote_average = ${q(derived.voteAverage)}${gained && row.browsed ? ", browsed = 0" : ""}, updated_at = unixepoch() WHERE id = ${q(id)};`);
  sql.push(`INSERT INTO item_doc (media_item_id, vector, facets, merged, derive_version, derived_at) VALUES (${q(id)}, ${q(JSON.stringify(vector))}, ${q(JSON.stringify(derived.facets))}, ${q(JSON.stringify(derived.merged))}, ${DERIVE_VERSION}, unixepoch()) ON CONFLICT(media_item_id) DO UPDATE SET vector = excluded.vector, facets = excluded.facets, merged = excluded.merged, derive_version = excluded.derive_version, derived_at = excluded.derived_at;`);
  const want = new Set(); for (const l of ls) for (const [ns, ext] of Object.entries(extractCrossIds(l.source, l.data))) want.add(`${ns}\u0000${ext}`);
  const have = new Set(before.media_external_ids.filter((e) => e.media_item_id === id).map((e) => `${e.source}\u0000${e.external_id}`));
  for (const k of want) if (!have.has(k)) { const [ns, ext] = k.split("\u0000"); sql.push(`INSERT OR IGNORE INTO media_external_ids (source, external_id, media_item_id) VALUES (${q(ns)}, ${q(ext)}, ${q(id)});`); }
  for (const k of have) if (!want.has(k)) { const [ns, ext] = k.split("\u0000"); sql.push(`DELETE FROM media_external_ids WHERE source = ${q(ns)} AND external_id = ${q(ext)} AND media_item_id = ${q(id)};`); }
  const old = docBefore.get(id) ? JSON.parse(docBefore.get(id).vector) : {};
  report.push({ slug: row.slug, before: `${row.title} (${row.release_date ?? "no date"}) [${before.media_links.filter((l) => l.media_item_id === id).map((l) => l.source).join(", ")}]${old.addon ? " addon" : ""}`,
    after: `${derived.canonical.title} (${derived.canonical.releaseDate ?? "no date"}) [${ls.map((l) => l.source).join(", ")}]${vector.addon ? " addon" : ""}${gained && row.browsed ? ", joins the pool" : ""}` });
}
// A fold target outside the pool (created by /v1/resolve for the fold) takes
// the place of pool titles, so it joins the pool even when none of its own
// links changed. On 2026-10-23 prince-of-persia-1989 missed this and had no page.
for (const to of new Set(folds.map((f) => idOf(f.to)))) {
  if (touched.has(to) || !itemById.get(to).browsed) continue;
  sql.push(`UPDATE media_items SET browsed = 0, updated_at = unixepoch() WHERE id = ${q(to)};`);
  report.push({ slug: slugOf(to), before: "outside the pool", after: "joins the pool, links unchanged" });
}
sql.push("DELETE FROM kv WHERE key = 'pool_count';");
sql.push("UPDATE users SET counted_items = NULL, counted_episodes = NULL, counted_hidden = NULL WHERE counted_items IS NOT NULL OR counted_episodes IS NOT NULL OR counted_hidden IS NOT NULL;");

// ── 5. The undo: every row read, put back as it was ─────────────────────────
// A user row written on one of these titles after the change is lost by an
// undo, which deletes and re-inserts the whole set.
const undo = [];
for (const r of before.media_items) {
  if (removed.has(r.id)) undo.push(insert("media_items", { ...r, updated_at: null }).replace(/NULL\);$/, "unixepoch());"));
  else undo.push(`UPDATE media_items SET title = ${q(r.title)}, norm_title = ${q(r.norm_title)}, release_date = ${q(r.release_date)}, poster_url = ${q(r.poster_url)}, slug = ${q(r.slug)}, browsed = ${q(r.browsed)}, vote_count = ${q(r.vote_count)}, vote_average = ${q(r.vote_average)}, updated_at = unixepoch() WHERE id = ${q(r.id)};`);
}
const keySql = (k) => `(source = ${q(k.source)} AND source_id = ${q(k.source_id)} AND media_type = ${q(k.media_type)})`;
for (const l of before.media_links) undo.push(`DELETE FROM media_links WHERE ${keySql(l)};`, insert("media_links", l));
for (const a of aliasesAdded) undo.push(`DELETE FROM provider_aliases WHERE ${keySql(a)};`);
undo.push(`DELETE FROM provider_aliases WHERE media_item_id IN (${L});`);
for (const a of before.provider_aliases) undo.push(insert("provider_aliases", a).replace(/^INSERT/, "INSERT OR REPLACE"));
for (const t of ["item_doc", "media_external_ids", "item_ip_override", "user_item_state"]) {
  undo.push(`DELETE FROM ${t} WHERE media_item_id IN (${L});`);
  for (const r of before[t]) undo.push(insert(t, r));
}
undo.push(...sql.slice(-2));

// ── 6. Files ────────────────────────────────────────────────────────────────
const tooLong = [...sql, ...undo].filter((s) => Buffer.byteLength(s) > 95_000);
if (tooLong.length) throw new Error(`${tooLong.length} statement(s) over D1's 100 KB statement limit`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const base = path.join(ROOT, "data", "backups", `regroup-${where.slice(2)}-${stamp}`);
fs.mkdirSync(path.dirname(base), { recursive: true });
fs.writeFileSync(`${base}.json`, JSON.stringify({ plan, rows: before }));
fs.writeFileSync(`${base}.sql`, sql.join("\n") + "\n");
fs.writeFileSync(`${base}.undo.sql`, undo.join("\n") + "\n");
fs.writeFileSync(`${base}.redirects.json`, JSON.stringify(redirects, null, 1));
fs.writeFileSync(`${base}.report.md`, [
  `# Regroup ${where.slice(2)} ${stamp}`, "",
  `${removed.size} titles removed, ${report.length} re-derived, ${notes.filter((n) => n.startsWith("row")).length} user-row changes.`, "",
  "## Titles kept and re-derived", "", ...report.map((r) => `- \`${r.slug}\`: ${r.before} → ${r.after}`), "",
  "## Addresses that now redirect", "", ...redirects.map((r) => `- \`/${r.type}/${r.from}\` → \`/${r.type}/${r.to}\``), "",
  "## Every step", "", ...notes.map((n) => `- ${n}`), "",
].join("\n"));
if (opt("--snapshot")) {
  const users = [...new Set(before.user_item_state.map((r) => r.user_id))];
  const snap = [];
  if (users.length) for (const u of query(`SELECT * FROM users WHERE id IN (${list(users)})`)) snap.push(insert("users", u).replace(/^INSERT/, "INSERT OR IGNORE"));
  for (const t of ["media_items", "media_links", "item_doc", "media_external_ids", "provider_aliases", "item_ip_override", "user_item_state"]) for (const r of before[t]) snap.push(insert(t, r));
  fs.writeFileSync(opt("--snapshot"), snap.join("\n") + "\n");
  console.log(`snapshot: ${snap.length} rows in ${opt("--snapshot")}`);
}
console.log(`${ids.length} titles read (${rowsRead} rows read); ${removed.size} removed, ${report.length} re-derived, ${sql.length} statements.`);
console.log(`files: ${path.relative(ROOT, base)}.{json,sql,undo.sql,report.md,redirects.json}`);
if (!flag("--apply")) { console.log("Dry run. Add --apply to run it."); process.exit(0); }

d1(["--file", `${base}.sql`, "--yes"]);

// ── 7. Check ────────────────────────────────────────────────────────────────
const left = query(`SELECT COUNT(*) n FROM media_items WHERE id IN (${R})`)[0].n;
const after = query(`SELECT source, source_id, media_type, media_item_id FROM media_links WHERE media_item_id IN (${L})`);
const wrong = [...links.values()].filter((l) => !after.some((a) => linkKey(a) === linkKey(l) && a.media_item_id === l.media_item_id));
const docs = query(`SELECT COUNT(*) n FROM item_doc WHERE media_item_id IN (${L})`)[0].n;
const rowsAfter = query(`SELECT user_id, media_item_id, source, relation FROM user_item_state WHERE media_item_id IN (${L})`);
const rowsWrong = rowsAfter.length !== userRows.size || rowsAfter.some((r) => !userRows.has(`${r.user_id}|${r.media_item_id}|${r.source}|${r.relation}`));
console.log(`after: ${left} removed titles left, ${wrong.length} links misplaced, ${docs} docs for ${ids.length - removed.size} kept, user rows ${rowsWrong ? "DIFFER from the plan" : "as planned"} (${rowsAfter.length})`);
if (left || wrong.length || docs !== ids.length - removed.size || rowsWrong) process.exit(1);
