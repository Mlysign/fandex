// The titles you asked not to be shown ("Hide from suggestions"), as a set of
// ids read off this device.
//
// The rule is the old site's (AGENTS.md, "which surfaces does a display
// preference reach"): every list that CHOOSES titles for you leaves them out,
// and a search by name still finds them. So Home's rails and Search's default
// list use this, and a typed query does not.

import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useAuth } from '~/lib/AuthProvider';

const NONE: ReadonlySet<string> = new Set();

export function useHiddenIds(): ReadonlySet<string> {
  const db = useSQLiteContext();
  const { rowsRevision } = useAuth();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    let live = true;
    void db.getAllAsync<{ media_item_id: string }>('SELECT media_item_id FROM hidden_item')
      .then((rows) => { if (live) setHidden(rows.length ? new Set(rows.map((r) => r.media_item_id)) : NONE); });
    return () => { live = false; };
  }, [db, rowsRevision]);
  return hidden;
}

/** A list without your hidden titles. Returns the list itself when nothing is hidden. */
export function withoutHidden<T extends { id: string | null }>(items: T[], hidden: ReadonlySet<string>): T[] {
  return hidden.size ? items.filter((i) => !(i.id && hidden.has(i.id))) : items;
}
