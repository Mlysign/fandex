// What a poster card needs to know, and what its two buttons do.
//
// The site's card (src/components/cardItem.ts, useQuickActions.ts) asked the
// server about each title. Here your rows are on the device, so a whole grid's
// state is one query, and an action goes through the same write path as the
// item page (lib/itemActions.ts): Trakt, then the Worker, then the device.

import { useRouter } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type MediaType } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { CatalogRow } from '~/lib/db';
import { rateItem, setWishlist, type ActionTarget } from '~/lib/itemActions';
import { TraktAuthError } from '~/lib/trakt';

/** One title on a card. Either a catalog row (`id`) or a provider's title nobody holds yet (`source` + `sourceId`). */
export interface CardItem {
  /** The key in a list. A catalog id, or `source:type:sourceId`. */
  key: string;
  id: string | null;
  source?: string;
  sourceId?: string;
  type: MediaType;
  title: string;
  slug?: string | null;
  releaseDate: string | null;
  posterUrl: string | null;
  /** The crowd's rating, 0 to 100. */
  communityScore: number | null;
  communityVotes?: number;
  /** A score worked out for this card alone, from less than the full title: Home's recommendations. */
  fandexScore?: number | null;
}

export function cardFromCatalog(r: CatalogRow): CardItem {
  return {
    key: r.id, id: r.id, type: r.type, title: r.title, slug: r.slug, releaseDate: r.release_date,
    posterUrl: r.poster_url, communityScore: r.community_score, communityVotes: r.community_votes,
  };
}

/** Where a card leads. A provider title goes through /open, which asks the Worker to find or fetch it. */
export function cardHref(item: CardItem): string {
  return item.id ? `/item/${item.id}` : `/open/${item.source}/${item.type}/${item.sourceId}`;
}

export interface CardState { rating: number | null; wishlisted: boolean; inLibrary: boolean }

const NOTHING: CardState = { rating: null, wishlisted: false, inLibrary: false };

/** Your state for a set of titles: one query, re-run when your rows change. */
export function useCardStates(ids: (string | null)[]): (id: string | null) => CardState {
  const db = useSQLiteContext();
  const auth = useAuth();
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    let live = true;
    if (auth.status !== 'signedIn' || !key) {
      setStates(new Map());
      return;
    }
    void readStates(db, key.split(',')).then((m) => { if (live) setStates(m); });
    return () => { live = false; };
  }, [db, key, auth.status, auth.rowsRevision]);
  return useCallback((id) => (id ? states.get(id) ?? NOTHING : NOTHING), [states]);
}

async function readStates(db: SQLiteDatabase, ids: string[]): Promise<Map<string, CardState>> {
  const out = new Map<string, { ratings: number[]; wishlisted: boolean; inLibrary: boolean }>();
  // SQLite caps the parameters of one statement; 500 is far inside it.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.getAllAsync<{ media_item_id: string; relation: string; rating: number | null }>(
      `SELECT media_item_id, relation, rating FROM item_state WHERE media_item_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const r of rows) {
      const s = out.get(r.media_item_id) ?? { ratings: [], wishlisted: false, inLibrary: false };
      if (r.relation === 'wishlist') s.wishlisted = true;
      if (r.relation === 'library') {
        s.inLibrary = true;
        if (r.rating != null && r.rating > 0) s.ratings.push(r.rating);
      }
      out.set(r.media_item_id, s);
    }
  }
  // The rating shown is the average across the providers that hold one, as on the item page.
  return new Map([...out].map(([id, s]) => [id, {
    wishlisted: s.wishlisted, inLibrary: s.inLibrary,
    rating: s.ratings.length ? Math.round((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length) * 10) / 10 : null,
  }]));
}

/** The target a write needs: the title's id and the provider ids it is known by. */
async function targetFor(db: SQLiteDatabase, item: CardItem): Promise<ActionTarget> {
  if (item.id) {
    const row = await db.getFirstAsync<{ vector: string }>('SELECT vector FROM catalog WHERE id = ?', [item.id]);
    if (row) {
      const sources = (JSON.parse(row.vector) as { sources?: ActionTarget['sources'] }).sources ?? [];
      return { id: item.id, type: item.type, sources };
    }
  }
  // Not on the device: a title nobody had acted on. The Worker finds or fetches it.
  const id = item.id ?? (await api.resolve(item.source as string, item.type, item.sourceId as string)).id;
  const detail = await api.item(id);
  return { id: detail.id, type: detail.type, sources: detail.vector.sources };
}

export function describeActionError(e: unknown): string {
  return e instanceof TraktAuthError ? 'Trakt needs you to sign in again. You can do that under You.'
    : e instanceof ApiError && e.code === 'offline' ? 'No connection. Nothing was changed.'
    : e instanceof ApiError && e.code === 'budget-exhausted' ? 'Fandex cannot save more changes until tomorrow.'
    : e instanceof ApiError ? 'Fandex could not save that. Nothing was changed.'
    : e instanceof Error ? e.message : 'That did not work. Nothing was changed.';
}

/**
 * Rate a title or put it on the wishlist, from a card. Signed out, either one
 * leads to sign-in: the buttons are shown to everybody, as on the site, because
 * a control that disappears reads as a missing feature.
 */
export function useCardActions(onError: (message: string) => void) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const signedIn = auth.status === 'signedIn';

  const run = useCallback((item: CardItem, write: (target: ActionTarget) => Promise<void>) => {
    if (!signedIn) {
      router.push('/profile');
      return;
    }
    setBusy(item.key);
    targetFor(db, item)
      .then(write)
      .then(() => {
        auth.rowsChanged();
        // A title that was not in the pool is now: the next catalog check brings it to the device.
        if (!item.id) catalog.sync();
      })
      .catch((e: unknown) => {
        console.warn('card_action_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        onError(describeActionError(e));
      })
      .finally(() => setBusy(null));
  }, [db, auth, catalog, router, signedIn, onError]);

  return {
    signedIn,
    busy,
    rate: useCallback((item: CardItem, rating: number | null) => run(item, (t) => rateItem(db, t, rating)), [run, db]),
    toggleWishlist: useCallback((item: CardItem, on: boolean) => run(item, (t) => setWishlist(db, t, on)), [run, db]),
  };
}
