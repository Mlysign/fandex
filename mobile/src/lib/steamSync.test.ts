import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import { planSteamSync } from './steamSync';
import { TraktSyncRefused, type LocalItemRow } from './traktSync';

// What a Steam sync writes. The property under test is the prune invariant's:
// nothing is deleted on a run that could not match every app, and never more
// than a tenth of what the account holds from Steam.

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const ids = new Map([['10', A], ['20', B], ['30', C]]);
const row = (mediaItemId: string, relation: string, status: string | null, reviewedAt: number | null, rating: number | null = null): LocalItemRow =>
  ({ mediaItemId, relation, status, rating, review: null, reviewedAt });

describe('a Steam sync plan', () => {
  it('writes owned and played games, and the wishlist, and nothing that already matches', () => {
    const plan = planSteamSync({
      pull: {
        library: [{ appid: 10, playtime: 0, lastPlayed: null }, { appid: 20, playtime: 300, lastPlayed: 1790000000 }],
        wishlist: [{ appid: 30, addedAt: 1700000000 }],
      },
      ids, deferred: 0,
      localItems: [row(A, 'library', 'owned', null)],
    });
    expect(plan.itemUpserts).toEqual([
      { mediaItemId: B, source: 'steam', relation: 'library', status: 'played', rating: null, review: null, reviewedAt: 1790000000 },
      { mediaItemId: C, source: 'steam', relation: 'wishlist', status: null, rating: null, review: null, reviewedAt: null, addedAt: 1700000000 },
    ]);
    expect(plan.itemDeletes).toEqual([]);
  });

  it('keeps a rating a row already carries, and moves an owned game to played', () => {
    const plan = planSteamSync({
      pull: { library: [{ appid: 10, playtime: 60, lastPlayed: 1790000000 }], wishlist: [] },
      ids, deferred: 0,
      localItems: [row(A, 'library', 'owned', null, 8)],
    });
    expect(plan.itemUpserts).toEqual([
      { mediaItemId: A, source: 'steam', relation: 'library', status: 'played', rating: 8, review: null, reviewedAt: 1790000000 },
    ]);
  });

  it('removes what Steam no longer lists, but nothing on a run that could not match every app', () => {
    const local = [row(A, 'library', 'owned', null), row(B, 'wishlist', null, null)];
    const pull = { library: [{ appid: 10, playtime: 0, lastPlayed: null }], wishlist: [] };
    expect(planSteamSync({ pull, ids, deferred: 0, localItems: local }).itemDeletes).toEqual([
      { mediaItemId: B, source: 'steam', relation: 'wishlist' },
    ]);
    expect(planSteamSync({ pull, ids, deferred: 3, localItems: local }).itemDeletes).toEqual([]);
  });

  it('refuses a run that would delete more than a tenth of a large Steam library', () => {
    const many = Array.from({ length: 300 }, (_, i) => row(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'library', 'owned', null));
    expect(() => planSteamSync({ pull: { library: [], wishlist: [] }, ids, deferred: 0, localItems: many })).toThrow(TraktSyncRefused);
  });

  it('counts an app with no catalog title as unmatched, and writes nothing for it', () => {
    const plan = planSteamSync({ pull: { library: [{ appid: 999, playtime: 5, lastPlayed: null }], wishlist: [] }, ids, deferred: 0, localItems: [] });
    expect(plan).toEqual({ itemUpserts: [], itemDeletes: [], unmatched: 1 });
  });
});
