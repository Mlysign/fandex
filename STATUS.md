# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 Currently: P13b — flip `PUBLIC_ITEMS_INDEXABLE` to index the whole library** (decided; just needs executing). Everything else below is either waiting on you (Android TWA) or not yet scoped (H1/H3/H4).

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🟡 | **P13b — turn on indexing** | Decided: index the whole library. One-line flip (`PUBLIC_ITEMS_INDEXABLE`) not yet executed. |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ shipped **soft-launched** (`noindex` until P13b) |
| Public facet pages (P17) | ✅ **done**, live on fandex.org |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🔭 planned |
| Legal & compliance — imprint, privacy, cookies, account deletion, support (H4) | 🔭 planned · gate before public/EU |
| Fandex Recommendation Algorithm (manually added by nils) | 🔭 planned (FYI, Claude) |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
