---
plan_id: 2026-08-07-post-outage-verification-facet-cost-slug-fix
created: 2026-08-07
status: ready
branch: current
---

# Post-outage verification close-out, facet compute exposure, and the non-ASCII slug 404

## Objective

Railway came back on 2026-08-07 for a ~32 minute window (last observed `uptime` 1871 s)
and was then un-routed again at the edge. During that window the PR17 verification
readings were captured, and **the row-write leak that caused the 2026-07-22 cost
outage is confirmed fixed in production**. This session banks that result in the
docs, fixes two real bugs found while checking (a crawl-driven compute/quota
exposure on the public facet pages, and person links that hard-404 for names with
stroked or ligature letters), and leaves the remaining prod-only steps written up
for Nils. Every prod-dependent step is written to probe reachability first and log
a blocker rather than fail, because prod may well be down for the whole session.

## Decisions

- **How to bound the facet-page compute exposure?** → **Enlarge the in-process cache**,
  implemented as **TTL 1 h → 24 h plus a byte-budgeted increase to `max`**, not a
  blind 10×. Rationale: Nils chose "enlarge the cache" as the low-risk option that
  avoids PR14's auth-state caching hazard and preserves the P17 SEO surface. But
  `BoundedCache` bounds entry *count*, not bytes, and `_facetPageCache` holds full
  ~60-item payloads — it is deliberately 500 where the tiny-value caches beside it
  are 5000. A blind 500→5000 could add several hundred MB and re-create the memory
  ramp that took prod down. Raising the TTL costs **zero** additional bytes and is
  the larger share of the win; `max` rises only as far as a measured budget allows.
- **Fix the non-ASCII slug 404?** → **Yes: `personKey` + `companyKey` + `slugify`.**
  `companyKey` is built on `personKey`, so one transliteration map fixes all three.
  Verified against the live TMDB API this session: `lisa-t-nne` → 0 results (today's
  404), `lisa-tonne` → 4 results including "Lisa Tønne". Transliteration alone is
  sufficient; no change to the TMDB query shape is needed.
- **Touch `tagKey`?** → **No, explicitly out.** Tag keys are **persisted** —
  `tag_category_override` (84 rows on prod) and `tag_alias` (4) are keyed by them.
  Changing the tag normalizer would silently orphan those rows. Person and company
  keys are runtime-only, which is what makes them safe to change.
- **`PRUNE_ON_BOOT` before prod returns?** → **Set it to `0` first.** Goes in
  "Needs Nils" (it is a Railway env var, not a code change). Rationale: the
  unattended delete path stays off until PR17 steps 4–5 confirm Litestream's
  replica generation, which has been UNVERIFIED since 2026-07-22, and the boot
  prune is the likely cause of the 340.8 MB WAL high-water.
- **How to handle prod-dependent tasks while prod flaps?** → Each one starts with a
  reachability probe; if prod is unreachable it appends a `BLOCKED` entry and moves
  on. The session must still count as complete with every prod task blocked.
- **`wal-truncate` on prod?** → Only inside the prod-probe task, and only after the
  dbsize/health readings are captured. It is safe by construction (SQLite cannot
  discard frames Litestream still needs) and needs no confirm string.

## Out of scope

- **H3 affiliate program signups** (GOG → Humble → Fanatical → GMG → Amazon last).
  Requires Nils in a browser on third-party sites; still gated on prod being stably
  reachable because every program reviews the applicant URL.
- **`NEXT_PUBLIC_SUPPORT_URL` on Railway** — env change + redeploy, Nils only.
- **`PRUNE_ON_BOOT=0` on Railway** — env change, Nils only. This plan only documents it.
- **P15/P16 Android TWA** — blocked on Nils building/signing the TWA.
- **PR17 steps 4–5** (Litestream `snapshots`, stale `rr.db.tmp-*` WAL sidecars) —
  need the Railway shell, unreachable from any session.
- **H3.0 upkeep baseline**, **H3.8 threshold approval**, **Fandex Score re-tune**
  (time-gated) — unchanged, still Nils / still waiting.
