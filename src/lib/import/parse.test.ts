import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseCsv, readCsvTable, cell } from "./csv";
import { readZip, looksLikeZip } from "./zip";
import { parseImport, ImportParseError } from "./parse";

// PL4. The import is a WRITE PATH fed by a file a stranger uploads, so these
// cover the two ways it can go wrong quietly: a parser that shifts columns (and
// therefore imports a year as a title), and an import that reads nothing and
// reports success.

// ── a real ZIP, built here ───────────────────────────────────────────────────
// Rather than checking in a binary fixture. The ZIP reader walks the central
// directory, so a hand-built archive has to be structurally correct, which is
// exactly what makes this worth doing: it exercises the real record layout.
function buildZip(files: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.body, "utf8");
    const comp = deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(8, 8);             // method: deflate
    local.writeUInt32LE(0, 14);            // crc (unchecked by our reader)
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

describe("parseCsv — the cases that silently shift columns", () => {
  it("keeps a comma inside a quoted title in the title", () => {
    const rows = parseCsv('Name,Year\n"Dawn of the Dead, Part II",1978\n');
    expect(rows[1]).toEqual(["Dawn of the Dead, Part II", "1978"]);
  });

  it("handles a doubled quote inside a quoted field", () => {
    const rows = parseCsv('Name\n"The ""Burbs"\n');
    expect(rows[1][0]).toBe('The "Burbs');
  });

  it("handles a newline inside a quoted field, which reviews contain", () => {
    const rows = parseCsv('Name,Review\n"Alien","line one\nline two"\n');
    expect(rows.length).toBe(2);
    expect(rows[1][1]).toBe("line one\nline two");
  });

  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const t = readCsvTable("﻿Name,Year\nAlien,1979\n");
    expect(t.headers[0]).toBe("Name");
    expect(cell(t, t.rows[0], "Name")).toBe("Alien");
  });

  it("reads CRLF files, which is what a Windows download gives you", () => {
    const t = readCsvTable("Name,Year\r\nAlien,1979\r\n");
    expect(cell(t, t.rows[0], "Year")).toBe("1979");
  });

  it("looks columns up by NAME, so a reordered export still reads correctly", () => {
    const t = readCsvTable("Year,Rating,Name\n1979,4.5,Alien\n");
    expect(cell(t, t.rows[0], "Name")).toBe("Alien");
    expect(cell(t, t.rows[0], "Year")).toBe("1979");
  });
});

describe("readZip", () => {
  it("reads an entry back out of a real archive", () => {
    const zip = buildZip([{ name: "ratings.csv", body: "Name,Year\nAlien,1979\n" }]);
    expect(looksLikeZip(zip)).toBe(true);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["ratings.csv"]);
    expect(entries[0].data.toString("utf8")).toContain("Alien");
  });

  it("honours the name filter, so reviews are never even decompressed", () => {
    const zip = buildZip([
      { name: "ratings.csv", body: "Name\nAlien\n" },
      { name: "reviews.csv", body: "Name,Review\nAlien,secret\n" },
    ]);
    const entries = readZip(zip, { nameFilter: (n) => n === "ratings.csv" });
    expect(entries.map((e) => e.name)).toEqual(["ratings.csv"]);
  });

  it("refuses an archive that expands past the cap", () => {
    const zip = buildZip([{ name: "ratings.csv", body: "x".repeat(5000) }]);
    expect(() => readZip(zip, { maxTotalBytes: 100 })).toThrow(/more than this import accepts/);
  });

  it("rejects something that is not a ZIP at all", () => {
    expect(() => readZip(Buffer.from("Name,Year\nAlien,1979\n"))).toThrow(/not a ZIP/);
  });
});

