# Fandex: rules for agents

## Where things are written down

**`STATUS.md` first** (state in one screen), then **`TASKS.md`** (open work only, led by a "Needs Nils" list).

- `docs/decisions.md`: settled calls and standing constraints. **Read before proposing anything that sounds new.** Every line is closed.
- `docs/worker.md`: the API (routes, D1 limits with what was measured, commands, test accounts). Before touching `worker/` or a `src/lib` module it imports.
- `docs/app.md`: the Expo app (screens, data sources, building the APK). Before touching `mobile/`.
- `docs/app-parity.md`: what the app still owes the old site. Before building or restyling a screen, or calling a feature done.
- `docs/website.md`: fandex.org (addresses, the publish command, the nightly task). Before touching `mobile/web/`, `ItemPage` or the legal content.
- `docs/app-plan.md`: why the project is an app plus a static site on Cloudflare, and which provider keys may ship in an APK. Before any hosting or cost conversation.
- `docs/fandex-score.md` (the score's design), `docs/letterboxd-import.md` (the list import), `docs/monetization-legal.md` (the legal gate on affiliate links), `docs/play-store.md` (putting the native app on Google Play), `docs/design/fandex-handoff/` (the design system), `PLATFORMS.md` (what each provider allows), `smoketest.md` (the `/smoketest` plan).
- `docs/archive/`: finished work, the old site's docs included. **Grep, never read end to end.**

**Rules live next to the code they protect.** This file holds what applies everywhere. Each package has its own `CLAUDE.md`, which Claude Code loads on reading a file in that folder:
`worker/CLAUDE.md` (D1, the API), `mobile/CLAUDE.md` (the app), `mobile/web/CLAUDE.md` (the website), `src/CLAUDE.md` (the shared modules and providers), `scripts/taxonomy-sweep/CLAUDE.md`.

### Doc conventions (each one has been broken and re-applied)

1. **A finished section moves to `docs/archive/history.md` the same session**, leaving at most a one-line pointer.
2. **`STATUS.md` holds state, not a changelog.** Git log and the archive hold the history.
3. **A rule is the RULE in one to three lines plus a `→` pointer.** The incident behind it goes in the memory file the pointer names.
4. **A new rule goes in the `CLAUDE.md` of the folder whose code it protects**, and in this file only when it spans packages. A folder's file is loaded every time somebody works there, which is the reader the rule is for.
5. **A rule leaves when the code it protects is deleted**, to `docs/archive/`. The old site's 64 rules are in `docs/archive/old-site/invariants.md`.
6. **An index entry is a hook**: enough to answer "do I need to open this?". That covers this list and the memory index.

**Budget:** this file plus `CLAUDE.md` and the memory index, the set every session pays for, stays under 25 KB. Measure it at the top of any hygiene pass. CI warns when `TASKS.md` passes 200 lines.

## Stack and commands

Three things are live: **the API** (`worker/`, a Cloudflare Worker on D1 at `api.fandex.org`), **the app** (`mobile/`, Expo, the APK on Nils's phone) and **the website** (`mobile/web/`, fandex.org, a static build of the app). The root holds the **shared modules** in `src/lib` that all three import, `src/lib/legal` included (its strings are the live legal pages), plus the repo-wide lint and the taxonomy sweep. The old Next.js site was deleted on 2026-10-23 and is at the git tag `old-site-final`, which stays the app's visual reference (`git worktree add ../fandex-old-site old-site-final`, then `npm ci` there).

TypeScript · Cloudflare Workers + D1 + R2 · Expo / React Native (also exported for the web) · Vitest.

| Task | Command |
|---|---|
| Shared lib tests | `npm test` (root) |
| Typecheck | `npx tsc --noEmit` in the root, `worker/` and `mobile/` (three packages) |
| Lint, all three | `npm run lint` (root). 0 errors is the bar |
| Worker tests · deploy | `npm test` · `npx wrangler deploy` in `worker/` (migration first: `npx wrangler d1 migrations apply fandex --remote`) |
| App tests | `npm test` in `mobile/` |
| Publish the website | `node mobile/web/publish.mjs` (stop `app-web` first) |
| A local stack to test writes | `node worker/scripts/dev-stack.mjs` |

## Repo map

- `src/lib/`: about 54 shared modules, each imported by the Worker, the app or the website build. Pure code: no database, no Node-only API. `sources/` is provider fetch and parse, `http.ts` every third-party call, `legal/` the legal pages. `src/types/` is the shared types, all type-only.
- `worker/`: its own package (lockfile, tsconfig, Vitest config), CI job `worker`. `migrations/` is the D1 schema, `scripts/` the seed, secrets and the local stack. It compiles `../src/lib` under the Workers runtime, **so a change there can break the Worker without touching `worker/`.**
- `mobile/`: its own package the same way, CI job `app`. `mobile/web/` builds and serves fandex.org; its output `mobile/web/dist/` is gitignored, as is `mobile/android` (generated by `expo prebuild`; never edit it by hand).
- `scripts/`: `taxonomy-sweep/` (weekly), `gen-brand-marks.mjs`, and `alias-hooks.mjs`, which lets a script run `src/lib` under plain `node`.
- `public/`: the site's icons, copied in by the website build.
- `android-package/`: **gitignored and must stay so.** The TWA's Play upload key (`signing.keystore`, from before the native app was chosen for Play) and `signing-key-info.txt`, which holds its passwords in plaintext. It sits here so OneDrive backs it up. → `docs/archive/twa-play-store.md`

## Testing behind a sign-in

**A write is tested on this machine with a test account, never on fandex.org**, where the one account is Nils's and a rating is a real write to Trakt: `node worker/scripts/dev-stack.mjs`, the launch configurations `worker-local` and `app-web-local`, then "Test account" on a sign-in card. → `docs/worker.md` ("The test accounts"), `smoketest.md`

Don't hand-mint a JWT (the harness blocks it as credential forging, correctly). **Never sign out of Nils's real session to see the signed-out side**: sign-out bumps `session_epoch` and signs out every device he has. The in-app browser pane is already signed out.

## Rules that span packages

- **The prune invariant: a sync pull that fails must THROW, never return `[]` or a partial list.** The app's Trakt sync (`mobile/src/lib/traktSync.ts`), Steam sync (`steamSync.ts`) and state pull (`stateSync.ts`) delete every row missing from a successful pull, so a swallowed error wipes the library. So does a pull that outlived its session, or one that ignores an edit made while it ran (guarded by the session counter in `AuthProvider.tsx` and `withoutRowsChangedDuringRun`). A pull that legitimately found nothing may return `[]`. **Anything a pull carries beyond ids inherits this**: `undefined` ("says nothing about X") and `[]` ("authoritative, there is none") stay distinct. Gate on a declared capability, never on a sniff of the returned shape. → [[trakt-sync-completeness]]
- **A private Steam profile is an error, never an empty library.** Steam answers a private library with no `games` at all. `GET /v1/me/steam` answers 409 `steam-private` for it, and a failed half is a 502, never half an answer.
- **A per-user DISPLAY preference never reaches a sync pull.** `users.platforms` and `users.media_types` filter what a person SEES. A pull reads "absent" as "removed upstream", so filtering there deletes every matching row: turning Games off leaves the rows where they are. Nor do they reach the Fandex Score, where every facet weight is a deviation from the user's GLOBAL baseline. → [[user-display-preferences]]
- **A provider id is unique only WITHIN a media type.** Trakt and TMDB number movies and shows in separate sequences (trakt 386 is both *Being John Malkovich* and *SpongeBob*), so `media_links` is keyed `(source, source_id, media_type)` and every lookup from a provider id carries the type. → [[cross-type-identity-merge]]
- **A secret never reaches the terminal, and one that does is burned.** Check for a trailing newline before appending to `.env` (a missing one glued a key onto `DISCORD_CLIENT_SECRET`'s value). If a secret shows up in a transcript, say so and put its rotation at the top of Nils's list. → [[identity-only-auth-providers]]
- **Monetization is off, and that is the legal gate.** No affiliate code is live (the old site's is at the tag). The first live affiliate link makes Fandex commercial under §5 DDG, and every link must stay a direct outbound `<a href>`: a Fandex redirect or click pixel breaks §25 TDDDG's cookie exemption and Amazon's terms. → `docs/monetization-legal.md`, [[monetization-h3]]
- **The legal pages are closed and filled.** The Impressum holds a real home address and stays `noindex, nofollow, noarchive, nosnippet` and out of the sitemap. Don't "restore" an EU ODR link: that platform shut down 2025-07-20.

## Tooling

- **A type-only import is written `import type`** (an eslint ERROR). Node's type stripping, which `scripts/alias-hooks.mjs` gives every `.mjs`, erases only syntactically type-only imports, so a plain `import { Foo }` of an interface throws when a script reaches it while tsc and Vitest stay green.
- **Never edit a repo file with `node -e` string slicing. Use the Edit tool.** This checkout is CRLF, so `indexOf('\n\n')` returns -1 and `slice(-1)` keeps one character: it deleted 236 of `TASKS.md`'s 254 lines once. Backticks in a `node -e` string are command substitution in bash. If you must script an edit, compare line counts before and after.
- **Read eslint's `✖` totals line, never `tail`.** The last line is the FIXABLE summary, which reads as green over a real error: `npm run lint 2>&1 | grep -E '^✖'`.
- **Don't run `eslint --fix` broadly without diffing it.** It once turned three `{/* eslint-disable-next-line */}` JSX comments into a bare `{ }`. → [[eslint-fix-mangles-jsx-comments]]
- **A wall of unfamiliar lint errors usually means a stray worktree.** `npm run lint` scans the whole folder; check `git worktree list`, and **never delete a worktree you didn't create**. → [[worktree-needs-real-npm-ci]]
- **Stage by path, never `git add -A`.** Another session may be working in this checkout. → [[shared-checkout-stage-by-path]]

## Measuring

- **Measure before optimising, and quote a number with the database it came from.** A cold page load was blamed on the wrong cause for days once; a local copy and production disagree on every catalog count.
- **Take a time series, never a spot sample**, for cost, memory or row counts. In four incidents the obvious culprit was wrong every time.

## Delegating

- **Searching** ("where is X"): the `Explore` agent.
- **Mechanical doc work** (archiving, renaming): fine at low effort; review the diff.
- **Never delegate to a background or low-effort agent** anything touching `worker/migrations/`, `worker/src/catalog/ingest.ts`, `worker/src/auth/`, `worker/src/me.ts` or `account.ts`, or the app's sync (`mobile/src/lib/{traktSync,steamSync,stateSync,AuthProvider}`). A mistake there loses data or opens an auth hole. Do it in the main loop and verify against a real local D1, not only green tests.
