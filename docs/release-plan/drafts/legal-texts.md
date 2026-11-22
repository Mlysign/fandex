# Legal text changes before launch (draft)

**This is a draft by an AI, not legal advice. Nils decides, and nothing here is live until he approves it and it is copied into `src/lib/legal/content/{en,de}/`.**

Written 2026-11-22. Every claim about Fandex was checked against the code named next to it. Line numbers are for the files as they are today. Both languages change together, and each changed page gets a new `updated` date.

Sections:

1. Imprint: the VAT ID, and the business name
2. Privacy policy: "Usage statistics" replaced in full
3. Privacy policy: the other out-of-date spots
4. Terms: monetization, and the rest that is stale
5. Provider notices
6. Google Play's trader declaration

Then: decisions only Nils can take.

---

## 1. Imprint

### 1a. The VAT ID line

**WHERE.** A new section after "Contact" / "Kontakt", where the comment says it belongs: `en/imprint.ts` lines 44 to 46, `de/imprint.ts` lines 61 to 64 (replace the comment block with the section).

**CURRENT.** No section. The comment says: "No VAT section (removed 2026-08-03, as requested). § 27a UStG only requires stating a VAT identification number IF one exists... If one is ever issued, the section comes back."

**PROPOSED (EN).**

```ts
{
  heading: "VAT identification number",
  body: [
    "VAT identification number under § 27a of the German VAT Act (Umsatzsteuergesetz): [USt-IdNr]",
  ],
},
```

**PROPOSED (DE).**

```ts
{
  heading: "Umsatzsteuer-ID",
  body: [
    "Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz: [USt-IdNr]",
  ],
},
```

**Which number.** § 5 Abs. 1 Nr. 6 DDG asks for "eine Umsatzsteueridentifikationsnummer nach § 27a ... **oder** eine Wirtschafts-Identifikationsnummer nach § 139c ... AO" (gesetze-im-internet.de/ddg/__5.html, read 2026-11-22). The word is "or": one of the two is enough. Show the USt-IdNr. It is the number people and other businesses know and can check in the EU's VIES service. Showing the W-IdNr as well is allowed but adds nothing. For a business that already has a USt-IdNr, the W-IdNr is normally that same number with a five-digit suffix (as the BZSt describes it; not re-read today).

**WHY.** § 5 DDG requires the number once it exists, and both numbers now exist. The comment in the file already says the section has to come back.

Also update the German file's header comment (line 12, "§27a UStG: USt-IdNr., falls vorhanden") to cite § 5 Abs. 1 Nr. 6 DDG, which is the rule that actually puts it in the imprint.

### 1b. Name and business name

**WHERE.** The protected block, `en/imprint.ts` line 34 and `de/imprint.ts` line 44. It is base64. Regenerate it with the command in `src/lib/legal/types.ts` line 26.

**CURRENT (decoded).** Four lines: the full name, the street, the postcode and city, the country. Nothing about InFlucx.

**PROPOSED (EN), decoded, before encoding.**

```text
Nils Mlynarek
InFlucx (sole trader)
[street, as today]
[postcode and city, as today]
Germany
```

**PROPOSED (DE), decoded, before encoding.**

```text
Nils Mlynarek
InFlucx (Einzelunternehmen)
[Straße, wie heute]
[PLZ und Ort, wie heute]
Deutschland
```

The address is left as a placeholder on purpose: this repo is public and the file keeps it out of plain text.

**WHY.** For a sole trader the law's "name" is the owner's full name, which is already there. A business name that is not in the commercial register may be added, but never on its own and never with a suffix like "e.K." Adding "InFlucx" means the imprint matches what Google Play will show once the account is a business account (section 6). § 5 DDG asks for a legal form only from legal persons (Nr. 1: "bei juristischen Personen zusätzlich die Rechtsform"), so "Einzelunternehmen" is a courtesy, not a duty.

### 1c. The rest of the imprint, checked against § 5 DDG and § 18 MStV

| Item | Verdict |
|---|---|
| Name and address (§ 5 Abs. 1 Nr. 1) | Present. Add InFlucx (1b). |
| Fast electronic contact plus direct communication (Nr. 2) | Email is present. The ECJ (C-298/07) wants a second channel; the file argues the support page is it. That still holds. Once Play shows a phone number publicly (section 6), adding the same number here costs nothing and closes the question. Nils's call. |
| Register and register number (Nr. 4) | Not needed. A sole trader with a Gewerbe registration is not in the commercial register. If InFlucx is ever entered, the register line becomes required. |
| Supervisory authority, professional rules (Nr. 3, 5) | Not applicable. |
| VAT ID (Nr. 6) | Missing. 1a. |
| § 18 Abs. 2 MStV (responsible for editorial content) | Covered by the shared heading and block. Fine as is. |
| § 36 VSBG statement | Fine. A business with ten or fewer staff does not have to make it, but making it does no harm. |
| Kleinunternehmer (§ 19 UStG) | Not an imprint item. It belongs on invoices only. |
| "Copyright" paragraph, `en` line 71, `de` line 89 | Says "films, shows and games". Books are live. Proposed EN: "Metadata about films, shows, games and books, including titles, artwork, descriptions and ratings, comes from third-party providers and remains with the respective rights holders. Fandex is not endorsed or certified by any of them." DE: "Metadaten zu Filmen, Serien, Spielen und Büchern, einschließlich Titel, Bildmaterial, Beschreibungen und Bewertungen, stammen von Drittanbietern und verbleiben bei den jeweiligen Rechteinhabern. Fandex ist von diesen Anbietern weder unterstützt noch zertifiziert." |
| Robots rules (noindex, out of the sitemap) | Untouched. |

---

## 2. Privacy policy: "Usage statistics" / "Nutzungsstatistik"

**WHERE.** Replace the whole `body` of the section: `en/privacy.ts` lines 82 to 93, `de/privacy.ts` lines 64 to 75. The heading stays.

**CURRENT.** Seven paragraphs: pageviews on the website, the no-identifier promise, the § 25 TDDDG argument for the website, "Only pages opened in a web browser are counted. The Android app sends no counts." / „Die Android-App übermittelt keine Zählungen.", the last-seen day, the score report.

**What the code does (checked).**

