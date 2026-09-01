// The leftovers of SM50: what `repair-cross-type-links.mjs` does NOT touch.
//
// Two kinds, both minted from the wrong title while the item was still merged,
// and both invisible to a repair that only moves links and external ids.
//
//   1. THE SLUG. Three movies are wearing a show's.
//   2. AN IP OVERRIDE. One movie is hand-attached to a show's franchise, so its
//      page rendered a rail headed "More from SpongeBob SquarePants" full of
//      Nickelodeon games. Found by reading the rendered page after the link
//      repair had already run and reported success.
//
//   /movie/spongebob-squarepants  ->  Being John Malkovich (1999)
//   /movie/legion                 ->  The Raid 2 (2014)
//   /movie/house-of-cards         ->  Ratatouille (2007)
//
// All three verified live on fandex.org before this was written. They are
// public, crawlable urls naming the wrong work.
//
// ── Why the link repair leaves them behind ──────────────────────────────────
// `ensureItemSlug` assigns a slug ONCE, right after the media_items row is
// created, and never changes it, deliberately: "a url that moves when a
// provider retitles a film is a url nobody can share". The cross-type merge
// (migration 23's bug) gave these rows the show's title at create time, so the
// slug was minted from it. Repairing the links moves the provider ids back and
// restores each title, but the slug is immutable by contract and stays wrong.
// `grep -n slug scripts/repair-cross-type-links.mjs` shows it only ever READS
// the column.
//
// ── Why this is a three-row list and not a detector ─────────────────────────
// A generic "slug does not match slugify(title)" sweep would flag every item
// whose provider retitled it after creation, which is the immutability rule
// working as designed, not damage. The real fingerprint is narrower: a slug
// shared across two types where one holder's title cannot produce it.
//
// Surveyed on prod 2026-09-01: **46 slugs are shared across types and 43 of
// them are correct**, because slugs are unique PER TYPE and `/game/batman` and
// `/movie/batman` are two right answers. Exactly three had a mismatched title,
// and they are the three below. Migration 23 makes the cross-type merge
// impossible, so this list cannot grow.
//
// ── How the replacement slugs were derived ─────────────────────────────────
// By the app's own `slugCandidate(title, release_date, attempt)` from
// src/lib/publicUrl.ts, run locally against the real titles. NOT by a copy of
// slugify pasted in here: it depends on `transliterate`, and a duplicated
// normaliser is the exact drift this repo has been bitten by before. The
// attempt-1 fallback is the same year suffix `pickSlug` would pick.
//
//   node scripts/repair-cross-type-slugs.mjs <db-path>            # report
//   node scripts/repair-cross-type-slugs.mjs <db-path> --apply    # repair
//
// Idempotent: every row is matched on its CURRENT wrong slug and title, so a
// second run is a no-op, and a row that has already moved is skipped rather
// than overwritten.
import Database from "better-sqlite3";

/**
 * Each entry names the row by id, states what it must look like NOW, and gives
 * the slug it should take. `fallback` is `slugCandidate(title, date, 1)`, used
 * only if `slug` is already taken within the type.
 */
const REPAIRS = [
  {
    id: "6b46fcd5-c79f-49c4-92a1-e0e745423d56",
    expectTitle: "Being John Malkovich",
    expectSlug: "spongebob-squarepants",
    slug: "being-john-malkovich",
    fallback: "being-john-malkovich-1999",
  },
  {
    id: "034870fb-2194-41c1-8afa-878bb9f09096",
    expectTitle: "The Raid 2",
    expectSlug: "legion",
    slug: "the-raid-2",
    fallback: "the-raid-2-2014",
  },
  {
    id: "c9973488-b37c-4409-af7e-3d73242ad40c",
    expectTitle: "Ratatouille",
    expectSlug: "house-of-cards",
    slug: "ratatouille",
    fallback: "ratatouille-2007",
  },
];

/**
 * IP overrides attached to the wrong work, same cause as the slugs above.
 *
 * The 2026-08-14 Wikidata franchise sweep resolved each item by its title, and
 * this one's title was "SpongeBob SquarePants" at the time, so the sweep did
 * exactly the right thing with the wrong input. `mode: "add"` means the row
 * ADDS the franchise, so deleting it removes the association.
 *
 * ⚠️ Surveyed before writing this: prod holds **498 overrides** and only this
 * one is wrong. A crude "does the item's title share a word with the ip label"
 * test flagged 53, and 52 of those are CORRECT and are the whole point of the
 * feature (Prometheus → Alien, Andor → Star Wars, Better Call Saul → Breaking
 * Bad, every Harry Potter → Wizarding World). Do not turn that heuristic into a
 * sweep; it would delete the good ones.
 *
 * Durable: re-running the sweep now resolves the corrected title, so this does
 * not come back.
 */
