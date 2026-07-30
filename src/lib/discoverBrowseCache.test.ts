import { describe, it, expect, beforeEach, vi } from "vitest";
import { readBrowseCache, writeBrowseCache, BROWSE_CACHE_CEILING_BYTES } from "./discoverBrowseCache";

// T7 — same pattern as navHistory.test.ts: this project's vitest config runs
// plain Node (no jsdom), so sessionStorage doesn't exist by default. Stub a
// minimal in-memory implementation, including one that can simulate a quota
// exception, rather than switching the whole suite to a browser environment.
function stubSessionStorage(store: Map<string, string>, opts?: { throwOnSetItem?: boolean }) {
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.throwOnSetItem) throw new DOMException("QuotaExceededError");
      store.set(k, v);
    },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
}

describe("discoverBrowseCache (T7)", () => {
  beforeEach(() => {
    stubSessionStorage(new Map());
  });

  it("readBrowseCache is a miss when nothing has been written", () => {
    expect(readBrowseCache()).toBeNull();
  });

  it("round-trips a normal payload", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    writeBrowseCache(items);
    expect(readBrowseCache()).toEqual({ items });
  });

  it("refuses a payload over the ceiling — write is a no-op, later read is a miss", () => {
    // One large fake item well past the ceiling on its own.
    const huge = [{ id: "a", blob: "x".repeat(BROWSE_CACHE_CEILING_BYTES + 1) }];
    writeBrowseCache(huge);
    expect(readBrowseCache()).toBeNull();
  });

  it("an over-ceiling write clears a PREVIOUS smaller cached value too", () => {
    writeBrowseCache([{ id: "small" }]);
    expect(readBrowseCache()).not.toBeNull();

    const huge = [{ id: "a", blob: "x".repeat(BROWSE_CACHE_CEILING_BYTES + 1) }];
    writeBrowseCache(huge);
    expect(readBrowseCache()).toBeNull();
  });

  it("corrupt JSON is treated as a miss, not a throw", () => {
    sessionStorage.setItem("rr_discover_browse_items", "{not valid json");
    expect(() => readBrowseCache()).not.toThrow();
    expect(readBrowseCache()).toBeNull();
  });

  it("a valid JSON value with the wrong shape is treated as a miss", () => {
    sessionStorage.setItem("rr_discover_browse_items", JSON.stringify({ notItems: [1, 2, 3] }));
    expect(readBrowseCache()).toBeNull();

    sessionStorage.setItem("rr_discover_browse_items", JSON.stringify({ items: "not an array" }));
    expect(readBrowseCache()).toBeNull();

    sessionStorage.setItem("rr_discover_browse_items", JSON.stringify(null));
    expect(readBrowseCache()).toBeNull();
  });

  it("a quota exception on write never throws, and does not corrupt the existing cache", () => {
    const store = new Map<string, string>();
    stubSessionStorage(store);
    writeBrowseCache([{ id: "safe" }]);
    const before = readBrowseCache();

    // Same underlying store, now with setItem throwing — proves a failed
    // write doesn't touch what's already there.
    stubSessionStorage(store, { throwOnSetItem: true });
    expect(() => writeBrowseCache([{ id: "new" }])).not.toThrow();
    expect(readBrowseCache()).toEqual(before);
  });

  it("degrades to a miss, not a throw, when sessionStorage is unavailable entirely", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => writeBrowseCache([{ id: "a" }])).not.toThrow();
    expect(readBrowseCache()).toBeNull();
  });
});
