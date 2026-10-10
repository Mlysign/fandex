import type { LegalDocument } from "@/lib/legal/types";

// H4.3: jede Tatsachenbehauptung hier muss aus diesem Repository ableitbar
// sein (eine Tabelle, ein Cookie, ein Anbieter, ein Konfigurationswert).
//
// Neu gefasst am 2026-10-10 für den Umzug zu Cloudflare (docs/app-plan.md).
// Woran jeder Abschnitt geprüft wurde, steht in der englischen Datei; beide
// Fassungen müssen Abschnitt für Abschnitt dasselbe sagen.
// ⚠️ Die 30 Tage für Sicherungen sind eine Lifecycle-Regel am R2-Bucket, kein
// Code. Entfällt die Regel, ist der Satz falsch.
const privacy: LegalDocument = {
  title: "Datenschutzerklärung",
  updated: "2026-10-10",
  intro: [
    "Fandex ist ein Hobbyprojekt einer Einzelperson, kein Unternehmen. Diese Erklärung ist bewusst einfach und exakt formuliert: Sie beschreibt genau, was die App speichert und warum, und ist kein Vorlagentext. Sie stellt keine Rechtsberatung dar und befindet sich in Überarbeitung, bis eine fachliche Rechtsberatung vorliegt (siehe Hinweis zur Anschrift des Verantwortlichen unten).",
    "Sie gilt für die Website fandex.org und für die Fandex-App für Android. Beide sind dieselbe App und funktionieren gleich.",
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
        "Sie können Fandex ohne Konto nutzen: Kalender, Suche und jede Titelseite funktionieren ohne Anmeldung, und es wird nichts über Sie gespeichert. Wenn Sie sich anmelden, fragt Fandex weder Namen noch E-Mail-Adresse ab. Ihr Konto wird ausschließlich über das Anbieterkonto identifiziert, mit dem Sie sich anmelden. Konkret speichert die Datenbank:",
        {
          list: [
            "Konto: eine interne Konto-ID, den Erstellungszeitpunkt, den Tag Ihres letzten Besuchs, Ihr Land und Ihre Anzeige-Einstellungen, sofern Sie sie festlegen (welche Medientypen und Plattformen angezeigt werden sollen), sowie einen Zähler, mit dem Ihre Sitzungen beim Abmelden beendet werden.",
            "Anmelde-Anbieter: mit welchem Anbieter Sie sich angemeldet haben (derzeit Trakt), die Konto-ID und den Anzeigenamen dieses Anbieters für Sie sowie die URL Ihres Avatarbilds, falls der Anbieter eines liefert. Die Server von Fandex speichern weder ein Passwort noch ein Zugriffstoken für Ihr Anbieterkonto.",
            "Ihre Bibliothek und Wunschliste: welche Titel Sie als gesehen oder gespielt markiert haben, welche Sie sich wünschen, Ihre Bewertung und eine etwaige geschriebene Rezension, den Status jedes Eintrags sowie seine Herkunft (Trakt, Steam oder Fandex selbst).",
            "Episoden: welche Episoden einer Serie Sie als gesehen markiert haben.",
            "Ausgeblendete Titel: die Titel, die Fandex Ihnen nicht vorschlagen soll.",
          ],
        },
      ],
    },
    {
      heading: "Was auf Ihrem eigenen Gerät liegt",
      body: [
        "Fandex hält auf dem Gerät, auf dem Sie es nutzen, eine Arbeitskopie vor, damit die App schnell ist und ohne Verbindung funktioniert. Diese Kopie enthält den öffentlichen Katalog, Ihre eigenen Bibliothekseinträge, Ihre Fandex-Sitzung und, wenn Sie sich mit Trakt angemeldet haben, die Trakt-Zugriffstokens.",
        "Im Browser liegt sie im Speicher des Browsers für fandex.org. In der Android-App liegt sie im privaten Speicher der App; Sitzung und Tokens liegen im Schlüsselspeicher des Systems. Die Trakt-Tokens werden ausschließlich verwendet, um von Ihrem Gerät aus mit Trakt zu sprechen. Sie werden nie an die Server von Fandex gesendet, abgesehen von dem einen Moment der Anmeldung, der unten beschrieben ist.",
        "Beim Abmelden werden die Sitzung, die Tokens und Ihre Bibliothekseinträge vom Gerät entfernt.",
      ],
    },
    {
      heading: "Was Fandex NICHT speichert",
      body: [
        "Keine E-Mail-Adresse, kein echter Name (nur der Anzeigename, den Ihr Anbieter liefert), keine Zahlungsdaten (Fandex hat derzeit keine Zahlungsfunktion), kein Anbieter-Passwort oder -Token auf den eigenen Servern und keine Analyse- oder Werbe-Kennungen Dritter.",
      ],
    },
    {
      heading: "Cookies und Gerätespeicher",
      body: [
        "Fandex setzt ein Cookie: ein Sitzungscookie, damit Sie im Browser angemeldet bleiben. Es ist technisch notwendig und dient weder Tracking noch Werbung. Auch der oben beschriebene Gerätespeicher enthält nur, was die App zum Funktionieren braucht. Da all das für einen von Ihnen gewünschten Dienst unbedingt erforderlich ist, verlangt § 25 TDDDG hierfür kein Consent-Banner.",
        "Sollte Fandex jemals Analyse-, Werbe- oder Affiliate-Tracking-Cookies einführen, wird vorher ein Consent-Banner eingeführt, nicht nachträglich.",
      ],
    },
    {
      heading: "Nutzungsstatistik",
      body: [
        "Fandex führt derzeit keine eigene Nutzungsstatistik. Es gibt keine Zählung von Seitenaufrufen, kein Google Analytics, keinen anderen Analysedienst, kein Tracking-Skript, keine Werbe-Kennung und kein Fingerprinting.",
        "Für angemeldete Konten speichert Fandex den Tag, an dem das Konto zuletzt gesehen wurde, höchstens einmal pro Tag. So lässt sich erkennen, wie viele Konten noch genutzt werden. Dieses Datum liegt an Ihrem Konto und wird mit dessen Löschung entfernt.",
        "Sollte Fandex Seitenaufrufe wieder zählen, dann als Tagessummen je Art von Seite und ohne jede Kennung, und dieser Abschnitt beschreibt es, bevor es geschieht.",
      ],
    },
    {
      heading: "Anbieter, mit denen wir zusammenarbeiten, und was ihnen übermittelt wird",
      body: [
        "TMDB und IGDB liefern die von Fandex angezeigten Informationen zu Filmen, Serien und Spielen (Titel, Poster, Beschreibungen, Genres). Keiner von beiden erfährt etwas über Ihr Konto.",
        {
          list: [
            "TMDB (The Movie Database): Die Server von Fandex fragen TMDB nach Titeln. Zusätzlich fragt Ihr Gerät TMDB direkt, wenn Sie in der App suchen. TMDB erhält dann Ihren Suchbegriff und, wie jeder Server, den Sie kontaktieren, Ihre IP-Adresse.",
            "IGDB (Teil von Twitch): Spieleinformationen, ausschließlich von den Servern von Fandex abgefragt. IGDB erhält keinerlei individuelle Informationen über Sie.",
            "Trakt: Wenn Sie sich mit Trakt anmelden, spricht die App auf Ihrem Gerät direkt mit Trakt. Sie liest Ihren Trakt-Verlauf, Ihre Bewertungen und Ihre Merkliste und sendet Ihre Bewertungen, Ihren Sehstatus und Änderungen an der Merkliste an Ihr Trakt-Konto. Die Server von Fandex kontaktieren Trakt einmal, bei der Anmeldung, um zu bestätigen, welches Trakt-Konto sich anmeldet. Das für diese eine Anfrage verwendete Token wird nicht aufbewahrt.",
            "Bilder: Poster und Artwork lädt Ihr Gerät direkt von den Bildservern von TMDB, IGDB und, bei manchen Spielen, Steam und RAWG. Jeder von ihnen erhält beim Laden eines Bildes Ihre IP-Adresse, wie jede Website.",
            "Trailer: Eine Titelseite mit Trailer bindet den Player von YouTube ein. YouTube (Google) erhält Ihre IP-Adresse, wenn diese Seite lädt, und kann eigene Cookies setzen. Was YouTube damit tut, richtet sich nach der Datenschutzerklärung von Google.",
          ],
        },
        "Die meisten dieser Anbieter sitzen in den USA. Was das für Ihre Daten bedeutet, hängt davon ab, um welchen Anbieter es geht. Deshalb hier die Fälle einzeln statt einer pauschalen Aussage:",
        {
          list: [
            "Nur Kataloginformationen: Es verlassen keine personenbezogenen Daten die Server von Fandex. Eine Anfrage von Fandex an TMDB oder IGDB enthält einen Titel oder eine ID und nichts über Sie.",
            "Anfragen, die Ihr eigenes Gerät stellt. Suchen bei TMDB, Bilder und Trailer gehen von Ihrem Gerät an den jeweiligen Anbieter, so wie beim Besuch seiner Website. Sie enthalten Ihre IP-Adresse und nichts aus Ihrem Fandex-Konto.",
            "Das Konto, mit dem Sie sich anmelden. Wenn Sie sich mit Trakt anmelden, gehen Daten an ein Konto, das Sie dort bereits besitzen, auf Ihre Veranlassung und nur solange Sie angemeldet bleiben. Diese Übermittlung erfolgt, weil Sie sie ausdrücklich veranlasst haben (Art. 49 Abs. 1 lit. a DSGVO); ab dem Eingang behandelt Trakt die Daten nach seiner eigenen Datenschutzerklärung, nicht nach dieser.",
            "Der Anbieter, der Daten im Auftrag von Fandex verarbeitet. Das ist Cloudflare: Cloudflare liefert die Website aus, betreibt die Datenbank und ihre Sicherungen und stellt das Postfach hello@fandex.org zu. Die Datenbank und die Sicherungen liegen in der Europäischen Union. Cloudflare sitzt in den USA, und seine Mitarbeitenden können auf das zugreifen, was es für uns hostet; das gilt als Übermittlung. Cloudflare ist daher nach dem EU-US Data Privacy Framework selbstzertifiziert und verpflichtet sich zusätzlich auf die Standardvertragsklauseln der Europäischen Kommission für den Fall, dass diese Zertifizierung entfällt. Stand August 2026. Zertifizierungen können widerrufen werden, dies wird daher nachgeprüft und nicht unterstellt.",
          ],
        },
        "Cloudflare verarbeitet diese Daten im Rahmen des Betriebs des Dienstes und nicht zu eigenen Zwecken. Um eine Seite auszuliefern, sieht Cloudflare zwangsläufig Ihre IP-Adresse, und es führt für einige Tage kurzlebige technische Protokolle über Anfragen (die angefragte Adresse, die Uhrzeit und Angaben wie das Land, aus dem die Anfrage kam).",
      ],
    },
    {
      heading: "Wie lange wir Daten speichern",
      body: [
        "Ihre Kontodaten werden gespeichert, solange Ihr Konto besteht. Wird ein Konto gelöscht, werden alle Tabellen mit Bezug zu Ihnen in einem Schritt gelöscht.",
        "Die Datenbank wird zur Notfallwiederherstellung auf zwei Wegen gesichert: Cloudflare kann sie auf jeden Zeitpunkt der letzten 7 Tage zurücksetzen, und jede Nacht wird eine Kopie in einen Sicherungsspeicher in der Europäischen Union geschrieben und 30 Tage aufbewahrt. Nach einer Kontolöschung können Sicherungen, die vorher entstanden sind, daher bis zu 30 Tage lang noch den Zustand vor der Löschung enthalten, rein als Nebeneffekt dieses Sicherungszyklus und nicht als aktive Aufbewahrung gelöschter Daten.",
      ],
    },
    {
      heading: "Ihre Rechte",
      body: [
        "Nach der DSGVO haben Sie das Recht auf Auskunft über die zu Ihnen gespeicherten Daten, auf Berichtigung, Löschung, Einschränkung oder Widerspruch gegen die Verarbeitung sowie auf Datenübertragbarkeit.",
        {
          list: [
            "Ihre Daten exportieren: Schreiben Sie an hello@fandex.org. Sie werden gebeten nachzuweisen, dass das Konto Ihres ist, bevor etwas versendet wird. Sie erhalten dann eine JSON-Datei mit allem, was die App über Sie speichert, eigenständig lesbar ohne Kenntnis der internen Struktur der App.",
            "Ihr Konto löschen: Schreiben Sie an hello@fandex.org, mit derselben Prüfung. Jede Tabelle mit Bezug zu Ihnen wird gelöscht. Dies ist unwiderruflich; es gibt kein Rückgängigmachen.",
          ],
        },
        "Beides wird wieder als Schaltfläche in den Einstellungen der App verfügbar sein. Bis dahin ist der Weg die E-Mail, und es antwortet ein Mensch.",
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
