import type { LegalDocument } from "@/lib/legal/types";

// H4.8 — Support-/Kontaktseite rund um die bereits aktive hello@fandex.org.
const support: LegalDocument = {
  title: "Support",
  updated: "2026-07-30",
  intro: [
    "Fandex wird von einer einzelnen Person als Hobbyprojekt neben allem anderen im Leben betrieben — kein Unternehmen mit einem Support-Team. Hier ist, was das für Sie konkret bedeutet.",
  ],
  sections: [
    {
      heading: "Kontakt",
      body: [
        "hello@fandex.org — für Fehlermeldungen, Fragen zu Ihrem Konto (auch zu Ihren Daten) oder allgemeines Feedback.",
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
        "Zwei Dinge sind bereits selbstbedienbar und benötigen keine E-Mail — beide unter Einstellungen → Ihre Daten:",
        {
          list: [
            "Alles herunterladen, was Fandex über Sie speichert, als Datei zum Behalten.",
            "Ihr Konto und alles darin dauerhaft löschen.",
          ],
        },
        "Betrifft Ihre Frage eines dieser beiden Themen, müssen Sie möglicherweise gar nicht auf eine Antwort warten.",
      ],
    },
    {
      heading: "Fehlermeldungen",
      body: [
        "Je konkreter, desto schneller kann sich das tatsächlich jemand ansehen: was Sie gemacht haben, was Sie erwartet haben, was stattdessen passiert ist — und, falls es einen bestimmten Titel betrifft, welchen.",
      ],
    },
  ],
};

export default support;
