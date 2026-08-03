# Fandex — Status

_Your index of every game, movie & show._ · **This file = current state only.** Open work in detail → [TASKS.md](TASKS.md). Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it, don't read it).

_Last updated: 2026-08-03._

---

## 🔴 Prod is DOWN — and it's now on you

fandex.org has been down since **2026-07-22**. Railway paused all deployments when compute hit $10.28/$10.00. The underlying cost driver (PR16's catalog-pool prune) is already fixed and committed, but **the expected ~2026-08-01 billing-cycle reset did NOT restore service** — re-checked 2026-08-02, still a Railway-edge 404 on every route.

This stopped being a "wait it out" situation. **Action for Nils:** open the Railway dashboard and check whether the pause needs a manual resume, or whether usage is still over the cap. No data was ever at risk.

**Consequence:** everything since 2026-07-22 is committed and pushed but **has never run in production** — the whole H1 UI overhaul, the mockup-vs-live rebuild, the catalog-pool fixes (PR13–PR16), the legal pages, the Fandex Score calibration, the provider circuit breaker, and now all of H3/H4. Prod is also what gates the affiliate signups: **every program reviews the applicant site, and a 404 gets you rejected.**

## ▶ What's open

| | Item | Blocked on |
|--|------|--|
| 🔵 | **P15/P16 — Android TWA** | **You:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + cert → 2 env vars on Railway. Serving infra is done. |
| ⏸️ | **PR17 — post-outage verification** | Prod being back. One-shot checklist is pre-written in TASKS.md, every expected value inline. |
| ⏸️ | **P18 — JustWatch clickable links** | PR17. Attribution shipped 2026-07-31; the links need a full-catalog re-projection (the same heavy op that caused the outage). |
| 🔵 | **H3 — affiliate revenue** | **You:** Railway → program signups (**GOG first, Amazon last**) → env vars → flip `MONETIZATION_ENABLED`. Code is done and dark. → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| 🔵 | **H3.0 — upkeep baseline** | **You.** One number (Railway bill + domain + recurring). The support page deliberately quotes no figure until it exists. |
| 🟢 | **Score `priorStrength`/role-weight re-tune** | Time. Needs a few weeks of real scores under the raw-sum formula; 5 days as of 2026-08-03. |

Everything else is done. **H1, H2, H4 (closed 2026-08-03), H5, all five audit passes, all 10 smoke sweeps, every production incident, and the full performance audit.**

**H3 v1 landed 2026-08-03.** Donations are **live** (Ko-fi, in the footer, the sign-in dialog and the `/profile` list). The affiliate layer is **built and dark** behind `MONETIZATION_ENABLED`, which defaults off — H3's legal gate expressed as code. H3.8's Path B trigger stays **defined but explicitly NOT approved**.

**H4 closed 2026-08-03.** The Impressum is written and filled in both locales; German is the operative version.

**Performance is closed (2026-08-02).** The probes stay in `scripts/`; **measure before optimising** (§A was mis-sized by 100× once).

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
| **H1** — UI/UX overhaul (mobile-first) | ✅ 2026-07-27. Direction 2a "Ticket · Calm". Design system → [docs/design/fandex-handoff/](docs/design/fandex-handoff/) |
| **H2** — data-model hardening | ✅ |
| **H5** — Fandex Score | ✅ 2026-07-27 incl. calibration. Design → [docs/fandex-score.md](docs/fandex-score.md) |
| **H4** — legal & compliance | ✅ 2026-08-03, epic closed |
| **H3** — monetization | 🔵 v1 built 2026-08-03 — donations live, affiliate dark → [docs/monetization-go-live.md](docs/monetization-go-live.md) |
| Android TWA (P15/P16) | 🔵 needs the TWA build |

## ✅ Quality bar (as of 2026-08-03)

544 tests · `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm run build` clean. **This is the standing bar — don't land work below it.**

---
_✅ done · 🔵 needs input / in progress · ⏸️ blocked · 🟢 later · 🔴 broken_
