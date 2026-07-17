# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| ✅ | **H2 — Data-model hardening** | **DONE — all three phases shipped** ([TASKS.md](TASKS.md) H2a/b/c). **H2a** — `raw_data` was ~94% of the DB; now projected at write time: **149.6MB → 35.4MB (-76%)**, DB file **160MB → 42MB** after VACUUM, verified lossless. **H2b** (DEPLOYED 2026-07-17) — discover persists every item it returns (no network), so every item has a uuid: P13's source-id URL machinery **deleted** (one URL form), `/discover` **ungated** for anonymous; migration 8 (`media_items.browsed`) keeps browsed items out of Best-match/Insights/IDF. **H2c ✅ DEPLOYED 2026-07-17** (`6afe601`, live-verified) — anonymous now sees the REAL stars + wishlist controls; interacting opens an in-page sign-in dialog, and the action survives the OAuth round-trip (return-path cookie with an open-redirect guard + localStorage intent, drained back on the item page). |
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🟣 | **P17 — Public facet pages** (reframed "P13b") | **BUILT 2026-07-17 (working tree; tsc+195 tests+build green, 0 lint errors) — pending your Chrome/UX review + deploy.** Audit found item pages + /discover already link to public pages — facets were the only gap. Public, provider-sourced, session-aware **`/person /tag /studio`** pages replace authed `/insights/facet?…` (now a 308 redirect): combined roles + role-per-work badges, crowd-avg + your-vs-crowd overlay, paginated/sorted, persist-at-fetch linking. **Provider integration (TMDB/RAWG search + credits) is UNVERIFIED live — needs your browser pass.** Detail in [TASKS.md](TASKS.md) P17 + memory. |
| 🟡 | **P13b — turn on indexing** | Deferred until P17 lands (index orphan pages = bad). One-line flip (`PUBLIC_ITEMS_INDEXABLE`). Decide first: index the whole library or a subset? |
| ✅ | **S2 token backfill** | **Effectively closed (confirmed 2026-07-17).** Encrypt path is universal + decrypt is plaintext-tolerant (zero functional risk); prod `TOKEN_ENCRYPTION_KEY` is provably set (a successful Trakt login can't happen otherwise) and that same recent login re-wrote the only sensitive token (Trakt refresh) encrypted. `scripts/encrypt-tokens.ts` stays as an idempotent backfill for stragglers if ever wanted. |
| ✅ | **Railway healthcheck path** | **Done (2026-07-17).** Endpoint re-verified live (`200 ok`); dashboard Healthcheck Path confirmed pointed at `/api/health` by user. |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ · S2 backfill confirmed closed (2026-07-17) |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ shipped **soft-launched** (`noindex` until P13b) |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | ✅ **done** (A→B→C all shipped 2026-07-16/17) |
| Monetization strategy (H3) | 🔭 planned |
| Legal & compliance — imprint, privacy, cookies, account deletion, support (H4) | 🔭 planned · gate before public/EU |
| Fandex Recommendation Algorithm (manually added by nils) | 🔭 planned (FYI, Claude) |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