- Any change to `tagKey`, to the facet routes' `dynamic = "force-dynamic"`, or to
  `robots.txt`. All three were considered and rejected above.

## Do not touch

- `src/lib/facets.ts`'s `tagKey()` — persisted keys, see Decisions.
- `src/lib/migrations.ts` and the `db.ts` schema block — no schema work in this plan.
- `src/lib/sync/index.ts` and `src/lib/sources/adapters/**` — the prune invariant.
- `src/app/api/dev/login/route.ts` — its three fail-closed gates.
- `src/app/{tag,person,studio}/[slug]/page.tsx` route-segment configs
  (`export const dynamic = "force-dynamic"` stays).
- `robots.txt` / `src/app/robots.ts` — the facet surfaces stay crawlable.
- `MONETIZATION_ENABLED` and anything that would make an affiliate link live.
- Prod data: no `POST /api/dev/prune` with `{"action":"prune"}`, `"prune-job"` or
  `"vacuum"`. `wal-truncate` only, per Decisions.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build`

Standing bar: 544 tests passing, `tsc` clean, lint **0 errors**, build clean. Do not
land below it. Never run `npm run build` while `npm run dev` is running.

## Tasks

- [ ] **T1** — Add a stroked/ligature transliteration map and route `personKey` through it
  - Files: `src/lib/facets.ts`, `src/lib/facets.test.ts`
  - Detail: `personKey()` (facets.ts:50) does `.normalize("NFD")` then strips
    combining marks — which does nothing for characters that have **no canonical
    decomposition**. Add a module-level map applied *before* the
    `.replace(/[^a-z0-9]+/g, " ")` strip, covering at minimum:
    `ø→o å→a æ→ae œ→oe ł→l ß→ss đ→d ð→d þ→th ı→i ħ→h ŋ→n ŧ→t ø→o`
    (apply after `.toLowerCase()`, so only lowercase forms are needed).
    Do **not** touch `tagKey()`. `companyKey()` calls `personKey()` and inherits the
    fix for free — verify that rather than duplicating the map.
  - Done when: `personKey("Lisa Tønne") === "lisa tonne"`,
    `personKey("Łukasz Żal") === "lukasz zal"` (today: `"ukasz zal"` — the leading
    `Ł` is dropped entirely), `personKey("Straße") === "strasse"`,
    `personKey("Sœur Emmanuelle") === "soeur emmanuelle"`,
    `companyKey("Đại Việt Films") === "dai viet"`, and `tagKey` behaviour is
    byte-identical to before (assert it explicitly).
  - Tests: extend `src/lib/facets.test.ts` with the cases above plus a regression
    assertion that `tagKey("Sci-Fi")` still returns `"sci fi"`.
  - Depends on: none

- [ ] **T2** — Apply the same transliteration to `slugify`
  - Files: `src/lib/publicUrl.ts`, `src/lib/publicUrl.test.ts` (create if absent)
  - Detail: `slugify()` (publicUrl.ts:54) has the identical NFKD defect. Reuse the
    map from T1 — export it from `facets.ts` and import it, do not copy it. Keep the
    existing behaviour for non-Latin scripts (the comment at publicUrl.ts:51 notes
    "君の名は。" must still slugify to `""` and be handled by the caller); the map
    must not change that.
  - Done when: `slugify("Lisa Tønne") === "lisa-tonne"`,
    `slugify("Amélie") === "amelie"` (unchanged), `slugify("君の名は。") === ""`
    (unchanged), and the length-cut / trailing-hyphen trim behaviour is unchanged.
  - Tests: as above.
  - Depends on: T1

- [ ] **T3** — Confirm no persisted data is keyed by a person or company key
  - Files: none (verification only; write findings into T7's commit message)
  - Detail: T1 changes an identity/dedup key. Prove nothing on disk depends on the
    old form before shipping it. Read `sqlite_master` on the real local
    `data/rr.db` **read-only** (`new Database(path, { readonly: true })`) and confirm
    no table or JSON column stores a person/company facet key. The prod table list
    captured 2026-08-07 is: `media_external_ids media_items media_links
    scoring_config sync_log tag_alias tag_category tag_category_override
    user_identities user_item_state user_library user_watchlist users`.
    Pay specific attention to `user_item_state` — if it carries a facet-keyed JSON
    blob, T1 becomes a data-migration question and must be reported as BLOCKED
    instead of shipped.
  - Done when: either confirmed clean (state which columns were checked), or T1/T2
    are reverted and a BLOCKED entry explains what persists person keys.
  - Tests: none — verification task.
  - Depends on: T1

- [ ] **T4** — Enlarge the facet payload cache against a measured byte budget
  - Files: `src/lib/detail/publicFacetDetail.ts`
  - Detail: `_facetPageCache` (line 430) is
    `BoundedCache{max: 500, ttlMs: 60*60*1000}`. Two changes:
    1. **TTL 1 h → 24 h** (`24 * 60 * 60 * 1000`). Costs zero extra bytes and is the
       bigger share of the win. Safe because `scoringConfigSignature()` is already
       folded into the cache key, so an admin tag/bundle edit still busts it
       immediately rather than waiting out the TTL.
    2. **`max` 500 → a measured value.** First measure: build one representative
       payload for each kind (`person`, `tag`, `company`) and record
       `JSON.stringify(payload).length`. Then set
       `max = min(5000, floor(150_000_000 / p95_payload_bytes))`, rounded down to a
       round number, and **write the measured sizes and the resulting arithmetic
       into the code comment** so the next session doesn't re-derive it. If the
       measured p95 puts `max` at or below 500, leave `max` at 500 and say so — the
       TTL change alone still ships.
    Update the comment block at lines 416–429 to record the new numbers and why the
    budget exists (cite the 2026-07-22 memory ramp). Do not change the cache key
    composition — `persist` and `scoringConfigSignature` must stay in it (PR14).
  - Done when: TTL is 24 h; `max` is justified by measured bytes in a code comment;
    the 150 MB ceiling is stated; cache key unchanged; tests green.
  - Tests: none new required (`boundedCache.test.ts` covers the mechanism). If a
    facet test asserts the old TTL, update it.
  - Depends on: none

- [ ] **T5** — Record the 2026-08-07 prod readings and close what PR17 can close
  - Files: `docs/archive/history.md`, `TASKS.md`, `STATUS.md`
  - Detail: The full findings are in the session scratchpad at
    `leak-check-2026-08-07.md`; transcribe the substance, don't rely on that file
    surviving. Append an archive entry under a `PR17 post-outage verification`
    heading recording, as actual-vs-expected:
    - `fileMb` **37.1 → 37.2** (expected ≈36.5) — **not** the old ~2.5 GB, so the
      performance audit's §B inflation is settled, not reopened.
    - `media_items` **2141** (expected ≈2012); `media_links` 4098;
      `media_external_ids` 4102; `user_library` 1912; `user_watchlist` 96;
      `user_item_state` 2337; `freelistCount` 0→3; `pageSize/pageCount` 4096/9512.
    - `libRowsWithoutState` **0** and `wishRowsWithoutState` **0** — the precondition
      for ever dropping the `user_library`/`user_watchlist` cache tables is **met**.
    - **The decisive leak test:** 23 anonymous Googlebot-UA requests across 15 public
      facet pages plus item pages (the exact shape that caused the blowup, ~60 titles
      per page → ~900 thin rows if the gate were broken) left `media_items`,
      `media_links` and `media_external_ids` **byte-identical**. PR13–PR15's
      logged-in write gate **holds in production**. The +129 over the 2026-07-27
      expectation is 16 days of the owner's own synced/logged-in-browsed rows
      (`users` = 1), not crawler growth.
    - Sitemap **2019** `<url>`s (expected ≈2013) = 972 movie + 758 game + 282 show
      + 6 legal + 1 root; the 6 legal are `{en,de}×{privacy,terms,support}` with
      **imprint correctly absent**. `robots.txt` served real content (no
      `localhost:3000`, so the SM7 trap is still fixed).
    - Memory: **no ramp** — rss 330→333→304 (GC)→324, anonMb 296→266→286, cgroup
      `currentMb` 353–387 against `limitMb` 7629, across 9 samples spanning the
      crawl. **PARTIAL**: uptime only reached ~31 min, so the multi-hour plateau
      proof step 2 demands is still owed.
    - Availability: up ~32 min then all routes returned Railway's edge 404
      (`x-railway-fallback: true`, `{"code":404,"message":"Application not found"}`,
      `x-railway-edge: ams1`) — the identical 2026-07-22 signature. The app process
      never crashed: `uptime` climbed 1354→1871 monotonically. It was **un-routed**,
      i.e. stopped/paused, not broken.
    Then in `TASKS.md`: mark PR17 steps 1 and 3 **done with these readings**, step 2
    **partial (needs a multi-hour re-read)**, steps 4–5 **still blocked on the Railway
    shell**. Keep PR17 open — it cannot close until 4–5 run. **Correct the doc drift:**
    step 1 says a cookie-less `curl` to `/api/dev/dbsize` gets **404**; it actually
    returns **401**. Fix that so a future session doesn't misread a 401 as the gate
    working as documented.
  - Done when: the archive entry exists with every number above; TASKS.md reflects
    the per-step status; the 404→401 correction is made; `TASKS.md` is still under
    the 200-line CI guard (check with `wc -l`).
  - Depends on: none

- [ ] **T6** — Document the facet-page compute + provider-quota exposure
  - Files: `TASKS.md`, and `docs/archive/performance-audit.md` only if a pointer is
    needed (performance work is otherwise closed — do not reopen the audit)
  - Detail: Add a short open item recording a **new** cost channel, distinct from the
    row leak PR13–16 closed. Measured cold on prod 2026-08-07:
    `/tag/telepathy` **59.2 s**, `/tag/action` 14.5 s, `/tag/sci-fi` 12.8 s,
    `/tag/mystery` 7.4 s, `/tag/comedy` 6.4 s, `/tag/romance` 5.3 s,
    `/tag/thriller` 4.9 s; warm repeats 0.13–0.22 s. Cause: all three facet routes
    are `force-dynamic` (no route cache) and `buildPublicFacetDetail` fans out to
    providers per build — studio up to 8 TMDB discover calls, tag = TMDB + RAWG +
    IGDB. `robots.txt` **allows** `/person/ /tag/ /studio/`, and the slug surface
    (every person credited across 2012 titles) vastly exceeds the cache, so a crawl
    sweep runs at a near-100% miss rate. This is a compute **and third-party quota**
    exposure — **RAWG's free tier is 20k req/mo**. Note that T4 mitigates but does
    not eliminate it, and that `openProviderCircuits` was `{}` throughout, so the
    59 s was genuine render cost, not a dead provider. State plainly that it is
    **not proven** to be the original cost driver — it is live exposure found while
    verifying.
  - Done when: the item is in TASKS.md with the measured numbers, the RAWG quota
    note, and an explicit "T4 mitigates, does not eliminate"; TASKS.md still under
    200 lines.
  - Depends on: T4

- [ ] **T7** — Prod re-verification, if prod is reachable
  - Files: `docs/archive/history.md` (append), `TASKS.md` (status only)
  - Detail: **Probe first:**
    `curl -s -o /dev/null -w "%{http_code}" --max-time 20 https://fandex.org/api/health`.
    If it is not `200`, append a `BLOCKED` entry noting the status and the timestamp
    and **finish the task successfully** — do not retry in a loop, do not fail the
    session. If it **is** `200`:
    1. Record `uptime`. If `uptime` > 4 h, read `cgroupMb.fileMb`, `memoryMb.rss` and
       `cgroupMb.anonMb`, take **at least 5 samples ≥ 5 min apart**, and record
       whether it is a plateau or a climb toward 2000 — that closes PR17 step 2.
       If `uptime` < 4 h, say so and leave step 2 partial; a fresh process cannot
       prove a plateau.
    2. Record `dbFilesMb` (`dbMb`, `walMb`, `shmMb`, `shadowWalMb`). Baseline
       2026-08-07: 37.2 / **340.8** / 0 / **129.4**. A `walMb` still near 340.8 that
       is **static under write load** is the reusable high-water mark, not a stall;
       a `walMb` that **climbs** is the 2026-07-22 checkpoint stall recurring and
       must be flagged loudly in the blockers log.
    3. Then `POST /api/dev/prune` with `{"action":"wal-truncate"}` to reclaim the
       high-water (~470 MB of billed volume for a 37 MB DB). Record
       `walMbBefore`/`walMbAfter` and `busy`. **A `busy: 1` result is expected and
       normal**, not a failure — Litestream holds a read lock over frames it has not
       shipped. Do not escalate, do not retry aggressively, and do **not** fall back
       to any other `action`.
    - This endpoint is admin-gated behind `SCORING_ADMIN_USER_IDS`; a cookie-less
      `curl` gets **401**. If the session has no admin cookie, log that the readings
      need Nils's browser and finish — that is a blocker, not a failure.
  - Done when: either the readings are recorded, or a BLOCKED entry states the probe
    result and what is still owed. Either outcome completes the task.
  - Depends on: none

