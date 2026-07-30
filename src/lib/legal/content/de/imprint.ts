import type { LegalDocument } from "@/lib/legal/types";

// T1 placeholder — filled in by T6. This doc stays a placeholder even after
// T6: no §5 DDG content until H4.0 (legal advice) lands. noindex is applied
// per-doc in page.tsx, not here.
const imprint: LegalDocument = {
  title: "Impressum",
  updated: "2026-07-30",
  sections: [
    { heading: "In Vorbereitung", body: ["Diese Seite ist ein Platzhalter. Das vollständige Impressum wird in einer späteren Aufgabe verfasst."] },
  ],
};

export default imprint;
