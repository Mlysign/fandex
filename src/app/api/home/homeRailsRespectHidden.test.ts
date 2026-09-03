import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-03, second pass. Nils: "i hid The Bear. It was removed from the
// progress (good), but not from 'popular right now' (wrong)."
//
// The first version filtered only the `recommendation` rail, on the reasoning
// that trending and upcoming come out of the viewer-INDEPENDENT snapshot and
// that hiding means "stop recommending" rather than "erase from the site". That
// reasoning was wrong, and wrong in a way worth pinning: a rail on your own home
// page is something Fandex chose to show you, whatever the machinery behind it
// is called, and "the snapshot is viewer-independent" is an implementation
// detail nobody outside that file can see.
//
// The fix keeps the snapshot contract intact by filtering in `withUserOverlay`,
// which is already the per-user layer. This test exists because the mistake is
// so easy to repeat: the next person to add a rail will reach for the snapshot
// and reasonably assume it is not their problem.
const HOME_ROUTE = join("src", "app", "api", "home", "route.ts");

/** Comments name the banned pattern on purpose, so strip them before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("every Home rail respects a hidden title", () => {
  const code = stripComments(readFileSync(HOME_ROUTE, "utf8"));

  it("filters inside withUserOverlay, which serves trending AND upcoming", () => {
    const overlay = code.slice(code.indexOf("function withUserOverlay"));
    expect(
      overlay,
      "trending and upcoming both go through withUserOverlay. Filtering only the " +
        "recommendation rail is the bug Nils found: a hidden show stayed in " +
        "'Popular right now'.",
    ).toMatch(/withoutHidden\(/);
  });

  it("still filters the recommendation rail", () => {
    expect(code.match(/withoutHidden\(/g) ?? []).toHaveLength(2);
  });

  it("does not filter the snapshot itself", () => {
    // The snapshot is shared by every visitor and is what makes the page cheap
    // for a crawler. Dropping a row there would make it per-user, which is a
    // different and much more expensive thing.
    const snapshotLine = code.split("\n").find((l) => l.includes("readHomeSnapshot()")) ?? "";
    expect(snapshotLine).toContain("readHomeSnapshot");
    expect(snapshotLine).not.toMatch(/withoutHidden/);
  });
});
