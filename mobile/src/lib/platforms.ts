// Where each title in the catalog can be played or watched, on the device.
//
// The Worker answers for the whole pool at once, per country (`/v1/catalog/
// platforms`): game platforms and streaming services as the providers name
// them. The device keeps that answer and turns names into the site's keys
// (`@/lib/platformKeys`), which is what the "Available on" filter and the
// "Your platforms" picker both speak. Asked once a day, and again when the
// country changes, because a streaming line-up belongs to a country.

import type { SQLiteDatabase } from 'expo-sqlite';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { availableOnKeys, platformOptions, type PlatformOption } from '@/lib/platformKeys';
import { api } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { getMeta, inTransaction, setMeta } from '~/lib/db';

const SYNCED_KEY = 'platforms_synced';

/** What one title is on, in the shape `platformKeys` reads. */
interface Availability { platforms?: string[]; streamingProviders?: { name: string }[] }

export interface PlatformIndex {
  /** Platform keys per item id. An item with no row is one we hold no availability for. */
  keysOf: (id: string | null) => string[] | undefined;
  /** The options a set of items offers, most common first. */
  optionsFor: (ids: Iterable<string | null>) => PlatformOption[];
  size: number;
}

let revision = 0;
let cached: { revision: number; value: PlatformIndex } | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The stamp of an up-to-date copy: this country's, fetched today (UTC). */
const stampFor = (region: string) => `${region}:${new Date().toISOString().slice(0, 10)}`;

/**
 * Fetch the country's answer if the device's copy is another country's or
 * another day's. A failure leaves the old copy in place: a stale filter is
 * better than an empty one.
 */
export function syncPlatforms(db: SQLiteDatabase, region: string): Promise<void> {
  running ??= (async () => {
    const stamp = stampFor(region);
    if ((await getMeta(db, SYNCED_KEY)) === stamp) return;
    const answer = await api.catalogPlatforms(region);
    await inTransaction(db, async () => {
      await db.runAsync('DELETE FROM item_platform');
      const put = await db.prepareAsync('INSERT OR REPLACE INTO item_platform (media_item_id, grp, names) VALUES (?, ?, ?)');
      try {
        for (const [id, names] of Object.entries(answer.games)) await put.executeAsync([id, 'p', JSON.stringify(names)]);
        for (const [id, names] of Object.entries(answer.streaming)) await put.executeAsync([id, 's', JSON.stringify(names)]);
      } finally {
        await put.finalizeAsync();
      }
      await setMeta(db, SYNCED_KEY, stamp);
    });
    revision++;
    for (const l of listeners) l();
  })().finally(() => { running = null; });
  return running;
}

async function loadIndex(db: SQLiteDatabase): Promise<PlatformIndex> {
  if (cached?.revision === revision) return cached.value;
  const at = revision;
  const rows = await db.getAllAsync<{ media_item_id: string; grp: string; names: string }>(
    'SELECT media_item_id, grp, names FROM item_platform',
  );
  const byItem = new Map<string, { item: Availability; keys: string[] }>();
  for (const r of rows) {
    let names: string[] = [];
    try { names = (JSON.parse(r.names) as unknown[]).filter((n): n is string => typeof n === 'string'); } catch { /* an unreadable row is no row */ }
    const item: Availability = r.grp === 'p' ? { platforms: names } : { streamingProviders: names.map((name) => ({ name })) };
    const keys = availableOnKeys(item);
    if (keys.length) byItem.set(r.media_item_id, { item, keys });
  }
  const value: PlatformIndex = {
    size: byItem.size,
    keysOf: (id) => (id ? byItem.get(id)?.keys : undefined),
    optionsFor: (ids) => {
      const items: Availability[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const hit = byItem.get(id);
        if (hit) items.push(hit.item);
      }
      return platformOptions(items);
    },
  };
  cached = { revision: at, value };
  return value;
}

/**
 * The platform index, kept current. Null until the device's copy is read; a
 * screen that filters on it must treat null as "not known yet", not as "none".
 */
export function usePlatformIndex(enabled = true): PlatformIndex | null {
  const db = useSQLiteContext();
  const { region } = useAuth();
  const [index, setIndex] = useState<PlatformIndex | null>(cached?.revision === revision ? cached.value : null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadIndex(db).then((v) => { if (live) setIndex(v); });
    void syncPlatforms(db, region).catch((e: unknown) => {
      console.warn('platforms_sync_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    });
    return () => { live = false; };
  }, [db, region, enabled, tick]);

  return index;
}

/** The ids of everything on your library and wishlist: what "Your platforms" surveys. */
export async function shelfItemIds(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT DISTINCT media_item_id AS id FROM item_state WHERE relation IN ('library', 'wishlist')",
  );
  return rows.map((r) => r.id);
}
