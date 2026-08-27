import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SM49 / SM51, 2026-08-27. `MyStuffView` is ONE component rendered by TWO
// routes (/library and /wishlist), and the tab you are looking at is `?tab=`,
// not the path. So a condition on `route ===` decides behaviour by the door you
// came in through rather than by what is on screen.
//
// That has now shipped twice. SM19's 300-card render cap read
// `route === "library"`, but AppNav links no /library at all — the signed-in
// path to your library is /wishlist?tab=library, which is precisely the route
// the cap skipped: 1,929 cards / 40,748 DOM nodes against 300 / 6,519 for the
// identical view one URL over. The search placeholder had the same shape and
// read "Search your wishlist…" under an <h1> reading Library.
//
// Nothing else catches it. Both branches are valid TypeScript, both render, and
// whichever route the test happens to open passes. The failure is only ever
// visible as the WRONG half being right.
//
// The rule: anything about the visible SET (its cap, its copy, its counts)
// comes from `activeTab`. `route` is legitimate only where the URL path itself
// is the answer — building an href, or a returnTo.
const MY_STUFF = join("src", "components", "MyStuffView.tsx");

/** Comments name the banned pattern on purpose, so strip them before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("MyStuffView branches on the active TAB, not the route", () => {
  it("has no `route ===` condition outside comments", () => {
    const code = stripComments(readFileSync(MY_STUFF, "utf8"));
    const offenders = code
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\broute\s*[=!]==/.test(line));

    expect(
      offenders,
      "MyStuffView serves /library and /wishlist, and the Library tab is reachable " +
      "at /wishlist?tab=library. Branch on `activeTab` for anything describing the " +
      "visible set; `route` is for building URLs only.",
    ).toEqual([]);
  });

  it("caps the rendered list by tab, so the cap applies on both routes", () => {
    const code = stripComments(readFileSync(MY_STUFF, "utf8"));
    expect(code).toMatch(/const capRender = activeTab === "library"/);
  });
});
