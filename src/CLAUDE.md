# The shared modules (`src/lib`)

Everything here is imported by the Worker, the app or the website build, so a change here can break any of them without touching their folders. Run the root tests, and the Worker's and the app's typecheck.

## Providers

- **Check a provider's USAGE TERMS before its capabilities**, and treat a `PLATFORMS.md` cell as a claim about code. Two were wrong. → [[platform-integration-architecture]]
- **Failure isolation is not latency isolation, and the breaker must THROW.** `http.ts` has a per-host circuit breaker and an optional `budgetMs`; browse paths pass `BROWSE_BUDGET_MS`, sync keeps an unbounded budget. `ProviderUnavailableError` is never a fabricated Response: a synthetic 503 reads as `!res.ok` to a pull and turns an outage into a wiped library. Browse opts into degradation (`bestEffort`); pull code throws. → [[provider-latency-isolation]]
- **A call carrying only an APP credential opts into the 401/403 latch with `appScopedAuth: true`**, per call site, not per host (TMDB serves app-key and per-user calls from one host). `httpCallSites.test.ts` fails if an app key goes out without it. → [[provider-quotas-and-scale]]
- **A provider's response SHAPE can't be verified from its documentation**, and a mocked test of an assumed shape proves nothing. When an integration returns nothing, probe the real payload first. → [[trakt-episode-endpoints]]
- **A cache goes through `sharedCache(name, opts)`, never `new BoundedCache()`.** The name is the identity, so two caches sharing one share storage. Bounds are entry counts. `vitest.setup.ts` clears them before every test. **Never cache an empty result**: it pins an outage for the whole TTL. `openProviderCircuits: {}` on `/v1/health` means no breaker is open, not that providers are healthy.
- **IGDB runs behind a kill switch: `IGDB_ENABLED=0` stops every call, default ON.** Games are IGDB-only, so the switch takes games to nothing. `igdbKillSwitch.test.ts` fails any export reaching `igdbQuery` without the guard. Default ON is right: a typo must leave the site working.
- **Read a safety gate or switch at CALL time, never at module load** (`igdbConfigured()` is the shape). A test that sets the env var after the module loaded silently asserts the default.
- **A provider's RETENTION cap is separate from its tier.** TMDB caps caching at six months, an age cap the Worker's cron enforces by re-fetching ageing links. IGDB's question is open and nothing is enforced on purpose: don't pick a number. → `PLATFORMS.md`
- **Hardcover facts only** (`sources/hardcoverPure.ts`): no rating, review, list or reader count may survive parsing. The rest of the rule is in `worker/CLAUDE.md`.

## Projection and keys

- **Before a `PROJECTION_VERSION` bump** (`sources/project.ts`), check whether lazy self-heal already covers the change. A bump makes the Worker's cron re-derive the whole pool. → [[lazy-heal-vs-mass-reprojection]]
- **`personKey`/`slugify`: NFD does not decompose `ø å æ ł ß`.** Never give `tagKey` the same fix. → [[unicode-normalization-lossy-slugs]]
- **`CATEGORY_LABELS` (`tags.ts`) is nine static ids, and the taxonomy is editable.** Resolve a label against the live list and fall back to the id, never to a flat "Tag".
- **The legal pages are `legal/content/{en,de}/`.** Change both languages in one go, and move the page's `updated` date. They render on fandex.org through the website build.
