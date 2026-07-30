import type { LegalDocument } from "@/lib/legal/types";

// T6 — deliberately minimal, on purpose, not an oversight: §5 DDG content
// (name, serviceable address, responsible-person line) is gated on H4.0's
// legal advice on how to satisfy the address requirement without publishing
// a home address. Writing that content here before H4.0 resolves would be
// exactly the mistake this gate exists to prevent. noindex is applied
// per-doc in page.tsx, and this doc is excluded from sitemap.ts — a search
// result linking to "imprint in preparation" would be worse than no result.
const imprint: LegalDocument = {
  title: "Imprint",
  updated: "2026-07-30",
  sections: [
    {
      heading: "In preparation",
      body: [
        "The full legal imprint (Impressum) for this site is being prepared and isn't published yet.",
        "In the meantime, you can reach the operator at hello@fandex.org.",
      ],
    },
  ],
};

export default imprint;
