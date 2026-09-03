import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-03. Nils: "sometimes the tooltip modal stays and does not disappear
// any more on web. The repro seems to be rating an item and then being outside
// the card when the rating band disappears."
//
// React's synthetic `onMouseEnter` / `onMouseLeave` follow the REACT tree, and a
// portal is a React child wherever it renders in the DOM. ActionCells' star
// picker portals to `document.body` and is a React descendant of PosterCard, so
// moving the pointer from the Rate button down into the picker is not a "leave".
// Then the picker unmounts under the cursor when a score is picked, React is
// left tracking a detached node, and that card never receives another leave
// event: the explainer stays pinned over the page, and hovering the next card
// opens a second one beside it.
//
// Measured on the reproduction with both listener kinds attached at once:
// native mouseenter 1, native mouseleave 1, tooltip still open. The DOM boundary
// was correct throughout; only the synthetic layer was stuck. So hover is
// tracked with native listeners, which are computed from the element's own box
// and cannot be confused by where a child renders.
//
// Nothing else catches this. Both handler styles typecheck, both work for a card
// nobody rates, and the suite runs in node rather than jsdom, so there is no
// pointer to move. It only shows up as a tooltip that will not go away, several
// interactions after the one that broke it.
const POSTER_CARD = join("src", "components", "PosterCard.tsx");

/** Comments name the banned pattern on purpose, so strip them before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("PosterCard tracks hover natively, not through React's synthetic events", () => {
  const code = stripComments(readFileSync(POSTER_CARD, "utf8"));

  it("has no onMouseEnter/onMouseLeave prop", () => {
    const offenders = code
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\bonMouse(Enter|Leave)\s*=/.test(line));

    expect(
      offenders,
      "ActionCells' star picker is a portal, so React's synthetic leave never " +
        "fires once the pointer has been inside it. Add the listeners to the " +
        "card element instead.",
    ).toEqual([]);
  });

  it("attaches both native listeners, and removes both", () => {
    for (const ev of ["mouseenter", "mouseleave"]) {
      expect(code, `addEventListener("${ev}")`).toContain(`addEventListener("${ev}"`);
      expect(code, `removeEventListener("${ev}")`).toContain(`removeEventListener("${ev}"`);
    }
  });
});
