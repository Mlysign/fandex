# RV11: duplicate and mis-merged games, folded (2026-10-23)

Applied on live D1 at 20:18 UTC with `worker/scripts/regroup-items.mjs worker/scripts/rv11-game-twins.json --remote --apply`,
after the same plan ran on a local D1 loaded with the same 193 titles, was undone there, and came back
byte for byte. The full per-title report, every moved row and the undo are local only (they hold
provider blobs and Nils's rows): `data/backups/regroup-remote-2026-10-23T20-18-14-361Z.*`.

## The rule

IGDB labels every entry, so the call per group came from its `game_type` and `parent_game`, not from titles:

- **A port, a cancelled port, and a same-title remaster, expanded version or re-release bundle
  folds into the main game IGDB names as its parent.** A same-title remaster is the same game in HD
  (*God of War II* 2009, *Resident Evil 4* 2011), and two pages called the same thing with nothing
  to tell them apart was the bug.
- **A remake stays its own title**: *Dead Space* 2023, *Resident Evil 2* 2019, *Resident Evil 4* 2023,
  *Link's Awakening* 2019, *Final Fantasy IV* (DS), *GoldenEye 007* (Wii), the *Tony Hawk* remakes,
  *Ratchet & Clank* 2016, *Resident Evil* 2002.
- **Different games that share a name stay apart**: the five *Jurassic Park* games, four *TMNT*, three
  *Lost World*, *Doom* 1993 and 2016, *Overwatch* 2016 and 2023, the two *Warzone*s, the next *Mass Effect*.
- **A title whose links belong to two works is split**: each link goes to the title it describes, with
  the user rows of that source.

105 titles removed, 13 re-derived with the Worker's own `deriveItem`. Every removed address is a 301 in
`mobile/web/folded.json` (104; the 105th was a title created for this and never public). Every provider
id of a removed title answers as the kept one (`provider_aliases`), so no sync or lookup creates it again.

## The cases RV11 named

| Address | Was | Now |
|---|---|---|
| `/game/final-fantasy-vii` | a cancelled Super Famicom concept with the Remake's RAWG link and a Steam release | 301 to `final-fantasy-vii-1997`, which gained the Steam link; the Remake's RAWG link and his rating of 8 went to `final-fantasy-vii-remake` |
| `/game/dead-space` | a 2011 mobile game with the 2023 remake's RAWG and Steam links | deleted (the mobile game was only a wrong match), 301 to the 2008 original; the remake's links and his 10 went to `dead-space-2023` |
| `/game/dead-space-2008` | "Dead Space (2008)", a RAWG and Steam twin of the original | folded into `dead-space-2008-2`, the original, which now holds IGDB, RAWG and Steam |
| `/game/baldurs-gate-3` | an empty Steam-only page | 301 to `baldurs-gate-iii`, his Steam row with it |
| `black-myth-wu-kong` / `black-myth-wukong` | two RAWG ids for one game | one title; his two 8s were the same fact, one kept |
| `pokemon-red-blue-yellow` | RAWG's one entry for all three | folded into `pokemon-red-version` with his 10 |
| `overwatch` / `overwatch-2023` | Overwatch 2's Steam app on the 2016 game | Steam link moved to `overwatch-2023`; both stay, as IGDB has them |
| `resident-evil-4` (x4) | GameCube original, PS2 version, 2011 HD remaster at the plain address, 2023 remake | `resident-evil-4-2005` and `resident-evil-4-2023`; the plain address 301s to the original |
| `wolfenstein-3d` (x6) | DOS original, IGDB's catch-all entry, a 3DO port, two store bundles, a browser port | one title, `wolfenstein-3d-1992` (the catch-all is typed a bundle, which would hide it from rails) |
| `god-of-war-ii` | the 2009 remaster at the original's address | 301 to `god-of-war-ii-2007` |

Found on the way and fixed the same way: `system-shock` held the 1994 original's IGDB entry with the 2023
remake's Steam and RAWG links (his 6 and his Steam row), now split to `system-shock-2023`; `soul-hackers-2`
swapped a PC-only IGDB duplicate for the full entry; `tony-hawks-pro-skater-4-2002` was the GBA port and is
now the real 2002 game; *Prince of Persia*'s three ports folded into the 1989 original
(`prince-of-persia-1989`), created through `/v1/resolve` for this like the 2026-10-18 playtests.

## Nils's library

| | Before | After |
|---|---|---|
| Rows | 2,499 | 2,497 |
| Library titles | 1,961 | 1,956 |
| Rated titles | 1,707 | 1,705 |
| Wishlist | 97 | 97 |

No rating was lost. The counts fall because five games were counted twice: Black Myth, Dead Space 2008,
Vice City (two Steam apps), Baldur's Gate 3 (Steam row plus RAWG rating) and Kane & Lynch (the same).
The two rows that went were the same fact twice (the second Black Myth 8, the second Vice City Steam row):
the ratings' sum fell by exactly 8. Nine rows moved to the title they describe, none conflicted, and no
row outside the 193 titles changed.

## Undo

```
cd worker
npx wrangler d1 execute fandex --remote --file ../data/backups/regroup-remote-2026-10-23T20-18-14-361Z.undo.sql --yes
```

then take the 104 RV11 entries out of `mobile/web/folded.json` and publish the site. It puts every row of
the 193 titles back, so a rating written on one of them after 2026-10-23 would be lost with it.

`prince-of-persia-1989` was put in the pool by hand at 20:31 (`browsed = 0`, `pool_count` dropped): the
first run left it out, because it absorbed its three ports through aliases alone and the script only
promoted a target whose links changed. The script does both now. The undo above leaves it in the pool.

## Left alone

- *God of War (2018)* is a RAWG-only title with the year in its name; IGDB's entry was never fetched.
- Same-title bundles that differ in content: the two *Destiny 2: Legacy Collection*s, *Monster Hunter
  Rise + Sunbreak* beside the expansion.
- Same-title remasters stay folded into their originals: Nils's call, 2026-10-24 (docs/decisions.md).

## The cause, and four more (2026-10-24)

Every chimera was made on the old site (created 2026-06-25, its RAWG and Steam links synced in
August), by two rules:

1. **IGDB was attached to a RAWG or Steam title by a name search with no floor.** The old site's
   `searchByTitle` (`src/lib/metadata/providers/igdb.ts` at the tag `old-site-final`) took the
   best-scoring hit and never refused one: an exact title earned 100 and "no parent game" 50, while
   a wrong year cost at most 15 and an UNDATED entry lost nothing. So "Final Fantasy VII" with the
   Remake's 2020 date scored the undated Super Famicom concept at 180 against the 1997 game's 85,
   and "Dead Space" 2023 scored the 2011 mobile game at 168 against the remake's 115 (having a
   parent game cost it 50, being a remake 25).
   That code went with the old site.
