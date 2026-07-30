import Link from "next/link";
import type { LegalDocId, LegalLocale } from "@/lib/legal/types";
import { LEGAL_LOCALES } from "@/lib/legal/types";

const LABEL: Record<LegalLocale, string> = { en: "EN", de: "DE" };

// H4.1 — plain links, not a client toggle: distinct URLs per locale is the
// whole point (a German user must be linkable straight to the German text),
// so there's nothing here that needs client state.
export default function LocaleToggle({ current, docId }: { current: LegalLocale; docId: LegalDocId }) {
  return (
    <nav className="inline-flex rounded-full border border-border bg-surface-elevated p-0.5 text-xs font-mono" aria-label="Language">
      {LEGAL_LOCALES.map((l) => (
        <Link
          key={l}
          href={`/legal/${l}/${docId}`}
          aria-current={l === current ? "true" : undefined}
          // SM33 (2026-07-30, fixed 2026-07-31): measured 39×24 at 375px, well
          // under the app's 44px `.tap-44` convention. Height-only (`.tap-44-y`),
          // same choice SubBar's segmented view-toggle made: two pills packed
          // side by side can't each claim 44px of WIDTH without overlapping.
          className={`tap-44-y px-3 py-1 rounded-full transition-colors ${
            l === current ? "bg-accent text-text-on-accent" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {LABEL[l]}
        </Link>
      ))}
    </nav>
  );
}
