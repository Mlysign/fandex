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

## Left alone

- *God of War (2018)* is a RAWG-only title with the year in its name; IGDB's entry was never fetched.
- Same-title bundles that differ in content: the two *Destiny 2: Legacy Collection*s, *Monster Hunter
  Rise + Sunbreak* beside the expansion.
- Why the chimeras formed (Steam and RAWG links matched to the wrong IGDB title) is not fixed here.
