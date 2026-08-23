// PL4 — a correct-enough CSV reader for the list imports.
//
// Written rather than installed on purpose. The runtime dependency list is nine
// packages and the parsing this needs is small; a CSV library would be a larger
// supply-chain surface than the problem.
//
// It has to be a real parser rather than `line.split(",")`, because the files it
// reads carry free text written by users: a Letterboxd review contains commas,
// quotes and newlines, and a film title routinely contains a comma ("Dawn of the
// Dead, Part II") or a quote. Splitting on commas silently shifts every column
// after the offending one, which would show up as a title matched against a year
// and an import that looked like it worked.
//
// Handles RFC 4180: quoted fields, doubled quotes inside a quoted field, and
// newlines inside a quoted field. Also tolerates CRLF and a UTF-8 BOM, both of
// which real exports carry.

/** Parse a whole CSV document into rows of raw cell strings. */
export function parseCsv(input: string): string[][] {
  // A BOM survives most editors and would otherwise become part of the first
  // header name, so "Date" arrives as "﻿Date" and every lookup misses.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; sawAnyChar = true; continue; }
    if (c === ",") { row.push(field); field = ""; sawAnyChar = true; continue; }
    if (c === "\r") continue;                              // CRLF → LF
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; sawAnyChar = false; continue; }
    field += c;
    sawAnyChar = true;
  }
  // A trailing newline leaves an empty pending row; a file with no trailing
  // newline leaves a real one. `sawAnyChar` is what separates those two.
  if (field.length || sawAnyChar || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parse into objects keyed by header name.
 *
 * ⚠️ Lookup is BY HEADER NAME, never by column index. Neither Letterboxd nor
 * IMDb publishes a schema, both have changed their column order before, and a
 * positional reader fails silently by reading the wrong column rather than
 * loudly by finding nothing. Header names are compared case-insensitively and
 * with surrounding whitespace stripped, because exports are inconsistent about
 * both.
 */
export interface CsvTable {
  headers: string[];
  /** Lowercased, trimmed header → column index. */
  index: Map<string, number>;
  rows: string[][];
}

export function readCsvTable(input: string): CsvTable {
  const all = parseCsv(input).filter((r) => r.some((c) => c.trim() !== ""));
  if (!all.length) return { headers: [], index: new Map(), rows: [] };
  const headers = all[0].map((h) => h.trim());
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase();
    if (!index.has(key)) index.set(key, i); // first wins on a duplicated header
  });
  return { headers, index, rows: all.slice(1) };
}

/** Read one cell by header name, or null when the column is absent or empty. */
export function cell(table: CsvTable, row: string[], ...names: string[]): string | null {
  for (const name of names) {
    const i = table.index.get(name.toLowerCase());
    if (i == null) continue;
    const v = (row[i] ?? "").trim();
    if (v !== "") return v;
  }
  return null;
}

/** True when the table has at least one of the named columns. */
export function hasColumn(table: CsvTable, ...names: string[]): boolean {
  return names.some((n) => table.index.has(n.toLowerCase()));
}
