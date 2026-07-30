import type { LegalDocument, LegalDocId, LegalLocale } from "@/lib/legal/types";
import LocaleToggle from "@/components/legal/LocaleToggle";

// H4.1 — renders a LegalDocument. No markdown, no dangerouslySetInnerHTML
// (the enforced CSP makes that the wrong reflex) — the content is a plain
// structure walked directly.
export default function LegalDoc({ doc, locale, docId }: { doc: LegalDocument; locale: LegalLocale; docId: LegalDocId }) {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <LocaleToggle current={locale} docId={docId} />

      <h1 className="font-serif text-serif-2xl text-text-primary leading-tight mt-4">{doc.title}</h1>
      <p className="text-xs font-mono text-text-secondary mt-1">
        {locale === "de" ? "Zuletzt aktualisiert" : "Last updated"}: {doc.updated}
      </p>

      {doc.intro && (
        <div className="mt-6 space-y-3">
          {doc.intro.map((p, i) => (
            <p key={i} className="text-sm text-text-secondary leading-relaxed">{p}</p>
          ))}
        </div>
      )}

      <div className="mt-8 space-y-8">
        {doc.sections.map((s, i) => (
          <section key={i}>
            <h2 className="font-serif text-lg text-text-primary mb-2">{s.heading}</h2>
            <div className="space-y-3">
              {s.body.map((block, j) =>
                typeof block === "string" ? (
                  <p key={j} className="text-sm text-text-secondary leading-relaxed">{block}</p>
                ) : (
                  <ul key={j} className="list-disc list-inside space-y-1">
                    {block.list.map((item, k) => (
                      <li key={k} className="text-sm text-text-secondary leading-relaxed">{item}</li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