2. **A title matched any same-title title when either side had no year.** The Worker inherited this
   rule (`findMatchingItem` in `worker/src/catalog/ingest.ts`): an undated IGDB entry resolved today
   would still have joined the Remake's RAWG title. Fixed: for a game both years must be there and
   within one, and the nearest year wins instead of whichever row the index returned first
   (`worker/test/ingest.test.ts`, the FF7 and Overwatch shapes). Films and shows keep the old rule,
   since a Trakt or Letterboxd link carries the TMDB id and the cross ids settle them.

A scan of every live title's IGDB entry against its RAWG and Steam links (type, status, year, name)
found four more, fixed the same way with `worker/scripts/rv11-chimeras-2026-10-24.json` after a
local rehearsal and undo (backup `data/backups/regroup-remote-2026-10-24T07-43-43-783Z.*`):

- `pokemon-stadium-2` held RAWG's *Pokémon Gold, Silver* and his 10: both now on `pokemon-silver-version`.
- `the-settlers-mobile` was IGDB's undated mobile game on RAWG's 1993 *The Settlers* and his 2: they
  went to the 1993 game, which IGDB files under its US name, `serf-city-life-is-feudal`; the old
  address 301s there.
- `black-desert-online-explorers-package` held RAWG's *Black Desert Online* and his "owned" row, now
  on `black-desert` beside his Steam row.
- `deadlock` (Valve's) carried an old 2016 RAWG page called *Deadlock*, which gave it a 2016 date.
  The RAWG link went; both of his rows stay, since RAWG's ownership came from the Steam app.

His library after: 2,497 rows, 1,955 titles (Black Desert was counted twice), 1,705 rated,
97 wishlist, the ratings' sum unchanged. Left: the rest of the scan's flags are early-access games
that IGDB dates at 1.0 and RAWG at launch, and remasters whose RAWG and Steam pages are the
remaster's own.
