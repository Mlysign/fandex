import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// House style guard (2026-08-20).
//
// The site title read "Fandex — your index of every game, movie & show" and was
// called out for looking machine-written on sight, in a Google result, before
// anyone had clicked through. An em-dash is the single clearest tell, and the
// project's writing rules ban it outright.
//
// A one-off sweep fixes today and nothing else, so this is the guard: any NEW
// em-dash in a string literal or in JSX text fails the suite. Comments are
// exempt on purpose. No reader ever sees them, and the repo has thousands.
//
// If this test fires on something you just wrote, the fix is almost always to
// split the sentence in two, or to use a colon for a list intro and a comma for
// an aside. It is not to add an entry to ALLOWED below.

const SRC = path.resolve(__dirname, "..");
const EM_DASH = "—";
const EN_DASH = "–";

/**
 * The two legitimate uses, decided by the dash's IMMEDIATE neighbours rather
 * than by anything on the rest of the line.
 *
 * Both are typography rather than prose: a lone dash standing in for "no value"
 * in a table cell or a stat tile (`"—"`, `>—<`), and an en-dash joining the two
 * halves of a range or a compound proper noun (`0–100`, `EU–US`). Neither reads
 * as a sentence, so neither is the tell this guard exists to catch.
 *
 * Testing the whole line instead was the first attempt and it was wrong twice
 * over: `value={x ?? "—"}` is a placeholder the line test rejected, and a line
 * that happens to contain a range would have excused real prose beside it.
 */
const DELIMITERS = new Set(["\"", "'", "`", ">", "<", "{", "}"]);

function isAllowedUse(src: string, at: number): boolean {
  const before = src[at - 1];
  const after = src[at + 1];
  // A lone glyph between its own delimiters.
  if (DELIMITERS.has(before) && DELIMITERS.has(after)) return true;
  // A range or compound: only ever an en-dash, and never spaced.
  if (src[at] === EN_DASH && /[0-9A-Za-z]/.test(before ?? "") && /[0-9A-Za-z]/.test(after ?? "")) return true;
  return false;
}

type Hit = { file: string; line: number; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Find dashes that are NOT inside a comment.
 *
 * A plain grep cannot do this: the repo's comments carry thousands of em-dashes
 * and every one of them is fine. So this walks the source tracking whether it is
 * in code, a line comment, a block comment, or a string, and reports only the
 * hits that land in a string literal or in JSX text (which reads as "code" here,
 * since JSX children are not a string literal to the tokenizer).
 */
function findProseDashes(src: string): { line: number; text: string }[] {
  const lines = src.split("\n");
  const hits: { line: number; text: string }[] = [];
  const seen = new Set<number>();
  let i = 0;
  let line = 1;
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "\n") {
      line++;
      if (state === "line") state = "code";
      i++;
      continue;
    }
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { state = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { state = c; i++; continue; }
    } else if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; i += 2; continue; }
    } else if (state === "'" || state === '"' || state === "`") {
      if (c === "\\") { i += 2; continue; }
      if (c === state) { state = "code"; i++; continue; }
    }
    if ((c === EM_DASH || c === EN_DASH) && state !== "line" && state !== "block" && !seen.has(line)) {
      const text = lines[line - 1].trim();
      // Belt and braces on top of the tokenizer, for two reasons. SQL comments
      // inside a template literal (`-- ...` in migrations.ts and db.ts) are a
      // string to the tokenizer and a comment to every reader. And the state
      // machine is defeatable: a regex literal containing a lone quote, e.g.
      // /['"]/, opens a string state it never closes, which made three ordinary
      // `//` comments in igdb.ts and publicUrl.ts read as prose.
      const isComment = text.startsWith("//") || text.startsWith("--") || text.startsWith("*");
      if (!isComment && !isAllowedUse(src, i)) {
        seen.add(line);
        hits.push({ line, text: text.slice(0, 150) });
      }
    }
    i++;
  }
  return hits;
}

describe("copy style", () => {
  it("has no em-dash in any string literal or JSX text under src/", () => {
    const hits: Hit[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      for (const h of findProseDashes(fs.readFileSync(file, "utf8"))) {
        hits.push({ file: rel, ...h });
      }
    }
    const report = hits.map((h) => `  src/lib/../${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(hits, `Em-dash in user-visible copy:\n${report}\n\nSplit the sentence, or use a colon or comma.`).toEqual([]);
  });

  // Guards the guard. The tokenizer above is the whole reason this test is
  // usable, so prove it still distinguishes the four positions.
  it("ignores comments and allows placeholder glyphs and ranges", () => {
    expect(findProseDashes(`// a comment with an ${EM_DASH} in it\nconst a = 1;`)).toEqual([]);
    expect(findProseDashes(`/* block ${EM_DASH} comment */\nconst a = 1;`)).toEqual([]);
    expect(findProseDashes(`const a = "0${EN_DASH}100";`)).toEqual([]);
    expect(findProseDashes(`const a = "${EM_DASH}";`)).toEqual([]);
    expect(findProseDashes(`const a = "real ${EM_DASH} prose";`)).toHaveLength(1);
  });
});
