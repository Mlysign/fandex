# First Play release notes: draft

_Draft for Nils, 2026-11-22. Play's "What's new" field allows 500 characters per language. Counts were made with `node` (characters, line breaks included). Facts from `store-listing.md`._

## English (489 characters)

<!-- count:en -->
```text
The first public version of Fandex.

Keep movies, shows, games and books in one wishlist and library.
See their release dates on one calendar, in the dates for your country.
Get a reminder at 9am on release day, when a new season starts, or when the next episode airs.
Rate titles from 1 to 10. Fandex guesses what you'd rate the rest, from your own ratings only.
Sync with Trakt, or import a Letterboxd or IMDb file.

Something wrong or missing? The Support row on the You tab reaches me.
```

## Deutsch (469 Zeichen)

<!-- count:de -->
```text
Die erste öffentliche Version von Fandex.

Filme, Serien, Spiele und Bücher in einer Liste.
Alle Termine in einem Kalender, mit den Daten für dein Land.
Erinnerung um 9 Uhr am Erscheinungstag, bei neuer Staffel und nächster Folge.
Bewerte von 1 bis 10. Fandex schätzt, wie du den Rest bewerten würdest, nur aus deinen Wertungen.
Sync mit Trakt, Import aus Letterboxd und IMDb.
Die App ist auf Englisch.

Etwas falsch oder fehlt? Schreib mir über „Support“ im Tab „You“.
```

Optional line, use only once Steam connect ships (check the count after adding):
- EN: `Connect Steam to bring in your library and wishlist.`
- DE: `Verbinde Steam, und Bibliothek und Wunschliste kommen mit.`

## Notes

- The German note says the app is in English, so nobody installs expecting German menus. Titles still show in the language of the chosen country.
- "Support row on the You tab" is from `docs/app.md` (You row). If the planned "Send feedback" row (`pr-feedback`) ships first, point to that instead.
- The reminder line is Android only, which is fine here: these notes only show on Play.
