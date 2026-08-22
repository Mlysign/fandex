# Scalability: where Fandex holds up, and where it does not

**Written 2026-08-20, from measurement rather than reasoning.** Every number below
was taken off live prod using the per-host counters added the same day
(`/api/health` → `providerCalls`). Where something is inferred rather than
measured, it says so.

**The one-line answer: compute is not the problem, and neither is the database.
Third-party provider quotas are, and they are consumed by CRAWLERS rather than
by users, so the cost does not scale with the traffic you would monetize.**

---

## 1. The measured baseline

Provider requests made while serving one page, on a cold process:

| Surface | Time | Provider calls | RAWG | TMDB | IGDB | Other |
|---|--:|--:|--:|--:|--:|--:|
| `/tag/{genre}` **cold** | 7–10 s | **14** | **4** | 9 | 1 | |
| `/tag/{genre}` warm | 0.16 s | **0** | | | | |
| `/calendar/{month}` cold | 1.9 s | 5 | 1 | 2 | 1 | twitch 1 |
| `/` (homepage) | 0.15 s | **0** | | | | |
| `/{type}/{slug}` (item page) warm | 0.46 s | 2 | | | | letterboxd 1, omdb 1 |

And the provider health that fell out of the same snapshot:

```
api.rawg.io          req= 19  ok=  0  4xx= 19   last=401   quota exhausted
api.themoviedb.org   req= 42  ok= 42  4xx=  0   last=200
api.igdb.com         req=  5  ok=  3  4xx=  0   last=200
api.letterboxd.com   req=  1  ok=  0  4xx=  1   last=401   no valid key
www.omdbapi.com      req=  1  ok=  0  4xx=  1   last=401   invalid key
```

**Three of the six providers return 401 on every call, and nothing surfaced that
until the counters existed.**

> ✅ **Fixed 2026-08-22 — the auth latch shipped.** After **5 consecutive
> 401/403s on app-scoped requests**, `http.ts` opens the host's breaker for 15
> minutes, doubling to a 6 h ceiling on each rejected probe. A permanently dead
> credential now costs about **8 calls a day** instead of ~5,600. It recovers by
> itself: any response that is not a 401/403 clears the run, so RAWG comes back
> within 6 h of its monthly quota resetting, with no deploy. `/api/health`'s
> `openProviderCircuits` now carries `latchedOnAuth`, which separates "the
> provider is down" from "the provider is up and rejecting us" — a distinction
> nothing in the app could previously make.
>
> ⚠️ **The latch counts only APP-scoped requests, and that is load-bearing.**
> RAWG and TMDB serve app-key metadata and per-user calls from the *same host*,
> so a single user's expired token would otherwise latch the provider for
> everybody. Call sites opt in with `appScopedAuth: true`; missing one costs
> wasted requests (safe), setting it on a user-scoped call is the bug.

### 1a. ⚠️ The same counters after 10.5 h of real traffic — much worse than the per-page maths implied

Taken at the end of the session, on the same boot. **This is the number that matters**, and it is not an extrapolation from a handful of probes.

| Host | Requests | OK | 401 | Projected / month |
|---|--:|--:|--:|--:|
| `api.themoviedb.org` | **40,231** | 40,231 | 0 | **2,793,323** |
| `api.rawg.io` | 13,068 | **0** | **13,068** | 907,339 |
| `www.omdbapi.com` | 4,343 | **0** | **4,343** | 301,544 |
| `api.letterboxd.com` | 3,155 | **0** | **3,155** | 219,058 |
| `api.igdb.com` | 232 | 41 | 0 (190 network) | 16,108 · **2,929 blocked by the breaker** |
| `store.steampowered.com` | 88 | 88 | 0 | 6,110 |
| `api.trakt.tv` | 26 | 26 | 0 | 1,805 |

**Three findings, in order of how cheap they are to act on.**

**1. ~20,600 requests — about a third of all provider traffic — went to three endpoints that 401 on EVERY call.** RAWG (quota gone), OMDb (invalid key), Letterboxd (no key). Nothing is learning from the failure, so the app re-asks roughly 2,000 times an hour and will keep doing so forever.

⚠️ **This is a design consequence, not an accident.** `http.ts` deliberately treats a 4xx as "the provider working as designed" and refuses to open the breaker on one, so that our own bad request cannot take a healthy host offline for everyone. That rule is right for a *one-off* 4xx and clearly wrong for a *persistent* one: **a 401 repeated 13,068 times is not a bad request, it is a dead credential.** The fix is a latch — after N consecutive 401/403s on a host, stop calling it and surface it — and it would remove a third of all provider traffic in one change. **Highest-leverage item in this document.**

**2. TMDB at 40,231 requests in 10.5 h projects to ~2.8 MILLION per month**, from an app with almost no human users. This is the crawler thesis confirmed far more strongly than §3.1 estimated. ⚠️ **Note the likely trigger: the sitemap was submitted to Search Console the same morning**, so some of this is the crawl that SEO work invited. Expect it to persist. TMDB has no hard monthly cap, which is the only reason this has not broken anything, but it is the volume a $149/mo commercial licence would be priced against.

