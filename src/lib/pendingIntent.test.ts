import { describe, it, expect, beforeEach } from "vitest";
import { stashIntent, takeIntent, PendingIntent } from "./pendingIntent";

// Node test env has no localStorage; back it with a Map so the module's real code
// path runs. A `throws` flag lets us simulate storage being unavailable.
let throws = false;
beforeEach(() => {
  throws = false;
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => { if (throws) throw new Error("blocked"); return store.has(k) ? store.get(k)! : null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error("blocked"); store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});

const RATE: PendingIntent = { path: "/movie/uuid/dracula", action: { kind: "rate", value: 8 } };

describe("stash / take round-trip", () => {
  it("returns the intent when the path matches, then clears it", () => {
    stashIntent(RATE);
    expect(takeIntent("/movie/uuid/dracula")).toEqual(RATE);
    // Drained: a second take finds nothing — an intent can never fire twice.
    expect(takeIntent("/movie/uuid/dracula")).toBeNull();
  });

  it("carries the concrete action shape", () => {
    stashIntent({ path: "/p", action: { kind: "wishlist" } });
    expect(takeIntent("/p")).toEqual({ path: "/p", action: { kind: "wishlist" } });
  });
});

describe("path guard", () => {
  it("does NOT return an intent stashed for a different item, and clears it", () => {
    stashIntent(RATE);
    // User navigated away before finishing login → must not act on the wrong page.
    expect(takeIntent("/show/other/slug")).toBeNull();
    // And it was consumed, so returning to the original page won't fire it either.
    expect(takeIntent("/movie/uuid/dracula")).toBeNull();
  });
});

describe("resilience", () => {
  it("takeIntent returns null when nothing is stored", () => {
    expect(takeIntent("/anything")).toBeNull();
  });

  it("discards a corrupt stored value", () => {
    localStorage.setItem("fandex.pendingIntent", "{not json");
    expect(takeIntent("/anything")).toBeNull();
  });

  it("stashIntent never throws when storage is unavailable (no auto-resume, no crash)", () => {
    throws = true;
    expect(() => stashIntent(RATE)).not.toThrow();
  });

  it("takeIntent returns null when storage read throws", () => {
    throws = true;
    expect(takeIntent("/movie/uuid/dracula")).toBeNull();
  });
});