describe("parseImport — Letterboxd", () => {
  const zip = () => buildZip([
    { name: "ratings.csv", body: 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Alien,1979,https://boxd.it/x,4.5\n2024-01-03,"Dawn of the Dead, Part II",1978,https://boxd.it/y,3\n' },
    { name: "watchlist.csv", body: "Date,Name,Year,Letterboxd URI\n2024-02-01,Solaris,1972,https://boxd.it/z\n" },
    { name: "reviews.csv", body: "Name,Review\nAlien,not imported\n" },
  ]);

  it("reads ratings and watchlist, and nothing else", () => {
    const out = parseImport([{ name: "letterboxd.zip", data: zip() }]);
    expect(out.source).toBe("letterboxd");
    expect(out.filesRead.sort()).toEqual(["ratings.csv", "watchlist.csv"]);
    expect(out.rows.map((r) => r.title).sort())
      .toEqual(["Alien", "Dawn of the Dead, Part II", "Solaris"]);
    // reviews.csv is not merely unused, it is never read out of the archive.
    expect(out.rows.some((r) => r.title === "not imported")).toBe(false);
  });

  it("doubles half-stars onto our 0–10 scale with no rounding", () => {
    const out = parseImport([{ name: "letterboxd.zip", data: zip() }]);
    expect(out.rows.find((r) => r.title === "Alien")?.rating).toBe(9);   // 4.5 → 9
    expect(out.rows.find((r) => r.title === "Dawn of the Dead, Part II")?.rating).toBe(6);
  });

  it("marks watchlist rows as wishlist and leaves them unrated", () => {
    const out = parseImport([{ name: "letterboxd.zip", data: zip() }]);
    const solaris = out.rows.find((r) => r.title === "Solaris")!;
    expect(solaris.relation).toBe("wishlist");
    expect(solaris.rating).toBeNull();
  });

  it("prefers the rated copy when a title is on both lists", () => {
    const both = buildZip([
      { name: "ratings.csv", body: "Name,Year,Rating\nAlien,1979,4\n" },
      { name: "watchlist.csv", body: "Name,Year\nAlien,1979\n" },
    ]);
    const out = parseImport([{ name: "lb.zip", data: both }]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].relation).toBe("library");
    expect(out.rows[0].rating).toBe(8);
  });

  it("accepts a bare ratings.csv, for the people who unzip out of habit", () => {
    const out = parseImport([{ name: "ratings.csv", data: Buffer.from("Name,Year,Rating\nAlien,1979,5\n") }]);
    expect(out.rows[0].rating).toBe(10);
  });
});

describe("parseImport — IMDb", () => {
  it("uses the stable tconst and IMDb's own 1–10 scale unchanged", () => {
    const csv = "Const,Your Rating,Title,Title Type,Year\ntt0078748,9,Alien,Movie,1979\n";
    const out = parseImport([{ name: "ratings.csv", data: Buffer.from(csv) }]);
    expect(out.source).toBe("imdb");
    expect(out.rows[0].imdbId).toBe("tt0078748");
    expect(out.rows[0].rating).toBe(9);
    expect(out.rows[0].relation).toBe("library");
  });

  it("treats a file with no rating column as a watchlist", () => {
    const csv = "Const,Title,Title Type,Year\ntt0078748,Alien,Movie,1979\n";
    const out = parseImport([{ name: "WATCHLIST.csv", data: Buffer.from(csv) }]);
    expect(out.rows[0].relation).toBe("wishlist");
    expect(out.rows[0].rating).toBeNull();
  });

  it("drops video games and episodes, which IMDb mixes into the same file", () => {
    const csv = "Const,Your Rating,Title,Title Type,Year\n"
      + "tt1,8,A Film,Movie,2001\n"
      + "tt2,9,A Game,Video Game,2002\n"
      + "tt3,7,An Episode,TV Episode,2003\n";
    const out = parseImport([{ name: "ratings.csv", data: Buffer.from(csv) }]);
    expect(out.rows.map((r) => r.title)).toEqual(["A Film"]);
  });

  it("is detected by its id column even when the file was renamed", () => {
    const csv = "Const,Title,Year\ntt0078748,Alien,1979\n";
    const out = parseImport([{ name: "my-stuff.csv", data: Buffer.from(csv) }]);
    expect(out.source).toBe("imdb");
  });
});

describe("parseImport — failure is loud, never an empty success", () => {
  it("names the headers it actually saw when nothing matched", () => {
    const csv = "Foo,Bar\n1,2\n";
    let msg = "";
    try { parseImport([{ name: "ratings.csv", data: Buffer.from(csv) }]); }
    catch (e) { msg = (e as Error).message; }
    // The headers are the whole diagnostic: a column rename upstream is the
    // likeliest cause and we have no other way of learning about it.
    expect(msg).toContain("Foo, Bar");
    expect(msg).toContain("ratings.csv");
  });

  it("throws rather than returning zero rows", () => {
    expect(() => parseImport([{ name: "empty.csv", data: Buffer.from("") }]))
      .toThrow(ImportParseError);
  });
});
