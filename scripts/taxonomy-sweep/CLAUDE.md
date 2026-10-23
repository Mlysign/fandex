# The weekly taxonomy sweep

How it runs, and the scheduled task on Nils's PC, are in memory [[taxonomy-sweep-weekly]]. Its reports and undo files land in `docs/archive/taxonomy-sweeps/`.

- **The sweep NEVER changes a row that was already there.** Inserts only (`ON CONFLICT DO NOTHING`); a bundle or spelling that would re-point an existing alias is skipped; hand-placed tags are refused; `category-merge` runs only with `--allow-category-merge`, which the schedule never passes.
- **Every row it writes carries one `updated_at` stamp** (plus `source = 'sweep'` where the table has the column), and the undo deletes only rows still holding it. Keep that when touching `apply.mjs`.
- **`prepare.mjs` stops when it can't read the dismissals, and `apply.mjs` refuses without them**, so a denied suggestion is never re-proposed.
- **A new facet page kind also goes in `mobile/web/worker.ts`'s `appRoute`**, or its address 404s in a browser.
