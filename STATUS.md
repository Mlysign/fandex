# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🔒 | **S2 token backfill** | Re-encrypt any pre-encryption token rows (likely moot after the provider reconnects — quick confirm). |
| 🔧 | **Railway healthcheck path** | Confirm it points at `/api/health`. |
| 🟢 | **P13 SSR detail pages** | Shareable/crawlable URLs. Nice-to-have. |

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
| SEO SSR detail pages (P13) | 🟢 later |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | 🔭 planned |
| Monetization strategy (H3) | 🔭 planned |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
