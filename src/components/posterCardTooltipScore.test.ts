import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-03. Nils: "there is a regression on the tooltip modal. it no longer
// shows the score breakdown".
//
// PosterCard renders TWO scores from one item. `item.fandexScore` is what the
// payload carried; `fandexScore` is that OR the one `usePendingFandexScore`
// resolved client-side for an item the feed marked `fandexPending` (its local
// row was too thin to score honestly at snapshot time). The card has always
// shown the resolved one. The explainer was handed the raw `item`.
//
// `TooltipBody` branches on `fandexScore == null` and, when it is null, renders
// the release date and a type chip, which are the two things the card
// underneath it already says, and never fetches `fandexReasons` at all. So the
// explainer went blank for exactly the cards that resolve their score here,
// which since the RAWG retirement (2026-09-02) is most games: a thin IGDB-only
// row is what `fandexPending` means, and a card reading 78 popped a tooltip
// with no number on it.
//
// Nothing else catches it. Both objects satisfy `TooltipItem`, so tsc is happy;
// the tooltip renders either way, so no error surfaces; and the suite runs in
// node, not jsdom, so there is no render to assert on. The failure is only ever
// visible as the emptier of two valid tooltips.
const POSTER_CARD = join("src", "components", "PosterCard.tsx");

/** Comments name the banned pattern on purpose, so strip them before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("PosterCard's explainer sees the score the card shows", () => {
  const code = stripComments(readFileSync(POSTER_CARD, "utf8"));

  it("passes no raw `item` to Tooltip or TooltipBody", () => {
    const offenders = code
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /<Tooltip(Body)?\b[^>]*\bitem=\{item\b/.test(line));

    expect(
      offenders,
      "Pass `tooltipItem` (item + the resolved fandexScore/fandexCenter). The raw " +
        "item carries null for anything `fandexPending`, and TooltipBody reads null " +
        "as unscoreable: no number, no bands, no breakdown fetch.",
    ).toEqual([]);
  });

  it("builds tooltipItem from the resolved score, not the payload's", () => {
    // The two locals, not `item.fandexScore` / `item.fandexCenter`. Anything
    // else the object carries is free to change.
    expect(code).toMatch(/tooltipItem\s*=\s*\{\s*\.\.\.item,[^}]*\bfandexScore\s*[,}]/);
    expect(code).toMatch(/tooltipItem\s*=\s*\{\s*\.\.\.item,[^}]*\bfandexCenter\s*[,}]/);
  });

  it("uses it on BOTH surfaces: the hover popover and the long-press sheet", () => {
    expect(code.match(/item=\{tooltipItem\}/g) ?? []).toHaveLength(2);
  });
});
