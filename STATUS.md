# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-12._

---

## 🟢 Prod is BACK — and the leak is confirmed fixed

fandex.org is **up and serving** (2026-08-12, stable across a ~7 h window and counting). It was down from **2026-07-22** on a Railway compute-usage pause, and served only a ~32-minute window on 2026-08-07 before being un-routed again.

**The 2026-07-22 root cause is now verified dead in production**, not just in theory:

- **`rr.db` is 37.7 MB** (peak was 2,487 MB). The perf audit's §B inflation question is answered.
- **The write gate holds under a replayed crawl** — 15 anonymous Googlebot-UA facet requests (~900 thin rows if broken) changed `media_items`/`media_links`/`media_external_ids` by **zero**.
- **The memory ramp is dead** — `cgroupMb.fileMb` flat at **74–76 MB** across ~7 h of uptime, then **reclaimed to 25** as the box idled. Not a climb toward 2,000. First window long enough to prove a plateau.
- **`libRowsWithoutState` / `wishRowsWithoutState` = 0/0** on prod — the cache-table drop is now unblocked.

→ full readings in [the archive](docs/archive/history.md), grep `PR17 post-outage verification`.

**Still on you (see [TASKS.md](TASKS.md) "Needs Nils"):** ⚠️ **Litestream's replica generation has been UNVERIFIED since the 2026-07-22 VACUUM** and it is the only recovery path — that needs the Railway shell. Also `PRUNE_ON_BOOT=0` (the unattended delete path has now fired against prod at least once; nothing broke, user rows unchanged) and a `wal-truncate` to reclaim ~340 MB of billed volume for a 38 MB DB.

**Watch that it STAYS up.** The app never crashed in either outage — `uptime` climbed monotonically both times, so it was **un-routed**, which reads as a billing/pause action, not a technical one. If usage is still near the cap, resumed traffic re-accrues. **Affiliate signups stay parked until this holds for days, not hours** — every program reviews the applicant site.

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔵 | **P15/P16 — Android TWA** | **You:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + cert → 2 env vars on Railway. Serving infra is done. |
| 🔵 | **PR17 — post-outage verification** | **Steps 1–3 CLOSED 2026-08-12.** Steps 4–5 need the **Railway shell**: Litestream's replica generation (unverified since the VACUUM) + stale Jul-17 WAL sidecars. |
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

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
