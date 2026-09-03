// The curated rules behind the taxonomy sweep (2026-09-03).
//
// Nils: "can you do a sweep of all tags and franchises? the goal should be to
// have almost no tag in the 'other' category."
//
// MEASURED BEFORE WRITING ANY OF THIS: 5,516 of the catalog's 6,041 tags sit in
// "Other", or 91%. `categorizeTag` covers 525. That is not a bug in the
// heuristic so much as its scope: its word sets were written against TMDB
// keywords and Trakt moods, and the catalog is now a third games, whose IGDB
// keywords and Steam tags it has never seen.
//
// ── Why this is a separate file from tags.ts ──────────────────────────────
//
// `categorizeTag` is the DEFAULT for a tag nobody has ruled on, and it ships in
// the code. These rules are PROPOSALS, reviewed one group at a time in
// /dev/scoring → Taxonomy → Review, and accepting one writes
// tag_category_override rows, which win over the heuristic. Two reasons that is
// the right split rather than growing tags.ts's sets:
//
//  1. A word set in tags.ts changes what every existing tag scores as, silently,
//     on deploy. An override is a row Nils clicked, and the admin table shows
//     which tags carry one.
//  2. These lists are opinions about a specific catalog. Half of them ("bink
//     video" is noise, "deckbuilding" is a mechanic and not a genre) are worth
//     arguing about, and an argument you can only have by editing TypeScript is
//     one nobody has.
//
// ⚠️ Keys are the NORMALIZED form from `tagKey()`: lowercase, with hyphens,
// underscores and whitespace folded to single spaces, and EVERYTHING ELSE LEFT
// ALONE. So "Turn-based strategy (TBS)" is `turn based strategy (tbs)` with the
// brackets intact, and "Hack and slash/Beat 'em up" keeps its slash and its
// apostrophe. Writing "turn based strategy tbs" here matches nothing, quietly.

export interface TagRule {
  /** Stable identity. A dismissal is remembered against this, so never reuse one. */
  id: string;
  title: string;
  /** The one-line case for the move, shown on the card. */
  why: string;
  /** Target category id. Must exist, or be created by `creates` below. */
  category: string;
  /** Set when the rule's target category does not exist yet. */
  creates?: { id: string; label: string };
  words?: string[];
  patterns?: RegExp[];
}

