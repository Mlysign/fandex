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

export type LegalBlock = string | { list: string[] };

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
