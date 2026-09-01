# Fandex

Track upcoming **games, movies, and shows** in one release calendar, synced from your
connected accounts (Trakt, TMDB, Steam, RAWG) with a personalized discover feed, taste-based
recommendations, per-episode show tracking (two-way with Trakt), and an insights view.

## Stack

- **Next.js 16** (App Router) + **React 19**, TypeScript, Tailwind CSS v4
- **SQLite** via `better-sqlite3` (single-file DB, WAL) — see *Hosting model* below
- Auth: JWT sessions (`jose`) over an httpOnly cookie; OAuth/OpenID per provider
- Tests: Vitest (`npm test`)

## Local development

```bash
npm install
npm run dev            # http://localhost:3000
```

Create a `.env` with the values from the table below. ⚠️ Note that **`.env.example` is not
in the repo** — `.gitignore` excludes `.env*`, so a fresh clone has no sample file to copy.
The table below is the authoritative list; boot-time validation will also name anything
missing.

`npm test` runs the suite. `npm run build` produces the production build.

## Environment variables

| Variable | Required | Purpose |
|---|:--:|---|
| `JWT_SECRET` | ✅ (prod) | Session signing. Generate: `openssl rand -hex 32`. **The server refuses to start in production without it.** |
| `TOKEN_ENCRYPTION_KEY` | ✅ (prod) | OAuth-token encryption at rest (S2). Generate: `openssl rand -hex 32`. **Must differ from `JWT_SECRET`.** |
| `TMDB_API_KEY` | ✅ | Movies & TV (core data source) |
| `RAWG_API_KEY` | ✅ | Games: the browse feed and the RAWG connector. Not the facet pages since PL3 |
| `NEXT_PUBLIC_BASE_URL` | ✅ | Public origin, no trailing slash (e.g. `https://app.example.com`) — used for OAuth redirects |
| `DB_PATH` | — | SQLite file path. Defaults to `./data/rr.db`; **set to the mounted volume in production** (e.g. `/app/data/rr.db`) |
| `STEAM_API_KEY` | ⬚ | Steam integration |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⬚ | Google sign-in (identity only, no library). Both halves or the button stays hidden. The id is `NEXT_PUBLIC_` deliberately and has a Dockerfile `ARG`; the secret must never be. Register `<origin>/api/auth/google/callback` in the Google console. |
| `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` / `TRAKT_REDIRECT_URI` | ⬚ | Trakt integration |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | ⬚ | IGDB game metadata (skipped if unset) |
| `BACKFILL_ENABLED` | ⬚ | **Phase 4: the seeded backfill. Default OFF.** `1` starts paced ingest toward 30–50k titles (`BACKFILL_PAGES` per 30 min, default 2; stops at `BACKFILL_MAX_ITEMS`, default 50,000). ⚠️ **The pacing is the safety feature** — 30–50k titles is 60–120k provider calls and every row is WAL that Litestream ships. Check Railway spend before raising anything. |
| `CATALOG_BROWSE` | ⬚ | **Phase 2: serve Discover browse from our own database. Default OFF.** `1` lets a (type, window) go local once it holds `CATALOG_BROWSE_MIN` rows (default 200), per type, so a thin lane keeps asking the provider. A ready section costs **zero** provider calls. |
| `HOUSEKEEPING_START_MB` | ⬚ | **Phase 5: reclaim `media_links.raw_data` above this file size** (default 1200 MB). Drops blobs, never rows, so pages and user data survive. A size trigger, not an age one. |
| `IGDB_ENABLED` | ⬚ | **IGDB kill switch. Default ON** — set to `0` to stop every IGDB call at once. It exists because the Twitch Developer Services Agreement, which IGDB's own docs name as its licence, allows storing copies only with prior written authorization or a 24-hour cache, while IGDB's own product ships webhooks for maintaining your local mirror. Awaiting an answer from `partner@igdb.com`. Flipping it stops the flow; `scripts/purge-igdb.mjs` removes what is already stored. See [docs/catalog-growth.md](docs/catalog-growth.md). |
| `TWA_PACKAGE_NAME` / `TWA_CERT_FINGERPRINT` | ⬚ | Android TWA Digital Asset Links (`/.well-known/assetlinks.json`) |
| `SYNC_BUDGET_MS` | ⬚ | Per-request wall-clock budget for a sync pass |
| `HEAL_BUDGET_MS` | ⬚ | Per-request wall-clock budget for `/api/discover/scores`' heal loop (default 10 000). Ids it can't heal in time come back as `deferred`, not scored |
| `MONETIZATION_ENABLED` | ⬚ | **H3 master kill switch — leave UNSET.** `1`/`true` turns on every affiliate link on the site. The first one makes Fandex commercial under §5 DDG, so this must not be set until H4.2's Impressum is live. See [docs/monetization-go-live.md](docs/monetization-go-live.md). |
| `AFFILIATE_AMAZON_TAG` / `AFFILIATE_AMAZON_HOST` | ⬚ | Amazon PartnerNet associate tag (marketplace-specific) and marketplace host (defaults `amazon.de`) |
| `AFFILIATE_HUMBLE_PARTNER` | ⬚ | Humble Store partner id (a `?partner=` value) |
| `AFFILIATE_GOG_LINK` / `AFFILIATE_GMG_LINK` / `AFFILIATE_FANATICAL_LINK` | ⬚ | Affiliate-network deep-link templates — paste the one your network gives you, with a destination placeholder. **`{url}`** substitutes percent-encoded (Partnerize/Impact); **`{urlRaw}`** substitutes verbatim (Adtraction, which is GOG's network, appends it last). A template with neither is ignored rather than sending traffic to a bare homepage. |
| `AFFILIATE_ENEBA_LINK` / `AFFILIATE_INSTANT_GAMING_LINK` / `AFFILIATE_KINGUIN_LINK` | ⬚ | Same template format, for the gray-market key resellers (labeled "key reseller" in the UI) |
| `NEXT_PUBLIC_SUPPORT_URL` / `NEXT_PUBLIC_SUPPORT_LABEL` | ⬚ | H3.3 donations link (Ko-fi / GitHub Sponsors) shown next to the legal links; label defaults to `Donate`. **Build-time inlined** — changing it needs a rebuild. Not gated by `MONETIZATION_ENABLED`; a donation link isn't a commercial communication. |
| `SCORING_ADMIN_USER_IDS` | ⬚ | Comma-separated `users.id` allowlist for `/dev/scoring`. Unset = nobody (fails closed) |
| `DEV_LOGIN_USER_ID` | ⬚ | **Local dev only.** A `users.id` that `GET /api/dev/login` mints a session for, so the logged-in pages are reachable without an OAuth round-trip. 404s unless `NODE_ENV !== "production"` *and* the host is loopback. Leave unset unless testing. |
| `KPI_READ_KEY` | ⬚ | Shared secret for `GET /api/telemetry/kpi`, the aggregate KPI feed read by the portfolio hub at <https://nilsmlynarek.eu/analytics/>. Sent as the `X-BW-Admin` header and compared in constant time. Unset, or under 16 characters, = the route 404s for everybody. Generate with `openssl rand -hex 32`, and keep it distinct from every other secret so it can be rotated alone. Aggregates only: counts and totals, no user ids, no paths. |

Required vars are validated once at boot ([`src/lib/config.ts`](src/lib/config.ts) via
[`src/instrumentation.ts`](src/instrumentation.ts)) — a missing one fails fast in production with a
list of what's missing.

## Hosting model

`better-sqlite3` is a synchronous, in-process, single-file database. The app therefore runs as
**one always-on Node process with a persistent disk** — *not* serverless and *not* multi-instance.
The chosen target is a **single-instance container on [Railway](https://railway.app)** with a mounted
volume for the DB. (See `docs/archive/history.md` for the full rationale.)

## Deploy to Railway

The repo ships a multi-stage [`Dockerfile`](Dockerfile) that builds Next's `standalone` output.
Railway auto-detects and builds it. ⚠️ The runner deliberately **runs as root**: Railway mounts
volumes owned by root, so a non-root user can't create `rr.db` on the mounted volume. Acceptable
for a single-tenant app; non-root is a known hardening follow-up (see the comment in `Dockerfile`).

1. **Push to GitHub** (Railway deploys from the repo).
2. **New Project → Deploy from GitHub repo** → select this repo. Railway detects the `Dockerfile`.
3. **Add a Volume** and mount it at **`/app/data`**. ⚠️ Without this, the DB resets on every deploy.
4. **Set environment variables** (table above). At minimum: `JWT_SECRET`, `TMDB_API_KEY`,
   `RAWG_API_KEY`, `NEXT_PUBLIC_BASE_URL`, and `DB_PATH=/app/data/rr.db`. Plus any provider keys you use.
5. Pick the **EU (Amsterdam)** region if available (data residency / latency).
6. Deploy. The container serves on `$PORT` (Railway sets it; the standalone server honors it).
7. **Custom domain:** add it in Railway, then create the shown **CNAME** at your domain's DNS.
   Railway provisions HTTPS automatically.
8. **OAuth redirect URIs:** in each provider's app settings, register the **production** callback URLs
   (Trakt callback, TMDB, Steam return/realm, Letterboxd). Set `TRAKT_REDIRECT_URI` +
   `NEXT_PUBLIC_BASE_URL` to the production origin. (The `localhost` defaults won't work in prod.)

### Migrating existing data

To carry over an existing local `data/rr.db` (library, wishlist, ratings), copy it into the Railway
volume once via the Railway CLI (`railway run` / volume upload). Otherwise the instance starts empty
and rebuilds from your connected accounts on first sync.

### Backups

✅ **Done.** The Railway volume is a single copy, so **[Litestream](https://litestream.io)**
continuously replicates `rr.db` to object storage with auto-restore on a fresh container
(config: [`litestream.yml`](litestream.yml)). `litestream.yml` sets no explicit `retention`, so
the effective backup window is the default for the **v0.3.13** binary the `Dockerfile` installs:
**24 hours** — confirmed during H4.3 against v0.3.13's own docs, not the current v0.5+ ones
(different config schema entirely). The privacy policy quotes that same 24h figure as the true
erasure horizon; if the pinned Litestream version ever changes, re-check both.

## Project docs

- `STATUS.md` — short human-readable digest of live state + next actions (read this first)
- `TASKS.md` — execution tracker (source of truth) for what's still open, incl. a one-paragraph summary of the (all-resolved) audit/review findings
- `docs/archive/history.md` — everything finished: completed phases, resolved audit findings, closed bugs/QA findings (moved out of the working set 2026-07-18 to keep the active docs short — grep it, don't read it end to end)
- `PLATFORMS.md` — platform integration capability reference
- `smoketest.md` — the living exploratory-QA plan; findings land in `TASKS.md` as `SM#` entries
- `.claude/plans/` — session plans written by one session and executed by another (the audit trail
  of planned-vs-shipped); the only tracked path under `.claude/`
- `AGENTS.md` — contributor/agent notes: this Next.js version has breaking changes (read the bundled docs), the project doc map, load-bearing data-model invariants, and model/agent-routing guidance
