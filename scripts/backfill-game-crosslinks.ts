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
import { GAME_SOURCES } from "@/lib/sources/crossLink";
import { surveyGameCrossLinks, runCrossLinkBatch } from "@/lib/sources/crossLinkBackfill";
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

async function main() {
  // Same survey the /api/dev/crosslink route reports, so a local dry run and a
  // prod one can't disagree about what's missing.
  const survey = surveyGameCrossLinks(wanted);
  console.log(`games in catalog:        ${survey.totalGames}`);
  console.log(`missing at least one:    ${survey.needing}`);
  console.log(`missing links by source:`, survey.missingBySource);
  console.log(`targeting:               ${wanted.join(", ")}`);

  if (dryRun) {
    console.log("\n--dry-run — no writes, no network calls.");
    return;
  }

  const total = limit > 0 ? Math.min(limit, survey.needing) : survey.needing;
  console.log(`\nprocessing ${total}${limit > 0 ? ` (--limit ${limit})` : ""}…\n`);

  let done = 0;
  const result = await runCrossLinkBatch({
    sources: wanted,
    maxItems: limit > 0 ? limit : Number.MAX_SAFE_INTEGER,
    // No wall-clock budget: this IS the bulk pass, run from a terminal, and it
    // paces itself between searches. The route is the one that needs a deadline.
    onProgress: (title, added) => {
      done++;
      if (added.length) console.log(`  [${done}/${total}] ${title.slice(0, 48).padEnd(50)} +${added.join(",")}`);
      else if (done % 25 === 0) console.log(`  [${done}/${total}] …`);
    },
  });

  console.log(`\ndone — ${result.itemsLinked} games gained links (${result.itemsProcessed} visited)`);
  console.log(`links added by source:`, result.addedBySource);
  if (result.remaining > 0) console.log(`still to visit: ${result.remaining} (re-run to continue)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
