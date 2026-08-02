# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-02._

---

## 🔴 Prod is DOWN — and it's now on you

fandex.org has been down since **2026-07-22**. Railway paused all deployments when compute hit $10.28/$10.00. The underlying cost driver (PR16's catalog-pool prune) is already fixed and committed, but **the expected ~2026-08-01 billing-cycle reset did NOT restore service** — re-checked 2026-08-02, still a Railway-edge 404 on every route.

This stopped being a "wait it out" situation. **Action for Nils:** open the Railway dashboard and check whether the pause needs a manual resume, or whether usage is still over the cap. No data was ever at risk.

**Consequence:** every commit since 2026-07-22 is local-only. That includes the whole H1 UI overhaul, the mockup-vs-live rebuild, the catalog-pool fixes (PR13–PR16), the legal pages, the Fandex Score calibration, and the provider circuit breaker. **Nothing since 2026-07-22 has ever run in production.**

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔵 | **P15/P16 — Android TWA** | **You:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + cert → 2 env vars on Railway. Serving infra is done. |
| ⏸️ | **PR17 — post-outage verification** | Prod being back. One-shot checklist is pre-written in TASKS.md, every expected value inline. |
| ⏸️ | **P18 — JustWatch clickable links** | PR17. Attribution shipped 2026-07-31; the links need a full-catalog re-projection (the same heavy op that caused the outage). |
| 🔵 | **H4.0 — legal advice on the Impressum** | **You.** Gates H4.2, which gates all of H3. |
| ⏸️ | **H4.2 — Impressum content** | H4.0. Route + noindex + placeholder already live. |
| 🟢 | **H3 — monetization** | H4.0/H4.2. Scoped + model locked; H3.0/H3.3/H3.4/H3.9 not started. H3.8's trigger is **defined but explicitly NOT approved** — don't read those numbers as settled. |
| 🟢 | **Perf §A / §B** | Nothing — deliberately deferred. §A = the catalog pool cache's over-eager invalidation (~0.4 s, correctly re-sized after the 2026-08-02 misattribution). §B = why prod's `rr.db` is 2.5 GB. See [docs/performance-audit.md](docs/performance-audit.md). |
| 🟢 | **Score `priorStrength`/role-weight re-tune** | Time. Needs a few weeks of real scores under the raw-sum formula; it's been 4 days as of 2026-08-02. |

Everything else is done. **H1, H2, H5, all five audit passes, all 10 smoke sweeps, every production incident, and all of H4 except H4.0/H4.2.**

## 🗺️ Roadmap

| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ built · 🔴 currently paused, see above |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ (24h retention, v0.3.13) |
| Observability (`/api/health`, structured logs) | ✅ incl. `openProviderCircuits` |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| SEO — public item pages (P13) + facet pages (P17) | ✅ live + fully indexed |
| **H1** — UI/UX overhaul (mobile-first) | ✅ 2026-07-27, incl. the mockup-vs-live rebuild + gap closeout. Direction 2a "Ticket · Calm". Design system → [docs/design/fandex-handoff/](docs/design/fandex-handoff/) |
| **H2** — data-model hardening | ✅ |
| **H5** — Fandex Score | ✅ 2026-07-27 incl. calibration. Design → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** — legal & compliance | 🟢 all done except H4.0 + H4.2 |
| **H3** — monetization | 🟢 scoped; v1 = donations + affiliate only |
| Android TWA (P15/P16) | 🔵 needs the TWA build |

## ✅ Quality bar (as of 2026-08-02)

502 tests · `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm run build` clean. **This is the standing bar — don't land work below it.**

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
