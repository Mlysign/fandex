import { initDb, query } from "@/lib/db";
import { upsertMediaItem } from "@/lib/matcher";

initDb();

// Two DIFFERENT "Zilch" movies — same title + same year, different TMDB ids.
const a = upsertMediaItem({ source: "trakt", sourceId: "111", type: "movie", title: "Zilch", releaseDate: "2025-01-01", rawData: { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch", year: 2025 } });
const b = upsertMediaItem({ source: "trakt", sourceId: "222", type: "movie", title: "Zilch", releaseDate: "2025-06-01", rawData: { ids: { trakt: 222, tmdb: 2002 }, title: "Zilch", year: 2025 } });
console.log("two distinct same-title trakt movies are separate:", a !== b);

// tmdb 1001 must merge with A (matching its embedded tmdb), NOT B.
const t1 = upsertMediaItem({ source: "tmdb", sourceId: "1001", type: "movie", title: "Zilch", releaseDate: "2025-01-01", rawData: { id: 1001 } });
console.log("tmdb 1001 merges with A (not B):", t1 === a && t1 !== b);

// tmdb 2002 must merge with B.
const t2 = upsertMediaItem({ source: "tmdb", sourceId: "2002", type: "movie", title: "Zilch", releaseDate: "2025-06-01", rawData: { id: 2002 } });
console.log("tmdb 2002 merges with B:", t2 === b);

// Same movie from Letterboxd (cross-ref tmdb 1001) must merge with A.
const lb = upsertMediaItem({ source: "letterboxd", sourceId: "zilch", type: "movie", title: "Zilch", releaseDate: "2025-01-01", rawData: { id: "zilch", name: "Zilch", links: [{ type: "tmdb", id: 1001 }] } });
console.log("letterboxd via tmdb 1001 merges with A:", lb === a);

const items = query<{ c: number }>("SELECT COUNT(*) c FROM media_items WHERE norm_title = 'zilch'")[0];
const aLinks = query<{ source: string; source_id: string }>("SELECT source, source_id FROM media_links WHERE media_item_id = ?", [a]).map((l) => `${l.source}:${l.source_id}`).join(", ");
console.log("total 'Zilch' items:", items.c, "(expect 2)");
console.log("item A links:", aLinks, "(expect trakt:111, tmdb:1001, letterboxd:zilch)");