const IP_OVERRIDE_REMOVALS = [
  {
    id: "6b46fcd5-c79f-49c4-92a1-e0e745423d56",
    expectTitle: "Being John Malkovich",
    ipKey: "spongebob squarepants",
    label: "SpongeBob SquarePants",
  },
];

const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dbPath) {
  console.error("usage: node scripts/repair-cross-type-slugs.mjs <db-path> [--apply]");
  process.exit(1);
}

const db = new Database(dbPath);
const readRow = db.prepare("SELECT id, type, title, slug FROM media_items WHERE id = ?");
const slugTaken = db.prepare("SELECT id, title FROM media_items WHERE type = ? AND slug = ? AND id <> ?");

const plan = [];
for (const r of REPAIRS) {
  const row = readRow.get(r.id);
  if (!row) {
    plan.push({ id: r.id, action: "skip", why: "no such row" });
    continue;
  }
  if (row.slug === r.slug || row.slug === r.fallback) {
    plan.push({ id: r.id, title: row.title, action: "skip", why: "already repaired", slug: row.slug });
    continue;
  }
  if (row.title !== r.expectTitle || row.slug !== r.expectSlug) {
    // Refuse rather than guess. The row is not in the state this repair was
    // written against, so something else has touched it.
    plan.push({
      id: r.id,
      action: "REFUSE",
      why: "row does not match the expected state",
      expected: { title: r.expectTitle, slug: r.expectSlug },
      actual: { title: row.title, slug: row.slug },
    });
    continue;
  }
  const clash = slugTaken.get(row.type, r.slug, r.id);
  const chosen = clash ? r.fallback : r.slug;
  const clashFallback = clash ? slugTaken.get(row.type, r.fallback, r.id) : null;
  if (clash && clashFallback) {
    plan.push({ id: r.id, action: "REFUSE", why: "both the slug and its year fallback are taken", clash, clashFallback });
    continue;
  }
  plan.push({
    id: r.id,
    type: row.type,
    title: row.title,
    action: "rename",
    from: row.slug,
    to: chosen,
    usedFallbackBecause: clash ? `${r.slug} is held by ${clash.title}` : undefined,
    oldUrlAfter: `/${row.type}/${row.slug} will 404, which is correct: it never named this work`,
  });
}

const readOverride = db.prepare("SELECT * FROM item_ip_override WHERE media_item_id = ? AND ip_key = ?");
const ipPlan = [];
for (const r of IP_OVERRIDE_REMOVALS) {
  const row = readRow.get(r.id);
  const ov = readOverride.get(r.id, r.ipKey);
  if (!ov) {
    ipPlan.push({ id: r.id, action: "skip", why: "override already gone", ip: r.label });
    continue;
  }
  if (!row || row.title !== r.expectTitle) {
    ipPlan.push({ id: r.id, action: "REFUSE", why: "item is not in the expected state", expected: r.expectTitle, actual: row?.title ?? null });
    continue;
  }
  ipPlan.push({ id: r.id, title: row.title, action: "detach", ip: r.label, mode: ov.mode, source: ov.source });
}

console.log(JSON.stringify({ dbPath, apply, plan, ipPlan }, null, 2));

const refused = [...plan, ...ipPlan].some((p) => p.action === "REFUSE");

if (!apply) {
  console.log("\nreport only. re-run with --apply to repair.");
  process.exit(refused ? 1 : 0);
}

if (refused) {
  console.error("\nREFUSED: at least one row is not in the expected state. Nothing written.");
  process.exit(1);
}

const update = db.prepare("UPDATE media_items SET slug = ? WHERE id = ? AND slug = ?");
const dropOverride = db.prepare("DELETE FROM item_ip_override WHERE media_item_id = ? AND ip_key = ?");
const renames = plan.filter((p) => p.action === "rename");
const detaches = ipPlan.filter((p) => p.action === "detach");
const run = db.transaction(() => {
  let slugs = 0, ips = 0;
  for (const p of renames) slugs += update.run(p.to, p.id, p.from).changes;
  for (const p of detaches) ips += dropOverride.run(p.id, IP_OVERRIDE_REMOVALS.find((r) => r.id === p.id).ipKey).changes;
  return { slugs, ips };
});
const changed = run();

console.log(JSON.stringify({
  applied: true,
  renamed: changed.slugs,
  ipOverridesRemoved: changed.ips,
  note: "slugs are immutable by contract; this repair exists only because the cross-type merge minted them, and the Wikidata sweep's ip override, from the wrong title. Migration 23 makes that impossible, so neither list can grow.",
}, null, 2));
