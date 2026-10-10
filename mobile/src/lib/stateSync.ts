// Keeping the device's copy of YOUR rows in step with the Worker's.
//
// Unlike the catalog this is not a delta. The Worker answers a cheap question
// first (how many rows of each kind, and when the newest changed), and if that
// matches what the device saw last time, nothing is fetched. If it differs, the
// device pulls everything and replaces its copy.
//
// ⚠️ THE PRUNE INVARIANT, in its smallest form. The replace DELETES the old
// rows, so it must only ever run on a pull that finished. Every page is fetched
// into memory first, and the delete and the inserts are one transaction. A
// request that fails throws out of the fetch loop before anything local is
// touched, and the library on the device stays exactly as it was. A pull that
// "returned what it had so far" would turn a dropped connection into a
// half-empty library.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api, type EpisodeStateRow, type ItemStateRow, type StateCounts, type StateWrite } from '~/lib/api';
import { getMeta, setMeta, inTransaction } from '~/lib/db';

const SIGNATURE_KEY = 'state_signature';
/** A runaway guard. The Worker pages at 3,000 rows; no account is this many pages. */
const MAX_PAGES = 200;

export interface StateSyncResult {
  /** False when the Worker's answer matched what the device already holds. */
  changed: boolean;
  items: number;
  episodes: number;
  hidden: number;
}

function signature(c: StateCounts): string {
  return [c.items, c.itemsUpdatedAt, c.episodes, c.episodesUpdatedAt, c.hidden, c.hiddenUpdatedAt].join(':');
}

async function allItems(): Promise<ItemStateRow[]> {
  const out: ItemStateRow[] = [];
  let after: { mediaItemId: string; source: string; relation: string } | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.stateItems(after);
    out.push(...res.rows);
    if (res.done || !res.rows.length) return out;
    const last = res.rows[res.rows.length - 1];
    after = { mediaItemId: last.mediaItemId, source: last.source, relation: last.relation };
  }
  throw new Error('state pull did not finish');
}

async function allEpisodes(): Promise<EpisodeStateRow[]> {
  const out: EpisodeStateRow[] = [];
  let after: { mediaItemId: string; season: number; episode: number } | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.stateEpisodes(after);
    out.push(...res.rows);
    if (res.done || !res.rows.length) return out;
    const last = res.rows[res.rows.length - 1];
    after = { mediaItemId: last.mediaItemId, season: last.season, episode: last.episode };
  }
  throw new Error('state pull did not finish');
}

export async function syncState(db: SQLiteDatabase, force = false): Promise<StateSyncResult> {
  const counts = await api.stateCounts();
  const sig = signature(counts);
  if (!force && (await getMeta(db, SIGNATURE_KEY)) === sig) {
    return { changed: false, items: counts.items, episodes: counts.episodes, hidden: counts.hidden };
  }

  // Everything, in memory, BEFORE the first local write. See the header.
  const [items, episodes, hidden] = await Promise.all([allItems(), allEpisodes(), api.stateHidden()]);

  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM item_state');
    await db.runAsync('DELETE FROM episode_state');
    await db.runAsync('DELETE FROM hidden_item');

    const putItem = await db.prepareAsync(
      `INSERT OR REPLACE INTO item_state
         (media_item_id, source, relation, status, rating, review, reviewed_at, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const r of items) {
        await putItem.executeAsync([
          r.mediaItemId, r.source, r.relation, r.status, r.rating, r.review, r.reviewedAt, r.addedAt, r.updatedAt,
        ]);
      }
    } finally {
      await putItem.finalizeAsync();
    }

    const putEpisode = await db.prepareAsync(
      'INSERT OR REPLACE INTO episode_state (media_item_id, season, episode, watched_at, sources) VALUES (?, ?, ?, ?, ?)',
    );
    try {
      for (const e of episodes) {
        await putEpisode.executeAsync([e.mediaItemId, e.season, e.episode, e.watchedAt, JSON.stringify(e.sources ?? [])]);
      }
    } finally {
      await putEpisode.finalizeAsync();
    }

    for (const h of hidden.rows) {
      await db.runAsync('INSERT OR REPLACE INTO hidden_item (media_item_id, hidden_at) VALUES (?, ?)', [h.mediaItemId, h.hiddenAt]);
    }

    // Stored with the rows, in the same transaction. A signature that landed
    // without its rows would tell every later sync there was nothing to do.
    await setMeta(db, SIGNATURE_KEY, sig);
  });

  return { changed: true, items: items.length, episodes: episodes.length, hidden: hidden.rows.length };
}

/**
 * Mirror a write the Worker has ACCEPTED into the device's copy, so the
 * screen shows it without pulling everything again.
 *
 * The stored signature is left alone on purpose. It no longer matches the
 * Worker, so the next sync pulls the lot and replaces this approximation with
 * the truth (the Worker's own timestamps, and anything another device wrote).
 */
export async function applyLocalWrite(db: SQLiteDatabase, write: StateWrite): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await inTransaction(db, async () => {
    for (const k of write.items?.delete ?? []) {
      await db.runAsync('DELETE FROM item_state WHERE media_item_id = ? AND source = ? AND relation = ?', [k.mediaItemId, k.source, k.relation]);
    }
    for (const r of write.items?.upsert ?? []) {
      // The same rule the Worker applies to added_at: what was sent, else what
      // the row had, else now.
      await db.runAsync(
        `INSERT INTO item_state (media_item_id, source, relation, status, rating, review, reviewed_at, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT added_at FROM item_state WHERE media_item_id = ? AND source = ? AND relation = ?), ?), ?)
         ON CONFLICT(media_item_id, source, relation) DO UPDATE SET
           status = excluded.status, rating = excluded.rating, review = excluded.review,
           reviewed_at = excluded.reviewed_at, added_at = excluded.added_at, updated_at = excluded.updated_at`,
        [r.mediaItemId, r.source, r.relation, r.status, r.rating, r.review, r.reviewedAt,
         r.addedAt ?? null, r.mediaItemId, r.source, r.relation, now, now],
      );
    }
    for (const k of write.episodes?.delete ?? []) {
      await db.runAsync('DELETE FROM episode_state WHERE media_item_id = ? AND season = ? AND episode = ?', [k.mediaItemId, k.season, k.episode]);
    }
    for (const e of write.episodes?.upsert ?? []) {
      await db.runAsync(
        'INSERT OR REPLACE INTO episode_state (media_item_id, season, episode, watched_at, sources) VALUES (?, ?, ?, ?, ?)',
        [e.mediaItemId, e.season, e.episode, e.watchedAt, JSON.stringify(e.sources)],
      );
    }
  });
}

/** Signing out: the device forgets the account's rows. The Worker's copy is untouched. */
export async function clearState(db: SQLiteDatabase): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM item_state');
    await db.runAsync('DELETE FROM episode_state');
    await db.runAsync('DELETE FROM hidden_item');
    await db.runAsync('DELETE FROM meta WHERE key = ?', [SIGNATURE_KEY]);
  });
}
