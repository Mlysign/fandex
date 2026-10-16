import { describe, expect, it } from "vitest";
import { normalizeName, searchKey } from "./normalize";

// SM78: "pokemon" found none of the Pokémon games, because normalizeName turns
// é into a space. A search compares searchKey on both sides instead.
describe("searchKey", () => {
  const finds = (typed: string, title: string) => searchKey(title).includes(searchKey(typed));

  it("finds an accented title typed without its accent, and the other way round", () => {
    expect(finds("pokemon", "Pokémon Red Version")).toBe(true);
    expect(finds("pokémon", "Pokemon Go")).toBe(true);
    expect(finds("amelie", "Amélie")).toBe(true);
    expect(finds("les miserables", "Les Misérables")).toBe(true);
    expect(finds("senor", "Señor Smoke")).toBe(true);
  });

  it("folds the letters NFD leaves alone", () => {
    expect(searchKey("Straße")).toBe("strasse");
    expect(searchKey("Ærø")).toBe("aero");
    expect(searchKey("Łódź")).toBe("lodz");
    expect(searchKey("Œuvre")).toBe("oeuvre");
    expect(searchKey("Þór")).toBe("thor");
  });

  it("treats a combining accent like its precomposed letter", () => {
    expect(searchKey("Pokémon")).toBe(searchKey("Pokémon"));
    expect(searchKey("Pokémon")).toBe("pokemon");
  });

  it("keeps a lone non-ASCII letter a real query instead of an empty one", () => {
    expect(searchKey("ß")).toBe("ss");
    expect(searchKey("ü")).toBe("u");
    expect(searchKey("エヴァ")).toBe("エヴァ");
    expect(searchKey("Ёжик")).toBe("ёжик");
  });

  it("reads punctuation the way normalizeName does for plain titles", () => {
    for (const t of ["Spider-Man: No Way Home", "Marvel's Spider-Man 2", "Blade Runner 2049", "S.T.A.L.K.E.R. 2", "  The   Witcher 3  "]) {
      expect(searchKey(t)).toBe(normalizeName(t));
    }
    expect(searchKey("“Quoted”, ¡sí! ×2")).toBe("quoted si 2");
    expect(searchKey('"')).toBe("");
  });

  it("leaves normalizeName, the matcher's stored key, as it was", () => {
    expect(normalizeName("Pokémon")).toBe("pok mon");
  });
});
