// Hardened fetch for third-party APIs (P8). A drop-in superset of `fetch`:
// same signature and success behavior, but adds
//   - an abort TIMEOUT so a hung upstream can't block a request/sync forever, and
//   - bounded RETRIES with backoff for transient failures (network error / 5xx),
//     ONLY for idempotent methods (GET/HEAD) so we never double-submit a write.
//   - 429 (rate-limit) handling for idempotent methods: wait the server-requested
//     `Retry-After` (or a backoff) then retry, bounded — so bulk enrichment (e.g.
//     the ~1,700-item Trakt→TMDB sync) self-paces instead of silently dropping
//     the metadata for every rate-limited item. We only *wait then retry*, never
//     hammer immediately, and if the requested wait is too long we give up (the
//     caller treats a returned 429 as that one item failing, not the whole sync).
//
// Per-source failure isolation stays with the callers (each adapter/sync step
// already try/catches), so a timeout here surfaces as that one source failing,
// not the whole request.

export interface HttpFetchInit extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKOFF_MS = [200, 500]; // per-retry wait
const MAX_429_WAIT_MS = 10_000; // honor Retry-After up to this; a longer wait → give up (best-effort)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry-After is seconds (or an HTTP date, which we ignore → fall back to backoff).
function retryAfterMs(res: Response, attempt: number): number {
  const secs = Number(res.headers.get("retry-after"));
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : (BACKOFF_MS[attempt] ?? 500);
}

export async function httpFetch(input: string | URL, init: HttpFetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = retries ?? (idempotent ? 2 : 0);

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (attempt < maxRetries) {
        // Transient server errors: back off and retry.
        if (res.status >= 500) {
          await sleep(BACKOFF_MS[attempt] ?? 500);
          continue;
        }
        // Rate-limited: wait the requested time (bounded) then retry, idempotent only.
        if (res.status === 429 && idempotent) {
          const waitMs = retryAfterMs(res, attempt);
          if (waitMs <= MAX_429_WAIT_MS) {
            await sleep(waitMs);
            continue;
          }
        }
      }
      return res;
    } catch (e) {
      // AbortError (timeout) or a network failure. Retry idempotent requests.
      if (attempt < maxRetries) {
        await sleep(BACKOFF_MS[attempt] ?? 500);
        continue;
      }
      throw e;
    }
  }
}
