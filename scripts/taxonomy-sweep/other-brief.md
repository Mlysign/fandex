# Sorting Fandex tags out of "Other"

The brief for one chunk of the weekly sweep's Other tags (`prepare.mjs` writes them to `other.txt` and, past 700 lines, to `other-NN.txt` chunks). Used first on 2026-11-06, when 5,562 tags were sorted this way by eight agents and Other went to empty.

Fandex is a catalog of films (F), shows (S), games (G), books (B) and board games (BG). Every title carries tags from its providers (TMDB keywords, IGDB keywords and themes, Steam tags, Open Library subjects, Hardcover tags). Each tag sits in one category. These tags all sit in "Other", the catch-all, and every one must leave it.

Your chunk is a text file, one tag per line:

`key | label | titles | (blank) | titles per medium | up to three titles carrying it`

## The categories (use the id on the left)

| id | what goes there | examples |
|---|---|---|
| genre | a genre or subgenre label, including bookshop shelf genres | caper, magical realism, romantasy, literature & fiction, thriller & suspense, historical fantasy, american suspense fiction, arcade shooter, political satire |
| source | says the work is adapted from, or tied in to, something else | book tie in, fan remake, rom hack, based on a play, classic adaptation |
| setting | a place, a period or a world it is set in | alps mountains, ancient civilizations, singapore, 19th century, shipyard, hollywood, ice age, alternate reality |
| artstyle | how it looks | cartoon graphics, archive footage, anime inspired, art deco, black and white |
| mood | a tone or a feeling | high tension, black humor, slow burn, apathetic, heartwarming, disgust |
| theme | what the work is about: a subject, an event, a relationship, an activity, a plot device, a field of knowledge | alien abduction, hiking, art restoration, american football, family secrets, enemies to lovers, allergies, social science, mathematics, philosophy, anti war protest |
| audience | who it is for, or its format | middle grade, picture book, teen & young adult, audiobook, short stories, anthology, children's books, plays, mobile games |
| character | who is in it: a named character or real person, a creature, a kind of person, a profession, a group of people | anne boleyn, hired killer, historians, alcoholics, vikings, androids, nurses, pikachu |
| object | an animal or a thing in it | hijab, frog, ufo, drone, slot machine, bikes |
| mode | how a game is played or structured | co-op, open world, non linear, online pvp, raiding |
| mechanics | a game system | crafting, stealth kills, dialogue choices, character classes |
| perspective | a camera or a view | first person, sidescroller, isometric |
| storytelling | how the story is told, as readers describe it | strong or weak character development, loveable or unloveable characters, diverse characters, plot driven, character driven, a mix driven, slow / medium / fast paced, first person narrative |
| meta | says nothing about what the work is like | reading-list bookkeeping (did-not-finish, physical-tbr, calibre import, mediabox-old-format, owned, to-read, book club), the edition or the language (large type books, English, ebook formats), awards and nominations, platform services and storefront features, names of real authors or publishers as tags, a franchise or cinematic universe name (it already has its own franchise facet: arrowverse), library classification numbers, words too vague to mean anything ("story", "fiction" alone, "date" alone) |

## Rules

- Non-English tags: classify by what they mean (hijos de alcohólicos → theme, historiadores → character, протагонистка → character).
- Typos: classify what was meant (historical ffiction → genre).
- When two fit, pick the one a person browsing would look under. A kind of person is `character` even when it reads like a topic; an activity people do is `theme`; a real-world sport is `theme`.
- Use the titles to break ties: "date" on seven romcoms is theme (dating); "story" alone is meta.
- Only when NONE of the categories above fits, write `NEW:<lowercase-id>` and add the tag to your notes with one line on why. Expect this to be rare (none of 5,562 needed one on 2026-11-06). Don't invent a category for something that fits one of the above loosely.

## Output

Write `<chunk name>.out.tsv` next to the chunk file (for `other-03.txt` it is `other-03.out.tsv`): one line per input line, in the same order, `key<TAB>category`. The key copied EXACTLY as the first field of the input line (accents, Cyrillic, punctuation and all). No header. Every input line gets exactly one output line. Judge every tag yourself; a script may join your calls to the keys, never pick them by keyword.

Then check it with `node scripts/taxonomy-sweep/join-other.mjs <work folder> --check`, which compares every chunk's output with its input. Fix anything it names in your chunk.

Reply with: the line count, your count per category, every `NEW:` tag with its one-line reason, and up to ten calls you were least sure of.
