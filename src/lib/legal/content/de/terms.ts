import type { LegalDocument } from "@/lib/legal/types";

// H4.5 — Nutzungsbedingungen für den kostenlosen Dienst, plus
// monetarisierungsbereite Abschnitte, markiert TODO(H3): Fandex' festgelegtes
// v1-Monetarisierungsmodell ist ausschließlich Spenden + Affiliate-Links
// (TASKS.md H3, 2026-07-18) — keines davon ist ein direkter Verkauf durch
// Fandex, daher beschreiben die Zahlungs-/Widerrufs-/Preisänderungsabschnitte
// unten eine mögliche spätere Stufe (Path B), die nicht ausgelöst wurde, kein
// heute aktives Merkmal. Keine Rechtsberatung.
const terms: LegalDocument = {
  title: "Nutzungsbedingungen",
  updated: "2026-07-30",
  intro: [
    "Fandex ist ein kostenloses Hobbyprojekt einer Einzelperson. Diese Bedingungen sind bewusst einfach und ehrlich formuliert, kein Vorlagentext. Sie stellen keine Rechtsberatung dar und befinden sich in Überarbeitung, bis eine fachliche Rechtsberatung vorliegt.",
  ],
  sections: [
    {
      heading: "Der Dienst",
      body: [
        "Fandex ist ein kostenloses Verzeichnis- und Geschmacks-Tracking-Tool für Filme, Serien und Spiele. Es gibt derzeit keine Zahlungsfunktion — nichts in der App verlangt aktuell Geld. Fandex wird von Nils Mlynarek bereitgestellt (Kontaktangaben siehe Datenschutzerklärung).",
      ],
    },
    {
      heading: "Ihr Konto",
      body: [
        "Sie legen kein Fandex-eigenes Passwort an. Sie melden sich an, indem Sie ein Anbieterkonto verknüpfen (Trakt, Steam, TMDB oder RAWG); Fandex identifiziert Sie über diese Verknüpfung. Für die Sicherheit Ihres Anbieterkontos sind Sie selbst verantwortlich — Fandex verwaltet keine eigenen Zugangsdaten dazu.",
        // H4.10 (2026-08-02) — deutsche Entsprechung des EN-Absatzes; siehe dort
        // für die Begründung und die geprüfte Code-Grundlage.
        "Ein Unterschied sei ausdrücklich genannt: Trakt, Steam und TMDB nutzen eine weiterleitungsbasierte Anmeldung — Ihr Passwort geben Sie dort ein, Fandex bekommt es nie zu sehen. Für RAWG existiert kein solcher Weg; das Anmeldeformular wird deshalb von Fandex bereitgestellt, und Ihr RAWG-Passwort läuft über den Server von Fandex, um von RAWG ein Sitzungs-Token abzurufen. Das Passwort wird ausschließlich für diese eine Anfrage verwendet und nicht gespeichert — aufbewahrt wird nur das daraus resultierende RAWG-Token, verschlüsselt. Wenn Sie nicht möchten, dass Fandex Ihr Passwort überhaupt verarbeitet, verknüpfen Sie stattdessen einen der drei anderen Anbieter.",
      ],
    },
    {
      heading: "Zulässige Nutzung",
      body: [
        "Nutzen Sie Fandex für seinen vorgesehenen Zweck: das Verfolgen und Entdecken von Medien. Versuchen Sie nicht, Ratenbegrenzungen zu umgehen, den Katalog in einem Umfang zu scrapen, der den Dienst für andere beeinträchtigt, oder die Anbieterintegrationen für etwas anderes als das Synchronisieren Ihrer eigenen Bibliothek und Bewertungen zu nutzen.",
      ],
    },
    {
      heading: "Ihre Inhalte",
      body: [
        "Bewertungen, Rezensionen sowie Bibliotheks- und Wunschlisteneinträge, die Sie in Fandex erstellen, gehören Ihnen. Sofern sie zusätzlich mit einem verknüpften Anbieter synchronisiert werden (z. B. eine an Ihr Trakt-Konto übertragene Bewertung), unterliegt diese Kopie den Bedingungen dieses Anbieters, nicht diesen hier. Fandex beansprucht keine Rechte an Ihren Inhalten und teilt Ihre Rezensionen nicht öffentlich in Ihrem Namen, außer im Rahmen dessen, was Sie bei einem verknüpften Anbieter konfiguriert haben.",
      ],
    },
    {
      heading: "Verfügbarkeit",
      body: [
        "Dies ist ein von einer Einzelperson betriebenes Hobbyprojekt, kein Unternehmen mit einer Verfügbarkeitszusage. Fandex wird „wie besehen“ bereitgestellt, ohne Verfügbarkeitsgarantie, und der Dienst kann jederzeit pausiert, geändert oder eingestellt werden. Sollte er dauerhaft abgeschaltet werden, ist der selbstbedienbare Datenexport (Einstellungen → Ihre Daten) der Weg, Ihre eigenen Daten vorher mitzunehmen — ihn zu nutzen, solange der Dienst noch läuft, ist die richtige Vorgehensweise, falls dies eine Sorge ist.",
      ],
    },
    {
      heading: "Beendigung der Nutzung",
      body: [
        "Sie können die Nutzung von Fandex jederzeit beenden, indem Sie die App einfach nicht mehr verwenden, einen Anbieter in den Einstellungen trennen oder Ihr Konto samt allem, was Fandex über Sie speichert, dauerhaft löschen (Einstellungen → Ihre Daten). Die Kontolöschung ist unwiderruflich — die genauen Löschvorgänge sind in der Datenschutzerklärung beschrieben.",
        "Fandex kann den Zugang bei einem Verstoß gegen den obigen Abschnitt zur zulässigen Nutzung aussetzen oder beenden.",
      ],
    },
    {
      heading: "Haftung",
      body: [
        "Fandex wird kostenlos und ohne Gewähr bereitgestellt. Soweit gesetzlich zulässig, ist die Haftung für Schäden auf Vorsatz und grobe Fahrlässigkeit beschränkt; dies berührt nicht die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie sonstige nach deutschem Recht nicht beschränkbare Haftung.",
      ],
    },
    {
      heading: "Anwendbares Recht",
      body: [
        "Diese Bedingungen unterliegen dem Recht der Bundesrepublik Deutschland, unbeschadet zwingender verbraucherschutzrechtlicher Bestimmungen Ihres Wohnsitzstaates.",
      ],
    },
    {
      heading: "Künftige Monetarisierung (heute nicht aktiv)",
      body: [
        "Fandex finanziert sich derzeit ausschließlich über Spenden und Affiliate-Links — keines davon ist ein direkter Verkauf durch Fandex an Sie, daher lösen sie die folgenden Abschnitte nicht von sich aus aus. Die nachfolgenden Abschnitte sind Platzhalter für eine mögliche spätere Stufe, etwa eine einmalige werbefreie Freischaltung oder eine kostenpflichtige Stufe. Ein solches Merkmal existiert heute nicht; die Abschnitte werden erst wirksam, wenn ein solches Angebot tatsächlich eingeführt und hier bekannt gegeben wird.",
        {
          list: [
            "Zahlungs- und Abonnementbedingungen — Preisgestaltung, Abrechnungszyklus und der genutzte Zahlungsdienstleister würden hier festgelegt, sobald (falls) ein kostenpflichtiges Merkmal eingeführt wird.",
            "Widerrufsrecht für digitale Inhalte — nach deutschem Recht (§ 356 Abs. 5 BGB) kann das übliche 14-tägige Widerrufsrecht bei Online-Käufen für digitale Inhalte vorzeitig erlöschen, sobald Sie der sofortigen Bereitstellung ausdrücklich zugestimmt und zur Kenntnis genommen haben, dass Sie dadurch Ihr Widerrufsrecht verlieren. Sollte je ein kostenpflichtiges digitales Merkmal eingeführt werden, würden der genaue Zustimmungsablauf und die Mechanik des Verzichts hier beschrieben, nicht unterstellt.",
            "Preisänderungsklausel — wie weit im Voraus Sie über eine Preisänderung informiert würden und was mit einem bestehenden Abonnement geschieht.",
          ],
        },
      ],
    },
  ],
};

export default terms;
