// Cross-link backfill — give every catalog game the source links it's missing,
// above all STEAM, which is the tag source: 446 tags including `Deckbuilding`
// and `Tower Defense`, where RAWG and IGDB stop at genre level. `mergeLinks`'
// TAG_SOURCES already unions all three into an item's tags, so a missing link is
// directly a poorer Fandex Score and a game a tag search can't find.
//
// Measured before the first run: 473 of 1,090 catalog games had no Steam link,
// because the sync adapters only ever cross-linked WISHLIST items — nothing
// anyone actually played was touched. The adapters now cross-link both (see
// sources/crossLink.ts); this is the one-off pass for everything already stored.
//
// Idempotent and resumable: a source already linked is skipped before any
// network call, so re-running only picks up what's new. Insert-only — it can
// never overwrite a richer stored payload.
//
//   npx tsx --env-file=.env scripts/backfill-game-crosslinks.ts --dry-run
//   npx tsx --env-file=.env scripts/backfill-game-crosslinks.ts --limit 25
//   npx tsx --env-file=.env scripts/backfill-game-crosslinks.ts --source steam
//   npx tsx --env-file=.env scripts/backfill-game-crosslinks.ts            # full run
//
// Env: DB_PATH (defaults to ./data/rr.db) + STEAM_API_KEY / RAWG_API_KEY /
// TWITCH_* for the searches. MUTATES the database — back it up first.
import { query } from "@/lib/db";
import { crossLinkGame, GAME_SOURCES } from "@/lib/sources/crossLink";
import type { Source } from "@/types";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const numArg = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? parseInt(args[i + 1] ?? "0", 10) : 0;
};
const limit = numArg("--limit");
const sourceArg = (() => {
  const i = args.indexOf("--source");
  return i >= 0 ? (args[i + 1] as Source) : null;
})();
const wanted: readonly Source[] = sourceArg ? [sourceArg] : GAME_SOURCES;

interface Row { id: string; title: string; release_date: string | null; sources: string }

async function main() {
  // One row per game with its linked sources, so the "what's missing" decision
  // is made here rather than N queries deep.
  const rows = query<Row>(
    `SELECT mi.id, mi.title, mi.release_date,
            (SELECT GROUP_CONCAT(ml.source) FROM media_links ml WHERE ml.media_item_id = mi.id) AS sources
       FROM media_items mi
      WHERE mi.type = 'game'
      ORDER BY mi.title`
  );

  const needing = rows.filter((r) => {
    const have = new Set((r.sources ?? "").split(",").filter(Boolean));
    return wanted.some((s) => !have.has(s));
  });

  const missingBySource: Record<string, number> = {};
  for (const r of needing) {
    const have = new Set((r.sources ?? "").split(",").filter(Boolean));
    for (const s of wanted) if (!have.has(s)) missingBySource[s] = (missingBySource[s] ?? 0) + 1;
  }

  console.log(`games in catalog:        ${rows.length}`);
  console.log(`missing at least one:    ${needing.length}`);
  console.log(`missing links by source:`, missingBySource);
  console.log(`targeting:               ${wanted.join(", ")}`);

  if (dryRun) {
    console.log("\n--dry-run — no writes. First 10 that would be searched:");
    for (const r of needing.slice(0, 10)) {
      const have = new Set((r.sources ?? "").split(",").filter(Boolean));
      console.log(`  ${r.title.slice(0, 50).padEnd(52)} has[${[...have].join(",")}] → needs[${wanted.filter((s) => !have.has(s)).join(",")}]`);
    }
    return;
  }

  const work = limit > 0 ? needing.slice(0, limit) : needing;
  console.log(`\nprocessing ${work.length}${limit > 0 ? ` (--limit ${limit})` : ""}…\n`);

  const addedBySource: Record<string, number> = {};
  let touched = 0;
  for (let i = 0; i < work.length; i++) {
    const r = work[i];
    // No budget: this IS the bulk pass, and it paces itself between searches.
    const added = await crossLinkGame(r.id, r.title, { sources: wanted, releaseDate: r.release_date });
    if (added.length) {
      touched++;
      for (const s of added) addedBySource[s] = (addedBySource[s] ?? 0) + 1;
      console.log(`  [${i + 1}/${work.length}] ${r.title.slice(0, 48).padEnd(50)} +${added.join(",")}`);
    } else if ((i + 1) % 25 === 0) {
      console.log(`  [${i + 1}/${work.length}] …`);
    }
  }

  console.log(`\ndone — ${touched} games gained links`);
  console.log(`links added by source:`, addedBySource);
}

main().catch((e) => { console.error(e); process.exit(1); });
