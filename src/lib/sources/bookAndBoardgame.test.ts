import { describe, expect, it } from "vitest";
import { items, parseThing, thingCard } from "@/lib/sources/bgg";
import { bggFranchises, bggThemes } from "@/lib/sources/bggPure";
import { bookDate, bookSubjects, isWholeBook, parseDay, seriesFromEditions, seriesFromSubjects } from "@/lib/sources/bookPure";
import { extractFacets } from "@/lib/facets";
import { mergeLinks } from "@/lib/merge";
import type { MediaLink } from "@/types";

// BGG's `thing` answer, in the shape its documentation gives (xmlapi2/thing?stats=1).
const THING = `<?xml version="1.0" encoding="utf-8"?><items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
<item type="boardgame" id="13">
  <thumbnail>https://cf.geekdo-images.com/catan_t.jpg</thumbnail>
  <image>https://cf.geekdo-images.com/catan.jpg</image>
  <name type="primary" sortindex="1" value="CATAN" />
  <name type="alternate" sortindex="1" value="Die Siedler von Catan" />
  <description>In CATAN, players try to be the dominant force&#10;&#10;on the island &amp; trade.</description>
  <yearpublished value="1995" />
  <minplayers value="3" /><maxplayers value="4" />
  <playingtime value="120" /><minplaytime value="60" /><maxplaytime value="120" />
  <minage value="10" />
  <link type="boardgamecategory" id="1021" value="Economic" />
  <link type="boardgamecategory" id="1026" value="Negotiation" />
  <link type="boardgamemechanic" id="2072" value="Dice Rolling" />
  <link type="boardgamefamily" id="3" value="Game: Catan" />
  <link type="boardgamefamily" id="5666" value="Theme: Colonial" />
  <link type="boardgamefamily" id="66" value="Components: Hexagonal Tiles" />
  <link type="boardgamedesigner" id="11" value="Klaus Teuber" />
  <link type="boardgameartist" id="12" value="Volkan Baga" />
  <link type="boardgamepublisher" id="37" value="KOSMOS" />
  <statistics page="1"><ratings>
    <usersrated value="122345" /><average value="7.10" /><bayesaverage value="6.9" />
    <ranks><rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="507" bayesaverage="6.9" />
    <rank type="family" id="5497" name="strategygames" friendlyname="Strategy Game Rank" value="400" bayesaverage="6.9" /></ranks>
    <averageweight value="2.29" />
  </ratings></statistics>
</item></items>`;

describe("reading BGG's XML", () => {
  const thing = parseThing(items(THING)[0])!;

  it("reads a game, its links and its statistics", () => {
    expect(thing).toMatchObject({
      id: "13", name: "CATAN", year: 1995, minPlayers: 3, maxPlayers: 4, playingTime: 120, minAge: 10,
      categories: ["Economic", "Negotiation"], mechanics: ["Dice Rolling"], designers: ["Klaus Teuber"],
      publishers: ["KOSMOS"], average: 7.1, usersRated: 122345, rank: 507, weight: 2.29,
      image: "https://cf.geekdo-images.com/catan.jpg",
    });
    expect(thing.description).toBe("In CATAN, players try to be the dominant force\n\non the island & trade.");
  });

  it("makes a card with the rating on 0-100 and only the year as the date", () => {
    expect(thingCard(thing)).toEqual({
      source: "bgg", sourceId: "13", type: "boardgame", title: "CATAN", releaseDate: "1995",
      posterUrl: "https://cf.geekdo-images.com/catan.jpg", votes: 122345, rating: 71,
    });
  });

  it("takes series and franchise families as a franchise, theme families as tags, and nothing else", () => {
    expect(bggFranchises(["Game: Catan", "Series: Ticket to Ride (Official)", "Franchise: Star Wars", "Components: Dice"]))
      .toEqual(["Catan", "Ticket to Ride", "Star Wars"]);
    expect(bggThemes(["Theme: Pirates", "Game: Catan"])).toEqual(["Pirates"]);
  });

  it("gives the score a designer, a publisher, a franchise and genre tags", () => {
    const link = { source: "bgg", sourceId: "13", rawData: thing } as unknown as MediaLink;
    const merged = mergeLinks([link], "boardgame");
    expect(merged).toMatchObject({ title: "CATAN", releaseDate: "1995", collection: "Catan", designers: ["Klaus Teuber"], players: { min: 3, max: 4 }, weight: 2.29 });
    expect(merged.communityRatings).toEqual([expect.objectContaining({ source: "bgg", score: 7.1, outOf: 10 })]);
    const facets = extractFacets([link], "boardgame", merged);
    expect(facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", role: "creator", label: "Klaus Teuber" }),
      expect.objectContaining({ kind: "company", role: "publisher", label: "KOSMOS" }),
      expect.objectContaining({ kind: "ip", label: "Catan" }),
      expect.objectContaining({ kind: "tag", label: "Economic", category: "genre" }),
    ]));
    // The artist is left out, as a film's crew below the writer is.
    expect(facets.some((f) => f.label === "Volkan Baga")).toBe(false);
  });
});

