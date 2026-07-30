<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project doc map (start here)

- `STATUS.md` — live state + what's left, one page. Read this first.
- `TASKS.md` — the open work in detail (source of truth for execution).
- `docs/archive/history.md` — everything finished (completed phases, resolved audit findings, closed bugs/QA findings). Grep it for a keyword when you need the "why" behind a past decision — don't read it end to end, and don't pull it into context for planning new work.
- `PLATFORMS.md` — platform integration capability reference.
- `smoketest.md` — the `/smoketest` living plan; findings land in `TASKS.md`.
- `.claude/plans/` — session plans written by one session and executed by another (the audit trail of planned-vs-shipped). This is the one path under `.claude/` that is tracked.

## Verifying anything behind a login

`/library`, `/wishlist`, `/insights`, `/profile`, `/settings` and the item-detail personal block all `router.replace("/")` for anonymous visitors, so **none of them can be checked without a session.** Use **`GET /api/dev/login`** — it mints one for the `users.id` in `DEV_LOGIN_USER_ID` and redirects to `/`; the local `.env` already points at the real account. Works in the in-app browser pane.

Don't hand-mint a JWT (the harness blocks it as credential-forging, correctly) and don't assume anon-only verification is the best available — that assumption is why several batches shipped "not yet verified logged-in". **Never call `/api/auth/logout` to test the anon side**: it bumps `session_epoch` and kills Nils's own browser session, which only a real OAuth round-trip restores.

The route's three fail-closed gates (`NODE_ENV !== "production"` · loopback host · a real identity row) are what keep it off fandex.org. Do not relax them, and treat it as auth code — main-loop only, per the routing rules below.

## Load-bearing invariants (don't relearn these the hard way)

- **The prune invariant:** a sync pull that fails must THROW, never return `[]`/partial. `syncProvider` (`src/lib/sync/index.ts`) deletes every local entry missing from a successful pull, so a swallowed error silently wipes the user's library. When adding any adapter: a pull that can't complete must throw; a pull that legitimately found nothing may return `[]`.
- **The thin-write / pool rule:** a discover-time write is insert-only and stamps `browsed=1` / projection version `0` — it must never overwrite or degrade a real synced/ingested row.
- **Migrations have TWO apply paths** — in-process via `getDb()` (what tests/prod use) and standalone via `node scripts/migrate.mjs` (plain Node, resolves neither the `@/*` alias nor extensionless specifiers). Green tests only prove the in-process path. After touching `migrations.ts`, run the standalone script against a DB copy.
- **`db.ts`'s `CREATE TABLE`/`CREATE INDEX` block runs BEFORE migrations** and must stay valid against an OLD (pre-migration) schema. A column added by a migration must have its index created in that *same* migration, never in the schema block — putting them together only works on a fresh DB and silently breaks every upgrade path.
- **Any route reading an env var to build an absolute URL (`BASE_URL`, etc.) must export `dynamic = "force-dynamic"`.** Next prerenders route handlers without it at `next build` time, and Railway's build-phase env can differ from its runtime env (confirmed: `NEXT_PUBLIC_BASE_URL` resolves correctly at runtime but wasn't available at build) — the wrong value gets baked into the static output permanently, invisible until you actually read the response body (status 200 either way). `sitemap.ts` had this from the start; `robots.ts` didn't and shipped `localhost:3000` to prod until a live smoketest caught it (SM7, 2026-07-19). `/legal/[locale]/[doc]` (H4.1, 2026-07-30) is the same trap: `generateMetadata` builds canonical + hreflang URLs from `BASE_URL`, so it needs the export too — verify with `npm run build`'s route table showing `ƒ (Dynamic)`, not `○ (Static)`.

- **Erasure is schema-derived, and a `user_id` column is what makes a table personal.** `deleteAccount()` (`src/lib/account.ts`, H4.6) finds its targets by reading `sqlite_master` for tables with a `user_id` column, deletes them explicitly (never trusting `ON DELETE CASCADE`, which is a silent no-op without `foreign_keys = ON`), and re-checks completeness inside the transaction. So: a new user-scoped table is covered the moment it exists — but **only if its owning column is literally named `user_id`**. Name it anything else and GDPR erasure silently skips it with every test still green. Same rule in the other direction for `/api/account/export`: it uses explicit column lists, never `SELECT *`, so credentials can't drift into a file the user downloads.

Each of these has a fuller writeup in memory ([[trakt-sync-completeness]], [[data-model-gaps-and-plan]], [[migrate-mjs-two-apply-paths]], [[fresh-db-tests-hide-upgrade-bugs]], [[railway-build-vs-runtime-env]], [[account-erasure-and-export]]) — read the relevant one before touching schema, migrations, a sync/pull adapter, a route that builds absolute URLs, or anything user-scoped.

- **A type-only import must be written `import type` — enforced as an eslint ERROR (`consistent-type-imports`, 2026-07-30).** Not style: Node's native type-stripping (what `scripts/alias-hooks.mjs` gives every `rehearse-*.mjs`/`calibrate-*.mjs`) erases only *syntactically* type-only constructs, so a plain `import { Foo }` where `Foo` is an interface throws `SyntaxError: does not provide an export named 'Foo'` the moment a standalone script reaches that module — while tsc, vitest, `next dev` and `next build` all elide it correctly and report nothing. Every export of `src/types/index.ts` is type-only. **And: do not run `eslint --fix` broadly without diffing for non-import changes** — it rewrote three `{/* eslint-disable-next-line */}` JSX comments in `AuthOptions.tsx` to a bare `{ }`, destroying the directives while looking inert (both render nothing).
- **`npm run lint` scans the whole cwd with no path filter — a stray `git worktree` under `.claude/worktrees/` (from an `isolation:"worktree"` agent run) gets scanned too, gitignored or not.** `eslint.config.mjs`'s `globalIgnores` excludes `.claude/worktrees/**` explicitly now (2026-07-30), after an abandoned worktree from an unrelated prior session — checked out at an old commit, predating a since-added lint rule — surfaced 200+ false "errors". If `npm run lint` ever reports a wall of errors you don't recognize, check `git worktree list` before assuming you broke something; never delete a worktree you didn't create without checking first, it may be another session's in-progress work.
- **The `react-hooks/*` eslint rules are ERRORS here, and the repo is error-clean.** Some remaining `set-state-in-effect` flags are on genuinely idiomatic patterns (storage hydration, prop→state sync, data-fetch-on-mount, load guards, layout measurement) and carry justified `eslint-disable-next-line` comments — those are correct as-is, not bugs to fix. Don't remove a disable comment without checking why it's there first.

## Model/agent routing for this repo

The main session's model is whatever the human picked — this doesn't change that. It guides which model/agent tier to reach for when *delegating* via the Agent/Task/Workflow tools:

- **Bulk file search / "where is X" exploration** → the `Explore` agent at the default model. Cheap, fast, keeps the main context clean.
- **Mechanical doc maintenance** (archiving a finished phase, reformatting, renaming) → fine to delegate at low effort. Low blast radius, easy to review the diff afterward.
- **Anything touching `migrations.ts`, `matcher.ts`'s write paths, sync/pull adapters, or auth/session code** → do NOT delegate to a background/low-effort agent. These carry the invariants above (a mistake risks data loss or an auth hole) — do this work in the main loop at full effort, and verify against real `data/rr.db` behavior rather than trusting green tests alone (see [[fresh-db-tests-hide-upgrade-bugs]]: every DB test starts fresh, so none of them exercise the upgrade path production actually takes).
