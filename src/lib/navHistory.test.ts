import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordPageView, hasPriorPageView } from "./navHistory";

// T14 (2026-07-29) — BackButton's target-resolution logic (real in-app
// history vs a hard-loaded/shared link with nothing behind it), kept pure
// and DOM-free per the plan's own instruction. This project's vitest config
// runs in a plain Node environment (no jsdom), so `sessionStorage` doesn't
// exist by default — stub a minimal in-memory implementation rather than
// switching the whole suite to a browser environment for one file.
function stubSessionStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
}

describe("navHistory (T14)", () => {
  beforeEach(() => {
    stubSessionStorage();
  });

  it("hasPriorPageView is false before any page has ever been recorded — a fresh tab / direct link", () => {
    expect(hasPriorPageView()).toBe(false);
  });

  it("hasPriorPageView is false for the FIRST page's own render — recording it doesn't retroactively make it true for itself", () => {
    // This mirrors the real ordering: a page's own BackButton reads the
    // counter DURING RENDER, before AppNav's effect for THIS SAME page has
    // recorded it (see navHistory.ts's doc comment for why that ordering
    // is what makes this safe).
    expect(hasPriorPageView()).toBe(false); // read as this page renders
    recordPageView(); // AppNav's effect fires afterward, for this page
    // A DIFFERENT, later page's own read now sees real prior history:
    expect(hasPriorPageView()).toBe(true);
  });

  it("hasPriorPageView is true once a second page is reached via in-app navigation", () => {
    recordPageView(); // page 1 (e.g. Discover)
    expect(hasPriorPageView()).toBe(true); // page 2 (e.g. an item) reads this before its own recordPageView()
    recordPageView(); // page 2's own AppNav effect fires
    expect(hasPriorPageView()).toBe(true); // page 3 sees it too
  });

  it("degrades to false, not a throw, when sessionStorage is unavailable (SSR, privacy mode)", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => recordPageView()).not.toThrow();
    expect(hasPriorPageView()).toBe(false);
  });
});
