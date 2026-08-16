# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-16 (MB14 episode tracking + Home's "Up next" progress module)._

---

## 🟢 Prod is BACK, deployed, and the leak is confirmed fixed

fandex.org is **up, serving, and running `main`'s HEAD** as of 2026-08-12. It was down from **2026-07-22** on a Railway compute-usage pause, and served only a ~32-minute window on 2026-08-07.

**⚠️ The last blocker was CI, not billing — learn this one.** Railway auto-deploy has **Wait for CI ON**, so a red CI silently blocks every deploy. On 2026-08-12 the `npm audit` job began failing against an *unchanged* dependency tree (a nanoid advisory published after the last green run), and pushes stopped reaching prod — `uptime` climbed straight through them with no restart. Fixed by a lockfile-only bump; the deploy fired **automatically** the moment CI went green. **If a push doesn't seem to reach prod, check `gh run list --workflow=ci.yml` before suspecting Railway.** Everything committed since 2026-07-22 — H1, the mockup rebuild, PR13–PR16, the legal pages, Score calibration, the circuit breaker, all of H3/H4, P18 — is now live for the first time.

**The 2026-07-22 root cause is now verified dead in production**, not just in theory:

- **`rr.db` is 37.7 MB** (peak was 2,487 MB). The perf audit's §B inflation question is answered.
- **The write gate holds under a replayed crawl** — 15 anonymous Googlebot-UA facet requests (~900 thin rows if broken) changed `media_items`/`media_links`/`media_external_ids` by **zero**.
- **The memory ramp is dead** — `cgroupMb.fileMb` flat at **74–76 MB** across ~7 h of uptime, then **reclaimed to 25** as the box idled. Not a climb toward 2,000. First window long enough to prove a plateau.
- **`libRowsWithoutState` / `wishRowsWithoutState` = 0/0** on prod — the cache-table drop is now unblocked.

→ full readings in [the archive](docs/archive/history.md), grep `PR17 post-outage verification`.

- **Backups are PROVEN, not just present** — a full restore drill on 2026-08-12 (the one recommended since June and never run) restored the replica to a scratch file: `integrity_check` **ok**, every user table exact, and every real (`browsed=0`) catalog row exact at **1994**. Replication lag 6m39s. **PR17 is CLOSED.**

**Still on you (see [TASKS.md](TASKS.md) "Needs Nils"):** nothing on the infrastructure side. What is left is judgement, not plumbing: the Impressum review, H3.0's upkeep number, the affiliate signups (parked on prod staying up), the TWA build, and **one prod sweep** — `POST /api/dev/crosslink` (games cross-linking). The Wikidata franchise sweep **ran on prod 2026-08-14** (1,803 checked, 407 found, `remaining` 0). `PRUNE_ON_BOOT=0` is optional now that the guard has held twice in prod. The 340 MB WAL high-water **cannot** be reclaimed while Litestream runs (`busy: 1`, tried twice) and needs no action — the volume is 12% used.

**Watch that it STAYS up.** The app never crashed in either outage — `uptime` climbed monotonically both times, so it was **un-routed**, which reads as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **Affiliate signups stay parked until this holds for days, not hours** — every program reviews the applicant site.

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🟡 | **MB — Nils's mobile-testing batch (15 notes)** | **14 shipped.** **MB14 (per-episode tracking + two-way Trakt sync) shipped 2026-08-16** — migration 15, lazy TMDB fill, `/api/episodes`, `<EpisodeTracker>`; verified on both migration apply paths against a real pre-upgrade DB. **You:** the Trakt round-trip itself is unverified against a live account (no keys, no `rr.db` in that session) — connect Trakt, tick a season, confirm it lands on trakt.tv. Also that session: **Home's three counters are gone**, replaced by an "Up next" progress carousel of the episodes you'd watch next (filter: the preceding episode is watched; sort: latest event — a watch or a release — first, capped at 10). One left: **MB7** (bottom nav scrolls away on Insights, **installed PWA only** — not reproducible in the browser pane, needs a device look). → [TASKS.md](TASKS.md) |
| 🔵 | **P15/P16 — Android TWA** | **You:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + cert → 2 env vars on Railway. Serving infra is done. |
| 🔵 | **Games cross-link backfill on prod** | **You:** `POST /api/dev/crosslink` `{"source":"steam","maxItems":25}` from the browser console on fandex.org while logged in (both dev routes are session-gated, so a terminal `curl` 404s). Repeat until the cursor drains. Until then prod fills organically at ~30 cross-links per sync pass. |
| 🔵 | **Franchise `ip` weight** | **You.** Live on prod since 2026-08-14 at the default 1.3 (peer with `director`, which you have at 4). `node scripts/probe-ip-impact.mjs data/rr.db --config <a GET /api/dev/scoring response>` shows what a value does to real titles first. Two smaller calls with it → [TASKS.md](TASKS.md). |
| 🔵 | **H3 — affiliate revenue** | **You:** Railway → program signups (**GOG first, Amazon last**) → env vars → flip `MONETIZATION_ENABLED`. Code is done and dark. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| 🔵 | **H3.0 — upkeep baseline** | **You.** One number (Railway bill + domain + recurring). The support page deliberately quotes no figure until it exists. |
| 🟢 | **Fandex Score's residual ~1% outside 0–100** | A design call, not a bug: `FandexScoreBadge` makes no 0–100 claim itself, so "relabel rather than re-tune" is a live option. → [TASKS.md](TASKS.md) |
| 🟢 | **Score `priorStrength`/role-weight re-tune** | Time. Needs a few weeks of real scores under the raw-sum formula; 5 days as of 2026-08-03. |

