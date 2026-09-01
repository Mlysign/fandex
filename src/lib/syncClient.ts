// Client-side driver for the resumable /api/sync endpoint (P6). Each POST does a
// time-bounded slice of the work and returns any `remaining` providers; we
// re-POST those until the server reports `done`, so the full sync completes
// across several short requests instead of one long/OOM-prone one. `onProgress`
// fires after every slice for incremental UI. The guard cap makes a server bug
// (never reporting done) fail closed instead of looping forever.

export interface SyncSliceResult {
  ok: boolean;
  results: { provider: string; wishlist: number; library: number; error?: string }[];
  done: boolean;
  remaining: string[];
}

// How long a connected provider may go unsynced before a visit to My Stuff
// pulls it again. Lives here rather than in the view because staleProviders()
// below is the thing that has to agree with it.
export const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

// Which connected providers are overdue.
//
// 2026-08-22 — the caller used to collapse the whole log with
// `Math.max(...syncLogs.map(l => l.last_sync))` and sync EVERYTHING if that one
// timestamp was over a day old. That made any single-provider sync refresh the
// clock guarding every other provider, and one shipped on 2026-08-16: the Home
// progress rail runs `syncToCompletion("trakt")`. From that day Steam, RAWG and
// TMDB never synced again. It surfaced as a Steam game staying on the wishlist
// after it was bought (Steam had already dropped it; nothing asked Steam). The
// per-provider breakdown was always in the response, from /api/auth/me's
// `GROUP BY provider`; only the client threw it away.
//
// A provider writes several sync_log rows per pass: its own id, plus
// `${id}-library`, `${id}-episodes`, `${id}-episode-catalog`. Hence the prefix
// match. No source id is a prefix of another, so this cannot bleed across
// providers, and a provider that has NEVER synced reads as stale by design.
// Identity providers that hold no library, so nothing ever syncs them.
//
// ⚠️ Load-bearing, not documentation (2026-09-01, added with Google sign-in).
// The filter below reads "this identity has no sync_log row" as "overdue",
// which is correct for every provider that CAN sync and permanently wrong for
// one that cannot. Without this exclusion a google identity is due forever: the
// MyStuffView init would flip `autoSyncing` on and POST /api/sync on EVERY load
// of /library and /wishlist, for the life of the account. The request is not
// even an error that would show up in a log — `providerQueue` is registry-
// filtered, so it quietly drains to an empty queue and answers `done: true`.
//
// Kept here rather than in src/types because it is a runtime value and every
// export of that file is type-only (scripts/ rely on Node's type-stripping).
export const IDENTITY_ONLY_PROVIDERS: readonly string[] = ["google"];

export function staleProviders(
  identities: { provider: string }[],
  syncLogs: { provider: string; last_sync: number }[],
  now: number,
  staleMs: number = SYNC_STALE_MS,
): string[] {
  return identities
    .map((i) => i.provider)
    .filter((id) => !IDENTITY_ONLY_PROVIDERS.includes(id))
    .filter((id) => {
      const last = syncLogs
        .filter((l) => l.provider === id || l.provider.startsWith(`${id}-`))
        .reduce((max, l) => Math.max(max, l.last_sync * 1000), 0);
      return now - last > staleMs;
    });
}

export async function syncToCompletion(
  provider: string | string[] = "all",
  onProgress?: (slice: SyncSliceResult) => void,
): Promise<void> {
  // An explicit EMPTY list means "nothing is due", never "sync everything".
  // /api/sync's providerQueue falls back to the full registry on an empty
  // `providers`, so sending one would turn a no-op into a full sync.
  if (Array.isArray(provider) && provider.length === 0) return;
  let body: Record<string, unknown> = Array.isArray(provider) ? { providers: provider } : { provider };
  for (let guard = 0; guard < 25; guard++) {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return; // 401/429/500 — bail; caller keeps whatever synced so far
    const slice = (await res.json()) as SyncSliceResult;
    onProgress?.(slice);
    if (slice.done || !slice.remaining?.length) return;
    body = { providers: slice.remaining };
  }
}
