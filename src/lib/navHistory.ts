"use client";

// T14 (2026-07-29) — a simple "how many pages has this browser tab viewed
// this session" counter, so BackButton can tell a real in-app back
// destination apart from a hard-loaded/shared link with nothing behind it.
//
// Rejected alternatives (see the plan's own note on this):
//   - document.referrer: sticks to whatever referred the CURRENT DOCUMENT
//     load. Next.js <Link> navigations are client-side (History API
//     pushState, no new document), so it never updates across an in-app
//     hop — Discover -> item would still read referrer as whatever loaded
//     Discover (or empty), a false negative for the exact case that matters.
//   - window.history.length alone: increments correctly across client-side
//     transitions, but also accumulates entries from a completely different
//     origin visited earlier in the SAME tab (e.g. a search-engine results
//     page) — router.back() wouldn't be "dead" there, but it also wouldn't
//     be an in-app destination, which is what "smart back" means here.
const KEY = "rr_page_view_count";

// AppNav (mounted app-wide, in the root layout, outside the per-page
// {children}) calls this once per route change — including client-side
// transitions, since its own effect depends on the current pathname.
export function recordPageView(): void {
  try {
    const n = Number(sessionStorage.getItem(KEY) ?? "0");
    sessionStorage.setItem(KEY, String(n + 1));
  } catch { /* storage unavailable (privacy mode, quota) */ }
}

// True iff at least one OTHER page was already recorded before the CURRENT
// one. Callers MUST read this during RENDER (e.g.
// `useState(() => hasPriorPageView())`), never inside an effect — render
// always happens before ANY effect fires for a commit, so this reliably
// reflects the counter as it stood at the END of the PREVIOUS page's commit,
// with no dependency on effect-ordering between this component and AppNav.
export function hasPriorPageView(): boolean {
  try { return Number(sessionStorage.getItem(KEY) ?? "0") > 0; } catch { return false; }
}
