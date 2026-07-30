import type { LegalDocument } from "@/lib/legal/types";

// T6 — bewusst minimal, keine Nachlässigkeit: §5-DDG-Inhalte (Name,
// ladungsfähige Anschrift, Verantwortlicher nach § 18 Abs. 2 MStV) sind
// zurückgestellt, bis die Rechtsberatung zu H4.0 klärt, wie die
// Anschriftspflicht ohne Veröffentlichung einer Privatadresse erfüllt werden
// kann. Diese Inhalte hier vor Klärung von H4.0 zu verfassen wäre genau der
// Fehler, den diese Sperre verhindern soll. noindex wird pro Dokument in
// page.tsx gesetzt; dieses Dokument ist zudem aus sitemap.ts ausgeschlossen.
const imprint: LegalDocument = {
  title: "Impressum",
  updated: "2026-07-30",
  sections: [
    {
      heading: "In Vorbereitung",
      body: [
        "Das vollständige Impressum für diese Seite wird derzeit vorbereitet und ist noch nicht veröffentlicht.",
        "In der Zwischenzeit erreichen Sie den Betreiber unter hello@fandex.org.",
      ],
    },
  ],
};

export default imprint;
