import type { LegalDocument } from "@/lib/legal/types";

// H4.2 — DRAFT, 2026-08-03. H4.0 ist beantwortet: die Rechtsberatung sagt, ein
// Standard-Impressum genügt, nichts Besonderes. Dies ist die Umsetzung davon.
//
// Inhaltlich vollständig — keine Platzhalter mehr offen. Das Dokument bleibt
// noindex (page.tsx) und aus sitemap.ts ausgeschlossen, auch jetzt, wo es
// gefüllt ist: es enthält die echte Privatanschrift. Siehe unten.
//
// Aufbau bewusst als Standard-Impressum:
//   §5 DDG          — Name, ladungsfähige Anschrift, schneller Kontakt
//   §27a UStG       — USt-IdNr., falls vorhanden
//   §18 Abs.2 MStV  — inhaltlich Verantwortlicher
//   §36 VSBG        — Erklärung zur Verbraucherschlichtung
//
// BEWUSST NICHT ENTHALTEN — die EU-Plattform zur Online-Streitbeilegung (OS/ODR).
// Sie wurde am 20.07.2025 abgeschaltet und die Verordnung (EU) 524/2013 durch
// die Verordnung (EU) 2024/3228 aufgehoben; die Hinweispflicht ist entfallen.
// Praktisch jede Impressum-Vorlage, die älter als Mitte 2025 ist, führt den
// Link noch — er wäre heute schlicht falsch. Nicht "nachträglich ergänzen".
//
// ZUR ANSCHRIFT: TASKS.md H4.2 sah vor, die Adresse als Bild oder per
// JavaScript einzufügen, um Scraper abzuwehren. Davon wird abgeraten — §5 DDG
// verlangt "leicht erkennbar" und "unmittelbar erreichbar"; eine Adresse, die
// ohne JavaScript fehlt oder nur als Grafik existiert, ist weder barrierefrei
// noch sicher konform, und es ist das Gegenteil von "Standard-Impressum".
// noindex + Sitemap-Ausschluss bleiben — die halten das Impressum aus der
// Google-Suche, ohne es Besuchern vorzuenthalten.
const imprint: LegalDocument = {
  title: "Impressum",
  updated: "2026-08-03",
  sections: [
    // §5 DDG und §18 Abs. 2 MStV verlangen beide Name und Anschrift, und es ist
    // dieselbe Person mit derselben Anschrift. Zwei getrennte Abschnitte hätten
    // die Adresse zweimal auf der Seite stehen — ein Block mit beiden
    // Fundstellen in der Überschrift erfüllt beide Pflichten (2026-08-03).
    {
      heading: "Angaben gemäß § 5 DDG und § 18 Abs. 2 MStV",
      body: [
        // Nils Mlynarek / Konkordiastr. 85 / 40219 Düsseldorf / Deutschland
        // Base64, damit die Anschrift weder im server-gerenderten HTML noch als
        // durchsuchbarer Klartext im JS-Bundle steht — siehe ProtectedText.tsx
        // für das, was das leistet und was nicht.
        { protected: "TmlscyBNbHluYXJlawpLb25rb3JkaWFzdHIuIDg1CjQwMjE5IETDvHNzZWxkb3JmCkRldXRzY2hsYW5k" },
      ],
    },
    {
      heading: "Kontakt",
      body: [
        // Nur E-Mail (Entscheidung 2026-08-03, keine Telefonnummer). §5 DDG
        // verlangt Angaben für "schnelle elektronische Kontaktaufnahme und
        // unmittelbare Kommunikation" und nennt die E-Mail-Adresse ausdrücklich;
        // der EuGH (C-298/07) verlangt einen zweiten Weg, lässt dafür aber
        // jeden Kanal genügen, der zügige und effiziente Kommunikation
        // ermöglicht — ein Telefon ist nicht zwingend. Die Support-Seite
        // (/legal/de/support) beschreibt genau diesen Weg. Falls das je
        // beanstandet wird, ist die Telefonnummer die einfache Nachbesserung.
        "E-Mail: hello@fandex.org",
      ],
    },
    // Kein Umsatzsteuer-Abschnitt (entfernt 2026-08-03, auf Wunsch). §27a UStG
    // verlangt die Angabe der USt-IdNr. nur, WENN eine vorhanden ist — ohne
    // USt-IdNr. gibt es hier nichts anzugeben. Falls später eine erteilt wird,
    // muss der Abschnitt zurück.
    {
      heading: "Verbraucherstreitbeilegung",
      body: [
        "Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
      ],
    },
    {
      heading: "Haftung für Inhalte",
      body: [
        "Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.",
        "Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.",
      ],
    },
    {
      heading: "Haftung für Links",
      body: [
        "Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.",
        "Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.",
      ],
    },
    {
      heading: "Urheberrecht",
      body: [
        "Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet.",
        "Metadaten zu Filmen, Serien und Spielen — einschließlich Titel, Bildmaterial, Beschreibungen und Bewertungen — stammen von Drittanbietern und verbleiben bei den jeweiligen Rechteinhabern. Fandex ist von diesen Anbietern weder unterstützt noch zertifiziert.",
      ],
    },
  ],
};

export default imprint;
