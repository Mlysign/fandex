// "1 title", "2 titles". A leaf with no imports, so any screen and the
// website's server render can use it. "Library 1 titles" was SM84.

/** The count and the noun, the noun made plural unless the count is exactly one. */
export function count(n: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${n.toLocaleString('en')} ${n === 1 ? noun : pluralNoun}`;
}
