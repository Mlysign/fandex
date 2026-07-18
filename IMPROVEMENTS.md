# Improvements audit — summary

Five review passes (Phase 1 data/architecture, Phase 3 UI/UX, Phase 5
productionization + security) produced findings D1–D9, A1–A7, U1–U15, P1–P17,
S1–S13. **Every one of them is resolved.** Full findings + resolution detail
moved to [docs/archive/improvements.md](docs/archive/improvements.md) — that's
where to look for the "why" behind a past decision (e.g. why tokens are
encrypted a specific way, why SQLite over Postgres, why the merge layer is
shaped the way it is).

Overall verdict, still true: the data *model* is a genuine strength
(identity-agnostic users + canonical media_items + per-source links + a merge
layer); the issues found were about *how state was stored within that model*
and a few monoliths, not the core shape. Productionization/security verdict:
fundamentals were sound from the start (parameterized SQL, no XSS sinks,
verified OAuth) — the real gaps were credential-handling-at-rest and
public-internet hardening, both closed.

For what's still open, see [TASKS.md](TASKS.md) Phase 7 (H1–H4) and the
Android TWA items (P15/P16).
