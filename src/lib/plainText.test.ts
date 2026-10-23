import { describe, expect, it } from "vitest";
import { cutAtWord, plainDescription } from "./plainText";

describe("plainDescription", () => {
  it("takes Open Library's Markdown out and keeps the words", () => {
    const raw = "**Working at the local processing plant**, Marcos...\r\n\r\n----------\r\n\r\nSee [the work](https://openlibrary.org/works/OL16524231W) and [x][1].\n\n[1]: https://example.org\n\nFrom [wikipedia](https://en.wikipedia.org/wiki/X)";
    expect(plainDescription(raw)).toBe("Working at the local processing plant, Marcos...\n\nSee the work and x.");
  });
  it("leaves ordinary prose alone", () => {
    const prose = "Ryland Grace is the sole survivor on a desperate, last-chance mission. 2 * 3 = 6.\n\nHe wakes up alone.";
    expect(plainDescription(prose)).toBe(prose);
  });
});

describe("cutAtWord", () => {
  it("cuts at a word and says so", () => {
    expect(cutAtWord("a task considered to be impossible: inception", 40)).toBe("a task considered to be impossible…");
    expect(cutAtWord("short", 40)).toBe("short");
    expect(cutAtWord("x".repeat(50), 20)).toHaveLength(20);
  });
});
