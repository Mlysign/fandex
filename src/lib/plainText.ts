// Provider text as a reader should see it, and cut to a length without breaking
// a word. Pure and import-free: the Worker's normalizer, the app's item page and
// the website's meta tags all use it.

/**
 * A description with its Markdown taken out. Open Library's descriptions are
 * written in it, and the item page printed it raw: "**Working at the local
 * processing plant…**", a "----------" rule, "[source](https://openlibrary.org/…)"
 * and a closing "From [wikipedia](…)" (2026-10-23). Links keep their words,
 * emphasis keeps its text, rules, reference definitions and source lines go.
 */
export function plainDescription(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // an image
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1") // [words](url) → words
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1") // [words][1] → words
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "") // [1]: https://… definitions
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2") // **bold**, __bold__
    .replace(/^\s*(?:[-=*_]\s*){3,}$/gm, "") // a horizontal rule
    .replace(/^\s*#{1,6}\s+/gm, "") // a heading's hashes
    .replace(/^\s*\(?\s*(?:source|from)\s*:?\s*wikipedia\)?\s*\.?\s*$/gim, "") // "From wikipedia" once its link is words
    .replace(/^\s*https?:\/\/\S+\s*$/gm, "") // a bare address on its own line
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * At most `max` characters, cut at the last word that fits, with an ellipsis
 * when anything was cut. A meta description cut mid-word read as a broken page
 * in search results ("…considered to be impossible: \"inc").
 */
export function cutAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = flat.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max * 0.6 ? room.slice(0, space) : room).replace(/[\s,;:.(-]+$/, "")}…`;
}