- Server (`worker/src/usage.ts`, `auth/session.ts` line 123, `index.ts` lines 626 to 630): `active` (an account's first request of the day), `wactive` (first of the week), `ret:<signup week>`, `signup:<provider>`, `link:<provider>` (a provider added to an existing account), `req:<kind>` for 13 kinds of request, `err:<status>` for 5xx and 429. Table `usage_daily` (migration 0010): day, key, total. No user id column.
- The admin Usage page also reads three totals straight from `users` and `user_item_state`, worked out when the page opens: accounts by how many media types they rated in, new accounts per signup week that rated five titles within seven days, accounts that added a first title of a type they had none of.
- App (`mobile/src/lib/usageCounts.ts`, `APP_COUNT_KEYS` in `usage.ts` line 178): counts held in a Map in memory; one batch on going to the background; at most 20 batches a UTC day; a failed send is dropped; the batch is sent with `anonymous: true` (`mobile/src/lib/api.ts` line 465), so no session token; no install or device id. Stored on the phone (`setMeta`, the device's SQLite): the switch (`usage_counts`), the day's batch count (`usage_batches`), and the last day each flag went out (`usage_flag:*`). The server rate-limits by IP (`index.ts` line 292) and keeps nothing about the sender.
- Two accepted keys are never sent by today's app: `screen:discover` (the Search tab is `/discover` and counts as `screen:search`) and `reminder:arrived` (no code counts it). The text below lists what the server accepts, so it stays true if the app starts sending them.

**PROPOSED (EN).**

```ts
body: [
  "Fandex counts how much it is used, so the operator can tell what works, what breaks, and whether it is worth continuing to run. The counting is done by Fandex itself, in its own database. There is no Google Analytics, no other third-party analytics service, no tracking script, no advertising identifier and no fingerprinting.",
  "Every count is a running total for one calendar day, such as \"the calendar was opened 312 times on 3 March\". No count holds a user id, a device id, an IP address, or a time more precise than the day, and none records a single event. There is no way to work out from them what any one person did.",
  "On the website, each page opened adds to a count of: the day, what KIND of page it was, whether the visitor was signed in, and a coarse category for where the visit came from (a search engine, a social site, a link inside Fandex, or no referrer at all). \"Kind of page\" means a route template, so opening a specific tag, person or title page is recorded only as \"a tag page\", \"a person page\" or \"a title page\", never as the particular one you looked at.",
  "Fandex's servers also count, by themselves:",
  {
    list: [
      "how many accounts were active on each day and in each week. An account counts as active on its first request of the day, at the moment its last-seen day is stamped (see below). The count records that an account was active, not which one;",
      "of the accounts active in a week, how many signed up in each earlier calendar week, so the operator can see whether people come back. A signup week is shared by everyone who joined in it, so it identifies nobody;",
      "new accounts per sign-in method (Trakt, Google or Discord), and how often a further provider, such as Steam, was connected to an existing account;",
      "how many requests of each kind the servers answered (a search, a title page, the calendar, your library, and so on);",
      "how many requests failed, or were turned away because there was too much traffic.",
    ],
  },
  "The operator can also see a few totals worked out from what accounts already store, at the moment the admin page is opened: how many accounts rated titles of one, two, three or four kinds; per signup week, how many new accounts rated five titles within their first week; and how many accounts added their first title of a kind they had none of before. These totals are not stored.",
  "The Android app counts how it is used and sends those counts to Fandex. The website does not do this; it has the page count above. The app may send only these counts, and the server ignores anything else:",
  {
    list: [
      "which screens were opened, and how often: home, search, discover, the calendar, your wishlist, your library, a title page, your taste overview, settings, and a person, tag, studio or series page;",
      "how often the \"Why?\" explanation of a Fandex score was opened;",
      "how often a title was opened from \"Recommended for you\", per kind (film, show, game, book);",
      "release reminders: how many were set, how many arrived, and how many were tapped;",
      "the first start: whether you finished choosing what kinds of titles you want, and whether the first rating step ended with five ratings or was skipped;",
      "that a list import (from Letterboxd or IMDb) finished;",
      "how long the visit lasted, as one of four ranges: under 1 minute, 1 to 5 minutes, 5 to 15 minutes, or over 15 minutes;",
      "three once-a-day marks: \"the app was used today\", \"a release reminder is set\" and \"a Why? was opened today\". Each is sent at most once a day per phone. They exist because the counts carry no device id. Without them the operator could see that \"Why?\" was opened 40 times, but not whether that was one person or forty. Dividing one mark by \"the app was used today\" gives a share of phones, without knowing any phone.",
    ],
  },
  "How the app sends them: while you use the app the counts are kept in the phone's memory. When the app goes to the background, they are sent as one batch and cleared. At most 20 batches a day are sent, and a batch that fails is dropped, not retried. A batch is sent without your account's sign-in token, so it is not tied to your account even when you are signed in, and there is no install id or device id. Like every request, it shows the phone's IP address to the server. That address is used only for the rate limit and is not stored. The server adds a batch to the day's totals straight away and does not keep the batch.",
  "To keep to these limits, the app stores three small things on the phone: your choice in Settings, how many batches it sent today, and the day each once-a-day mark was last sent. Nothing about individual screens or actions is written to the phone's storage.",
  "You can turn the counts off in the app's Settings, under \"Share anonymous usage counts\". They are on until you turn them off. Turning them off throws away what is waiting in memory, and nothing more is counted or sent from that phone.",
  "Legal basis. The stored totals are not personal data, because none of them can be traced to a person. Receiving a batch, or noting that an account was active, briefly involves personal data: the IP address of the request, or which account made it. Fandex does this on the basis of its legitimate interest in knowing how the service is used and whether it works (Art. 6(1)(f) GDPR). You can object at any time; in the app, the Settings switch does exactly that. On the website, nothing is stored on or read from your device for the page count, and the request is an ordinary one that every page makes. In the app, the counts and the three small settings above are kept on the phone only for this measurement. Fandex considers this a minimal, anonymous measurement that you can switch off at any time (§ 25 TDDDG).",
  "For signed-in accounts Fandex records the day each account was last seen, at most once per day, so the operator can tell how many accounts are still in use. That date is stored on your account and is removed when you delete it.",
  "For signed-in accounts the app also sends, about once a day, a small set of counts about how well the Fandex match fits your own ratings: per kind of title (films, shows, games, books), how often the match was one, two or three points above or below the rating you gave, and how many titles with each match label you rated 8 or more. These are counts only. They name no title and contain no rating, they are stored on your account, they are included in your data export, and they are removed when you delete your account. The operator sums them over all accounts to check that the match still means what it says, and nothing else is done with them.",
],
```

**PROPOSED (DE).**

```ts
body: [
  "Fandex zählt, wie stark es genutzt wird, damit der Betreiber erkennen kann, was funktioniert, was nicht, und ob sich der weitere Betrieb lohnt. Gezählt wird von Fandex selbst, in der eigenen Datenbank. Es gibt kein Google Analytics, keinen anderen Analysedienst Dritter, kein Tracking-Skript, keine Werbe-Kennung und kein Fingerprinting.",
  "Jede Zählung ist eine laufende Summe für einen Kalendertag, etwa „der Kalender wurde am 3. März 312-mal geöffnet“. Keine Zählung enthält eine Nutzer-ID, eine Geräte-ID, eine IP-Adresse oder eine Uhrzeit, die genauer wäre als der Tag, und keine hält ein einzelnes Ereignis fest. Aus ihnen lässt sich nicht ableiten, was eine einzelne Person getan hat.",
  "Auf der Website erhöht jede geöffnete Seite eine Zählung aus: dem Tag, der ART der Seite, ob die Person angemeldet war, sowie einer groben Kategorie für die Herkunft des Aufrufs (Suchmaschine, soziales Netzwerk, ein Link innerhalb von Fandex oder gar kein Verweis). „Art der Seite“ bedeutet ein Routen-Muster: Der Aufruf einer bestimmten Tag-, Personen- oder Titelseite wird nur als „eine Tag-Seite“, „eine Personenseite“ bzw. „eine Titelseite“ gezählt, niemals als die konkrete Seite, die Sie angesehen haben.",
  "Die Server von Fandex zählen außerdem von sich aus:",
  {
    list: [
      "wie viele Konten an jedem Tag und in jeder Woche aktiv waren. Ein Konto zählt als aktiv bei seiner ersten Anfrage des Tages, in dem Moment, in dem sein letzter Besuchstag vermerkt wird (siehe unten). Die Zählung hält fest, dass ein Konto aktiv war, nicht welches;",
      "von den in einer Woche aktiven Konten, wie viele sich in welcher früheren Kalenderwoche angemeldet haben, damit der Betreiber sieht, ob Menschen wiederkommen. Eine Anmeldewoche teilen alle, die sich in ihr angemeldet haben; sie identifiziert niemanden;",
      "neue Konten je Anmeldeweg (Trakt, Google oder Discord) und wie oft ein weiterer Anbieter, etwa Steam, mit einem bestehenden Konto verbunden wurde;",
      "wie viele Anfragen welcher Art die Server beantwortet haben (eine Suche, eine Titelseite, der Kalender, Ihre Bibliothek usw.);",
      "wie viele Anfragen fehlgeschlagen sind oder wegen zu vieler Zugriffe abgewiesen wurden.",
    ],
  },
  "Der Betreiber sieht außerdem einige Summen, die beim Öffnen der Admin-Seite aus dem berechnet werden, was die Konten ohnehin speichern: wie viele Konten Titel aus einer, zwei, drei oder vier Arten bewertet haben; je Anmeldewoche, wie viele neue Konten in ihrer ersten Woche fünf Titel bewertet haben; und wie viele Konten ihren ersten Titel einer Art hinzugefügt haben, von der sie vorher keinen hatten. Diese Summen werden nicht gespeichert.",
  "Die Android-App zählt, wie sie genutzt wird, und übermittelt diese Zählungen an Fandex. Die Website tut das nicht; für sie gibt es die Seitenzählung oben. Die App darf nur die folgenden Zählungen senden, alles andere verwirft der Server:",
  {
    list: [
      "welche Bildschirme wie oft geöffnet wurden: Start, Suche, Entdecken, Kalender, Wunschliste, Bibliothek, eine Titelseite, Ihre Geschmacksübersicht, Einstellungen sowie eine Personen-, Tag-, Studio- oder Reihenseite;",
      "wie oft die „Why?“-Erklärung eines Fandex-Scores geöffnet wurde;",
      "wie oft ein Titel aus „Recommended for you“ geöffnet wurde, je Art (Film, Serie, Spiel, Buch);",
      "Erinnerungen an Veröffentlichungen: wie viele gesetzt wurden, wie viele eingetroffen sind und wie viele angetippt wurden;",
      "der erste Start: ob Sie die Auswahl der gewünschten Titelarten abgeschlossen haben und ob der erste Bewertungsschritt mit fünf Bewertungen endete oder übersprungen wurde;",
      "dass ein Listenimport (von Letterboxd oder IMDb) abgeschlossen wurde;",
      "wie lange der Besuch gedauert hat, als einer von vier Bereichen: unter 1 Minute, 1 bis 5 Minuten, 5 bis 15 Minuten oder über 15 Minuten;",
      "drei Tagesmarken: „die App wurde heute genutzt“, „eine Erinnerung ist gesetzt“ und „heute wurde ein Why? geöffnet“. Jede wird höchstens einmal am Tag je Telefon gesendet. Es gibt sie, weil die Zählungen keine Geräte-ID enthalten. Ohne sie sähe der Betreiber, dass „Why?“ 40-mal geöffnet wurde, aber nicht, ob von einer Person oder von vierzig. Eine Marke geteilt durch „die App wurde heute genutzt“ ergibt einen Anteil der Telefone, ohne dass ein Telefon bekannt wäre.",
    ],
  },
  "Wie die App sie sendet: Solange Sie die App nutzen, liegen die Zählungen im Arbeitsspeicher des Telefons. Wenn die App in den Hintergrund geht, werden sie als ein Paket gesendet und gelöscht. Höchstens 20 Pakete am Tag werden gesendet; ein Paket, das nicht ankommt, wird verworfen und nicht erneut gesendet. Ein Paket wird ohne das Anmelde-Token Ihres Kontos gesendet, ist also auch dann nicht mit Ihrem Konto verbunden, wenn Sie angemeldet sind, und es gibt keine Installations- oder Geräte-ID. Wie jede Anfrage macht es dem Server die IP-Adresse des Telefons sichtbar. Diese wird ausschließlich für die Rate-Begrenzung verwendet und nicht gespeichert. Der Server addiert ein Paket sofort zu den Tagessummen und bewahrt das Paket selbst nicht auf.",
  "Um diese Grenzen einzuhalten, speichert die App drei kleine Angaben auf dem Telefon: Ihre Wahl in den Einstellungen, wie viele Pakete sie heute gesendet hat, und an welchem Tag jede Tagesmarke zuletzt gesendet wurde. Über einzelne Bildschirme oder Handlungen wird nichts in den Speicher des Telefons geschrieben.",
  "Sie können die Zählungen in den Einstellungen der App unter „Share anonymous usage counts“ ausschalten. Sie sind eingeschaltet, bis Sie sie ausschalten. Beim Ausschalten wird verworfen, was im Arbeitsspeicher wartet, und von diesem Telefon wird nichts mehr gezählt oder gesendet.",
  "Rechtsgrundlage. Die gespeicherten Summen sind keine personenbezogenen Daten, weil sich keine von ihnen auf eine Person zurückführen lässt. Der Empfang eines Pakets oder der Vermerk, dass ein Konto aktiv war, berührt kurz personenbezogene Daten: die IP-Adresse der Anfrage oder welches Konto sie gestellt hat. Fandex tut das auf Grundlage seines berechtigten Interesses daran, zu wissen, wie der Dienst genutzt wird und ob er funktioniert (Art. 6 Abs. 1 lit. f DSGVO). Sie können jederzeit widersprechen; in der App tut der Schalter in den Einstellungen genau das. Auf der Website wird für die Seitenzählung nichts auf Ihrem Gerät gespeichert oder ausgelesen, und die Anfrage ist eine gewöhnliche, wie sie jede Seite stellt. In der App liegen die Zählungen und die drei kleinen Angaben oben nur für diese Messung auf dem Telefon. Fandex hält dies für eine minimale, anonyme Messung, die Sie jederzeit ausschalten können (§ 25 TDDDG).",
  "Für angemeldete Konten speichert Fandex den Tag, an dem das Konto zuletzt gesehen wurde, höchstens einmal pro Tag. So lässt sich erkennen, wie viele Konten noch genutzt werden. Dieses Datum liegt an Ihrem Konto und wird mit dessen Löschung entfernt.",
  "Für angemeldete Konten übermittelt die App außerdem etwa einmal täglich einige wenige Zählwerte dazu, wie gut der Fandex-Match zu Ihren eigenen Bewertungen passt: je Art von Titel (Filme, Serien, Spiele, Bücher), wie oft der Match einen, zwei oder drei Punkte über oder unter Ihrer Bewertung lag, und wie viele Titel mit dem jeweiligen Match-Label Sie mit 8 oder besser bewertet haben. Es sind ausschließlich Zählwerte. Sie nennen keinen Titel und enthalten keine Bewertung, sie liegen an Ihrem Konto, sind Teil Ihres Datenexports und werden mit der Löschung Ihres Kontos entfernt. Der Betreiber summiert sie über alle Konten, um zu prüfen, dass der Match noch bedeutet, was er aussagt; etwas anderes geschieht damit nicht.",
],
```

**WHY.** The current text says the app sends no counts, which stops being true the day the switch flips. A policy must say what is collected, how, on what basis, and how to stop it (Art. 13 GDPR).

**The honest note on § 25 TDDDG (for Nils, not for the page).** § 25 asks for consent before information is stored on a device or read from it, unless that is strictly necessary for a service the user asked for. The app stores the switch, the batch count and the flag days on the phone, and holds the counts in its memory. EDPB Guidelines 2/2023 treat even temporary storage, and an app sending information generated on the device, as covered. German authorities (the DSK's Orientierungshilfe Telemedien) generally treat usage measurement as not strictly necessary. On that reading the switch, on by default, is not enough and consent is needed. The case for the draft as written: the counts are anonymous, first-party, minimal, sent without any id, and can be switched off. That case is arguable, not settled. **What would end the argument: a question on first start ("Share anonymous usage counts? Yes / No"), with nothing counted until Yes.** The policy paragraph would then say "only if you agreed on first start (§ 25 Abs. 1 TDDDG, Art. 6(1)(a) GDPR); you can withdraw that in Settings". The website beacon has a milder version of the same question, since it is JavaScript reading the page's path.

**Code notes found on the way (no change made).** `screen:discover` and `reminder:arrived` are accepted but never sent. Either drop them from `APP_COUNT_KEYS` or leave the policy wording as above, which covers them.

---

## 3. Privacy policy: the other out-of-date spots

Each item: WHERE, CURRENT, PROPOSED EN, PROPOSED DE, WHY.

### 3a. "Hobby project, not a company", and a pointer to nothing

**WHERE.** `en/privacy.ts` line 33, `de/privacy.ts` line 15. And "Who controls your data", `en` line 40, `de` line 22.

**CURRENT.** "Fandex is a one-person hobby project, not a company. ... It is not legal advice, and it is under review pending professional legal advice (see the note on the controller's address below)." / „Fandex ist ein Hobbyprojekt einer Einzelperson, kein Unternehmen. ... (siehe Hinweis zur Anschrift des Verantwortlichen unten).“ There is no such note below any more. Controller: "Nils Mlynarek, contactable at hello@fandex.org."

**PROPOSED (EN).** Intro: "Fandex is run by one person, Nils Mlynarek, as a small business (InFlucx, a sole trader in Düsseldorf). This policy is written to be plain and accurate about exactly what the app stores and why, rather than assembled from a template." Controller: "Nils Mlynarek, trading as InFlucx, contactable at hello@fandex.org."

**PROPOSED (DE).** Intro: „Fandex wird von einer Person betrieben, Nils Mlynarek, als kleines Unternehmen (InFlucx, Einzelunternehmen in Düsseldorf). Diese Erklärung ist bewusst einfach und exakt formuliert: Sie beschreibt genau, was die App speichert und warum, und ist kein Vorlagentext.“ Verantwortlicher: „Nils Mlynarek, handelnd unter InFlucx, erreichbar unter hello@fandex.org.“

**WHY.** The business is registered and will be declared to Google as a trader, so "not a company" is false. The "note below" was removed long ago. Whether to keep "under review pending legal advice" is Nils's call; it was written for a question that the imprint comment says is answered.

Same wording problem, outside the privacy policy: `support.ts` (en line 8 and 23, de line 8 and 24) and `terms.ts` (section 4).

### 3b. Follows and avoids (`user_facet_follows`)

**WHERE.** The list under "What Fandex stores about you", after "Hidden titles": `en` line 55, `de` line 37.

**CURRENT.** Not mentioned. The table exists (migration 0007), is erased with the account and is in the export (`worker/src/account.ts` line 200).

**PROPOSED (EN).** "Follows: the people, tags, studios and series you chose to follow or avoid, with the name as it was shown and when you chose it."

**PROPOSED (DE).** „Folgen: die Personen, Tags, Studios und Reihen, denen Sie folgen oder die Sie meiden wollen, mit dem damals angezeigten Namen und dem Zeitpunkt.“

**WHY.** The list claims to be specific ("Specifically, the database stores:"), so a missing table makes it wrong. The Follow button is hidden today (`PULL_SHOWN`), but stored rows exist.

### 3c. Connecting Steam

**WHERE.** The Steam bullet under "Providers", `en` line 105, `de` line 87. The storage bullet (`en` 52, `de` 34) is correct apart from one word.

**CURRENT.** Storage: "its Steam account id ... and its display name." Providers: describes the library sync only, not how the account gets connected.

**What the code does.** `POST /v1/auth/steam` (`worker/src/index.ts` lines 579 to 624): only with a signed-in session; Steam is never a way in. The browser goes to Steam's OpenID page; Fandex asks Steam once whether it issued the answer (`check_authentication`) and once for the public profile name (`GetPlayerSummaries`). It stores the SteamID64 and that name (`verify.ts` lines 283 to 284: "no key or token exists in this flow at all"). A value from Steam's answer is kept for ten minutes so it can't be used twice (`kv`, `steam-answer:`); it says nothing about the person.

**PROPOSED (EN), storage bullet.** "Connected Steam account: if a Steam account is connected to yours, its Steam account id (a public number Steam gives every account) and its public profile name, if Steam gives one."

**PROPOSED (EN), first two sentences added to the Steam provider bullet.** "You can connect a Steam account in Settings once you are signed in; Steam is not a way to sign in. Your browser goes to Steam's own sign-in page and comes back, and Steam tells Fandex your Steam account id and nothing else: no password, no email address and no access token. Fandex's servers then ask Steam once whether it really issued that answer, and once for the account's public profile name."

**PROPOSED (DE), Speicher-Punkt.** „Verbundenes Steam-Konto: wenn ein Steam-Konto mit Ihrem verbunden ist, dessen Steam-Konto-ID (eine öffentliche Nummer, die Steam jedem Konto gibt) und dessen öffentlicher Profilname, sofern Steam einen liefert.“

**PROPOSED (DE), Ergänzung am Anfang des Steam-Punkts.** „Ein Steam-Konto können Sie in den Einstellungen verbinden, sobald Sie angemeldet sind; anmelden können Sie sich mit Steam nicht. Ihr Browser öffnet die Anmeldeseite von Steam und kehrt zurück, und Steam teilt Fandex Ihre Steam-Konto-ID mit, sonst nichts: kein Passwort, keine E-Mail-Adresse und kein Zugriffstoken. Die Server von Fandex fragen Steam danach einmal, ob die Antwort wirklich von Steam stammt, und einmal nach dem öffentlichen Profilnamen des Kontos.“

**WHY.** The existing text is true but does not say how the id arrives. The new route is a new transfer to Steam (the verify call and the name lookup), and the Art. 49(1)(a) list under "the account you sign in with" should name Steam next to Discord: "If you connect Steam, Fandex's servers send Steam your Steam account id, which Steam already knows, because you asked to connect it (Art. 49(1)(a) GDPR)." / „Wenn Sie Steam verbinden, senden die Server von Fandex Steam Ihre Steam-Konto-ID, die Steam bereits kennt, weil Sie die Verbindung veranlasst haben (Art. 49 Abs. 1 lit. a DSGVO).“

### 3d. Sign-in providers

**WHERE.** `en` line 51, `de` line 33.

**CURRENT.** "(Trakt, Google or Discord)".

**PROPOSED.** No change. It matches `verify.ts` (Trakt, Google, Discord sign in; Steam connects only). The stale list is in the terms (section 4b). The comment in `0001_init.sql` ("google | trakt | steam") is stale too, but it is a comment.

### 3e. Recipients and countries

**WHERE.** "Providers we work with", `en` lines 95 to 121, `de` lines 76 to 102.

**CURRENT.** Names TMDB, IGDB, Trakt, Google, Discord, Steam, image servers (TMDB, IGDB, Steam, RAWG), YouTube, Cloudflare. Opening line: "TMDB and IGDB supply the movie, show and game information".

**Missing, checked against the code.**

| Provider | Who calls it | Carries | Where it sits |
|---|---|---|---|
| Open Library (Internet Archive) | The servers, and the phone directly for author pages and covers (`mobile/src/lib/facetProviders.ts` lines 85 to 113) | From the phone: the author's name searched, and the IP address | USA |
| Hardcover | The servers only; covers are copied, never linked | A title or an ISBN, nothing about you | USA |
| Wikidata (Wikimedia Foundation) | The servers only, a nightly batch | Ids of titles | USA |
| BoardGameGeek | The servers only, and only once `BGG_TOKEN` is set | A game id | USA |
| JustWatch | Nobody. The data comes through TMDB. The "by JustWatch" link opens their site only if tapped | Nothing | |

**PROPOSED (EN).** Opening line: "TMDB, IGDB, Open Library, Hardcover and Wikidata supply the information Fandex shows about films, shows, games and books (titles, covers, descriptions, genres, people). None of them is told anything about your account." New bullets:

- "Open Library (run by the Internet Archive): book information, asked for by Fandex's servers. In addition, a person page for an author asks Open Library directly from your device. Open Library then receives that name and, like any server you contact, your IP address."
- "Hardcover and Wikidata: book, series and game-credit information, asked for by Fandex's servers only. Book covers from Hardcover are copied to Fandex's own storage, so your device never contacts Hardcover."
- "Streaming availability is supplied by JustWatch through TMDB. Your device does not contact JustWatch unless you open one of its links."

Images bullet: "Posters, covers and artwork are loaded by your device straight from the image servers of TMDB, IGDB, Open Library and, for some games, Steam. For a few older entries they still come from RAWG."

**PROPOSED (DE).** Einleitung: „TMDB, IGDB, Open Library, Hardcover und Wikidata liefern die Informationen, die Fandex zu Filmen, Serien, Spielen und Büchern anzeigt (Titel, Cover, Beschreibungen, Genres, Personen). Keiner von ihnen erfährt etwas über Ihr Konto.“ Neue Punkte:

- „Open Library (betrieben vom Internet Archive): Buchinformationen, von den Servern von Fandex abgefragt. Zusätzlich fragt eine Personenseite für eine Autorin oder einen Autor Open Library direkt von Ihrem Gerät aus. Open Library erhält dann diesen Namen und, wie jeder Server, den Sie kontaktieren, Ihre IP-Adresse.“
- „Hardcover und Wikidata: Informationen zu Büchern, Reihen und Mitwirkenden an Spielen, ausschließlich von den Servern von Fandex abgefragt. Buchcover von Hardcover werden in den eigenen Speicher von Fandex kopiert, Ihr Gerät kontaktiert Hardcover also nie.“
- „Die Angaben, wo ein Titel gestreamt werden kann, liefert JustWatch über TMDB. Ihr Gerät kontaktiert JustWatch nur, wenn Sie einen seiner Links öffnen.“

Bilder: „Poster, Cover und Artwork lädt Ihr Gerät direkt von den Bildservern von TMDB, IGDB, Open Library und, bei manchen Spielen, Steam. Bei einigen älteren Einträgen kommen sie noch von RAWG.“

**Also.** (1) The trailer bullet should link Google's privacy policy, which YouTube's developer policies require ("reference and link to the Google Privacy Policy"). Use a `rich` block with `https://policies.google.com/privacy`. (2) BoardGameGeek: add a bullet like Hardcover's on the day board games go live, not before. (3) The Cloudflare bullet says "Checked August 2026". Re-check Cloudflare's Data Privacy Framework entry (dataprivacyframework.gov) before publishing and change the month.

**WHY.** Books have been live since 2026-10-17 and the policy still reads as films, shows and games. Open Library is a direct call from the phone with the IP address, which must be listed. RAWG is retired as a provider, but 603 stored links survive (`PLATFORMS.md`), so its images can still load.

### 3f. Backups

**WHERE.** `en` line 126, `de` line 108.

**CURRENT.** "Cloudflare can restore it to any point in the last 7 days, and a copy is written to backup storage in the European Union every night and kept for 30 days."

**Verified today.** `npx wrangler r2 bucket lifecycle list fandex-backups --jurisdiction eu`: rule `expire-d1-exports`, prefix `d1/`, "Expire objects after 30 days". The bucket is in the EU jurisdiction. Time Travel 7 days: `docs/worker.md` line 505.

**PROPOSED.** No change. One nit: R2 removes expired objects within about a day of expiry, so "up to 30 days" may in practice be 31. Not worth new wording.

### 3g. No legal bases anywhere else in the policy

**WHERE.** A new section after "How long we keep it" (`en` after line 128, `de` after line 110).

**CURRENT.** Only Art. 49 (transfers) and, after section 2, Art. 6(1)(f) for counts. Art. 13(1)(c) GDPR asks for the legal basis of every purpose, and Art. 21(4) asks for the right to object to be pointed out on its own.

**PROPOSED (EN).**

```ts
{
  heading: "Why Fandex may use your data (legal bases)",
  body: [
    {
      list: [
        "Your account, library, ratings, episodes, hidden titles, follows, country and display preferences, and the sign-in and Steam data above: to provide the service you signed up for (Art. 6(1)(b) GDPR).",
        "Syncing with Trakt or Steam: because you asked for it, by connecting that account (Art. 6(1)(b) GDPR).",
        "The last-seen day, the usage counts, the match counts, the rate limit and the short technical logs: Fandex's legitimate interest in running the service safely and knowing whether it works (Art. 6(1)(f) GDPR).",
        "Keeping records that the law requires a business to keep, if any ever apply to your data: Art. 6(1)(c) GDPR.",
      ],
    },
    "You have the right to object, at any time and on grounds relating to your situation, to any use based on legitimate interest (Art. 21 GDPR). Write to hello@fandex.org. For the app's usage counts, the switch in Settings does it at once.",
  ],
},
```

**PROPOSED (DE).**

```ts
{
  heading: "Rechtsgrundlagen",
  body: [
    {
      list: [
        "Ihr Konto, Ihre Bibliothek, Bewertungen, Episoden, ausgeblendeten Titel, Folgen, Ihr Land und Ihre Anzeige-Einstellungen sowie die Anmelde- und Steam-Daten oben: zur Bereitstellung des Dienstes, für den Sie sich angemeldet haben (Art. 6 Abs. 1 lit. b DSGVO).",
        "Der Abgleich mit Trakt oder Steam: weil Sie ihn durch das Verbinden dieses Kontos veranlasst haben (Art. 6 Abs. 1 lit. b DSGVO).",
        "Der letzte Besuchstag, die Nutzungszählungen, die Match-Zählwerte, die Rate-Begrenzung und die kurzlebigen technischen Protokolle: das berechtigte Interesse von Fandex, den Dienst sicher zu betreiben und zu wissen, ob er funktioniert (Art. 6 Abs. 1 lit. f DSGVO).",
        "Aufzeichnungen, die ein Unternehmen gesetzlich aufbewahren muss, falls solche Ihre Daten je betreffen: Art. 6 Abs. 1 lit. c DSGVO.",
      ],
    },
    "Sie haben das Recht, jeder Verarbeitung auf Grundlage eines berechtigten Interesses jederzeit aus Gründen, die sich aus Ihrer besonderen Situation ergeben, zu widersprechen (Art. 21 DSGVO). Schreiben Sie an hello@fandex.org. Für die Nutzungszählungen der App wirkt der Schalter in den Einstellungen sofort.",
  ],
},
```

**WHY.** The heading above it ("Your rights") lists objection, but without a basis to object to. With a registered business behind it, the policy is more likely to be read by someone checking Art. 13 point by point.

### 3h. Smaller stale spots

| WHERE | CURRENT | PROPOSED EN | PROPOSED DE | WHY |
|---|---|---|---|---|
| "What Fandex does NOT store", `en` 72, `de` 54 | "Fandex does count pageviews, but it does so itself and without identifying anyone" | "Fandex does count how it is used, but it does so itself and without identifying anyone" | „Fandex zählt zwar, wie es genutzt wird, tut dies aber selbst und ohne jede Identifizierung“ | The counts now cover more than pageviews. |
| "What is kept on your own device", after `en` 65, `de` 47 | Nothing on reminders or imports | "In the Android app, release reminders you turn on are scheduled on the phone itself; no server sends them. A Letterboxd or IMDb export you import is read on the device, and only the titles and ratings in it are saved, as library rows. The file itself is not sent anywhere." | „In der Android-App werden Erinnerungen an Veröffentlichungen, die Sie einschalten, auf dem Telefon selbst geplant; kein Server versendet sie. Ein Letterboxd- oder IMDb-Export, den Sie importieren, wird auf dem Gerät gelesen, und nur die darin enthaltenen Titel und Bewertungen werden als Bibliothekseinträge gespeichert. Die Datei selbst wird nirgendwohin gesendet.“ | The Play Data safety draft relies on both facts; the policy should state them. |
| `updated`, `en` 31, `de` 13 | "2026-10-25" | the day it ships | same | Material change (CLAUDE.md for `src/lib`). |
| Header comment, `en` line 12 | "usage statistics worker/src/telemetry.ts" | add `worker/src/usage.ts`, `mobile/src/lib/usageCounts.ts` | | The file's own rule: every claim traceable to code. |

---

## 4. Terms

### 4a. Monetization

**WHERE.** `en/terms.ts` line 72, `de/terms.ts` line 72. Also the header comments, `en` lines 3 to 8, `de` lines 3 to 9.

**CURRENT (EN).** "Fandex's monetization today is donations and affiliate links only. Neither is a direct sale by Fandex to you, so neither triggers the sections below on its own."

**CURRENT (DE).** „Fandex finanziert sich derzeit ausschließlich über Spenden und Affiliate-Links.“

That is wrong today. No affiliate code is live (`AGENTS.md`). Donations through Ko-fi are live (`support.ts`). The plan since 2026-08-19 is ads first, affiliate demoted (`docs/decisions.md` line 41).

**PROPOSED, TODAY (EN).** "Fandex is free. It has no ads, no affiliate links and no payment feature. You can support it with a voluntary donation through the page linked from Support; a donation buys nothing and changes nothing in the app. The sections that follow are placeholders for a possible later stage, such as a one-time ad-free unlock or a paid tier. No such feature exists today, and these sections are not in effect unless and until one is actually launched and announced here."

**PROPOSED, TODAY (DE).** „Fandex ist kostenlos. Es gibt keine Werbung, keine Affiliate-Links und keine Zahlungsfunktion. Sie können Fandex mit einer freiwilligen Spende über die auf der Support-Seite verlinkte Seite unterstützen; eine Spende kauft nichts und ändert nichts in der App. Die nachfolgenden Abschnitte sind Platzhalter für eine mögliche spätere Stufe, etwa eine einmalige werbefreie Freischaltung oder eine kostenpflichtige Stufe. Ein solches Merkmal existiert heute nicht; die Abschnitte werden erst wirksam, wenn ein solches Angebot tatsächlich eingeführt und hier bekannt gegeben wird.“

**PROPOSED, THE DAY THE FIRST AFFILIATE LINK GOES LIVE (EN).** "Fandex is free. Some links to shops are affiliate links. Each one is marked \"Affiliate\" next to the link. If you buy something after following one, Fandex may earn a commission from the shop. You pay the same price. The link goes straight to the shop: Fandex sets no cookie and records nothing about the click. The shop's own cookies and terms apply once you are there. You can also support Fandex with a voluntary donation through the page linked from Support; a donation buys nothing. The sections that follow are placeholders for a possible later stage, such as a one-time ad-free unlock or a paid tier. No such feature exists today, and these sections are not in effect unless and until one is actually launched and announced here."

**PROPOSED, AFFILIATE DAY (DE).** „Fandex ist kostenlos. Einige Links zu Shops sind Affiliate-Links. Jeder ist neben dem Link mit „Werbung“ gekennzeichnet. Wenn Sie nach dem Klick auf einen solchen Link etwas kaufen, erhält Fandex unter Umständen eine Provision vom Shop. Der Preis für Sie bleibt gleich. Der Link führt direkt zum Shop: Fandex setzt dafür kein Cookie und erfasst nichts über den Klick. Sobald Sie im Shop sind, gelten dessen Cookies und Bedingungen. Sie können Fandex außerdem mit einer freiwilligen Spende über die auf der Support-Seite verlinkte Seite unterstützen; eine Spende kauft nichts. Die nachfolgenden Abschnitte sind Platzhalter für eine mögliche spätere Stufe, etwa eine einmalige werbefreie Freischaltung oder eine kostenpflichtige Stufe. Ein solches Merkmal existiert heute nicht; die Abschnitte werden erst wirksam, wenn ein solches Angebot tatsächlich eingeführt und hier bekannt gegeben wird.“

The marker word must match what the code renders (`docs/monetization-legal.md` §1 suggests "Affiliate" or "Werbung"). The "no cookie" sentence holds only while the links stay direct `<a href>` (`AGENTS.md`). The privacy policy's cookie section needs no change on that day for the same reason.

**WHY.** A reviewer at Google may read the terms, and the play-app-content draft flagged this line (item 12). Saying affiliate links are live when none are is a false statement about the business.

### 4b. The rest of the terms that is stale

| WHERE | CURRENT | PROPOSED EN | PROPOSED DE | WHY |
|---|---|---|---|---|
| Intro, `en` 13, `de` 14 | "a free, one-person hobby project" | "Fandex is a free service run by one person, Nils Mlynarek, as a small business (InFlucx). These terms are written to be plain and honest about what that means, not a template." | „Fandex ist ein kostenloser Dienst, den eine Person, Nils Mlynarek, als kleines Unternehmen (InFlucx) betreibt. Diese Bedingungen sind bewusst einfach und ehrlich formuliert, kein Vorlagentext.“ | Registered business. |
| "The service", `en` 19, `de` 20 | "for movies, shows and games ... provided by Nils Mlynarek (see the Privacy Policy for contact details)" | "for films, shows, games and books ... provided by Nils Mlynarek, trading as InFlucx (see the Imprint for the address and contact details)" | „für Filme, Serien, Spiele und Bücher ... wird von Nils Mlynarek unter InFlucx bereitgestellt (Anschrift und Kontakt siehe Impressum)“ | Books are live; the imprint is where the address is. |
| "Your account", `en` 25, `de` 26 | "(Trakt or Google)" | "(Trakt, Google or Discord)" | „(Trakt, Google oder Discord)“ | Discord sign-in is live. |
| "Availability", `en` 47, `de` 47 | "This is a hobby project run by one person, not a company with an uptime commitment." | "Fandex is run by one person, without an uptime commitment." | „Fandex wird von einer Person betrieben, ohne Verfügbarkeitszusage.“ | Same as 3a. |
| New, after "Your content" | Nothing on YouTube | "Trailers are played with YouTube's player. By watching one in Fandex you agree to YouTube's Terms of Service (https://www.youtube.com/t/terms)." | „Trailer werden mit dem Player von YouTube abgespielt. Wenn Sie einen in Fandex ansehen, stimmen Sie den Nutzungsbedingungen von YouTube zu (https://www.youtube.com/t/terms).“ | YouTube's developer policies ask an app's terms to say this and to link YouTube's ToS. Whether an embed alone falls under that rule is not settled in section 5. |
| `updated`, `en` 11, `de` 12 | "2026-10-11" | the day it ships | same | |

---

## 5. Provider notices

Checked 22 Nov 2026 on each provider's own page. "Not verified" means the page would not open for an automated fetch and nothing is claimed from memory. Quotes are at most 15 words.

**Where the lines go.** "About and legal" means one "Data sources" block in the app and on the website. The natural home is a new section in the imprint (`Copyright` / `Urheberrecht` already holds the general "not endorsed" line) or the Press page's source list (`mobile/src/components/LaunchPages.tsx` line 200). The item page already carries per-title credits (`ItemPage.tsx` lines 656 to 674, 736 to 739, 816 to 818).

| Provider | Source opened | Requirement, quoted | Line Fandex should show | Where |
|---|---|---|---|---|
| **TMDB** | themoviedb.org/api-terms-of-use and /about/logos-attribution, both opened | "uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB." Logo: "You must use the TMDB logo to identify Your use". Less prominent than Fandex's own marks, no implied endorsement, shown "prominently in or on Your Application". | "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB." plus the TMDB logo from their logos page. DE: „Dieses Produkt nutzt TMDB und die TMDB-APIs, wird aber von TMDB weder unterstützt noch zertifiziert oder anderweitig genehmigt.“ | About and legal (with logo); website footer or about; Play description (text only). **Today there is no TMDB logo anywhere**, and the store-listing draft uses a shorter, older sentence. |
| **JustWatch (via TMDB)** | developer.themoviedb.org/reference/movie-watch-providers, opened | "you must attribute the source of the data as JustWatch." No logo rule stated. | Already shown: "Streaming availability data by JustWatch". DE: „Streaming-Daten von JustWatch“. | Item page under "Where to watch" (done); also in About and legal. |
| **Trakt** | app.trakt.tv/branding, opened. API terms: **not verified** (trakt.docs.apiary.io renders nothing without script). | Branding: approved logos only, no recolouring; "Do not use the logo to imply sponsorship, endorsement, or affiliation". No attribution sentence found. | "Fandex uses Trakt but is not endorsed or certified by Trakt." (in `store-listing.md` line 81; that draft calls it confirmed, this check could not confirm it). | About and legal; Play description. **Wording not verified.** |
| **IGDB / Twitch** | api-docs.igdb.com, opened (by curl). Twitch Developer Services Agreement: **not verified** (renders by script). | Free "for non-commercial usage"; for commercial partners IGDB asks "for user facing attribution to IGDB.com", in "a static location (e.g. not in a change log)". | "Game data from IGDB.com" | About and legal; item page "Data from" line already names IGDB. Required only on a commercial partnership; shown anyway. |
| **Steam / Valve** | steamcommunity.com/dev/apiterms and partner.steamgames.com/doc/marketing/branding, both opened. "Steam Web API Network Branding Requirements": **not verified**, not opened. | API terms ask for no credit line; links to Valve must not be "nofollow"; no implied endorsement. Branding page: "Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation". | "Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries. Fandex is not affiliated with Valve." | About and legal. Not needed in the Play description. |
| **Open Library** | openlibrary.org/developers/api and /developers/licensing, opened | No attribution required. Asks for a User-Agent with contact details, and not to be used as "a backend for high-traffic commercial services". | Already shown: "Book data from Open Library". | Item page (done); About and legal. |
| **Hardcover** | docs.hardcover.app/api/getting-started, opened (by curl). hardcover.app/terms: **not verified** (403). | No attribution requirement found. Commercial or public sites "may not use data owned by users"; covers are user uploads, so a takedown contact is needed. | Already shown: "and Hardcover" on a book it contributed to. | Item page (done). Takedown contact on the support page (stated in `PLATFORMS.md`; not re-read). |
| **Wikidata** | wikidata.org/wiki/Wikidata:Licensing and Wikidata:Copyright, opened | Data is "into the public domain under Creative Commons Zero". No attribution required. | Optional: "Some game credits from Wikidata". | About and legal, if wanted. |
| **YouTube** | developers.google.com/youtube/terms/developer-policies and /branding-guidelines, opened | "must display a link to YouTube's Terms of Service"; privacy policy must "reference and link to the Google Privacy Policy". Branding next to the API use, unmodified, not the most prominent element. Whether a plain embed needs more than the player's own branding: not stated. | Terms line in 4b; privacy link in 3e. No extra logo: the embedded player carries YouTube's own. | Terms, privacy policy. |
| **BoardGameGeek** (when live) | boardgamegeek.com/wiki/page/XML_API_Terms_of_Use: **not verified** (403 on every BGG page). Search-result text only. | From search snippets: a linked "Powered by BGG" logo on public use; no commercial use without a licence. | Today: a text link "Powered by BGG" (`ItemPage.tsx` line 660). If the terms ask for the logo, the text is not enough. | Item page; About and legal. **Open the terms in a browser before the token goes in.** |

**One thing that matters more than wording.** TMDB's terms do not allow commercial use without a separate agreement. `docs/decisions.md` lines 29 and 58 to 66 record this as an accepted risk and say not to contact TMDB. Declaring "trader" on Play (section 6) does not by itself make the use commercial in TMDB's sense, but it is a public record that a business runs the app. Nils already knows this; it is listed so it is not forgotten.

---

## 6. Google Play's trader declaration

Google's help page "Trader status declaration" (support.google.com/googleplay/android-developer/answer/17594752, read 2026-11-22) says: existing accounts declare by **1 February 2027**, and trader details show on store pages from **1 March 2027**. Shown to everyone: contact details (for an individual account this includes "a phone number and address"), the D-U-N-S number if the account has one, and a link to the app's terms if given. Shown in the EEA and UK: the trader name in the "Offered by" field. The page does not mention email, and does not say whether the shown address is the payments-profile address. Fandex's account is being converted to a business account (`docs/play-store.md` line 13), which asks for a public developer email and phone. So, for a sole trader: **name, address and phone become public, plus the developer email.** The address is already public in the imprint; the phone is new. The imprint and the store page should then name the same person, business name and address. Nothing in the law forces the imprint to carry the phone, but once it is public on Play there is no reason to keep it off (1c). Link the terms (`https://fandex.org/legal/en/terms`) in the declaration only after section 4 has shipped.

---

## Decisions only you can take

- **The usage counts on the phone:** ship them as drafted (on by default, switch in Settings), or ask on first start, which removes the § 25 TDDDG doubt (section 2).
- **Add "InFlucx (Einzelunternehmen)" to the imprint**, and add your phone number there once Play shows it anyway (1b, 1c).
- **Show the USt-IdNr only**, or both the USt-IdNr and the W-IdNr (1a).
- **Drop "under review pending legal advice"** from the privacy and terms intros, or keep it (3a).
- **Add the TMDB logo** to an About/legal area in the app and on the site (section 5).
- **Ship the today-version of the terms now**, and hold the affiliate version for the day a link goes live (4a).
