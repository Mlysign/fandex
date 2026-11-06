# The weekly taxonomy sweep

How it runs, and the scheduled task on Nils's PC, are in memory [[taxonomy-sweep-weekly]]. Its reports and undo files land in `docs/archive/taxonomy-sweeps/`.

- **The sweep NEVER changes a row that was already there.** Inserts only (`ON CONFLICT DO NOTHING`); a bundle or spelling that would re-point an existing alias is skipped; hand-placed tags are refused; `category-merge` runs only with `--allow-category-merge`, which the schedule never passes.
- **Every row it writes carries one `updated_at` stamp** (plus `source = 'sweep'` where the table has the column), and the undo deletes only rows still holding it. Keep that when touching `apply.mjs`.
- **`prepare.mjs` stops when it can't read the dismissals, and `apply.mjs` refuses without them**, so a denied suggestion is never re-proposed.
- **A new facet page kind also goes in `mobile/web/worker.ts`'s `appRoute`**, or its address 404s in a browser.
- **A "no" to a Review card is a `deny` action, never a `skip`.** `deny` writes the row the app's Deny writes (`taxonomy_suggestion_dismissed`), so the card leaves Review; `skip` only reaches `decided.json`, which Review never reads.
- **Every tag in Other is sorted each week, not just the common ones.** Listing only tags on three or more titles let 5,562 pile up by 2026-11-06. `prepare.mjs` writes them all to `other.txt` (chunked past 700), subagents sort them per `other-brief.md`, and `join-other.mjs` checks and appends the moves.
- **A bundle counts under its MAIN tag's category, and resolves in one hop.** A category set on a bundled spelling is dead. `check-bundles.mjs` lists chains (errors) and bundles whose spelling was placed elsewhere (to decide: a tag-category, SQL with an undo, or a `skip` `bundle-category|<main tag>`).
- **The weights move only on a `ship` verdict from `scripts/score-tune.mjs`**, which tunes on half the ratings and judges on the other half; `scripts/score-apply-weights.mjs` refuses anything else and writes the undo. A search that wins only on its own half is overfitting (2026-11-06: 1.465 → 1.432 tuning, 1.543 → 1.547 checking).
- **One pass is ONE run.** `--limit kind:N` raises a cap for a pass asked for by hand; never chunk. Each run checks against the taxonomy it was prepared from, so a later chunk can re-point a tag an earlier one just made a target, and aliases resolve in one hop. A new Review card kind also goes in the Worker's `SUGGESTION_KINDS` and in `REVIEW_KINDS` here.
