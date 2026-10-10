import type { LegalDocument } from "@/lib/legal/types";

// H4.8 — Support-/Kontaktseite rund um die bereits aktive hello@fandex.org.
const support: LegalDocument = {
  title: "Support",
  updated: "2026-10-10",
  intro: [
    "Fandex wird von einer einzelnen Person als Hobbyprojekt neben allem anderen im Leben betrieben, nicht als Unternehmen mit einem Support-Team. Hier ist, was das für Sie konkret bedeutet.",
  ],
  sections: [
    {
      heading: "Kontakt",
      body: [
        "hello@fandex.org, für Fehlermeldungen, Fragen zu Ihrem Konto (auch zu Ihren Daten) oder allgemeines Feedback.",
      ],
    },
    {
      heading: "Was Sie erwarten können",
      body: [
        "Echtes Bemühen, im Tempo eines Hobbyprojekts: mal am selben Tag, mal erst nach ein paar Wochen, je nachdem, was gerade sonst ansteht. Es gibt keine Service-Level-Vereinbarung und kein garantiertes Antwortfenster.",
      ],
    },
    {
      heading: "Bevor Sie schreiben",
      body: [
        "Zwei Anliegen kommen am häufigsten vor, und beide gehen an die Adresse oben:",
        {
          list: [
            "Alles erhalten, was Fandex über Sie speichert, als Datei zum Behalten.",
            "Ihr Konto und alles darin dauerhaft löschen.",
          ],
        },
        "In beiden Fällen werden Sie zuerst gebeten nachzuweisen, dass das Konto Ihres ist. Beides wird wieder als Schaltfläche in den Einstellungen der App verfügbar sein; bis dahin ist dies der Weg.",
      ],
    },
    {
      heading: "Fehlermeldungen",
      body: [
        "Je konkreter, desto schneller kann sich das tatsächlich jemand ansehen: was Sie gemacht haben, was Sie erwartet haben, was stattdessen passiert ist, und, falls es einen bestimmten Titel betrifft, welchen.",
      ],
    },
    // H3.3, 2026-08-03. Bewusst OHNE konkrete Kostenangabe (Nils) — eine Zahl
    // müsste bei jeder Änderung der Railway-Rechnung nachgezogen werden, und
    // veraltete Angaben sind auf einer Seite über Geld schlimmer als eine
    // unspezifische Formulierung. Bewusst der LETZTE Abschnitt und bewusst
    // ohne Gegenleistung:
    // eine Spende mit Gegenleistung wäre eine steuerbare Leistung und zugleich
    // ein deutlich stärkeres Argument für "kommerzielle Nutzung" gegenüber der
    // ausschließlich nicht-kommerziellen TMDB-Gratisstufe.
    {
      heading: "Fandex finanziell unterstützen",
      body: [
        "Fandex ist kostenlos, zeigt keine Werbung und verkauft oder teilt Ihre Daten nicht. Daran soll sich nichts ändern. Der Betrieb kostet trotzdem Geld: Hosting, Domain und die Dienste, aus denen die Daten stammen, gehen alle auf eigene Rechnung.",
        {
          rich: [
            "Wer dabei helfen möchte, findet eine Spendenseite unter ",
            { href: "https://ko-fi.com/nilsmlynarek", label: "ko-fi.com/nilsmlynarek", external: true },
            ". Das ist ausdrücklich freiwillig.",
          ],
        },
        "Was eine Spende nicht bewirkt: Es gibt keine Unterstützerstufen, keine Vorteile, keine Funktionen hinter einer Bezahlschranke und keinen früheren Zugang. Alle bekommen dasselbe Fandex. Eine Spende deckt Betriebskosten. Sie kauft weder Vorrang noch Mitsprache darüber, was als Nächstes gebaut wird.",
      ],
    },
  ],
};

export default support;
