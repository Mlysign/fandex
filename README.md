# Fandex

Track **games, movies, shows, books and board games** in one place: a release calendar, a
wishlist and a library synced with Trakt, per-episode show tracking, and a Fandex Score that
learns your taste.

## What is in this repo

Three things run, and they share one folder of code.

- `worker/`: **the API.** A Cloudflare Worker on D1 (the database) and R2 (backups, book
  covers), at `api.fandex.org`. It holds the shared catalog and the accounts, and proxies the
  providers whose keys must not ship in an app. → `docs/worker.md`
- `mobile/`: **the app.** Expo / React Native, built as an Android APK. Each device keeps its own
  copy of the catalog and of your rows, and talks to Trakt itself. → `docs/app.md`
- `mobile/web/`: **the website, fandex.org.** The same app exported for the browser, plus a
  static page for every title, tag, person and studio, served by Cloudflare. → `docs/website.md`
- `src/lib/`: **the shared modules** the three import (merging a title's sources, facets, provider
  clients, the legal pages). Tested from the root.

The old Next.js site was deleted on 2026-10-23, after running nowhere since 2026-10-05. It is
kept at the git tag `old-site-final` as the visual reference for the app:

```bash
git worktree add ../fandex-old-site old-site-final
```

## Commands

| What | Where | Command |
|---|---|---|
| Shared lib tests | root | `npm test` |
| Lint all three packages | root | `npm run lint` |
| Typecheck | root, `worker/`, `mobile/` | `npx tsc --noEmit` |
| Worker tests | `worker/` | `npm test` |
| Deploy the API | `worker/` | `npx wrangler d1 migrations apply fandex --remote`, then `npx wrangler deploy` |
| App tests | `mobile/` | `npm test` |
| Run the app in a browser | `mobile/` | `npm run web` |
| Publish the website | root | `node mobile/web/publish.mjs` |
| A local API and app with test accounts | root | `node worker/scripts/dev-stack.mjs` |

Secrets live in `.env` (never committed) and reach the Worker through
`node worker/scripts/push-secrets.mjs`, which prints names and lengths only.

## Project docs

- `STATUS.md`: the live state in one screen. Read this first.
- `TASKS.md`: what is still open.
- `AGENTS.md`: the doc map and every rule the code depends on.
- `docs/decisions.md`: settled calls. `docs/archive/history.md`: everything finished (grep it).
- `PLATFORMS.md`: what each provider can do, and on what terms.
- `smoketest.md`: the exploratory test plan.
