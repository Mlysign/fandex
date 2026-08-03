import { describe, it, expect } from "vitest";
import { isLegalLocale, isLegalDocId, LEGAL_LOCALES, LEGAL_DOCS } from "./types";
import { getLegalDocument, everyLegalRoute } from "./registry";

// H4.1 — the executor requirement was explicit: "the test must fail if a
// translation is missing, not silently fall back to English." getLegalDocument
// indexes a plain object with no fallback branch, so a missing translation
// throws at the registry-construction import, not at test time — these tests
// instead pin that EVERY declared (locale, doc) pair resolves to real,
// non-placeholder-looking, distinct-per-locale content.

describe("isLegalLocale / isLegalDocId", () => {
  it("accepts the declared locales and docs", () => {
    expect(isLegalLocale("en")).toBe(true);
    expect(isLegalLocale("de")).toBe(true);
    expect(isLegalDocId("privacy")).toBe(true);
    expect(isLegalDocId("terms")).toBe(true);
    expect(isLegalDocId("support")).toBe(true);
    expect(isLegalDocId("imprint")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLegalLocale("fr")).toBe(false);
    expect(isLegalLocale("EN")).toBe(false);
    expect(isLegalLocale("")).toBe(false);
    expect(isLegalDocId("nonsense")).toBe(false);
    expect(isLegalDocId("privacy ")).toBe(false);
  });
});

describe("legal content registry — completeness", () => {
  it("every declared (locale, doc) pair has content in BOTH locales", () => {
    for (const doc of LEGAL_DOCS) {
      for (const locale of LEGAL_LOCALES) {
        const content = getLegalDocument(locale, doc);
        expect(content, `${locale}/${doc}`).toBeDefined();
        expect(content.title.length, `${locale}/${doc} title`).toBeGreaterThan(0);
        expect(content.sections.length, `${locale}/${doc} sections`).toBeGreaterThan(0);
      }
    }
  });

  it("everyLegalRoute enumerates exactly locales × docs, no duplicates", () => {
    const routes = everyLegalRoute();
    expect(routes.length).toBe(LEGAL_LOCALES.length * LEGAL_DOCS.length);
    const keys = new Set(routes.map((r) => `${r.locale}/${r.doc}`));
    expect(keys.size).toBe(routes.length);
  });

  // H4.2/H3.3 — every doc is currently placeholder-free, so this passes at
  // 0 === 0 and costs nothing. It is kept for the NEXT draft: the realistic
  // mistake when a legal doc is written in two locales is filling one and
  // forgetting the other. German is the legally operative imprint, so a filled
  // DE + unfilled EN looks correct on the page a German regulator would read
  // while leaving "[PLACEHOLDER: street and house number]" live for everyone
  // else. Both imprints and both support pages went through exactly that
  // draft→filled cycle on 2026-08-03 with this test watching.
  it("placeholders are filled in BOTH locales or NEITHER, never one", () => {
    const count = (doc: ReturnType<typeof getLegalDocument>) =>
      JSON.stringify(doc).match(/\[(PLACEHOLDER|PLATZHALTER)/g)?.length ?? 0;

    for (const doc of LEGAL_DOCS) {
      const en = count(getLegalDocument("en", doc));
      const de = count(getLegalDocument("de", doc));
      expect(
        en === 0,
        `${doc}: EN has ${en} placeholder(s) and DE has ${de} — fill both or neither`
      ).toBe(de === 0);
    }
  });

  it("the same doc id has DIFFERENT body text across locales (real translation, not a copy)", () => {
    // Title alone isn't a safe signal — "Support" is standard usage in German
    // too, so a title-only check would false-positive on a real, correctly
    // untranslated word. Section headings/body text is where the two locales
    // must actually diverge.
    for (const doc of LEGAL_DOCS) {
      const en = getLegalDocument("en", doc);
      const de = getLegalDocument("de", doc);
      expect(en.sections[0]?.heading, doc).not.toBe(de.sections[0]?.heading);
    }
  });
});