- [ ] **T8** — Update the Needs-Nils list with the two new prod actions
  - Files: `TASKS.md`, `STATUS.md`
  - Detail: The "Needs Nils" list currently says prod has been down since
    2026-07-22 and the billing reset didn't fix it. Rewrite item 1 to reflect what
    is now known: prod **did** come up on 2026-08-07 and served correctly for ~32
    minutes, then was un-routed at the edge again with the same
    "Application not found" signature. The app never crashed, so this reads as a
    **billing/pause action, not a technical one** — if usage is still at the cap,
    any resumed traffic re-accrues and can re-trip the pause immediately. Add:
    - **Set `PRUNE_ON_BOOT=0` on Railway before the next successful boot**, so the
      unattended delete path stays off until PR17 steps 4–5 confirm Litestream.
      Explain that the boot prune is the likely cause of the 340.8 MB WAL
      high-water and that Litestream's replica generation has been unverified since
      2026-07-22.
    Keep the existing items (Impressum review, `NEXT_PUBLIC_SUPPORT_URL` +
    redeploy, TWA, H3.0, H3.8, affiliate signups) — affiliate signups stay parked on
    prod being **stably** up, which a 32-minute window is not.
  - Done when: both files reflect the 2026-08-07 availability finding and the
    `PRUNE_ON_BOOT=0` action; STATUS.md's "Prod is DOWN" section states the new
    evidence rather than the stale "billing reset didn't fix it" framing.
  - Depends on: T5

