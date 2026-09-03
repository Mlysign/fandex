import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-03, second pass on the type filter's icon.
//
// Nils: "the fandex logo does only show up briefly after loading but is then
// replaced by the old icon."
//
// It was not a race, a cache or a failed import: the two states of this control
// were drawn with DIFFERENT icons. On a wide screen the row starts collapsed for
// one frame (useMediaQuery is false on the server and on the client's first
// paint, deliberately, so a narrow phone never paints a two-row bar and snaps)
// and then expands. The collapsed summary carried the Fandex mark; the expanded
// row's "All" chip carried lucide's Layers. So the mark rendered, the row
// opened, and the old icon took its place.
//
// I had argued the slots meant different things: "select every one of these",
// beside three sibling type icons, versus "Fandex" standing alone. From the
// outside they are one control that changed icon mid-load, which is a flicker
// and nothing else.
//
// Nothing else catches this. Both icons are valid components, both render, and
// either state on its own looks correct — the bug only exists in the transition
// between them, which no test that renders one state can see.
const TYPE_FILTER = join("src", "components", "ui", "TypeFilter.tsx");

/** Comments name the banned pattern on purpose, so strip them before scanning. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the type filter wears one mark in both of its states", () => {
  const code = stripComments(readFileSync(TYPE_FILTER, "utf8"));

  it("renders LogoOutline twice: the collapsed summary and the All chip", () => {
    expect(
      code.match(/<LogoOutline\b/g) ?? [],
      "The collapsed summary and the expanded row's All button are the same " +
        "control in two states. Different icons there read as a flicker on every " +
        "wide-screen load, because the row paints collapsed for one frame first.",
    ).toHaveLength(2);
  });

  it("keeps Layers only as the fallback for a type with no icon of its own", () => {
    const uses = code.split("\n").filter((l) => /\bLayers\b/.test(l) && !l.includes("import"));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/TYPE_ICONS\[t\]\s*\?\?\s*Layers/);
  });

  it("still shows a single selected type's OWN icon and colour", () => {
    // The one case where the Fandex mark is the wrong answer: a chip narrowed to
    // Movies has to say Movies without being opened.
    expect(code).toMatch(/SelectedIcon\s*\?/);
    expect(code).toMatch(/TYPE_COLORS\[selected\[0\]\]/);
  });
});

// 2026-09-03, third pass. Nils: "the logo line icon uses different shades for
// the cards. make them the same. the more transparent shade is barely visible.
// also i think the stroke thickness of the other icons for the type filter is
// slightly thicker? please verify this and adjust."
//
// He was right on both. Verified rather than eyeballed:
//
//   lucide (Gamepad2, Clapperboard, Tv)  viewBox 24, strokeWidth 2, box 16px
//                                         → 1.333px of stroke
//   LogoOutline, before                   viewBox 26, strokeWidth 1.7, box 17px
//                                         → 1.111px, i.e. 20% lighter
//
// Measured again on the live page after the fix: 1.335px against 1.333px, which
// is the rounding of 2.17 and nothing else.
//
// These assert the DERIVATION, not the number. A hard-coded 2.17 would silently
// stop matching the moment anybody changed the box size or the viewBox, and the
// whole point is that the value follows lucide's rather than being chosen.
describe("the Fandex mark is drawn to match the icons beside it", () => {
  const src = readFileSync(join("src", "components", "LogoOutline.tsx"), "utf8");

  it("derives its stroke from lucide's rather than hard-coding one", () => {
    expect(src).toMatch(/LUCIDE_PX\s*=\s*\(2 \* BOX\) \/ 24/);
    expect(src).toMatch(/STROKE\s*=[^;]*LUCIDE_PX \* VIEWBOX\) \/ BOX/);
  });

  it("defaults to the same 16px box the lucide chips use", () => {
    expect(src).toMatch(/const BOX = 16;/);
    expect(src).toMatch(/size = BOX/);
  });

  it("draws both cards at the same weight", () => {
    // The back card was dimmed to 50% to stop two outlines reading as one noisy
    // shape. The mask solves that properly, so the dimming only made the card
    // "barely visible" at 16px on a dark chip.
    expect(stripComments(src)).not.toMatch(/opacity=/);
  });

  it("sets strokeLinecap, because matching a row of icons means matching all of it", () => {
    expect(src).toMatch(/strokeLinecap="round"/);
  });
});