Everything else is done. **H1, H2, H4, H5, PR17, SM38–SM48, franchise/IP scoring (swept on prod), the facet-page compute + quota exposure, all five audit passes, all 11 smoke sweeps, every production incident, and the full performance audit.** Grep [the archive](docs/archive/history.md) for any of them.

**P18 closed 2026-08-03.** "Where to watch" rows are clickable + show an offer-type line, via TMDB's own per-region link and the existing lazy self-heal path — not the JustWatch Content Partner API or a full-catalog re-projection TASKS.md previously (incorrectly) had it blocked on. Same session: a **boot-time prune of the browsed tail, default ON** (`PRUNE_ON_BOOT=0` to disable — see below), `omdbConfigured()`, and cache-contraction drift counts in `/api/dev/dbsize`. → [archive](docs/archive/history.md), grep `P18 streaming links`.

**⚠️ The boot prune has now run against prod.** Every server boot runs a bounded prune of browsed-only catalog rows nobody acted on (small batches, 5s budget, skips if free space is low, never VACUUMs), default ON. Prod booted with it enabled and **nothing broke** — `user_library` 1,912 and `user_watchlist` 96 are unchanged, `media_items` is 2,267. It has since run a second time (the 2026-08-12 redeploy) deleting 255 browsed-only rows with **zero** user rows touched, and **Litestream is now confirmed by a restore drill**, so the original reason to disable it is gone. `PRUNE_ON_BOOT=0` is now a preference, not a precaution.

**H3 v1 landed 2026-08-03.** Donations are **live** (Ko-fi, in the footer, the sign-in dialog and the `/profile` list). The affiliate layer is **built and dark** behind `MONETIZATION_ENABLED`, which defaults off — H3's legal gate expressed as code. H3.8's Path B trigger stays **defined but explicitly NOT approved**.

**H4 closed 2026-08-03.** The Impressum is written and filled in both locales; German is the operative version.

**Performance is closed (2026-08-02).** The probes stay in `scripts/`; **measure before optimising** (§A was mis-sized by 100× once).

## 🗺️ Roadmap

| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ built · 🟢 back up 2026-08-12 — watch it stays, see above |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ (24h retention, v0.3.13) |
| Observability (`/api/health`, structured logs) | ✅ incl. `openProviderCircuits` |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| SEO — public item pages (P13) + facet pages (P17) | ✅ live + fully indexed |
| **H1** — UI/UX overhaul (mobile-first) | ✅ 2026-07-27. Direction 2a "Ticket · Calm". Design system → [docs/design/fandex-handoff/](docs/design/fandex-handoff/) |
| **H2** — data-model hardening | ✅ |
| **H5** — Fandex Score | ✅ 2026-07-27 incl. calibration; **franchise/IP added 2026-08-14** (§3.6). Design → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** — legal & compliance | ✅ 2026-08-03, epic closed |
| **H3** — monetization | 🔵 v1 built 2026-08-03 — donations live, affiliate dark → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| Android TWA (P15/P16) | 🔵 needs the TWA build |

## ✅ Quality bar (as of 2026-08-16)

**743 tests** · `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm run build` clean · `npm audit` 0 vulnerabilities. **This is the standing bar — don't land work below it.**

**Donations are LIVE (2026-08-12)** — Ko-fi renders on the support page, the sign-in dialog and `/profile`, as direct outbound `<a href>`. Setting the Railway variable was necessary but not sufficient: `NEXT_PUBLIC_*` is inlined into the **client bundle at build time**, and Railway only forwards a variable into a Dockerfile build when declared as `ARG`, so the server-rendered page worked while every client surface silently didn't. **Any future client-read `NEXT_PUBLIC_*` needs that Dockerfile line.**

**Dependencies are current as of 2026-08-14** — all four open Dependabot PRs merged after a full local bar *plus* a real JWT sign/verify round-trip, because `jose` is the session library and the suite never exercises a live token. Now on `next` 16.3.0, `react` 19.2.8, `jose` 6.2.8, `@types/node` 26, with CI on `actions/checkout@v7` + `setup-node@v7`. `npm audit` 0 vulnerabilities.

**11th smoke sweep (2026-08-12, live prod, both auth states)** — all five findings (`SM38`–`SM42`) fixed → [archive](docs/archive/history.md), grep `Smoke test 2026-08-12 11th run`. Ran during a genuine RAWG outage, which re-verified the three 2026-08-02 single-source games bugs as **fixed** under the exact condition that exposed them.

**⚠️ `npm audit` went red again on an UNCHANGED tree (2026-08-14) — the second time.** Two `brace-expansion` advisories published since the last green run widened their ranges to cover the exact version the existing override pinned (`5.0.8`), and eslint's own `minimatch@3` chain (`1.1.16`). **This silently blocks the Railway deploy** — Wait-for-CI is ON. Fixed with two *nested* overrides, `1.1.18` under `eslint` and `5.0.9` under `@typescript-eslint/typescript-estree`: the two consumers need different major lines, so one flat override cannot satisfy both. Back to 0 vulnerabilities. **Expect this again — pinning an exact version is a bet that the next advisory won't include it.**

**One dependency added 2026-08-14: `simple-icons`, as a devDependency.** It feeds `scripts/gen-brand-marks.mjs`, which extracts 11 brand paths into the committed `src/lib/brandMarks.ts`. **Nothing in the shipped app imports it** — the package carries 3,453 icons and generating keeps the bundle cost exact rather than trusting a barrel export to tree-shake. Re-run the script after adding a store-link name; it throws on an unknown slug rather than silently skipping a brand.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