describe("Open Library's books", () => {
  it("dates a book by the earliest full edition date of its first year, else the year alone", () => {
    expect(bookDate({ first_publish_year: 2026, publish_date: ["2026", "May 12, 2026", "2026-03-24", "24 March 2026"] })).toBe("2026-03-24");
    expect(bookDate({ first_publish_year: 1965, publish_date: ["1965", "August 1965", "1999-01-01"] })).toBe("1965");
    expect(bookDate({})).toBeNull();
    expect(parseDay("03/04/2026")).toBeNull();
    expect(parseDay("24 March 2026")).toBe("2026-03-24");
    expect(parseDay("January 27, 2026")).toBe("2026-01-27");
  });

  it("keeps subjects that describe the book and drops the library's bookkeeping", () => {
    expect(bookSubjects({ subject: [
      "Science fiction", "Accessible book", "Protected DAISY", "New York Times reviewed", "nyt:hardcover-fiction=2021-01-03",
      "Fiction, science fiction, general", "Dune (Imaginary place)", "Fiction", "Ecology", "science fiction",
    ] })).toEqual(["Science fiction", "Ecology"]);
  });

  it("gives the score its author, its series as a franchise, and a genre", () => {
    const link = { source: "openlibrary", sourceId: "OL893414W", rawData: {
      id: "OL893414W", key: "/works/OL893414W", title: "Dune", first_publish_year: 1965, author_name: ["Frank Herbert"],
      series_name: ["Dune"], publisher: ["Chilton", "Ace"], subject: ["Science fiction", "Ecology"], ratings_average: 4.3, ratings_count: 448,
      number_of_pages_median: 608,
    } } as unknown as MediaLink;
    const merged = mergeLinks([link], "book");
    expect(merged).toMatchObject({ title: "Dune", releaseDate: "1965", collection: "Dune", authors: ["Frank Herbert"], pageCount: 608, publisher: "Chilton" });
    expect(merged.storeLinks).toEqual([{ name: "Open Library", url: "https://openlibrary.org/works/OL893414W", source: "openlibrary" }]);
    const facets = extractFacets([link], "book", merged);
    expect(facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", role: "creator", label: "Frank Herbert" }),
      expect.objectContaining({ kind: "ip", label: "Dune" }),
      expect.objectContaining({ kind: "tag", label: "Science fiction", category: "genre" }),
      expect.objectContaining({ kind: "company", role: "publisher", label: "Chilton" }),
    ]));
  });
});

describe("Open Library's placeholders", () => {
  it("reads January 1st as the year alone, and folds spellings of one subject", () => {
    expect(bookDate({ first_publish_year: 1965, publish_date: ["January 1, 1965", "1965"] })).toBe("1965");
    expect(bookSubjects({ subject: ["Science fiction", "Science-fiction", "New York Times bestseller", "Long Now Manual for Civilization"] }))
      .toEqual(["Science fiction"]);
  });
});

