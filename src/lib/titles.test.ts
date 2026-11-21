import { describe, expect, it } from "vitest";
import { compactTitleNames, displayTitle, searchTitles, titleLanguagesFor } from "./titles";
import { tmdbTitleNames } from "./sources/normalize";
import { projectRawData } from "./sources/project";
import { editionTitlesByLanguage, mergeBookCards, stripIsbns, type BookCard } from "./sources/bookPure";
import { openLibraryTitles, relevantBooks } from "./sources/openlibrary";

// Your Name. as TMDB answered on 2026-11-21 (trimmed to the rows that matter).
const YOUR_NAME = {
  id: 372058, title: "Your Name.", original_title: "君の名は。", original_language: "ja",
  origin_country: ["JP"], production_countries: [{ iso_3166_1: "JP", name: "Japan" }],
  translations: { translations: [
    { iso_639_1: "en", iso_3166_1: "US", data: { title: "Your Name." } },
    { iso_639_1: "de", iso_3166_1: "DE", data: { title: "Your Name. - Gestern, heute und für immer" } },
    { iso_639_1: "fr", iso_3166_1: "CA", data: { title: "" } },
    { iso_639_1: "fr", iso_3166_1: "FR", data: { title: "Your Name." } },
    { iso_639_1: "ja", iso_3166_1: "JP", data: { title: "" } },
    { iso_639_1: "tr", iso_3166_1: "TR", data: { title: "Senin Adın" } },
  ] },
  alternative_titles: { titles: [
    { iso_3166_1: "JP", title: "君の名は.", type: "" },
    { iso_3166_1: "US", title: "Your Name", type: "" },
    { iso_3166_1: "JP", title: "Kimi no Na wa.", type: "romaji" },
  ] },
};

describe("a title's names", () => {
  it("reads a German account as German first, then English", () => {
    expect(titleLanguagesFor("DE")).toEqual(["de", "en"]);
    expect(titleLanguagesFor("CH")).toEqual(["de", "fr", "it", "en"]);
    expect(titleLanguagesFor("US")).toEqual(["en"]);
    expect(titleLanguagesFor(null)).toEqual(["en"]);
  });

  it("takes a film's translations and its home country's other names from TMDB", () => {
    const names = tmdbTitleNames(YOUR_NAME);
    expect(names.titles).toMatchObject({ en: "Your Name.", de: "Your Name. - Gestern, heute und für immer", fr: "Your Name.", ja: "君の名は。" });
    expect(names.titles).not.toHaveProperty("tr");
    // The original, then the romanization before the other home-country names.
    expect(names.aka).toEqual(["君の名は。", "Kimi no Na wa.", "君の名は."]);
  });

  it("keeps exactly what it reads through the projection", () => {
    const projected = projectRawData("tmdb", YOUR_NAME);
    expect(tmdbTitleNames(projected)).toEqual(tmdbTitleNames(YOUR_NAME));
    expect(projected.translations.translations).toHaveLength(3);
    expect(projected.alternative_titles.titles.every((a: any) => a.iso_3166_1 === "JP")).toBe(true);
  });

  it("stores a language reading the same as the title as '' and repeats nothing in the search names", () => {
    const n = compactTitleNames("Your Name.", [tmdbTitleNames(YOUR_NAME)]);
    expect(n.titles).toEqual({ en: "", de: "Your Name. - Gestern, heute und für immer", fr: "", ja: "君の名は。" });
    expect(n.aka).toEqual(["Kimi no Na wa.", "君の名は."]);
    expect(compactTitleNames("Inception", [{}])).toEqual({});
  });

  it("reads a language's title that only adds a subtitle or a bracket as the title itself", () => {
    expect(compactTitleNames("The intelligent investor", [{ titles: { en: "The Intelligent Investor (100 Page Summaries)" } }]).titles).toEqual({ en: "" });
    expect(compactTitleNames("Dune", [{ titles: { en: "Dune: Deluxe Edition", de: "Der Wüstenplanet" } }]).titles).toEqual({ en: "", de: "Der Wüstenplanet" });
    // A dash is not a subtitle mark: the German Your Name. stays its own title.
    expect(compactTitleNames("Your Name.", [{ titles: { de: "Your Name. - Gestern, heute und für immer" } }]).titles).toEqual({ de: "Your Name. - Gestern, heute und für immer" });
  });

  it("shows the account's language, and the title itself where that language reads the same", () => {
    const item = { title: "Your Name.", ...compactTitleNames("Your Name.", [tmdbTitleNames(YOUR_NAME)]) };
    expect(displayTitle(item, ["de", "en"])).toBe("Your Name. - Gestern, heute und für immer");
    expect(displayTitle(item, ["fr", "en"])).toBe("Your Name.");
    expect(displayTitle(item, ["sv", "en"])).toBe("Your Name.");
    expect(displayTitle({ title: "Der Kanon", titles: { en: "The Canon" } }, ["de", "en"])).toBe("The Canon");
    expect(displayTitle({ title: "Der Kanon", titles: { de: "", en: "The Canon" } }, ["de", "en"])).toBe("Der Kanon");
  });

  it("finds a title by its original, a romanization, English and the account's language, not by every language", () => {
    const item = { title: "Your Name.", titles: { en: "", de: "Your Name. - Gestern, heute und für immer", it: "Il tuo nome" }, aka: ["Kimi no Na wa."] };
    const names = searchTitles(item, ["de", "en"]);
    expect(names).toEqual(expect.arrayContaining(["Your Name.", "Your Name. - Gestern, heute und für immer", "Kimi no Na wa."]));
    expect(names).not.toContain("Il tuo nome");
  });
});