- [ ] **T9** — Quality bar, memory update, commit and push
  - Files: memory dir
    `C:\Users\n-mly\.claude\projects\C--Users-n-mly-OneDrive-Documente-09-Projects-Personal-ReleaseCalendar-releaseradar2\memory\`
  - Detail: Run all four verification commands and get them green. Then:
    - Update `prod-incidents.md`: the 2.5 GB inflation is **resolved** — prod read
      37.2 MB on 2026-08-07 — and the row-write leak is confirmed fixed by the
      byte-identical crawl test. Record the ~32-minute window and the un-routed
      (not crashed) diagnosis.
    - Update `provider-latency-isolation.md` or add a new memory for the facet-page
      crawl-cost channel, including the RAWG 20k/mo quota angle.
    - Add a memory for the transliteration class of bug — NFD/NFKD does not
      decompose `ø å æ ł ß đ`, so any "strip diacritics" normalizer is lossy for
      them, and when the key **is** the URL identity that means a hard 404.
    - Add one-line pointers to `MEMORY.md` for anything new.
    - `git fetch` first (more than one session pushes here), then commit per-task and
      push. Do not amend. End every commit message with the required
      `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.
  - Done when: `npm test` (≥544 passing), `npx tsc --noEmit`, `npm run lint`
    (0 errors) and `npm run build` are all clean; memory files updated; work is
    committed and pushed to `main`.
  - Depends on: T1, T2, T3, T4, T5, T6, T7, T8

## Blockers log

## Session log
