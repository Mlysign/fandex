import type { LegalDocument } from "@/lib/legal/types";

// T1 placeholder — filled in by T6. This doc stays a placeholder even after
// T6: no §5 DDG content until H4.0 (legal advice) lands. noindex is applied
// per-doc in page.tsx, not here.
const imprint: LegalDocument = {
  title: "Imprint",
  updated: "2026-07-30",
  sections: [
    { heading: "Coming soon", body: ["This page is a placeholder. The real imprint page is drafted in a later task."] },
  ],
};

export default imprint;