**3. The circuit breaker is visibly working now that it can be seen.** IGDB shows **2,929 blocked** calls against 232 attempted, i.e. the breaker short-circuited 93% of them after IGDB started failing (190 network errors, consistent with its 4 req/s limit). Before the `globalThis` fix this was invisible and, in the page-route bundle, largely ineffective.

---

## 2. Where it holds up

- **The homepage costs zero provider calls.** The SEO hub reads the local catalog
  only, cached 30 min. The busiest page on the site is a pure SQLite read.
- **A warm facet page costs zero provider calls and answers in 0.16 s.** The
  two-layer facet cache (in-process L1 + the persisted `facet_page_cache` L2) is
  doing exactly its job. The expensive case is strictly the *cold* one.
- **Reads scale well by construction.** SQLite is in-process, so a read is a
  function call, not a network hop. No connection pool, no query latency floor,
  no N+1 across a wire. The 154 MB database sits on a 4.6 GB volume at 11%.
- **The dual-source games design is proven under real failure.** RAWG has been
  returning 401 on *every* call and games still render everywhere, because IGDB
  carries them. That invariant, bought after the 2026-08-02 outage, is currently
  the only reason the games catalog works.
- **The database's growth is bounded.** Boot prune of the browsed tail, a VACUUM
  after any applied migration (331 → 154 MB unprompted), and a row cap on
  `facet_page_cache` after the 2026-08-19 incident.
- **Backups are proven restorable** (drill re-run 2026-08-20, all tables exact).

---

## 3. Where it does not hold up

### 3.1 Provider quotas are the binding constraint, and crawlers spend them

This is the finding that matters. **A cold tag facet page costs 4 RAWG requests.**
RAWG's free quota is 20,000 requests per month. So:

> **~5,000 cold facet page views exhaust the entire monthly RAWG quota.**

That is not hypothetical. The crawler walking the person/tag/studio long tail
filled `facet_page_cache` to **24,953 rows** on 2026-08-19. At 4 RAWG requests
per cold page that is on the order of **100,000 RAWG requests, five times the
monthly quota** — which is precisely the state prod is in today.

**The dangerous property is that this cost is driven by CATALOG BREADTH times
CRAWLER APPETITE, not by human traffic.** Fandex has almost no human visitors and
has already blown a 20,000-request monthly budget. Ten thousand human pageviews a
month (the H3.8 ads gate) would plausibly cost *less* in provider calls than the
crawler costs right now. Any capacity plan built on pageviews is measuring the
wrong variable.

### 3.2 Every paid tier is priced badly for this shape of traffic

| Provider | Free | Paid | Verdict at scale |
|---|---|---|---|
| **RAWG** | 20k req/mo, non-commercial | **$149/mo for 50k req/mo** | Only 2.5× the free quota. At the crawl volume already observed you would need Enterprise, price on application. **Paying does not fix this.** |
| **TMDB** | Unlimited-ish, **non-commercial only** | **$149/mo** under $1M revenue | 9 calls per cold facet page. Ads make Fandex commercial, so this becomes mandatory, not optional. |
| **OMDb** | 1k req/day | Patreon from $1/mo | ⚠️ **CC BY-NC 4.0 — non-commercial only, full stop.** Cannot be used alongside ads at any price. |
| **IGDB** | Free, 4 req/s, no monthly cap | Partnership on request | **The healthiest of the set**, and the only one with no monthly ceiling. |
| **Trakt** | Free | Approval required to monetize | Not a quota problem; an approval risk. |

**Two conclusions.** First, **going commercial costs ~$298/mo minimum** (TMDB +
RAWG) before hosting, against the model's ~€150 of ad revenue per 1,000 monthly
actives. Second, **RAWG is the weakest link**: it is the only provider whose paid
tier does not solve the problem it is sold to solve.

### 3.3 Single-process SQLite is a hard architectural ceiling

`better-sqlite3` is synchronous and in-process: **one always-on instance, never
serverless, never multi-instance** (AGENTS.md). That buys the read performance in
§2 and costs the ability to scale horizontally at all.

- **Reads scale vertically and well.** This is not the near-term worry.
- **Writes serialise.** One writer, plus Litestream holding a second connection.
- **There is no horizontal path** without replacing the storage layer. A second
  instance does not share the file, so "add another container" is not available.
- **Litestream is the only backup** (Railway volume backups are Pro-plan only,
  re-confirmed 2026-08-20). There is no second net.

For an app of this size that is a sound trade. It is worth stating plainly
because it is the constraint that cannot be relieved incrementally.

### 3.4 Module-level state is duplicated per bundle

