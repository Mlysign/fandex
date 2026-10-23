// Latin letters that NFD/NFKD does NOT decompose — the silent gap in every
// "strip the diacritics" normalizer.
//
// `.normalize("NFD").replace(/[̀-ͯ]/g, "")` only works for characters
// with a CANONICAL DECOMPOSITION: "é" really is "e" + U+0301, so dropping the
// combining mark leaves "e". A STROKED or LIGATURE letter is a single
// indivisible code point instead — "ø" (U+00F8) is not "o" + anything, "ß" is
// not "s" + anything. NFD leaves them untouched, the `[^a-z0-9]` strip that
// follows then DELETES them, and the result is silently lossy:
//
//   personKey("Lisa Tønne")  ->  "lisa t nne"   (slug /person/lisa-t-nne)
//   personKey("Łukasz Żal")  ->  "ukasz zal"    (leading letter gone entirely)
//
// Where the key IS the URL identity this is not a cosmetic wart. A facet has no
// database row — `facetUrl.ts` addresses it BY its normalized key — so the page
// looks the mangled name up against the provider and hard-404s. Verified
// against the live TMDB API (2026-08-07): "lisa t nne" returns 0 results,
// "lisa tonne" returns 4, including "Lisa Tønne".
//
// This module deliberately imports nothing: both `facets.ts` (which pulls in
// tags.ts) and `publicUrl.ts` (a leaf imported widely, including by client
// components) need it, so it lives below both rather than coupling them.
//
// NOT applied to `tagKey()`. Tag keys are PERSISTED — `tag_category_override`
// (84 rows on prod) and `tag_alias` are keyed by them — so changing that
// normalizer would silently orphan those rows. Person and company keys are
// runtime-only, which is what makes them safe to change.

// Lowercase source of truth. Chosen for the scripts that actually show up in
// film/game credits: Scandinavian (ø æ), Polish (ł), German (ß), Icelandic
// (þ ð), Vietnamese (đ), Turkish (ı), Maltese (ħ), Sami (ŋ ŧ), French (œ).
// "å" is included for callers that transliterate BEFORE normalizing — it does
// decompose, so it is already handled when NFD runs first.
const BASE: Record<string, string> = {
  "ø": "o",
  "å": "a",
  "æ": "ae",
  "œ": "oe",
  "ł": "l",
  "ß": "ss",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ı": "i",
  "ħ": "h",
  "ŋ": "n",
  "ŧ": "t",
};

// Both call sites lowercase before transliterating, so uppercase coverage is
// belt-and-braces — but it makes the function correct standalone. Built here
// rather than via the regex `i` flag on purpose: under Unicode simple case
// folding "ſ" folds to "s" and "ẞ" to "ß", so a case-insensitive character
// class silently matches far more than it lists.
const TRANSLITERATIONS: Record<string, string> = (() => {
  const m: Record<string, string> = { ...BASE };
  for (const [ch, rep] of Object.entries(BASE)) {
    const upper = ch.toUpperCase();
    // "ß".toUpperCase() is "SS" — two code points, not a character class member.
    if (upper !== ch && upper.length === 1) m[upper] = rep.toUpperCase();
  }
  m["ẞ"] = "SS"; // LATIN CAPITAL LETTER SHARP S, the one that needs it
  return m;
})();

// None of the mapped characters are regex-special, so the class needs no escaping.
const TRANSLIT_RE = new RegExp(`[${Object.keys(TRANSLITERATIONS).join("")}]`, "g");

// Replace stroked/ligature Latin letters with their ASCII equivalents. Leaves
// everything else — including non-Latin scripts — untouched, so a caller that
// relies on "君の名は。" collapsing to the empty string still gets that.
export function transliterate(s: string): string {
  return s.replace(TRANSLIT_RE, (ch) => TRANSLITERATIONS[ch] ?? ch);
}

// Cyrillic and Greek, lowercase, for an ADDRESS only (`slugify`): "Преступление
// и наказание" was /book/untitled-1866 (2026-10-23). Not for `personKey`, whose
// keys are stored inside every derived item's facets: changing them would split
// a Cyrillic name's facet in two until every item is derived again. A script
// with no letter-for-letter romanization (Japanese, Chinese, Devanagari) is
// left alone and still slugs to "untitled".
const SCRIPTS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "yo", є: "ye", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
const SCRIPTS_RE = new RegExp(`[${Object.keys(SCRIPTS).join("")}]`, "g");

/** Cyrillic and Greek letters to Latin, for an address. Expects lowercase, after NFKD has split off the accents. */
export function romanizeForAddress(s: string): string {
  return s.replace(SCRIPTS_RE, (ch) => SCRIPTS[ch] ?? ch);
}