describe("Open Library's editions", () => {
  it("finds a work by the translation it matched on, as Open Library answered 'der weg der könige' (2026-11-21)", () => {
    const row = { key: "/works/OL15358691W", title: "The Way of Kings", author_name: ["Brandon Sanderson"], cover_i: 1,
      editions: { numFound: 30, docs: [{ title: "Der Weg der Könige", language: ["ger"] }] } };
    const other = { key: "/works/OL1W", title: "The Circus of Adventure", author_name: ["Enid Blyton"], cover_i: 1,
      editions: { numFound: 23, docs: [{ title: "Der Zirkus der Abenteuer", language: ["ger"] }] } };
    expect(relevantBooks([row, other], "der weg der könige").map((d) => d.title)).toEqual(["The Way of Kings"]);
  });

  it("titles a work per language off its editions, the work's own title where an edition carries it", () => {
    expect(openLibraryTitles("The Way of Kings", [
      { title: "The way of kings", languages: [{ key: "/languages/eng" }] },
      { title: "Der Weg der Könige", languages: [{ key: "/languages/ger" }] },
      { title: "Cesta králů", languages: [{ key: "/languages/cze" }] },
      { title: "Kralların Yolu", languages: [{ key: "/languages/tur" }] },
      { title: "No language" },
    ])).toEqual({ en: "The Way of Kings", de: "Der Weg der Könige", cs: "Cesta králů" });
  });
});

describe("a book's titles and one card per book", () => {
  it("titles each language off the editions, the book's own title where an edition carries it", () => {
    expect(editionTitlesByLanguage("The Way of Kings", [
      { title: "The Way of Kings (Lib/E)", language: "English" },
      { title: "Der Weg der Könige", language: "German" },
      { title: "Der Weg der Könige: Teil 1", language: "German" },
      { title: "Untitled", language: null },
    ])).toEqual({ eng: "The Way of Kings", ger: "Der Weg der Könige" });
  });

  const card = (over: Partial<BookCard>): BookCard => ({
    source: "openlibrary", sourceId: "OL1W", type: "book", title: "x", releaseDate: null, posterUrl: null,
    votes: 0, rating: null, popularity: 0, genres: [], authors: ["Brandon Sanderson"], ...over,
  });

  it("folds a translation's own work into its book through Hardcover's ISBNs, and titles it for the reader", () => {
    const english = card({ sourceId: "OL1W", title: "The Way of Kings", votes: 900, isbns: ["9780765326355"] });
    const german = card({ sourceId: "OL2W", title: "Der Weg der Könige", votes: 30, isbns: ["9783453267701"] });
    const hc = card({
      source: "hardcover", sourceId: "7", title: "The Way of Kings", isbns: ["9780765326355", "9783453267701"],
      titles: { en: "The Way of Kings", de: "Der Weg der Könige" },
    });
    const merged = mergeBookCards([german, english], [hc]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "openlibrary", sourceId: "OL1W" });
    expect(stripIsbns(merged, ["de", "en"])).toEqual([expect.objectContaining({ sourceId: "OL1W", title: "Der Weg der Könige" })]);
    expect(stripIsbns(merged, ["en"])[0]).not.toHaveProperty("titles");
    expect(stripIsbns(merged, ["en"])[0]).not.toHaveProperty("isbns");
  });
});