// Order matters: a tag lands in the FIRST rule that matches it, so the
// bookkeeping rules come first (they are the most mechanical and the least
// arguable) and the broad content buckets come last.
export const TAG_RULES: TagRule[] = [
  {
    id: "store-plumbing",
    title: "Store and platform plumbing",
    why: "Facts about how a game is sold or what the launcher supports. True for the game, and nothing at all about whether you would like it.",
    category: "meta",
    patterns: [
      /^steam\b/,
      /^playstation (trophies|network|plus|experience|now|vr)\b/,
      /^xbox\b/,
      /^previously on\b/,
      /^available on\b/,
      /^games with\b/,
      /^retail games with\b/,
      /^media type\b/,
      /\b(4k ultra hd|ultra hd|hdr10|ray tracing|dlss|fsr|\d{2,3} fps)\b/,
    ],
    words: [
      "achievements", "digital distribution", "humble bundle", "controller support",
      "full controller support", "partial controller support", "ea app", "epic games store",
      "gog", "origin", "uplay", "downloadable content", "dlc", "platform exclusive",
      "console exclusive", "timed exclusive", "bink video", "60 fps on consoles",
      "wasd movement", "touch controls", "mouse only", "keyboard only", "cloud saves",
      "steamworks", "denuvo", "drm free", "early access", "game preview",
      "crowd funded", "game reference", "protagonist's name in the title",
      "remastered", "remaster", "port", "re release", "collectors edition",
      "season pass", "microtransactions", "in app purchases", "battle pass",
      "cross platform multiplayer", "cross save", "vr only", "vr supported",
      "playstation trophies", "achievements hunting", "free to play", "freeware",
      "shareware", "controller recommendation", "language selection",
      "auto saving", "unlockables", "compilation", "you can pet the dog",
    ],
  },
  {
    id: "event-noise",
    title: "Trade shows, award nominations and funding history",
    why: "Where a game was shown or what it was nominated for. It says a lot about a game's year and nothing about its content, and it is the single biggest cluster in Other.",
    category: "meta",
    patterns: [
      /^(pax|gamescom|e3|gdc|tokyo game show|the game awards|game critics awards|golden joystick|bafta|dice awards)\b/,
      /\b(pax (east|west|prime|south)|gamescom|e3|tgs)\s*\d{4}\b/,
      /^crowdfunding\b/,
      /^kickstarter\b/,
      /^(indiegogo|fig)\b/,
    ],
    words: [
      "steam greenlight", "pre release public testing", "public beta", "closed beta",
      "open beta", "licensed game", "original soundtrack release", "soundtrack release",
      "limited run games", "physical release", "day one patch",
    ],
  },
  {
    id: "modes",
    title: "How many people play, and how",
    why: "Single player, co-op, PvP and the rest. This is a real axis people filter on, and the Modes category currently holds three tags.",
    category: "modes",
    // ⚠️ `modes`, `objects-elements` and `people-characters` were created BY
    // HAND in the live DB and are not in tags.ts's CATEGORIES, so a fresh
    // database has no row for any of them. Without a `creates`, accepting this
    // on such a database would write overrides pointing at an id that does not
    // exist, and `groupTagsByCategory` buckets an unresolvable id back into
    // Other — the accept would appear to do nothing at all. On Nils's DB the
    // rows exist, so the sweep reports `createsCategory: null` and this is
    // never used.
    creates: { id: "modes", label: "Modes" },
    words: [
      "co op", "online co op", "local co op", "co operative", "cooperative",
      "pvp", "pve", "pvpve", "multiplayer", "single player", "singleplayer",
      "single player only", "local multiplayer", "online multiplayer", "online",
      "split screen", "team based", "competitive", "party", "party game",
      "mmo", "massively multiplayer online", "class based", "death match",
      "asynchronous multiplayer", "drop in drop out", "hotseat", "lan party",
      "versus", "1v1", "4 player local", "6 player local", "co op campaign",
      "campaign", "story campaign", "sandbox mode", "new game plus",
      "asymmetric multiplayer", "matchmaking", "dedicated servers",
    ],
  },
  {
    id: "perspective",
    title: "Camera and viewpoint",
    why: "First person, isometric, side scrolling. A separate axis from genre that games carry and film does not, and it is currently scattered across Other.",
    category: "perspective",
    creates: { id: "perspective", label: "Perspective & View" },
    words: [
      "first person", "third person", "top down", "top-down", "isometric",
      "side scrolling", "side scroller", "2.5d", "over the shoulder",
      "birds eye view", "fixed camera", "free camera", "third person shooter view",
      "first person perspective", "third person perspective",
      "orthographic", "dual perspective",
    ],
  },
  {
    id: "mechanics",
    title: "Systems you actually interact with",
    why: "Crafting, permadeath, deckbuilding, dialogue trees. Genre says what kind of game it is; these say what you spend the hours doing, and the taxonomy has nowhere to put them.",
    category: "mechanics",
    creates: { id: "mechanics", label: "Mechanics" },
    words: [
      "crafting", "base building", "building", "construction", "resource management",
      "deckbuilding", "deck building", "procedural generation", "permadeath",
      "leveling up", "grinding", "loot", "looting", "upgradeable weapons",
      "customization", "customizable characters", "character customization",
      "dialogue trees", "multiple endings", "choices matter", "choose your own adventure",
      "branching narrative", "time limit", "backtracking", "bullet time",
      "slow motion", "minigames", "boss fight", "boss battle", "level selection",
      "physics", "day/night cycle", "day night cycle", "weather", "dynamic weather",
      "inventory management", "skill tree", "talent tree", "crafting system",
      "stealth", "cover system", "quick time events", "puzzle solving",
      "moddable", "mod support", "user generated content", "level editor",
      "auto save", "manual save", "save points", "checkpoints", "difficulty options",
      "hunger", "stamina", "fast travel", "map", "waypoints", "loot boxes",
      "aim down sights", "melee", "ranged combat", "real time combat",
      "combo", "parry", "dodge roll", "wall jump", "double jump", "grappling hook",
      "destructible environments", "destruction", "gravity", "teleportation",
      "time travel mechanic", "rewind",
      "crafting recipes", "trading", "economy simulation", "tower building",
      // Things you DO. Steam and IGDB both tag these heavily, and they are the
      // single biggest uncovered cluster after the bookkeeping ones.
      "exploration", "parkour", "climbing", "swimming", "flight", "flying",
      "driving", "skateboarding", "cooking", "singing", "dancing", "fishing",
      "mining", "hunting", "farming", "sailing", "diving", "racing mechanic",
      "swordplay", "sword fight", "hand to hand combat", "vehicular combat",
      "kung fu", "martial arts combat", "gunplay", "shooting", "throwing weapons",
      "sniping", "grid based movement", "side quests", "world map", "fast paced combat",
      "rpg elements", "summoning support", "twin stick control", "mission",
      "missions", "quests", "crafting materials", "base defense", "wave defense",
      "turn order", "cooldowns", "combo system", "stealth kills", "hacking minigame",
      "archery", "melee combat", "vehicle combat", "capture the flag",
      "collectibles", "moral decisions", "time management", "automation",
      "replay value", "explorable world", "street racing", "car race",
      "rescue mission", "smuggling (contraband)", "level up", "respawn",
    ],
  },
  {
    id: "genre-games",
    title: "Game genres the heuristic never learned",
    why: "The Genre set in tags.ts was written for TMDB and Trakt. These are the IGDB and Steam genre names for the same idea, so they read as Other while their film equivalents read as Genre.",
    category: "genre",
    words: [
      "simulator", "simulation game", "action adventure", "platform", "platformer game",
      "sandbox", "hack and slash/beat 'em up", "beat 'em up", "brawler",
      "turn based strategy (tbs)", "turn based strategy", "turn based tactics",
      "turn based combat", "turn based", "tactical turn based combat",
      "real time strategy (rts)", "rts", "real time tactics", "real time strategy",
      "tactical rpg", "party based rpg", "action roguelike",
      "roguelike deckbuilder", "card battler", "card & board game", "card game",
      "sport", "point & click", "walking simulator", "shoot 'em up", "shmup",
      "bullet hell", "interactive fiction", "immersive sim", "mmorpg",
      "run and gun", "3d platformer", "2d platformer", "puzzle platformer",
      "precision platformer", "dungeon crawler", "looter shooter", "4x",
      "4x (explore, expand, exploit, and exterminate)",
      "arena shooter", "hero shooter", "auto battler", "idle game", "clicker",
      "rhythm game", "music and rhythm", "typing game", "rail shooter",
      "survival craft", "open world survival craft", "life sim",
      "dating sim", "automobile sim", "flight simulator", "farming sim",
      "city builder", "grand strategy", "wargame", "roguevania",
      // film / TV genres the set also missed
      "sitcom", "murder mystery", "psychological drama", "historical drama",
      "urban fantasy", "sword & sorcery", "sword and sorcery", "romcom",
      "gothic horror", "body horror", "wuxia", "space adventure", "courtroom drama",
      "medical drama", "police procedural", "docuseries", "docudrama",
      "coming of age story", "revenge thriller", "creature feature",
      "tactical", "management", "board game", "rhythm", "soulslike",
      "boomer shooter", "strategy rpg", "crpg", "isekai", "ecchi", "harem",
      "mecha anime", "shoot em up", "metroidvania game", "puzzle game",
      "adventure game", "horror game", "action game", "strategy game",
      "racing game", "sports game", "fighting game", "stealth game",
      "party based", "hero collector", "gacha", "roguelike action",
      "political thriller", "turn based rpg", "old school", "playing cards", "dice",
    ],
    patterns: [
      // "Automobile Sim", "Flight Simulator", "Life Sim". Providers coin these
      // endlessly and every one of them names a kind of game.
      / (simulator|sim)$/,
    ],
  },
  {
    id: "characters",
    title: "Who is in it",
    why: "Roles, archetypes and creatures. People & Characters was created for exactly this and holds eight tags.",
    category: "people-characters",
    creates: { id: "people-characters", label: "People & Characters" },
    words: [
      "mother", "father", "daughter", "son", "sister", "brother", "grandmother",
      "grandfather", "teacher", "priest", "nun", "pilot", "journalist", "singer",
      "writer", "hacker", "widow", "widower", "single mother", "single father",
      "teenage girl", "teenage boy", "high school student", "college student",
      "nazi", "outlaw", "prostitute", "native american", "chosen one",
      "super villain", "female villain", "male villain", "crime fighter",
      "mad scientist", "grim reaper", "silent protagonist", "male protagonist",
      "multiple protagonists", "one man army",
      "wizards", "witches", "dwarf", "orcs", "gods", "goddess",
      "fairy", "fairies", "werewolf", "skeleton", "ghosts", "demons", "monsters",
      "undead", "giant monster", "superhero team", "space marine",
      "vampire hunter (slayer)", "best friend", "neighbor", "war veteran",
      "drug dealer", "cannibal", "human", "humans", "animals", "pets",
      "robots", "aliens", "mutants", "zombies", "spirit", "spirits",
      "east asian lead", "female lead", "male lead", "ensemble cast",
      "anti villain", "sidekick", "mentor", "rebel", "bounty hunter",
      "cowboy", "gladiator", "viking", "wizard apprentice", "child protagonist",
      "talking animals", "dinosaurs", "dragons", "giants", "trolls", "goblins",
      "usa president", "sheriff", "police detective", "lawyer", "professor",
      "inventor", "sniper", "fugitive", "thief", "assassins", "crime boss",
      "child hero", "teen superhero", "killer", "general", "dracula",
      "non humanoid protagonist", "fox", "goat", "lion", "deer", "gorilla",
      "insects", "black protagonist", "masked superhero", "police officer",
      "special forces", "monk", "nasa", "astronauts",
    ],
  },
  {
    id: "objects",
    title: "Things and creatures on screen",
    why: "Helicopters, swords, horses, spaceships. Objects & Elements exists as a category and has never had a single tag in it.",
    category: "objects-elements",
    creates: { id: "objects-elements", label: "Objects / Elements" },
    words: [
      "helicopter", "explosion", "sword", "swords", "katana", "bow and arrow",
      "horse", "bird", "dog", "cat", "chicken", "shark", "wolf",
      "rabbit", "fish", "bear", "snake", "spider", "motorcycle", "airplane",
      "tank", "train", "ship", "boat", "submarine", "car", "cars", "truck",
      "spaceship", "mech", "guitar", "piano", "camera", "moon",
      "snow", "rain", "fire", "water", "traps", "maze", "portals", "keys",
      "treasure", "gold", "guns", "gun", "knife", "shield", "armor",
      "magic sword", "artifact", "book", "letter", "photograph", "mirror",
      "clock", "bomb", "explosives", "grenade", "chainsaw", "flamethrower",
      "sniper rifle", "shotgun", "laser", "robot suit", "power armor",
    ],
  },
  {
    id: "artstyle-extra",
    title: "Visual presentation",
    why: "Art Style holds 23 tags. These describe how the thing looks and nothing else.",
    category: "artstyle",
    words: [
      "3d animation", "2d animation", "live action and animation", "polygonal 3d",
      "black and white", "colorful", "colourful", "monochrome", "sepia",
      "hand painted", "cel shading", "vector art", "isometric art", "abstract",
      "surreal visuals", "photorealism", "motion capture", "rotoscope",
      "claymation style", "papercraft", "silhouette", "neon", "vaporwave",
      "flat design", "sprite based", "voxel art", "ascii", "text based",
    ],
  },
  {
    id: "audience-format",
    title: "Who it is for, and what shape it comes in",
    why: "Content warnings and format words. Audience / Format holds 14 tags, and content ratings are the one axis where a wrong bucket is worth more than a tidier list.",
    category: "audience",
    words: [
      "nudity", "sexual content", "profanity", "strong language", "gore content",
      "violent content", "drug reference", "mature content", "family friendly",
      "for kids", "kid friendly", "episodic", "one shot", "web series",
      "independent film", "student film", "made for tv", "direct to video",
      "vr", "virtual reality", "augmented reality", "mobile game", "browser game",
      "handheld", "arcade cabinet", "audio description", "subtitles",
      "sign language", "colorblind mode", "accessibility options",
      "short game", "long game", "replayable",
    ],
  },
  {
    id: "mood-extra",
    title: "How it feels",
    why: "Tone words the Trakt-derived Mood set never saw, mostly from Steam.",
    category: "mood",
    words: [
      "bloody", "cute", "cinematic", "darkness", "gothic", "insanity",
      "classic", "parody", "relaxing", "dark humor", "angst", "melancholy",
      "philosophical", "difficult", "fast paced", "immersive",
      "story rich", "story driven", "informative", "allegory", "evil", "chaos",
      "loneliness", "bravery", "hopeless", "uplifting",
      "unforgiving", "punishing", "chill", "cozy", "wholesome games",
      "tense atmosphere", "dread", "unsettling", "hilarious comedy", "slapstick",
      "irreverent", "sincere", "earnest", "sentimental", "moody", "bleak",
      "affectation", "blunt", "wistful", "anxious", "macabre", "hostility",
      "cliché", "slapstick comedy", "alternative reality",
    ],
  },
  {
    id: "setting-extra",
    title: "Where and when",
    why: "Places, eras and worlds. The Setting set covers film locations well and game worlds badly.",
    category: "setting",
    patterns: [
      // ⚠️ The generalized "City, Region" shape, which is where most of the
      // long tail's place names live. `PLACE_RX` in tags.ts does the same job
      // against a FIXED list of about a dozen countries, so it catches
      // "london, england" and misses "philadelphia, pennsylvania" and every
      // other one nobody thought to name.
      //
      // The trailing half is letters and spaces only, with no closing bracket,
      // which is what keeps it off "4x (explore, expand, exploit, and
      // exterminate)" — a comma is a weak signal on its own.
      /^[a-z0-9' .-]+,\s+[a-z][a-z .]{2,}$/,
      /\b(planet|kingdom of|republic of|island of)\b/,
    ],
    words: [
      "futuristic", "distant future", "england", "france", "italy", "europe",
      "asia", "africa", "russia", "china", "korea", "mexico", "brazil", "india",
      "california", "new mexico", "modern warfare", "warfare", "battlefield",
      "afterlife", "fairy tale", "alien planet", "parallel world", "school life",
      "japanese high school", "church", "hotel", "circus", "beach", "sea",
      "ocean", "space battle", "norse mythology", "greek mythology", "occult",
      "zombie apocalypse", "end of the world", "nature",
      "swamp", "cave", "caves", "ruins", "temple", "laboratory", "factory",
      "spaceship interior", "abandoned building", "graveyard", "cemetery",
      "farm", "ranch", "casino", "nightclub", "bar", "restaurant", "museum",
      "library", "arena", "coliseum", "battlefield setting", "trench warfare",
      "vietnam war", "korean war", "napoleonic wars", "american civil war",
      "prohibition", "renaissance", "stone age", "bronze age", "industrial revolution",
      "modern military", "school of witchcraft", "exotic island", "sandstorm",
      "egypt", "hell", "heaven", "amusement park", "underground world",
      "space colony", "planet mars", "new year s eve", "jail", "motel",
      "germany", "florida", "las vegas", "galaxy", "underground",
      "world war ii ww2", "world war i ww1",
    ],
  },
  {
    id: "theme-extra",
    title: "What it is about",
    why: "The broad content bucket, and the one to accept last: whatever the rules above do not claim usually belongs here.",
    category: "theme",
    words: [
      "illness", "disease", "grief", "trauma", "childhood trauma", "depression",
      "alcoholism", "drug addiction", "capitalism", "philosophy", "transhumanism",
      "reincarnation", "time loop", "time manipulation", "time skip", "hacking",
      "gambling", "training", "infidelity",
      "first love", "bromance", "female friendship", "male friendship", "friends",
      "teamwork", "money", "business", "economy", "robbery",
      "bank robbery", "rape", "child abuse", "prophecy", "resistance",
      "secret society", "breaking the fourth wall", "narration", "man vs machine",
      "good vs evil", "easter egg", "voice acting", "memory", "memory loss",
      "missing person", "mind control", "hallucination", "self sacrifice",
      "wedding", "car accident", "car crash", "photography",
      "mutation", "black magic", "lovecraftian", "experiment", "death game",
      "street gang", "police corruption", "artificial intelligence",
      "artificial intelligence a i", "cybernetics", "hostages",
      "great soundtrack", "esports", "video game", "licensed music",
      "loss", "regret", "forgiveness", "guilt", "identity", "legacy",
      "class struggle", "propaganda", "surveillance", "censorship", "genocide",
      "colonialism", "migration", "poverty", "homelessness", "grief and loss",
      "race against time", "supernatural power", "travel", "lgbtq+", "lgbtq",
      "paranormal", "symbolism", "anti war", "social satire", "social issues",
      "faith", "christianity", "religion and faith", "journalism", "double life",
      "dual identity", "con artist", "treasure hunt", "natural disaster",
      "infection", "exorcism", "power struggle", "government", "fascism",
      "imprisonment", "pregnancy", "funeral", "fear", "sadness", "questioning",
      "basketball", "football (soccer)", "baseball", "boxing", "wrestling",
      "guitar playing", "central intelligence agency cia",
      "central intelligence agency (cia)", "mafia", "yakuza", "gangs",
      "drug trafficking", "suicide attempt", "terminal illness", "exploitation",
      "time", "time machine", "hiding", "fate", "poison", "corpse",
      "semi autobiographical", "narrative", "evolution", "theft", "smuggling",
      "police brutality", "marijuana", "immigrant", "alcoholic", "lesbian",
      "absurdism", "biting", "paranoid", "loving", "moral choice",
    ],
    patterns: [
      // "father son relationship", "sister sister relationship" and the two
      // dozen other shapes TMDB emits. The THEME set in tags.ts lists nine of
      // them one by one; this is the same idea without the guessing.
      /(relationship|friendship)$/,
    ],
  },
];

// Categories a rule may create. Kept separate from CATEGORIES in tags.ts on
// purpose: those are the code's built-in taxonomy and seed a fresh DB, while
// these only ever exist if Nils accepts the suggestion that proposes one.
export function proposedCategories(): { id: string; label: string; ruleId: string }[] {
  return TAG_RULES.flatMap((r) => (r.creates ? [{ ...r.creates, ruleId: r.id }] : []));
}

// One Map for every word in every rule, built once. The obvious
// `r.words.includes(key)` inside the loop is 12 rules x ~70 words x 6,000 tags
// of string comparison per generation, which is exactly the shape of the
// "signature-check once per PASS, not once per item" rule.
const WORD_INDEX = new Map<string, TagRule>();
for (const r of TAG_RULES) {
  for (const w of r.words ?? []) if (!WORD_INDEX.has(w)) WORD_INDEX.set(w, r);
}

/** The first rule that claims this key, or null. Words win over patterns. */
export function ruleFor(key: string): TagRule | null {
  const byWord = WORD_INDEX.get(key);
  if (byWord) return byWord;
  for (const r of TAG_RULES) {
    if (r.patterns?.some((p) => p.test(key))) return r;
  }
  return null;
}
