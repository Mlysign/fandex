import { readZip, looksLikeZip, ZipError } from "./zip";
import { ImportParseError, parseImportTexts, WANTED, type ParsedImport } from "./parseText";

// PL4: the server's half of reading an upload, which is opening the ZIP. Every
// rule about the CSVs themselves is in parseText.ts, shared with the app.
export { ImportParseError, parseImportTexts };
export type { ImportRelation, ImportRow, ParsedImport } from "./parseText";

/**
 * Parse an upload. Accepts the Letterboxd ZIP as downloaded, a single CSV, or
 * several CSVs.
 *
 * `files` is whatever the user handed us: one entry for a single CSV, or the ZIP
 * itself which is expanded here.
 */
export function parseImport(files: { name: string; data: Buffer }[]): ParsedImport {
  const flat: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    if (looksLikeZip(f.data)) {
      try {
        // Pull only what we use. Reviews, diary, lists, likes and comments are
        // in there and are deliberately never decompressed: the cheapest way to
        // honour "ratings and watchlist only" is to not read the rest at all.
        flat.push(...readZip(f.data, { nameFilter: (n) => WANTED.some((w) => w.match.test(n)) }));
      } catch (e) {
        throw e instanceof ZipError ? new ImportParseError(e.message) : e;
      }
    } else {
      flat.push(f);
    }
  }
  return parseImportTexts(flat.map((f) => ({ name: f.name, text: f.data.toString("utf8") })));
}
