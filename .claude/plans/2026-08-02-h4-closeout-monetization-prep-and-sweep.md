---
plan_id: 2026-08-02-h4-closeout-monetization-prep-and-sweep
created: 2026-08-02
status: in_progress
branch: current
---

# H4.10 compliance review, H4.9 monetization legal prep, H3.8's Path B trigger, the WAL question, and the 9th sweep

## Objective

The actionable backlog is empty — the 8th sweep (2026-07-31) found zero findings and every logged
`SM#`/`T#`/`F#`/`R#` id is closed. What remains is blocked on Nils (Railway, legal advice, the TWA),
gated behind those blockers (PR17 → P18, H4.0 → H4.2 → H3.3/H3.4), reserved for a supervised session
(the catalog pool-signature split), or time-gated on real data (H5's two open questions).

This session takes the four things that are genuinely unblocked and unattended-safe: **H4.10**, the
compliance review pass that closes H4 down to just the two Nils-gated items; **H4.9**, the
decision-ready monetization legal one-pager H3 needs before its first affiliate link; **H3.8**, writing
down the concrete Path B trigger; and a **report-only investigation of the 48 MB local WAL**, which is
the one perf item left that doesn't require prod. Then a **full 9th smoke sweep**, log-only, because
nothing new shipped to scope a partial sweep to.

Every task is independent. If one gets blocked, the rest still run.

## Decisions

- **Scope: H4.10 + H4.9 + H3.8 + the WAL investigation + a 9th sweep.** → All four unblocked items,
  plus the sweep. Nothing else in the tree is both unblocked and safe for an unattended run.
- **The catalog pool-signature split stays deferred.** → `docs/performance-audit.md` §A already
  records why: it fails *silently* (a newly wishlisted item can miss the pool until TTL expiry), and
  that is precisely the failure class an unattended session must not introduce. It is reserved for a
  supervised Opus pass and is on this plan's **Do not touch** list, not its task list.
- **The two `TODO(H4.3)` markers in the privacy policy stay as they are.** → The per-provider GDPR
  transfer basis and the competent supervisory authority both stay marked TODO until H4.0's legal
  advice lands. Do not research them, do not fill them, do not soften the marker text.
- **H4.10's fix authority is bounded: correct factual drift, log judgment calls.** → If a legal doc
  states a *checkable* fact that the code contradicts (a cookie that no longer exists, a user-scoped
  table missing from the inventory, a wrong retention figure), correct it and cite the `file:line`
  that proves the correction. Anything requiring legal judgment, a new legal claim, or Nils's input
  gets logged as a finding in TASKS.md instead. An unattended session does not author legal positions.
- **H4.9 and H3.8 outputs: a new doc plus a TASKS.md pointer, and an in-place TASKS.md edit,
  respectively.** → H4.9 earns its own file (`docs/monetization-legal.md`) the way `fandex-score.md`
  and `cookie-assessment.md` do. H3.8's trigger is a short decision, not a document — it expands the
  existing H3.8 entry in TASKS.md in place.
- **H4.9 is research, not advice, and every claim carries a source.** → Source URL + access date for
  every legal claim. Where no source is found, write "unverified — needs H4.0's lawyer" rather than
  guessing. Carry the same not-a-lawyer caveat the other legal docs carry. Do not re-litigate the
  locked v1 model (donations + affiliate only) — scope the research *to* it.
- **The WAL work is investigate-and-report only, against a COPY.** → No `db.ts` PRAGMA change ships
  this session, no checkpoint is run against the real `data/rr.db`, and no `.bak` file is deleted.
  Findings append to `docs/performance-audit.md` §B. Precedent: `scripts/rehearse-*.mjs` never write
  their source DB.
- **The 9th sweep is a FULL A–F re-run, and it observes rather than fixes.** → The last two sweeps
  were scoped to what their batch shipped; this batch ships almost no user-facing surface, so a
  scoped sweep would check nothing. Findings log as `SM34+` in TASKS.md. Fixing them is a separate
  session, so this one ends deterministically.
- **PR17 gets one cheap probe, nothing more.** → Confirmed still down at plan time on **2026-08-02**
  (`https://fandex.org/api/health` → Railway edge 404, request_id `DrQvfIxHQhi0t-SC2prcFg`) — i.e. the
  expected ~2026-08-01 billing reset did **not** restore service. That is now a Railway-dashboard
  action for Nils. Probe once, record, move on.

## Out of scope

- The catalog pool-signature split / `catalogSignature()` / `POOL_WHERE` / `getCache()` invalidation
  (see Decisions — reserved for a supervised pass).
- Applying any WAL, checkpoint, or PRAGMA change. T5 measures and writes up; it does not ship a fix.
- Deleting the ~950 MB of `data/rr.db.bak*` snapshots. Several are pre-migration references the
  rehearsal scripts use; deletion is Nils's call.
- Researching or filling the `TODO(H4.3)` transfer-basis and supervisory-authority markers, and the
  `TODO(H4.0/H4.2)` address markers.
- **H4.2** (Impressum content) and **H4.0** — gated on Nils obtaining legal advice.
- **H3.0** (the real Railway bill), **H3.3** (donations rail), **H3.4** (affiliate implementation),
  **H3.9** (go-live checklist) — all gated on H4.0 + H4.2 being live. H4.9 *prepares* for H3.4; it
  does not start it.
- **PR17** steps 1–5 and **P18**'s clickable JustWatch links / `PROJECTION_VERSION` bump / any
  catalog re-projection — all gated on prod being reachable.
- **P15 / P16** (TWA) — gated on Nils building and signing the TWA.
- H5's two open questions (`priorStrength`/class-weight re-tune, the `capped` treatment) — both
  explicitly time-gated on "a few weeks of real scores"; it has been four days.
- Fixing anything the sweep finds.

## Do not touch

- `src/lib/migrations.ts` — no task here needs a new migration.
- `src/lib/matcher.ts` write paths, `src/lib/sync/`, and every provider adapter's pull/push logic —
  the prune invariant lives there and nothing in this plan requires a change. T2 *reads* the adapters
  to verify the privacy policy's recipients section; it must not edit them.
- `src/lib/discovery.ts`'s `catalogSignature()`, `POOL_WHERE`, and `getCache()` invalidation logic.
- `src/lib/sources/project.ts` and `normalize.ts` — touching either implies a `PROJECTION_VERSION`
  bump, which is out of scope.
- `src/lib/db.ts`'s PRAGMA block — T5 is report-only.
- `data/` — no writes to `data/rr.db` beyond ordinary app reads/writes, never delete a `.bak`, never
  run a VACUUM, never run a checkpoint against the real file. T5 works on a scratchpad copy.
- Every `TODO(H4.3)` and `TODO(H4.0/H4.2)` marker in `src/lib/legal/content/**` — leave the marker
  text exactly as written.
- `src/lib/legal/content/{en,de}/imprint.ts` — the placeholder is deliberate and gated on H4.0.
- `.claude/worktrees/` — a stray worktree `nervous-nightingale-c5c8e0` (detached HEAD `ef0fa74`) from
  an earlier session lives there. It is not this session's; do not delete, check out, or `git
  worktree prune` it.
- `/api/auth/logout` — calling it bumps `session_epoch` and kills Nils's own browser session, which
  only a real OAuth round-trip restores. Use `GET /api/dev/login` for a session.

## Verification commands

- tests: `npx vitest run`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build` — **stop the dev server first**; a build over a running `next dev` corrupts
  `.next` and produces 404s that read as product bugs. If `.next/turbopack` throws `EBUSY`, that's
  OneDrive/Defender holding it: retry the `rm -rf .next` a few times with a short wait.

Baseline to hold: **485 tests passing, 0 lint errors, typecheck clean, build clean.** This batch is
mostly documentation, so a *drop* in the test count means something broke — investigate, don't
rationalise.

## Tasks

- [x] **T1** — Probe prod once; record that PR17 is still blocked (or, if it answers, run steps 1–3)
  - Files: `TASKS.md` (the PR17 readiness-probe paragraph), `STATUS.md` and
    `docs/archive/history.md` only if prod is actually up
  - Detail: run `curl -s -o - -w "\n%{http_code}" https://fandex.org/api/health`. If the body is
    Railway's `{"status":"error","code":404,"message":"Application not found"}`, append one dated
    line to TASKS.md's PR17 readiness-probe paragraph recording the date, the request_id from the
    response, and the fact that the expected ~2026-08-01 billing-cycle reset did **not** restore
    service — then STOP this task, that is a complete and successful outcome. Additionally note in
    that paragraph that this now needs Nils in the Railway dashboard rather than more waiting.
    If it answers for real, run **steps 1, 2 and 3 only** of the PR17 checklist in TASKS.md (each has
    its literal command and expected value inline: `dbsize` `fileMb` ≈ 36.5 and `media_items.rows`
    ≈ 2,012; `/api/health` `cgroupMb.fileMb` plateauing rather than climbing; `sitemap.xml` `<url>`
    count ≈ 2,013) and record actual-vs-expected in `docs/archive/history.md`. **Steps 4 and 5 need
    the Railway console — do NOT attempt them**; note that they still require Nils either way.
  - Done when: TASKS.md contains a dated line stating either "still down" (with the request_id and
    the Railway-dashboard note) or the step 1–3 readings, and PR17's status reflects reality.
  - Tests: none — this is an observation task.
  - Depends on: none

- [x] **T2** — H4.10: the compliance review pass
  - Files: `docs/compliance-review.md` (new), `TASKS.md`; plus narrowly-scoped corrections to
    `src/lib/legal/content/{en,de}/*.ts` and/or `docs/cookie-assessment.md` **only** where a
    checkable fact is wrong
  - Detail: three checks, each producing evidence in the new doc. Every claim you make about the
    code must cite `file:line`.
    **(a) Two-click reachability.** H4.1's design puts `LegalFooter` at the bottom of `/profile`
    only (`src/app/profile/ProfilePageClient.tsx:245`), relying on `AppNav`'s "You" slot reaching
    `/profile` in one click from everywhere. Verify that actually holds for **every** page route:
    `src/app/page.tsx`, `calendar`, `dashboard`, `discover`, `insights`, `insights/facet`, `library`,
    `wishlist`, `profile`, `settings`, `item`, `item/debug`, `dev/scoring`, `legal/[locale]/[doc]`,
    `[type]/[id]/[slug]`, `person/[slug]`, `tag/[slug]`, `studio/[slug]` (enumerate with
    `find src/app -name "page.tsx"`). The interesting cases are the ones where `AppNav` may not
    render at all, and the anon case — a page that renders no nav for a logged-out visitor breaks the
    chain. Record a route-by-route table: does `AppNav` render, is `/profile` one click away, is the
    total ≤2 clicks. **A route where it does NOT hold is a finding to log, not a redesign to attempt.**
    **(b) Docs vs code.** Five concrete cross-checks:
      1. The privacy policy's data inventory vs the live schema — every table with a `user_id` column
         (the same rule `userScopedTables()` in `src/lib/account.ts` uses; read `sqlite_master`) must
         appear in the inventory, and nothing in the inventory may be absent from the schema.
      2. `docs/cookie-assessment.md` claims **exactly three** cookies app-wide. Re-grep for every
         cookie write in `src/` (`cookies().set`, `Set-Cookie`, `setSessionCookie`,
         `setOAuthStateCookie`, `setOAuthReturnCookie`) and confirm the count and the names are still
         `rr2_session` / `rr2_oauth_state` / `rr2_oauth_return`, with the stated max-ages.
      3. The privacy policy's recipients/transfers section vs each provider adapter's real
         `push*`/`pull*` functions — TMDB/Trakt/RAWG bidirectional, Steam read-only, IGDB
         metadata-only. Confirm by reading the adapters, not by trusting the doc.
      4. The **24h** Litestream retention figure vs the Dockerfile's pinned Litestream version and
         the `litestream.yml` config actually shipped (no `retention` key ⇒ v0.3.13's 24h default).
      5. The terms of service' factual claims about how the service works (no Fandex password,
         connect-a-provider-account only, no direct sale today) vs the auth code.
    **(c) The statutory checklist.** A section in the new doc checking the current state against
    §5 DDG (what's mandatory, what Fandex publishes, what's deliberately deferred to H4.0/H4.2),
    GDPR (Arts. 13/15/17/20 — the export and deletion routes exist; confirm the policy describes them
    accurately), and §25 TDDDG (the strictly-necessary exemption, and the standing guard naming H3.4
    as the task most likely to trip it).
    **Fix authority, hard boundary:** correct only a statement that is checkably false against the
    code, and cite the proof. Never add a new legal claim, never touch a `TODO(...)` marker, never
    touch the imprint. Anything ambiguous, judgment-dependent, or needing Nils → log it in TASKS.md
    under this batch's id, do not write it into a legal doc.
  - Done when: `docs/compliance-review.md` exists with all three sections, the reachability table
    covers every route returned by `find src/app -name "page.tsx"`, all five doc-vs-code checks are
    recorded as pass/fail with `file:line` evidence, every correction made is listed with its proof,
    every non-corrected discrepancy is logged in TASKS.md, and TASKS.md's H4.10 entry is marked ✅
    with a pointer to the new doc.
  - Tests: none required unless a correction changes a string covered by an existing legal-content
    test — if `npx vitest run` drops below 485, fix the test to match the corrected fact.
  - Depends on: none

- [x] **T3** — H4.9: the monetization legal one-pager
  - Files: `docs/monetization-legal.md` (new), `TASKS.md` (H4.9 entry → ✅ + pointer)
  - Detail: a decision-ready one-pager scoped to the **locked v1 model — donations + affiliate links
    only** (TASKS.md's H3 section, decided 2026-07-18). Do not re-litigate the model; research what
    it requires. Four sections:
      1. **Affiliate-link labeling duties.** German/EU requirements for making advertising
         recognisable as such (§5a UWG and the DDG's successor to §6 TMG) — what wording, where, and
         how prominent; what applies to the gray-market key shops (Eneba/Instant Gaming/Kinguin) that
         were deliberately decided *in*; whether a per-link marker, a per-page notice, or both is the
         defensible minimum.
      2. **Cookie/consent interaction.** Which of the named programs (GMG, Humble, Fanatical, Amazon
         PartnerNet, and the gray-market shops) set click-attribution cookies on *Fandex's* domain vs
         only on the destination's — that distinction is what decides whether H4.4's §25 TDDDG
         exemption survives H3.4. Cross-reference `docs/cookie-assessment.md`'s standing guard.
      3. **Tax.** Kleinunternehmerregelung (§19 UStG) — confirm the current thresholds against a
         primary source rather than repeating TASKS.md's numbers, and state plainly that affiliate
         income counts toward them. Note what changes at the threshold.
      4. **Payment-provider legal — Path B only.** Stripe DPA vs merchant-of-record (Paddle / Lemon
         Squeezy), and the consumer-law hooks already stubbed as `TODO(H3)` in
         `src/lib/legal/content/{en,de}/terms.ts` (Widerrufsrecht / §356(5) BGB for digital content).
         Mark this section clearly as **not needed for v1** — it exists so H3.8's decision is
         informed, not because anything here is imminent.
    Close with a **"before the first affiliate link goes live" checklist** — the concrete, ordered
    prerequisites, with H4.0 and H4.2 named as the hard gates.
    **Sourcing rule:** every legal claim carries a source URL and the date you accessed it. Where you
    cannot find a source, write "unverified — needs H4.0's lawyer" rather than asserting. Open the
    doc with the same not-a-lawyer caveat the other legal docs carry.
  - Done when: `docs/monetization-legal.md` exists with all four sections plus the go-live checklist,
    every legal claim has either a cited source URL + access date or an explicit "unverified" marker,
    no section proposes changing the locked v1 model, and TASKS.md's H4.9 entry is ✅ with a pointer.
  - Tests: none — this is a research document.
  - Depends on: none

- [x] **T4** — H3.8: write down the Path B trigger and how it gets measured
  - Files: `TASKS.md` (expand the existing H3.8 entry in place)
  - Detail: turn H3.8's parenthetical suggestion into a decided, written-down trigger. Two halves:
    **(a) The threshold.** TASKS.md's own starting point: "sustained active users where a 2–5%
    conversion at ~1–2 €/mo clears ~200 €/mo — roughly 1k+ actives — OR pageviews clear an ad
    network's minimum, e.g. Monumetric's 10k/mo". Commit to concrete numbers for both arms, show the
    arithmetic (including the fact that Path B's TMDB commercial licence is **$149/mo**, so the
    revenue arm must clear roughly $155/mo before it nets anything), and state which arm triggers
    what — the ad arm and the freemium arm do not need the same threshold.
    **(b) The metric.** Determine whether weekly active users is computable *today* from data the app
    already stores — check `users`, `user_item_state.updated_at`, `sync_log`, and the session
    mechanism in `src/lib/session.ts` for a last-seen signal. Write down either the exact query that
    computes it, or — if nothing suitable exists — the smallest change that would make it computable,
    named as a future task. **Do not build the metric.** This task writes a decision; Nils approves
    it before anything is implemented.
  - Done when: TASKS.md's H3.8 entry contains concrete numeric thresholds for both arms with the
    arithmetic shown, and either a working WAU query or a named, scoped follow-up for making WAU
    measurable. No new code ships.
  - Tests: none — this is a written decision.
  - Depends on: none

- [x] **T5** — Investigate the 48 MB local WAL; report only, change nothing
  - Files: `docs/performance-audit.md` (append to §B, "DB inflation")
  - Detail: `docs/performance-audit.md` §B records a **48.4 MB `rr.db-wal` against a 55.9 MB main
    file** and calls it "the thing to look at first". Find out why, without fixing it.
    **Work against a COPY** in the scratchpad directory, never the real `data/rr.db` — the precedent
    is `scripts/rehearse-prune.mjs` / `rehearse-account-deletion.mjs`, which never write their
    source. Do not run a checkpoint, a VACUUM, or any write against the real file.
    Measure, at minimum: current `rr.db-wal` size; `pragma page_size`; the effective
    `pragma wal_autocheckpoint` value (`src/lib/db.ts:22-35` sets `journal_mode = WAL`,
    `foreign_keys`, `busy_timeout` and `synchronous = NORMAL` but **never sets
    `wal_autocheckpoint`**, so SQLite's 1000-page default applies — confirm what that is in bytes at
    this page size and compare it to the 48 MB actually observed); the WAL's frame count; and whether
    any code path holds a long-lived read transaction that would block a checkpoint.
    Then run the one decisive non-destructive test: **stop the dev server and re-measure the WAL
    size.** A WAL that collapses on last-connection-close means the default autocheckpoint is working
    fine and is simply being outrun by a continuously-open dev connection (a dev artifact, not a prod
    bug); a WAL that persists at 48 MB after every connection closes is a real problem and a
    different diagnosis entirely. Say which one it is.
    Write up: the measurements, the diagnosis, whether prod is affected or this is dev-only, and the
    precise change you would make (with the exact PRAGMA and value) if it were in scope — so a later
    supervised pass reviews-and-applies rather than rediscovers. **Ship no change.**
  - Done when: `docs/performance-audit.md` §B has a dated subsection containing the measurements, the
    before/after-dev-server-stop WAL sizes, a stated diagnosis naming which of the two cases holds,
    a prod-affected yes/no, and the exact proposed PRAGMA change — and `git diff` shows no change to
    `src/lib/db.ts` and no file under `data/` added, modified or deleted.
  - Tests: none — investigation only.
  - Depends on: none

- [x] **T6** — The 9th smoke sweep: full A–F re-run, log-only
  - Files: `TASKS.md` (a new dated smoke-test section), `smoketest.md` (only if a step is stale)
  - Detail: run the **whole** flow checklist in `smoketest.md` — sections **A** (public/anonymous),
    **B** (API probes), **C** (logged-in), **D** (cross-cutting), **E** (the dedicated UI/UX
    evaluation), **F** (tag taxonomy round trip). Unlike the 7th and 8th sweeps this is not scoped to
    a batch's new surface: this batch ships almost no user-facing change, so a scoped sweep would
    check nothing.
    Get a session with **`GET /api/dev/login`** — it mints one for `DEV_LOGIN_USER_ID` and works in
    the in-app browser pane. **Never call `/api/auth/logout`.** For the anon half use a separate
    cookie-less path (curl without the cookie, or a fresh tab that has never had the cookie), not a
    logout.
    Check console and server logs after each block. **Observe, do not fix** — log every finding in
    TASKS.md as `SM34`, `SM35`, … with a severity, the exact repro, and the measured value where
    there is one. Note explicitly in the write-up that this is the **9th** sweep (the 2026-07-30
    entry mislabelled itself as the 7th and the 2026-07-31 entry already corrected the count once).
    If a checklist step is stale because the app changed, update that step in `smoketest.md` and say
    so — that file is a living plan.
  - Done when: TASKS.md has a new dated smoke-test section covering all six lettered blocks, with
    either logged `SM34+` findings or an explicit statement that a block was clean, and the console/
    server-log state is recorded for the sweep as a whole. No finding is fixed in this session.
  - Tests: none — this is an exploratory pass.
  - Depends on: T2 (run the sweep after any legal-content correction lands, so it exercises the
    final state)

- [ ] **T7** — Verify, update the project docs, commit and push
  - Files: `STATUS.md`, `TASKS.md`, `AGENTS.md` (only if T2 or T5 found something invariant-worthy)
  - Detail: run all four verification commands and record the actual numbers. Then update `STATUS.md`
    with a new dated headline entry for this batch, in the established voice — what was found, not
    just what was done — and make sure TASKS.md's "Remaining work (current)" section reflects the new
    state (H4 down to H4.0 + H4.2 only, if T2 and T3 both landed). **Both files must agree**; that
    two-file sync is the standing convention.
    If T2 or T5 surfaced something that would bite a future session the way the `@theme` tree-shaking
    trap did, add it to AGENTS.md's load-bearing invariants — but only if it is genuinely a trap, not
    merely a fact.
    Keep TASKS.md under its 200-line CI guard: if this batch's additions push it over, archive a
    completed section into `docs/archive/history.md` leaving a one-line pointer behind, per the
    file's own stated convention.
    Then commit (one commit per task where the work is separable, following the existing
    `type(scope): summary (plan-id T#)` message style) and push.
  - Done when: `npx vitest run` ≥ 485 passing, `npm run lint` 0 errors, `npx tsc --noEmit` clean,
    `npm run build` clean; STATUS.md and TASKS.md both updated and consistent; TASKS.md under 200
    lines; everything committed and pushed to `main`.
  - Tests: the full suite — this is the verification task.
  - Depends on: T1, T2, T3, T4, T5, T6

## Blockers log

(Left empty by the planner. The work skill appends here.)

## Session log

(Left empty by the planner. The work skill appends here.)