describe("one book per language, and the book itself", () => {
  // Open Library's rows for Brandon Sanderson and the Stormlight Archive, 2026-10-17.
  it("keeps a work with an English edition or no language, and drops a translation filed as its own work", () => {
    expect(isWholeBook({ title: "The Way of Kings", language: ["heb", "por", "eng", "ger"] })).toBe(true);
    expect(isWholeBook({ title: "Rhythm Of War" })).toBe(true);
    expect(isWholeBook({ title: "Rhythm Of War", language: [] })).toBe(true);
    expect(isWholeBook({ title: "Curso de escritura creativa", language: ["spa"] })).toBe(false);
    expect(isWholeBook({ title: "Die Königsmörder-Chronik", language: ["ger", "fre"] })).toBe(false);
  });

  it("drops a split edition and a box set catalogued as works of their own", () => {
    for (const title of [
      "Words of Radiance, Part Two", "Words of Radiance Part One", "Oathbringer part 1", "The Wise Man’s Fear [1/2]", "Words of Radiance (1 of 5)",
      "Stormlight Archive MM Boxed Set I, Books 1-3", "Stormlight Archives HC Boxed Set 1-4", "Stormlight Archive, Books 1-4",
      "The Stormlight Archive Series 6 Books Collection Set by Brandon Sanderson", "Kingkiller Chronicle Patrick Rothfuss Collection 3 Books Set",
      "Stormlight Archive Series Brandon Sanderson Collection 4 Books Bundles Set",
    ]) expect(isWholeBook({ title, language: ["eng"] }), title).toBe(false);
    for (const title of ["Words of Radiance", "The Complete Alcatraz", "Brandon Sanderson's White Sand Omnibus", "The Book of Dust", "Part of the Furniture"]) {
      expect(isWholeBook({ title, language: ["eng"] }), title).toBe(true);
    }
  });
});

describe("a book's series, read off its editions", () => {
  const edition = (series: string, lang?: string) => ({ series: [series], languages: lang ? [{ key: `/languages/${lang}` }] : [] });

  it("takes the name most English editions share once the numbering is off", () => {
    // The Way of Kings and Mistborn, as their editions name the series (2026-10-17).
    expect(seriesFromEditions([
      edition("O Arquivo das Tempestades, I", "por"), edition("The Stormlight Archive #1", "eng"), edition("The Stormlight Archive #1", "eng"),
      edition("The Stormlight Archive, 1", "eng"), edition("The Stormlight Archive"),
    ])).toBe("The Stormlight Archive");
    expect(seriesFromEditions([
      edition("Mistborn", "eng"), edition("Mistborn", "eng"), edition("The Mistborn Saga", "eng"), edition("The Mistborn Saga #1", "eng"),
      edition("Mistborn -- [bk. 1]", "eng"), edition("Nacidos de la bruma (MISTBORN) 1", "spa"), edition("Die Nebelgeborenen", "ger"),
    ])).toBe("Mistborn");
  });

  it("never lets a translation's name win on count, and reads every numbering seen", () => {
    expect(seriesFromEditions([
      edition("Die Königsmörder-Chronik, Band I", "ger"), edition("Die Königsmörder-Chronik, Band I", "ger"), edition("Die Königsmörder-Chronik (1)", "ger"),
      edition("The Kingkiller Chronicle, Day 2", "eng"), edition("The Kingkiller Chronicles Day 2, DAW Books Collectors No. 1540", "eng"),
    ])).toBe("The Kingkiller Chronicle");
    expect(seriesFromEditions([edition("A Song of ice and fire -- bk. 1.", "eng")])).toBe("A Song of ice and fire");
    expect(seriesFromEditions([edition("The Expanse Book One", "eng")])).toBe("The Expanse");
    expect(seriesFromEditions([edition("The Book of Dust", "eng")])).toBe("The Book of Dust");
  });

  it("answers null for editions that name no series, and reads a 'series:' subject", () => {
    expect(seriesFromEditions([{ languages: [{ key: "/languages/eng" }] }, {}])).toBeNull();
    expect(seriesFromEditions(undefined)).toBeNull();
    expect(seriesFromSubjects(["Fantasy", "series:Stormlight Archive"])).toBe("Stormlight Archive");
    expect(seriesFromSubjects(["Fantasy"])).toBeNull();
  });
});

describe("book search relevance", () => {
  it("keeps the book and its author's, and drops full-text noise, summaries and stubs", async () => {
    const { relevantBooks } = await import("@/lib/sources/openlibrary");
    const docs = [
      { title: "Project Hail Mary", author_name: ["Andy Weir"], cover_i: 1, ratings_count: 184 },
      { title: "Project Hail Mary: A Novel", author_name: ["Andy Weir"], ratings_count: 0 },
      { title: "Summary of Project Hail Mary by Andy Weir", cover_i: 2 },
      { title: "Macbeth", author_name: ["William Shakespeare"], cover_i: 3, ratings_count: 151 },
    ];
    expect(relevantBooks(docs, "project hail mary").map((d) => d.title)).toEqual(["Project Hail Mary"]);
    expect(relevantBooks(docs, "andy weir").map((d) => d.title)).toEqual(["Project Hail Mary"]);
  });
});
