# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-12._

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

**Still on you (see [TASKS.md](TASKS.md) "Needs Nils"):** just **`NEXT_PUBLIC_SUPPORT_URL` on Railway** — the last infrastructure action, and the only one a session can't do (the harness blocks writing to a service settings form). `PRUNE_ON_BOOT=0` is optional now that the guard has held twice in prod. The 340 MB WAL high-water **cannot** be reclaimed while Litestream runs (`busy: 1`, tried twice) and needs no action — the volume is 12% used.

**Watch that it STAYS up.** The app never crashed in either outage — `uptime` climbed monotonically both times, so it was **un-routed**, which reads as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **Affiliate signups stay parked until this holds for days, not hours** — every program reviews the applicant site.

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔵 | **P15/P16 — Android TWA** | **You:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + cert → 2 env vars on Railway. Serving infra is done. |
| ✅ | **PR17 — post-outage verification** | **CLOSED 2026-08-12**, all five steps. Backups proven by a real restore drill. |
| ✅ | **SM38 — anon surface had zero clickable items** | **FIXED 2026-08-12.** The anon branches now run the existing read-only `lookupExistingUuids` instead of returning an empty map. Verified on a real catalog: Discover 0 → **32** links, `/tag/action` 40, `/studio/a24` 26, Home 14 — and a Googlebot crawl still wrote **zero** rows. |
| 🟠 | **SM39 — Fandex Score renders far outside 0–100** | **You** — deliberately not "fixed": the unbounded range is pinned by two dated tests and a clamp would break the breakdown's additivity. The remedy is the re-tune below. Across 1,773 real items: min **−362.3**, median 93.4, max **557.4**; 21% below 0, 47% above 100. The Godfather shows **−59** on its card today. |
| ⬜ | **Facet-page compute + RAWG quota** | Nobody — open work. Cold `/tag/telepathy` renders in **59.8 s** on prod; crawl sweeps run at a near-100% cache miss. Cache enlarged 2026-08-12 (mitigates, doesn't eliminate). |
| 🔵 | **H3 — affiliate revenue** | **You:** Railway → program signups (**GOG first, Amazon last**) → env vars → flip `MONETIZATION_ENABLED`. Code is done and dark. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| 🔵 | **H3.0 — upkeep baseline** | **You.** One number (Railway bill + domain + recurring). The support page deliberately quotes no figure until it exists. |
| 🟢 | **Score `priorStrength`/role-weight re-tune** | Time. Needs a few weeks of real scores under the raw-sum formula; 5 days as of 2026-08-03. |

Everything else is done. **H1, H2, H4 (closed 2026-08-03), H5, all five audit passes, all 10 smoke sweeps, every production incident, and the full performance audit.**

**P18 closed 2026-08-03.** "Where to watch" rows are clickable + show an offer-type line, via TMDB's own per-region link and the existing lazy self-heal path — not the JustWatch Content Partner API or a full-catalog re-projection TASKS.md previously (incorrectly) had it blocked on. Same session: a **boot-time prune of the browsed tail, default ON** (`PRUNE_ON_BOOT=0` to disable — see below), `omdbConfigured()`, and cache-contraction drift counts in `/api/dev/dbsize`. → [archive](docs/archive/history.md), grep `P18 streaming links`.

**⚠️ The boot prune has now run against prod.** Every server boot runs a bounded prune of browsed-only catalog rows nobody acted on (small batches, 5s budget, skips if free space is low, never VACUUMs), default ON. Prod booted with it enabled and **nothing broke** — `user_library` 1,912 and `user_watchlist` 96 are unchanged, `media_items` is 2,267. It remains an unattended delete path and the likely cause of the 340.8 MB WAL high-water, so **set `PRUNE_ON_BOOT=0` until Litestream's replica generation is confirmed** (PR17 step 4, still unverified since the VACUUM).

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
| **H5** — Fandex Score | ✅ 2026-07-27 incl. calibration. Design → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** — legal & compliance | ✅ 2026-08-03, epic closed |
| **H3** — monetization | 🔵 v1 built 2026-08-03 — donations live, affiliate dark → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| Android TWA (P15/P16) | 🔵 needs the TWA build |

## ✅ Quality bar (as of 2026-08-12)

**576 tests** · `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm run build` clean. **This is the standing bar — don't land work below it.**

**Donations are LIVE (2026-08-12)** — Ko-fi renders on the support page, the sign-in dialog and `/profile`, as direct outbound `<a href>`. Setting the Railway variable was necessary but not sufficient: `NEXT_PUBLIC_*` is inlined into the **client bundle at build time**, and Railway only forwards a variable into a Dockerfile build when declared as `ARG`, so the server-rendered page worked while every client surface silently didn't. **Any future client-read `NEXT_PUBLIC_*` needs that Dockerfile line.**

**11th smoke sweep (2026-08-12, live prod, both auth states)** → findings `SM38`–`SM42` in [TASKS.md](TASKS.md). Ran during a genuine RAWG outage, which re-verified the three 2026-08-02 single-source games bugs as **fixed** under the exact condition that exposed them.

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
