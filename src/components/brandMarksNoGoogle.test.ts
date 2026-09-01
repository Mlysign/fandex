import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BRAND_MARKS } from "@/lib/brandMarks";

// Google's Sign in with Google branding guidelines, read 2026-09-01:
//
//   "Your website or app must follow these guidelines to complete the app
//    verification process."
//   Don't: "Use monochrome versions of the Google 'G' for the button."
//   "Regardless of the text, you can't change the size or color of the Google
//    'G' logo. It must be the standard color version."
//
// So the monochrome G is not a style choice here, it is a documented violation
// that can block the verification Google sign-in needs anyway.
//
// This is the shape of noOmdb.test.ts: a rule whose breach is INVISIBLE. A
// monochrome G renders perfectly, passes tsc, lint and every other test, and
// looks tidier than the coloured one against this site's palette — which is
// exactly why someone will eventually "fix" it back. The four-colour mark lives
// in components/auth/GoogleMark.tsx with its own literal fills.
describe("the Google mark is never monochrome", () => {
  it("has no Google entry in BRAND_MARKS, which renders in currentColor", () => {
    const keys = Object.keys(BRAND_MARKS).map((k) => k.toLowerCase());
    expect(keys).not.toContain("google");
  });

  it("is not requested by the brand-mark generator either", () => {
    // Belt and braces: BRAND_MARKS is generated, so a regeneration would put a
    // key back without anyone editing the generated file by hand.
    const gen = readFileSync("scripts/gen-brand-marks.mjs", "utf8");
    const wanted = [...gen.matchAll(/^\s*"([^"]+)":\s*"si\w+"/gm)].map((m) => m[1].toLowerCase());
    expect(wanted).not.toContain("google");
  });

  it("is not mapped by BrandGlyph, which also renders in the UI's text colour", () => {
    const src = readFileSync("src/components/BrandGlyph.tsx", "utf8");
    // The map's entries look like `google: "Google",`. A commented-out mention
    // is fine and expected (the file explains WHY there is no entry), so this
    // matches an actual property line rather than the word anywhere.
    expect(src).not.toMatch(/^\s*google:\s*"/m);
  });

  it("keeps its four brand fills in GoogleMark, unmodified", () => {
    const src = readFileSync("src/components/auth/GoogleMark.tsx", "utf8");
    // Every fill the component actually renders, rather than every occurrence
    // of a colour word in the file. The first version of this asserted the file
    // did not CONTAIN "currentColor" and failed on its own header comment,
    // which explains why currentColor is wrong here. A check that a doc comment
    // can trip is a check that will be deleted rather than heeded.
    const fills = [...src.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

    // The standard Google colours. Recolouring the mark to match the site
    // palette is the same violation wearing a different hat.
    expect(fills.sort()).toEqual(["#34A853", "#4285F4", "#EA4335", "#FBBC05"]);

    // currentColor in a fill would mean it inherits the button's text colour,
    // i.e. monochrome again by a different route.
    expect(fills).not.toContain("currentColor");
  });
});
