import type { LegalDocument } from "@/lib/legal/types";

// H4.3 — jede Tatsachenbehauptung hier muss aus diesem Repository ableitbar
// sein (eine Tabelle, ein Cookie, ein Anbieter in der Registry, ein
// Konfigurationswert). Wo eine Tatsache aus dem Code nicht verifizierbar ist,
// steht ein TODO(H4.3) statt einer Vermutung.
const privacy: LegalDocument = {
  title: "Datenschutzerklärung",
  updated: "2026-08-19",
  intro: [
    "Fandex ist ein Hobbyprojekt einer Einzelperson, kein Unternehmen. Diese Erklärung ist bewusst einfach und exakt formuliert: Sie beschreibt genau, was die App speichert und warum, und ist kein Vorlagentext. Sie stellt keine Rechtsberatung dar und befindet sich in Überarbeitung, bis eine fachliche Rechtsberatung vorliegt (siehe Hinweis zur Anschrift des Verantwortlichen unten).",
  ],
  sections: [
    {
      heading: "Verantwortlicher",
      body: [
        "Nils Mlynarek, erreichbar unter hello@fandex.org.",
        "Die vollständige ladungsfähige Anschrift des Verantwortlichen ist im Impressum veröffentlicht, das Bestandteil dieser Erklärung ist.",
      ],
    },
    {
      heading: "Welche Daten Fandex über Sie speichert",
      body: [
        "Fandex fragt weder Namen noch E-Mail-Adresse ab. Ihr Konto wird ausschließlich über die von Ihnen verknüpften Anbieterkonten identifiziert. Konkret speichert die Datenbank der App:",
        {
          list: [
            "Konto: eine interne Konto-ID, Erstellungszeitpunkt, Zeitpunkt des letzten Besuchs, Ihre Ländereinstellung (zur Lokalisierung von Erscheinungsterminen und Streaming-Verfügbarkeit) sowie einen Zähler zur Sitzungsungültigmachung, der beim Abmelden oder Trennen eines Anbieters verwendet wird.",
            "Verknüpfte Anbieter: welchen Anbieter (Trakt, Steam, TMDB, RAWG; siehe „Anbieter, mit denen wir zusammenarbeiten“ unten) Sie verknüpft haben, die Konto-ID und den Anzeigenamen dieses Anbieters für Sie, die URL Ihres Avatarbilds, falls der Anbieter eines liefert, sowie ein Zugriffstoken (und ggf. ein Refresh-Token), damit die App in Ihrem Namen handeln kann. Tokens werden vor der Speicherung verschlüsselt. Die Datenbank enthält sie nie im Klartext.",
            "Ihre Bibliothek: welche Titel Sie als gesehen/gespielt markiert haben, Ihre Bewertung und eine etwaige geschriebene Rezension sowie von welchem verknüpften Anbieter der jeweilige Eintrag stammt.",
            "Ihre Wunschliste: welche Titel Sie sich wünschen und von welchem Anbieter diese jeweils stammen.",
            "Anbieterspezifischer Titelstatus: für Titel mit differenziertem Status je Anbieter (z. B. „in Bearbeitung“ bei einem Dienst) ein Datensatz pro Anbieter mit Status, Bewertung und Rezension dieses Titels.",
            "Synchronisationsverlauf: ein Protokoll jedes Synchronisationslaufs je Anbieter (Zeitpunkt, Anzahl der betroffenen Einträge und Erfolg), ausschließlich zur Fehlerdiagnose bei der Synchronisation genutzt.",
          ],
        },
      ],
    },
    {
      heading: "Was Fandex NICHT speichert",
      body: [
        "Keine E-Mail-Adresse, kein echter Name (nur der Anzeigename, den Ihr verknüpfter Anbieter liefert), keine Zahlungsdaten (Fandex hat derzeit keine Zahlungsfunktion) und keine Analyse- oder Werbe-Kennungen Dritter. Fandex zählt zwar Seitenaufrufe, tut dies aber selbst und ohne jede Identifizierung; siehe „Nutzungsstatistik“ weiter unten.",
      ],
    },
    {
      heading: "Cookies",
      body: [
        "Fandex setzt drei Cookies, alle technisch notwendig für die Funktion der App und keines zu Tracking- oder Werbezwecken: ein Sitzungscookie, damit Sie angemeldet bleiben, sowie zwei kurzlebige (10 Minuten) Sicherheitscookies, die ausschließlich während des Verbindens eines Anbieterkontos verwendet werden, um eine standortübergreifende Fälschung dieser Verbindung zu verhindern. Da jedes Cookie technisch notwendig ist, verlangt § 25 TDDDG hierfür kein Consent-Banner. Diese Einschätzung sowie die vollständige Liste mit exakten Namen und Laufzeiten sind gesondert dokumentiert.",
        "Sollte Fandex jemals Analyse-, Werbe- oder Affiliate-Tracking-Cookies einführen, wird vorher ein Consent-Banner eingeführt, nicht nachträglich.",
      ],
    },
    {
      heading: "Nutzungsstatistik",
      body: [
        "Fandex zählt, wie stark die Seite genutzt wird, damit der Betreiber einschätzen kann, ob sich der weitere Betrieb lohnt. Gezählt wird von Fandex selbst, in der eigenen Datenbank. Es gibt kein Google Analytics, keinen anderen Analysedienst Dritter, kein Tracking-Skript, keine Werbe-Kennung und kein Fingerprinting.",
        "Erfasst wird: der Kalendertag, um welche ART von Seite es sich handelte, ob die Person angemeldet war, sowie eine grobe Kategorie für die Herkunft des Aufrufs (Suchmaschine, soziales Netzwerk, ein Link innerhalb von Fandex oder gar kein Verweis). „Art von Seite“ bedeutet ein Routen-Muster: Der Aufruf einer bestimmten Tag-, Personen- oder Titelseite wird nur als „eine Tag-Seite“, „eine Personenseite“ bzw. „eine Titelseite“ gezählt, niemals als die konkrete Seite, die Sie angesehen haben.",
        "Nicht erfasst wird: irgendeine Kennung. Keine Nutzer-ID, keine IP-Adresse, keine Sitzungs-ID, keine Geräte- oder Browserdaten und keine Uhrzeit, die genauer wäre als der Tag. Gespeichert werden ausschließlich laufende Tagessummen. Es gibt darin nichts, was sich auf Sie zurückführen ließe, und keine Möglichkeit, das Verhalten einer einzelnen Person zu rekonstruieren.",
        "Da nichts auf Ihrem Endgerät gespeichert oder ausgelesen wird, ist hierfür kein Consent-Banner nach § 25 TDDDG erforderlich; und da keine personenbezogenen Daten aufbewahrt werden, gibt es hier auch keinen Anknüpfungspunkt für die DSGVO. Die Übermittlung einer Zählung ist ein gewöhnlicher Web-Request und macht wie jeder Request an jede Website kurzzeitig Ihre IP-Adresse gegenüber dem Server sichtbar; sie wird ausschließlich für die Rate-Begrenzung verwendet, genau wie in jedem anderen Teil der App, und niemals zusammen mit den Zählungen gespeichert.",
        "Für angemeldete Konten speichert Fandex zusätzlich das Datum, an dem das Konto zuletzt gesehen wurde, höchstens einmal pro Tag. So lässt sich erkennen, wie viele Konten noch genutzt werden. Dieses Datum liegt an Ihrem Konto und wird mit dessen Löschung entfernt.",
        "Diese Statistiken sind ausschließlich für den Betreiber sichtbar.",
      ],
    },
    {
      heading: "Anbieter, mit denen wir zusammenarbeiten, und was wir ihnen übermitteln",
      body: [
        "TMDB, RAWG und IGDB liefern die von Fandex angezeigten Film-/Serien-/Spielmetadaten (Titel, Poster, Beschreibungen, Genres). Die App fragt sie anhand eines Titels oder einer ID ab und übermittelt ihnen nichts über Sie, sofern Sie nicht Ihr eigenes Konto bei diesem Anbieter verknüpfen.",
        {
          list: [
            "TMDB (The Movie Database): Metadaten immer; wenn Sie Ihr TMDB-Konto verknüpfen, sendet die App außerdem Ihre eigenen Bewertungen und Wunschlisten-Aktionen an Ihr TMDB-Konto und liest diese zurück.",
            "Trakt: wenn Sie Ihr Trakt-Konto verknüpfen, sendet die App Ihre Bewertungen, Ihren Sehstatus und Ihre Wunschlisten-Aktionen an Ihr Trakt-Konto und liest Ihre bestehende Trakt-Bibliothek zurück.",
            "RAWG: Spielemetadaten immer; wenn Sie Ihr RAWG-Konto verknüpfen, sendet die App außerdem Ihre Bewertungen und Wunschlisten-Aktionen dorthin und liest diese zurück.",
            "Steam: wenn Sie Ihr Steam-Konto verknüpfen, liest die App Ihre besessenen Spiele und Spielzeit aus. Die Steam-API unterstützt kein Zurückschreiben von Bewertungen oder Wunschlisten-Änderungen, daher wird außer der Leseanfrage selbst nichts an Steam gesendet.",
            "IGDB: ausschließlich Spielemetadaten, über einen anwendungsseitigen API-Schlüssel. IGDB erhält keinerlei individuelle Informationen über Sie.",
          ],
        },
        "Die meisten dieser Anbieter sitzen in den USA. Was das für Ihre Daten bedeutet, hängt davon ab, um welchen Anbieter es geht. Deshalb hier die Fälle einzeln statt einer pauschalen Aussage:",
        {
          list: [
            "Nur Metadaten: Es verlassen keine personenbezogenen Daten Fandex. IGDB immer, sowie TMDB und RAWG, solange Sie dort kein Konto verbunden haben, erhalten einen Titel oder eine ID und nichts über Sie. Es findet keine Übermittlung personenbezogener Daten statt, für die es einer Grundlage bedürfte.",
            "Von Ihnen selbst verbundene Konten. Wenn Sie Ihr TMDB-, Trakt-, RAWG- oder Steam-Konto verbinden, gehen Daten an ein Konto, das Sie dort bereits besitzen, auf Ihre Veranlassung und nur solange die Verbindung besteht; Sie können sie jederzeit in den Einstellungen trennen. Diese Übermittlung erfolgt, weil Sie sie ausdrücklich veranlasst haben (Art. 49 Abs. 1 lit. a DSGVO); ab dem Eingang behandelt der jeweilige Anbieter die Daten nach seiner eigenen Datenschutzerklärung, nicht nach dieser.",
            "Anbieter, die Daten im Auftrag von Fandex verarbeiten. Das sind Railway (Hosting einschließlich der Datenbank) und Cloudflare (DNS sowie die Zustellung des Postfachs hello@fandex.org). Beide sind nach dem EU-US Data Privacy Framework selbstzertifiziert und verpflichten sich zusätzlich auf die Standardvertragsklauseln der Europäischen Kommission für den Fall, dass diese Zertifizierung entfällt. Stand August 2026. Zertifizierungen können widerrufen werden, dies wird daher nachgeprüft und nicht unterstellt.",
          ],
        },
        "Fandex wird bei Railway gehostet; DNS und das Kontakt-Postfach hello@fandex.org laufen über Cloudflare. Beide Anbieter verarbeiten Daten im Rahmen des Betriebs des Dienstes (Hosting der Datenbank, Auslieferung der App, Weiterleitung der einzigen Kontaktadresse) und nicht zu eigenen Zwecken.",
      ],
    },
    {
      heading: "Wie lange wir Daten speichern",
      body: [
        "Ihre Kontodaten werden gespeichert, solange Ihr Konto besteht. Löschen Sie Ihr Konto (Einstellungen → Ihre Daten), werden alle Tabellen mit Bezug zu Ihnen in einer Transaktion gelöscht. Siehe „Löschung Ihres Kontos“ unten dazu, wie das tatsächlich umgesetzt ist, nicht nur zugesichert wird.",
        "Die Datenbank wird zur Notfallwiederherstellung fortlaufend gesichert. Sicherungs-Snapshots werden 24 Stunden aufbewahrt, bevor sie durch einen neuen ersetzt werden. Nach einer Kontolöschung kann daher ein kurzes Zeitfenster (bis zu 24 Stunden) bestehen, in dem ein Sicherungs-Snapshot noch den Zustand vor der Löschung widerspiegelt, rein als Nebeneffekt dieses Sicherungszyklus und nicht als aktive Aufbewahrung gelöschter Daten.",
        "CSP-Verletzungsberichte (ein Sicherheitsmechanismus, der protokolliert, wenn der Browser eine von der App nicht beabsichtigte Ressource blockiert) werden in die Server-Logs von Railway geschrieben. Dies sind Betriebsprotokolle, keine Datenbanktabelle mit eigener Aufbewahrungsfrist.",
      ],
    },
    {
      heading: "Ihre Rechte",
      body: [
        "Nach der DSGVO haben Sie das Recht auf Auskunft über die zu Ihnen gespeicherten Daten, auf Berichtigung, Löschung, Einschränkung oder Widerspruch gegen die Verarbeitung sowie auf Datenübertragbarkeit. Zwei dieser Rechte sind bereits selbstbedienbar umgesetzt, nicht nur zugesichert:",
        {
          list: [
            "Ihre Daten exportieren: Einstellungen → Ihre Daten → Download einer JSON-Datei mit allem, was die App über Sie speichert, eigenständig lesbar ohne Kenntnis der internen Struktur der App.",
            "Ihr Konto löschen: Einstellungen → Ihre Daten → ein Bestätigungsdialog (Tippen zum Bestätigen), der jede Tabelle mit Bezug zu Ihnen löscht. Dies ist unwiderruflich; es gibt kein Rückgängigmachen.",
          ],
        },
        "Für alles Weitere, etwa Berichtigung, Einschränkung oder Widerspruch, kontaktieren Sie hello@fandex.org.",
        "Sie haben zudem das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren. Nach Art. 77 DSGVO können Sie sich an die Behörde des EU- oder EWR-Staates wenden, in dem Sie wohnen, in dem Sie arbeiten oder in dem der mutmaßliche Verstoß stattgefunden hat. Es muss keine deutsche Behörde sein, auch wenn der Verantwortliche von Fandex in Deutschland ansässig ist.",
      ],
    },
    {
      heading: "Änderungen dieser Erklärung",
      body: [
        "Dies ist ein lebendes Dokument für ein Projekt, das selbst noch im Aufbau ist; siehe dazu das Datum „Zuletzt aktualisiert“ oben auf der Seite. Wesentliche Änderungen (z. B. ein neuer Anbieter, Analyse-Funktionen oder eine Zahlungsfunktion) aktualisieren dieses Datum.",
      ],
    },
  ],
};

export default privacy;
