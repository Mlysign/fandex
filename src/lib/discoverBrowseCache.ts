// T7 (2026-07-30-h4-legal-discover-cache-and-sweep) — caches Discover's merged
// browse `items` array across a Back navigation, alongside the existing depth
// stash (`rr_discover_browse`, DiscoverPageClient.tsx). Without this, Back
// re-fetched the ENTIRE saved browse depth before painting anything: the
// previous plan's T4 traced a real ~1.5s scroll-restore delay to exactly this
// — the document only reached full height once loadDefault()'s refetch
// resolved, and useScrollRestore can't fire before the list has items.
//
// Pure, DOM/React-free — same reasoning as navHistory.ts: kept testable
// without a browser environment (this project's vitest config runs plain
// Node, no jsdom — see navHistory.test.ts's own comment on why).
const CACHE_KEY = "rr_discover_browse_items";

// Measured against the real dev server (2026-07-30): one /api/discover page
// is 40 items / ~32KB, i.e. ~810 bytes/item. The worst-case depth this page
// allows (10 pages forward + 10 back, x3 sections) is ~2,400 items, ~2MB —
// comfortably under this ceiling. Real sessions after a few loads sit at a
// few hundred KB. 3MB leaves headroom under typical browser sessionStorage
// quotas (5-10MB/origin) for the app's other sessionStorage keys.
export const BROWSE_CACHE_CEILING_BYTES = 3 * 1024 * 1024;

export interface BrowseCache {
  items: unknown[];
}

// Read-and-validate. ANY failure — missing key, corrupt JSON, wrong shape,
// storage unavailable — is a cache MISS, never a thrown error: a caching
// failure must never be worse than the pre-T7 behavior (a cold fetch).
export function readBrowseCache(): BrowseCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as BrowseCache).items)) return null;
    return parsed as BrowseCache;
  } catch {
    return null;
  }
}

// Write, but refuse anything over the ceiling rather than risk a quota
// exception — which on some browsers can leave the storage area unable to
// accept OTHER keys' writes for the rest of the tab's life, not just this
// one. Clears any stale (possibly now-oversized) cached value in that case
// so a later read doesn't return old, unbounded data either.
export function writeBrowseCache(items: unknown[]): void {
  try {
    const payload = JSON.stringify({ items } satisfies BrowseCache);
    if (payload.length > BROWSE_CACHE_CEILING_BYTES) {
      sessionStorage.removeItem(CACHE_KEY);
      return;
    }
    sessionStorage.setItem(CACHE_KEY, payload);
  } catch {
    // Quota exceeded or storage unavailable (private mode, disabled) — never
    // let caching break the page; the next load just falls back to cold.
  }
}
