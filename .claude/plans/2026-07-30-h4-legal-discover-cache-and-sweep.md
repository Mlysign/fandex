---
plan_id: 2026-07-30-h4-legal-discover-cache-and-sweep
created: 2026-07-30
status: in_progress
branch: current
---

# H4 legal pages, Discover browse cache, PR17 readiness, and a smoke sweep

## Objective

Four independent bodies of work, explicitly requested together. **(1)** Build H4's legal
surface from scratch — there is no `/legal` route in the repo today: bilingual EN/DE routes,
a privacy policy, terms of service, a cookie-assessment record, a support page, and a
noindex Impressum placeholder. **(2)** Cache Discover's browse payload so Back stops
re-fetching the entire saved depth (the leftover from the previous plan's T4). **(3)** Probe
production and run whatever part of PR17's pre-written checklist is reachable. **(4)** Finish
with a log-only smoke sweep.

**This is a large plan by explicit request.** Every task below is independently completable
and independently committable, so a run that stops early still leaves usable history. Work
them in order; do not skip ahead to the sweep.

## Findings this plan is built on (verified 2026-07-30 against the live repo)

- Working tree clean, `main` level with `origin/main`, previous plan `status: complete` with
  an empty Blockers log.
- **Prod is still down**: `https://fandex.org/` and `/api/health` both return **404** at
  Railway's edge. The billing cycle resets ~2026-08-01.
- **Baselines to hold:** `npm test` **419 passing / 1 skipped** (55 files) · `npm run lint`
  **0 errors**, 371 pre-existing `no-explicit-any` warnings · `npx tsc --noEmit` clean ·
  `npm run build` compiles **61 routes**.
- **H4 is greenfield.** `src/app/legal/` does not exist. There is no footer on `/profile`
  (`ProfilePageClient.tsx` ends at the "Recommended for you" rail, line ~240).
- **There is no i18n library and no markdown renderer.** Dependencies are exactly
  better-sqlite3, date-fns, jose, lucide-react, next, react, react-dom, zod.
- **Page convention** (`src/app/settings/page.tsx`): a thin server `page.tsx` exporting
  `export const metadata: Metadata = { title: "…" }` and rendering a client component.
  Server-side metadata is deliberate — a client-effect title races Next's metadata sync and
  loses on a hard load (S1/SM10).
- **`litestream.yml` sets no `retention` key**, and the Dockerfile pins
  **litestream v0.3.13**. So the effective backup window is that version's default, which
  nobody has ever confirmed.
- **User-scoped tables, for the H4.3 data inventory** (read from the live DB):
  `users`, `user_identities`, `user_library`, `user_watchlist`, `user_item_state`, `sync_log`.
  Shared catalog: `media_items`, `media_links`, `media_external_ids`. Config:
  `scoring_config`, `tag_category`, `tag_category_override`, `tag_alias`.
- **`TASKS.md` is at 170 of its 200-line CI guard.** The fully-closed
  "Calendar sources + global layout order — 2026-07-28 (ID `L#`)" section (~15 lines) is the
  archive candidate that makes room.
- Discover's browse state: `loadDefault()` in `DiscoverPageClient.tsx:207` refetches
  `/api/discover` plus every saved page/backPage on mount, capped at 10 per section. Depth is
  already mirrored to `sessionStorage` under `rr_discover_browse` (`:259`); the scroll offset
  under `rr_discover_scroll` (`:262`). The **items themselves** are not cached.

## Decisions

- **Scope** → All four bodies of work, by explicit user instruction ("all of the above").
  Acknowledged risk: this is more than a typical session. Independence of tasks is the
  mitigation, not a reduction in scope.
- **EN/DE structure** → **Distinct URLs per locale**: `/legal/en/{doc}` and `/legal/de/{doc}`,
  with a toggle linking between them and `alternates.languages` (hreflang) in metadata.
  Rationale: a German user must be linkable straight to the German text, and crawlers should
  see two real pages.
- **Content storage** → Per-locale **typed data modules**, not markdown, not HTML strings.
  A shared renderer component walks a `{ heading, body[] }[]` structure. Rationale: there is
  no markdown renderer in the dependency list, and the enforced CSP makes
  `dangerouslySetInnerHTML` the wrong reflex. This also lets Nils edit prose without touching
  components.
- **Backup-retention figure** → The executor **confirms litestream v0.3.13's default
  retention from Litestream's own documentation** and states that figure. If it cannot be
  confirmed against a real source, it writes an explicit `TODO(H4.3)` marker in the draft.
  **Inventing or recalling a number is forbidden** — a wrong retention figure in a published
  privacy policy is a compliance problem, not a typo. Do **not** add a `retention` key to
  `litestream.yml`; changing production backup behaviour while prod is down is out of scope.
- **Impressum** → **A reachable placeholder page at `/legal/{locale}/imprint`, `noindex`**,
  saying the imprint is in preparation, with a contact email. User's explicit choice over the
  planner's recommendation to reserve the slot silently. Do **not** draft imprint content or
  include any postal address — H4.0/H4.2 remain gated on Nils's legal advice.
- **Smoke sweep** → **Log findings only.** Record them in `TASKS.md` with `SM#` ids and fix
  nothing. Rationale: an unsupervised session that starts fixing its own findings has no
  natural stopping point.
- **Legal drafting standard** → Every factual claim must be traceable to something in this
  repo (a table, a cookie, a provider in the registry, a config value). Where a fact is not
  verifiable from the code, write a `TODO(H4.x)` marker instead of a plausible sentence.
  Both documents carry a visible "not legal advice, under review" note until Nils signs off.
- **PR17** → Probe prod first. **Only steps 1–3 of the checklist are reachable by this
  session**; steps 4 and 5 need the Railway console, which it does not have. If prod 404s,
  record that and move on — do not retry in a loop.

## Out of scope

- **`enrichMissingSources` persistence.** AGENTS.md forbids delegating `matcher.ts` write
  paths to an unsupervised session; that is main-loop work. Do not touch it.
- H4.0 (legal advice) and H4.2 (real Impressum content / postal address) — gated on Nils.
- H4.9 (monetization legal research) and H4.10 (final compliance review pass) — both depend
  on the docs this session drafts existing first.
- Re-tuning `priorStrength` / per-role weights, and the `capped` treatment question. Still
  deliberately parked pending weeks of real data.
- Any migration or schema change.
- Adding a `retention` key to `litestream.yml`, or any other production backup change.
- Fixing anything the smoke sweep finds.
- Deploying. Prod is down; all verification is local.

## Do not touch

- `src/lib/migrations.ts`, `src/lib/matcher.ts` — schema and write-path invariants;
  main-loop-only per AGENTS.md.
- `src/lib/sync/**` and any provider pull adapter — the prune invariant lives there.
- `src/lib/session.ts`, `src/lib/withUser.ts`, `src/lib/devAdmin.ts`, `src/app/api/auth/**` —
  auth/session code is main-loop-only.
- `litestream.yml`, `Dockerfile`, `docker-entrypoint.sh` — production backup/runtime config.
- `data/rr.db.bak*`, `data/*.bak-*`.
- `.github/workflows/ci.yml`, `package.json`, `package-lock.json`. **No new dependencies** —
  if a task seems to need one, log a blocker instead.

## Environment notes for the executor

- **Never run `next build` while `next dev` is running** — it corrupts `.next`.
- Log in with **`GET /api/dev/login`**. **Never call `/api/auth/logout`** — it bumps
  `session_epoch` and destroys Nils's real browser session.
- Read `data/rr.db` read-only when inspecting (`new Database(path, { readonly: true })`).
- **`eslint --fix` is not safe to run broadly here** — it rewrote three
  `{/* eslint-disable-next-line */}` JSX comments to a bare `{ }` on 2026-07-30. If you run
  it, diff for non-import changes afterwards.
- The legal pages are **public and must not vary per viewer** — same SSR guarantee as the item
  page. Do not read the session in them.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build` (dev server stopped first)

## Tasks

- [x] **T1** — Build the `/legal` route infrastructure
  - Files: `src/app/legal/[locale]/[doc]/page.tsx` (new),
    `src/lib/legal/content/en/*.ts` + `src/lib/legal/content/de/*.ts` (new),
    `src/lib/legal/types.ts` (new), `src/components/legal/LegalDoc.tsx` (new),
    `src/components/legal/LocaleToggle.tsx` (new), `src/app/sitemap.ts`
  - Detail: A `[locale]/[doc]` route where `locale ∈ {en, de}` and `doc ∈ {privacy, terms,
    support, imprint}`. Unknown locale or doc → `notFound()`. Content is a typed structure —
    define `LegalDocument = { title: string; updated: string; intro?: string[]; sections:
    { heading: string; body: (string | { list: string[] })[] }[] }` — and `LegalDoc.tsx`
    renders it. **No markdown library, no `dangerouslySetInnerHTML`** (the CSP is enforced).
    Ship T1 with short placeholder content for all four docs; T3/T4/T5/T6 fill them in.
    **The route MUST export `dynamic = "force-dynamic"`.** Its `generateMetadata` builds
    canonical + `alternates.languages` hreflang URLs from `BASE_URL`, and that is exactly the
    invariant that shipped `localhost:3000` to production in `robots.ts` — Next prerenders
    route handlers at build time and Railway's build-phase env differs from runtime.
    Add `privacy`, `terms` and `support` (both locales) to `sitemap.ts`; **`imprint` must not
    be listed** (it is noindex, see T6). Match the repo's page convention: server component,
    server-side `metadata`.
  - Done when: `/legal/en/privacy`, `/legal/de/privacy`, `/legal/en/terms`, `/legal/de/terms`,
    `/legal/en/support`, `/legal/de/support` all render 200 with the locale toggle switching
    between them; `/legal/fr/privacy` and `/legal/en/nonsense` both 404;
    `curl -s localhost:3000/sitemap.xml | grep -c "/legal/"` returns **6**; and
    `grep -n "force-dynamic" src/app/legal/\[locale\]/\[doc\]/page.tsx` matches.
  - Tests: add `src/lib/legal/legalRoutes.test.ts` covering locale/doc validation (valid pairs
    accepted, unknown rejected) and that every declared doc has content in **both** locales —
    the test must fail if a translation is missing, not silently fall back to English.
  - Depends on: none

- [x] **T2** — Write the cookie/consent assessment record
  - Files: `docs/cookie-assessment.md` (new)
  - Detail: A **repo document, not a page** — H4.4 is explicitly "document, don't build".
    Enumerate every cookie the app actually sets, found by grepping the codebase (session
    cookie, OAuth state, the H2c return-path cookie, the pending-intent cookie) with name,
    purpose, lifetime and why each is strictly necessary under §25 TDDDG. State the
    conclusion: the essential-only exemption applies today, so no banner is required. Add the
    standing guard in bold: **any analytics, affiliate-click or ad script added later triggers
    the banner requirement**, and name H3.4 as the specific task that would trip it. Do not
    speculate about cookies the code does not set.
  - Done when: `docs/cookie-assessment.md` exists, every cookie it lists is grep-verifiable in
    `src/`, and it contains no cookie the code does not actually set. List the grep evidence
    (file:line per cookie) in the Session log.
  - Tests: none — a document.
  - Depends on: none

- [x] **T3** — Draft the privacy policy (EN + DE)
  - Files: `src/lib/legal/content/en/privacy.ts`, `src/lib/legal/content/de/privacy.ts`
  - Detail: Fill in the real content. Required coverage: controller identity (**name + email
    only** — no postal address, per the standing H4.0 gate); the full data inventory derived
    from the live schema (`users`, `user_identities`, `user_library`, `user_watchlist`,
    `user_item_state`, `sync_log`, plus the session cookie, encrypted OAuth tokens, and
    CSP-report payloads); recipients and transfers (TMDB, Trakt, Steam, RAWG, Railway,
    Cloudflare — state the transfer basis per provider, or `TODO(H4.3)` where you cannot
    verify it); legal bases and retention; **the backup-retention window** per the Decisions
    section — confirm litestream v0.3.13's default from Litestream's documentation, and if you
    cannot, write `TODO(H4.3)` rather than a number; all GDPR rights including the right to
    complain to a supervisory authority; a §25 TDDDG essential-cookie note pointing at T2's
    findings; and pointers to the **already-shipped** Art. 17 deletion and Art. 20 export in
    Settings (H4.6/H4.7). Both versions carry the "not legal advice, under review" note.
    **Every claim must be traceable to this repo.** Do not describe data the app does not hold
    — notably, it stores no email address and no real name.
  - Done when: both files render at `/legal/{en,de}/privacy` with substantive content; every
    table and cookie named in the doc exists in the live schema or in `src/`; and the Session
    log lists each `TODO(H4.3)` marker left behind with the reason it could not be resolved.
  - Tests: none — covered by T1's both-locales-present test.
  - Depends on: T1, T2

- [x] **T4** — Draft the terms of service (EN + DE)
  - Files: `src/lib/legal/content/en/terms.ts`, `src/lib/legal/content/de/terms.ts`
  - Detail: Free-service terms: account and acceptable use, user content (ratings, reviews,
    library), an availability disclaimer appropriate to a one-person hobby project,
    termination (cross-referencing the self-serve deletion in Settings), liability, and
    governing law (DE). **Plus monetization-ready sections with clearly-marked placeholders**
    per H4.5 — payment/subscription terms, Widerrufsrecht for digital content including the
    §356(5) BGB waiver mechanics, and a pricing-change clause — each marked
    `TODO(H3)` so it is obvious they are inactive until a model is picked. Same "not legal
    advice, under review" note.
  - Done when: both files render at `/legal/{en,de}/terms`; the monetization sections are
    present and visibly marked as not-yet-applicable; nothing claims a payment flow that does
    not exist.
  - Tests: none — covered by T1.
  - Depends on: T1

- [ ] **T5** — Support/contact page + the profile footer
  - Files: `src/lib/legal/content/en/support.ts`, `src/lib/legal/content/de/support.ts`,
    `src/components/legal/LegalFooter.tsx` (new), `src/app/profile/ProfilePageClient.tsx`
  - Detail: A simple support page built around `hello@fandex.org` (routing is already live)
    that sets a realistic response expectation for a one-person hobby project. Then add
    `LegalFooter` — links to privacy, terms, support and the imprint placeholder — **at the
    bottom of `/profile` only**, per the locked 2026-07-18 decision (BGH two-click rule; a
    global footer is convention, not law). The footer picks its locale link targets from a
    single default (`en`) — do not add locale detection, that is not in scope. Note in the
    Session log whether the two-click rule actually holds now (i.e. that `/profile` is
    reachable in one click from every page).
  - Done when: `/legal/{en,de}/support` render; `/profile` shows the footer with four working
    links; the footer appears on `/profile` and **nowhere else**
    (`grep -rn "LegalFooter" src/` matches only its definition and `ProfilePageClient.tsx`).
  - Tests: none — covered by T1.
  - Depends on: T1

- [ ] **T6** — Imprint placeholder page, noindex
  - Files: `src/lib/legal/content/en/imprint.ts`, `src/lib/legal/content/de/imprint.ts`,
    `src/app/legal/[locale]/[doc]/page.tsx`
  - Detail: A short reachable page stating the imprint is in preparation, with the contact
    email and nothing else. **It must be `noindex`** — add a per-doc robots override in
    `generateMetadata` so only `imprint` gets `robots: { index: false, follow: false }`, and
    keep it out of the sitemap (T1). **Do not write imprint content, and do not include any
    postal address** — §5 DDG content is gated on H4.0.
  - Done when: `/legal/en/imprint` returns 200 and its HTML contains
    `<meta name="robots" content="noindex`; the other three docs do **not**;
    `curl -s localhost:3000/sitemap.xml | grep -c imprint` returns **0**.
  - Tests: none — covered by T1's content-presence test.
  - Depends on: T1

- [ ] **T7** — Cache Discover's browse payload across navigation
  - Files: `src/app/discover/DiscoverPageClient.tsx`, `src/lib/usePersistedState.ts` only if a
    shared helper genuinely belongs there
  - Detail: The leftover from the previous plan's T4. On Back, `loadDefault()` re-fetches
    `/api/discover` plus every saved page and backPage before anything renders — the document
    only reaches full height at ~1474ms, which is why the restored scroll position visibly
    lands ~1.5s late. Cache the merged `items` array in `sessionStorage` alongside the existing
    `rr_discover_browse` depth so a Back navigation paints from cache immediately, then
    revalidates in the background and merges. Requirements: **cap the cached payload** so
    `sessionStorage` cannot blow its quota (measure the real size of a full browse array first
    and record it in the Session log; drop to no-cache above a sane ceiling rather than
    throwing); treat a quota or parse failure as a cache miss, never an error; and make sure a
    revalidation that returns different items does not fight `useScrollRestore` — the anchor
    logic at `captureAnchor()` is the existing pattern for that. **Do not change
    `useScrollRestore` itself.** A cold load (no cache) must behave exactly as it does today.
  - Done when: with a warm cache, Discover → item → Back paints items in **under ~400ms**
    (measured the same way as the previous plan's T4 trace: sample `document.
    documentElement.scrollHeight` and `window.scrollY` every 100ms after Back, and record the
    trace in the Session log), the restored scroll offset still lands within 20px of target,
    and a hard reload with `sessionStorage` cleared still loads normally. Re-verify
    `/library` and a facet page are unaffected.
  - Tests: add a unit test for the cache read/write helper — round-trip, over-ceiling payload
    refused, corrupt JSON treated as a miss.
  - Depends on: none

- [ ] **T8** — PR17 readiness probe
  - Files: `TASKS.md`
  - Detail: `curl -s -o /dev/null -w "%{http_code}" https://fandex.org/api/health`. **If it
    404s** (expected — it has since 2026-07-22), record the date and status in the PR17 entry
    and stop; do not retry in a loop and do not treat it as a blocker. **If it is up**, run
    only checklist steps **1–3** — the DB-size read via `/api/dev/dbsize`, the
    `cgroupMb.fileMb` reading from `/api/health`, and the sitemap URL count plus a site render
    — recording actual values against the expected ones already written in the PR17 entry.
    **Steps 4 and 5 need the Railway console and are not reachable from here**: leave them
    open and say so explicitly rather than marking PR17 closed.
  - Done when: the PR17 entry in `TASKS.md` states today's probe result, and — if prod was up
    — the real readings for steps 1–3 with steps 4–5 still flagged as needing Nils.
  - Tests: none.
  - Depends on: none

- [ ] **T9** — Smoke sweep, log-only
  - Files: `TASKS.md`, `smoketest.md`
  - Detail: Run the `/smoketest` skill's plan (`smoketest.md`) against the local dev server,
    logged in via `GET /api/dev/login`. **Cover the new legal surface** — all four docs in both
    locales, the toggle, the profile footer, the noindex on imprint — as well as Discover after
    T7's caching change. **Observe, don't fix**: log findings to a dated
    "Smoke test — 2026-07-30" section in `TASKS.md` using `SM#` ids continuing from SM32,
    following the file's existing convention. Check the existing tables first so a known open
    finding is not re-logged. If the sweep suggests a new permanent check, add it to
    `smoketest.md`.
  - Done when: `TASKS.md` has the dated section with `SM#`-numbered findings (or an explicit
    "no findings" statement), and **no source file outside `TASKS.md`/`smoketest.md` was
    modified by this task**.
  - Depends on: T1, T5, T6, T7

- [ ] **T10** — Verify, document, commit, push
  - Files: `STATUS.md`, `TASKS.md`, `AGENTS.md`, this plan file
  - Detail: Run `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test`. Stop the dev server,
    then `npm run build`. Confirm the build output lists the new `/legal/[locale]/[doc]` route
    as **`ƒ (Dynamic)`** — if it shows as static, `force-dynamic` did not take and T1's
    invariant is violated. Update `TASKS.md`: mark H4.1/H4.3/H4.4/H4.5/H4.8 done, leave
    H4.0/H4.2/H4.9/H4.10 open, add a dated section for this batch. **`TASKS.md` starts at 170
    of its 200-line CI guard** — archive the fully-closed 2026-07-28 `L#` (calendar
    sources / layout order) section into `docs/archive/history.md` first, leaving a one-line
    pointer, per the file's convention. Update `STATUS.md`'s digest and its roadmap row for
    H4. Add a line to `AGENTS.md` recording that the legal routes are the public,
    viewer-independent surface and must stay `force-dynamic`. Set this plan's front-matter
    `status: complete`. Commit in logical chunks and push.
  - Done when: all four verification commands pass, the legal route is dynamic in the build
    output, `TASKS.md` is under 200 lines, docs are mutually consistent, and the work is pushed
    to `origin/main`.
  - Tests: none — this is the verification task.
  - Depends on: T1–T9

## Blockers log

## Session log
