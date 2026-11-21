// Every title in YOUR language, on every screen (Nils, 2026-11-21: "the title
// should use the language of the account").
//
// The vector carries a title per language (`titles`, src/lib/titles.ts; "" is
// the same as the title itself). `catalog.title`, which every screen already
// reads, holds the title in the languages of the country this device is set
// to: its own languages, then English, then the catalog's title. The catalog
// sync writes a row's title the same way (catalogSync.ts, `storePage`), and a
// change of country rewrites every row once, from what the device holds: no
// request. `norm_title` stays the catalog's own title, the matcher's key.
//
// The other names find a title in Search (`catalogSearchNames`), never shown.

import type { SQLiteDatabase } from 'expo-sqlite';
import { displayTitle, searchTitles, titleLanguagesFor } from '@/lib/titles';
import type { ItemVector } from '~/lib/api';
import { inTransaction } from '~/lib/db';

/** The `meta` key naming the languages `catalog.title` is in, best first ("de,en"). */
export const TITLE_LANGS_KEY = 'title_langs';

/** The languages `catalog.title` is in, or [] before the first switch (the catalog's own title). */
export async function titleLangs(db: SQLiteDatabase): Promise<string[]> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [TITLE_LANGS_KEY]);
  return row?.value ? row.value.split(',') : [];
}

/** The title a row is written with, for a device reading `langs`. */
export const localTitle = (v: Pick<ItemVector, 'title' | 'titles'>, langs: readonly string[]): string => displayTitle(v, langs);

/**
 * The SQL for a row's title in `langs`: the first language its vector knows
 * ("" reads as the title itself), else the title. Pure, so it has a test
 * against `localTitle`. The language codes go in as parameters.
 */
export function localTitleSql(langs: readonly string[]): { expr: string; params: string[] } {
  const own = "json_extract(vector, '$.title')";
  const parts = langs.map(() => `CASE json_extract(vector, ?) WHEN '' THEN ${own} ELSE json_extract(vector, ?) END`);
  return {
    expr: `COALESCE(${[...parts, own].join(', ')})`,
    params: langs.flatMap((l) => [`$.titles.${l}`, `$.titles.${l}`]),
  };
}

/**
 * Point `catalog.title` at `region`'s languages. Returns whether anything
 * moved. One UPDATE over the catalog when the languages change, nothing on
 * every other start.
 */
export async function pointTitlesAt(db: SQLiteDatabase, region: string | null | undefined): Promise<boolean> {
  const langs = titleLanguagesFor(region);
  const key = langs.join(',');
  if ((await titleLangs(db)).join(',') === key) return false;
  const { expr, params } = localTitleSql(langs);
  await inTransaction(db, async () => {
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [TITLE_LANGS_KEY, key]);
    await db.runAsync(`UPDATE catalog SET title = ${expr} WHERE title IS NOT ${expr}`, [...params, ...params]);
  });
  return true;
}

/**
 * The names each title may also be found by in Search, beyond the one shown:
 * its catalog title, English, the device's languages and the search-only names
 * (titles.ts, `searchTitles`). Only rows that have any; read once per pool.
 */
export async function catalogSearchNames(db: SQLiteDatabase): Promise<Map<string, string[]>> {
  const langs = await titleLangs(db);
  const rows = await db.getAllAsync<{ id: string; title: string; titles: string | null; aka: string | null }>(
    `SELECT id, json_extract(vector, '$.title') AS title, json_extract(vector, '$.titles') AS titles, json_extract(vector, '$.aka') AS aka
       FROM catalog WHERE json_extract(vector, '$.titles') IS NOT NULL OR json_extract(vector, '$.aka') IS NOT NULL`,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    try {
      out.set(r.id, searchTitles({
        title: r.title,
        titles: r.titles ? (JSON.parse(r.titles) as Record<string, string>) : null,
        aka: r.aka ? (JSON.parse(r.aka) as string[]) : null,
      }, langs.length ? langs : ['en']));
    } catch { /* a row that will not parse is found by its shown title alone */ }
  }
  return out;
}
