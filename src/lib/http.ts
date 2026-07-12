// Hardened fetch for third-party APIs (P8). A drop-in superset of `fetch`:
// same signature and success behavior, but adds
//   - an abort TIMEOUT so a hung upstream can't block a request/sync forever, and
//   - bounded RETRIES with backoff for transient failures (network error / 5xx),
//     ONLY for idempotent methods (GET/HEAD) so we never double-submit a write.
// 429s are NOT retried (retrying would only deepen a rate-limit).
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpFetch(input: string | URL, init: HttpFetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = retries ?? (idempotent ? 2 : 0);

  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      // Retry transient server errors (not 429 — that needs backing off, not hammering).
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(BACKOFF_MS[attempt] ?? 500);
        continue;
      }
      return res;
    } catch (e) {
      // AbortError (timeout) or a network failure. Retry idempotent requests.
      lastErr = e;
      if (attempt < maxRetries) {
        await sleep(BACKOFF_MS[attempt] ?? 500);
        continue;
      }
      throw e;
    }
  }
}
