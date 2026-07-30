import type { LegalDocument, LegalDocId, LegalLocale } from "@/lib/legal/types";
import { LEGAL_DOCS, LEGAL_LOCALES } from "@/lib/legal/types";

import enPrivacy from "@/lib/legal/content/en/privacy";
import enTerms from "@/lib/legal/content/en/terms";
import enSupport from "@/lib/legal/content/en/support";
import enImprint from "@/lib/legal/content/en/imprint";
import dePrivacy from "@/lib/legal/content/de/privacy";
import deTerms from "@/lib/legal/content/de/terms";
import deSupport from "@/lib/legal/content/de/support";
import deImprint from "@/lib/legal/content/de/imprint";

// H4.1 — one explicit table, both locales, so a missing translation is a
// compile error rather than a silent English fallback. Add a new doc by
// adding it to LEGAL_DOCS (types.ts) AND both branches here.
const REGISTRY: Record<LegalLocale, Record<LegalDocId, LegalDocument>> = {
  en: { privacy: enPrivacy, terms: enTerms, support: enSupport, imprint: enImprint },
  de: { privacy: dePrivacy, terms: deTerms, support: deSupport, imprint: deImprint },
};

export function getLegalDocument(locale: LegalLocale, doc: LegalDocId): LegalDocument {
  return REGISTRY[locale][doc];
}

// Every (locale, doc) pair — used for static params and the completeness test.
export function everyLegalRoute(): { locale: LegalLocale; doc: LegalDocId }[] {
  return LEGAL_LOCALES.flatMap((locale) => LEGAL_DOCS.map((doc) => ({ locale, doc })));
}
