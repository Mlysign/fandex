// Title normalization — the single source of truth for the key the matcher uses
// to find candidate canonical items (media_items.norm_title). Kept dependency-free
// so the lowest layer (db.ts) can import it without pulling in merge.ts.
//
// Rule: lowercase → drop apostrophes (so possessives like "Marvel's" stay one word)
// → turn every other run of non-alphanumerics into a single space → trim. This
// means punctuation variants normalize equal: "Spider-Man" == "Spider Man" ==
// "spider man". Bump NORM_VERSION in db.ts whenever this rule changes (forces a
// norm_title re-backfill).
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’]/g, "") // apostrophes (straight + curly) → removed, no space
    .replace(/[^a-z0-9]+/g, " ")      // any other punctuation/symbol run → single space
    .trim();
}

// Letters a search should read as their plain spelling. Listed by hand rather
// than left to String.prototype.normalize('NFD'): NFD does not take ø, æ, ł, ß,
// œ, đ or þ apart at all, and an engine without it would fold nothing.
const FOLD_FROM = [
  "àáâãäåāăą", "çćĉċč", "ďđð", "èéêëēĕėęě", "ĝğġģ", "ĥħ", "ìíîïĩīĭįı", "ĵ", "ķ",
  "ĺļľŀł", "ñńņňŉ", "òóôõöøōŏő", "ŕŗř", "śŝşšș", "ţťŧț", "ùúûüũūŭůűų", "ŵ", "ýÿŷ", "źżž",
];
const FOLD_TO = "acdeghijklnorstuwyz";
const FOLD: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", þ: "th" };
FOLD_FROM.forEach((letters, i) => { for (const c of letters) FOLD[c] = FOLD_TO[i]; });

/**
 * The key a SEARCH compares, on both sides: what was typed and every title.
 * `normalizeName` drops every letter outside a to z, so "Pokémon" became
 * "pok mon" and "pokemon" never found it, and a lone "ß" was an empty query
 * that listed the whole catalog (SM78). This folds accents to the plain letter
 * and keeps the letters of other scripts. Not a replacement for normalizeName,
 * which is the matcher's stored identity key: change that and every
 * norm_title has to be recomputed.
 */
export function searchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[À-ɏ]/g, (c) => FOLD[c] ?? c)
    .replace(/[̀-ͯ]/g, "") // a combining accent typed or pasted on its own
    .replace(/['‘’]/g, "")
    // Space, ASCII and Latin-1 punctuation, general punctuation, CJK and full-width punctuation
    .replace(/[\s!-/:-@[-`{-~¡-¿×÷ -⁯　-〿！-／]+/g, " ")
    .trim();
}