Found 2026-08-20 while building the counters, and **proven for `http.ts`**: Next
resolves a module into different bundles for a page route and an API route, so
`new Map()` at module scope becomes several maps.

That had already broken the circuit breaker silently since 2026-08-02 (failure
counts accumulated per bundle, so a dead provider had to fail the threshold
separately in each) and made `/api/health`'s `openProviderCircuits` blind to the
page-route half of the process. Both are fixed by pinning to `globalThis`.

⚠️ **The same mechanism applies to every other module-level cache, and that is
NOT yet measured.** There are ~20 of them (`grep -rn "new BoundedCache" src/`),
several with no TTL at all and entry caps in the thousands:
`facetCache` 6000, `_personSearchCache` / `_rawgEntityCache` / `_personIdCache` /
`_tmdbCompanyCache` 5000 each, `_facetPageCache` 3000 (whose own comment budgets
~145 MB retained). If those are duplicated per bundle, then **retained memory is
a multiple of the budgeted figure and cache hit rates are lower than assumed** —
which would be a partial explanation for the JS heap ramp that has now been
mis-diagnosed twice.

**Do not act on that paragraph as fact.** It follows from a mechanism proven
elsewhere in the same file; it has not been measured for these caches. Measure
first. The cheap test is to instrument one cache the way `http.ts` was
instrumented and compare a page route against an API route.

### 3.5 Cache bounds are entry counts, not bytes

Every `BoundedCache` caps *entries*. A 3,000-entry cache of facet payloads is
~145 MB by its own estimate; a 6,000-entry one has no stated budget at all. This
is the same class of mistake as `facet_page_cache`'s TTL-without-a-size-cap,
which reached 80% of the database. **An entry cap is not a memory cap.**

### 3.6 Deploys cold-start every in-process cache

The L1 caches do not survive a restart, and this repo deploys often. Every deploy
therefore produces a fresh burst of provider calls as caches refill. The facet L2
(`facet_page_cache`) survives because it is a table; nothing else does. That is a
real multiplier on provider spend during active development.

### 3.7 Wasted calls to providers known to be unconfigured

An item page makes 2 provider calls and **both currently 401**: Letterboxd (no
working key, the integration is hidden in the UI) and OMDb (key invalid, noted in
PLATFORMS.md for weeks). `omdbConfigured()` tests only that a key *string exists*,
not that it works. Small in absolute terms, but it is pure waste on the most
crawled page type in the catalog, and it is the kind of thing that stays broken
because it fails silently.

---

## 4. What to do, ranked by leverage

1. ✅ **Latch off providers that keep returning 401/403** — **DONE 2026-08-22.**
   Measured a third of all provider traffic (§1a). One change in `http.ts`, no
   product impact, removes ~20,600 wasted requests per 10.5 h. See the box in §1.
   ⚠️ **Re-measure §1a on the next boot** — every figure in it was taken before
   the latch existed, so the "a third of traffic" split is now historical.
2. **Cut the provider fan-out on cold facet pages.** The other half of the problem.
   Options, cheapest first: serve facet pages from the local catalog only and
   drop the provider pool; persist the provider pool in the DB the way the page
   payload already is; or `noindex` far more of the long tail so it is crawled
   less. Anything that lowers "14 calls per cold facet page" is worth more than
   every other item here combined.
3. ✅ **Stop calling unconfigured providers** — **covered by the latch, 2026-08-22.**
   `omdbConfigured()` and the Letterboxd equivalent still only test whether a key
   is *present*, but a key that is present and rejected now latches off after five
   calls rather than being re-tried forever. Tightening the config predicates is
   no longer worth a change of its own.
3. **Decide RAWG's future as a metadata source.** IGDB is free, has no monthly
   cap and already carries the games catalog through RAWG's outage. RAWG must
   stay as a *connectable* platform (user library sync), but its metadata role is
   the expensive half and the one with no viable paid tier.
4. **Pin the remaining module-level caches to `globalThis`**, after measuring
   whether they are duplicated (§3.4).
5. **Give the byte-heavy caches a byte budget**, not just an entry cap (§3.5).
6. **Re-check the numbers in §1 after any of the above.** They took ten minutes
   to collect and they are the only honest basis for a capacity decision.

---

## 5. What this means for monetization

`docs/monetization-go-live.md` models revenue per 1,000 monthly actives at ~€150
for ads. Against that:

- Going commercial triggers **TMDB $149/mo + RAWG $149/mo**, and RAWG's paid tier
  still would not cover the observed crawl volume.
- **OMDb has to be removed entirely**, not paid for: CC BY-NC 4.0 forbids
  commercial use at any tier. It is already dark, so this costs nothing today.
- **Trakt needs approval** for a monetized app.

The standing guidance not to contact TMDB or Trakt while operating on their free
tiers still applies. The point here is only that the cost side of the ads model
is larger and lumpier than the doc currently assumes, and the largest single
lever on it is §4.1, which is an engineering change rather than a payment.
