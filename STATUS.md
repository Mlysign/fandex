# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **H2 — Data-model hardening** | **In progress.** Scoped into A→B→C ([TASKS.md](TASKS.md) H2a/b/c). **A first: ~94% of the DB is cached provider payloads** (~92KB per TMDB link) — trim to a projection, then discover persists (deletes P13's source-id workarounds), then login-with-intent. Order is load-bearing. |
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🟡 | **P13b — turn on indexing** | One-line flip (`PUBLIC_ITEMS_INDEXABLE`). Item pages ship **soft-launched**: readable + unfurlable but `noindex`. Decide first: index the whole library or a subset? (H2b dilutes this — the catalog stops mirroring your library.) |
| 🔒 | **S2 token backfill** | Re-encrypt any pre-encryption token rows (likely moot after the provider reconnects — quick confirm). |
| 🔧 | **Railway healthcheck path** | Confirm it points at `/api/health`. |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ · S2 backfill = confirm |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ shipped **soft-launched** (`noindex` until P13b) |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | 🔵 **scoped + in progress** (A→B→C) |
| Monetization strategy (H3) | 🔭 planned |
| Legal & compliance — imprint, privacy, cookies, account deletion, support (H4) | 🔭 planned · gate before public/EU |
| Fandex Recommendation Algorithm (manually added by nils) | 🔭 planned (FYI, Claude) |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
