// H4.1 (2026-07-30) — the shape every legal doc is written in. No markdown
// library and no dangerouslySetInnerHTML (the enforced CSP makes that the
// wrong reflex) — LegalDoc.tsx walks this structure directly.

export const LEGAL_LOCALES = ["en", "de"] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

export const LEGAL_DOCS = ["privacy", "terms", "support", "imprint"] as const;
export type LegalDocId = (typeof LEGAL_DOCS)[number];

export function isLegalLocale(v: string): v is LegalLocale {
  return (LEGAL_LOCALES as readonly string[]).includes(v);
}

export function isLegalDocId(v: string): v is LegalDocId {
  return (LEGAL_DOCS as readonly string[]).includes(v);
}

/**
 * A block of text that must NOT appear in the server-rendered HTML — base64 of
 * the UTF-8 string, newline-separated for multi-line values. Rendered
 * client-side only by `ProtectedText`; see that component for what this does
 * and does not protect against.
 *
 * Regenerate with:
 *   node -e "console.log(Buffer.from('line1\nline2','utf8').toString('base64'))"
 */
export type LegalProtectedBlock = { protected: string };

/** An inline link inside a paragraph. `external` opens in a new tab. */
export interface LegalLink {
  href: string;
  label: string;
  external?: boolean;
}

/**
 * A paragraph mixing plain text and inline links — the parts are concatenated
 * in order, so write the surrounding spacing into the strings themselves.
 *
 * Exists because the plain-string block can't hold a link and the CSP rules out
 * `dangerouslySetInnerHTML` (H4.1's original decision, unchanged). Added
 * 2026-08-03 for the Ko-fi link in the support page's donation section.
 */
export type LegalRichBlock = { rich: (string | LegalLink)[] };

export type LegalBlock = string | { list: string[] } | LegalProtectedBlock | LegalRichBlock;

export function isProtectedBlock(b: LegalBlock): b is LegalProtectedBlock {
  return typeof b === "object" && "protected" in b;
}

export function isRichBlock(b: LegalBlock): b is LegalRichBlock {
  return typeof b === "object" && "rich" in b;
}

export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  // ISO date string (YYYY-MM-DD) — "last updated" shown on the page.
  updated: string;
  intro?: string[];
  sections: LegalSection[];
}
