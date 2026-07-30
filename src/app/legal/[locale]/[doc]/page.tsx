import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { isLegalLocale, isLegalDocId, LEGAL_LOCALES } from "@/lib/legal/types";
import { getLegalDocument } from "@/lib/legal/registry";
import LegalDoc from "@/components/legal/LegalDoc";

// H4.1 — the legal surface: /legal/{en,de}/{privacy,terms,support,imprint}.
//
// MUST be force-dynamic. generateMetadata below builds canonical + hreflang
// URLs from BASE_URL, and reading an env var to build an absolute URL without
// force-dynamic is exactly the trap that shipped `localhost:3000` to
// production in robots.ts (SM7, 2026-07-19, see AGENTS.md) — Next prerenders
// route handlers at `next build` time, and Railway's build-phase env can
// differ from its runtime env.
//
// Public and viewer-independent, same guarantee as the item page (P13):
// nothing here reads the session, so the HTML never varies per visitor.
export const dynamic = "force-dynamic";

interface Params {
  locale: string;
  doc: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, doc } = await params;
  if (!isLegalLocale(locale) || !isLegalDocId(doc)) return { title: "Not found" };

  const content = getLegalDocument(locale, doc);
  const canonical = `${BASE_URL}/legal/${locale}/${doc}`;
  const languages = Object.fromEntries(LEGAL_LOCALES.map((l) => [l, `${BASE_URL}/legal/${l}/${doc}`]));

  return {
    title: content.title,
    alternates: { canonical, languages },
    // imprint is a placeholder until H4.0 (legal advice) lands — it must not
    // be indexed or listed in the sitemap while it says "coming soon".
    ...(doc === "imprint" ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function LegalPage({ params }: { params: Promise<Params> }) {
  const { locale, doc } = await params;
  if (!isLegalLocale(locale) || !isLegalDocId(doc)) notFound();

  const content = getLegalDocument(locale, doc);
  return <LegalDoc doc={content} locale={locale} docId={doc} />;
}
