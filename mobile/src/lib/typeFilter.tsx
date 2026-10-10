// Which media types the lists show. One choice for the whole app, remembered
// between launches, exactly as the site's `rr_type_filter` was: pick Games on
// Home and Discover, the Calendar and your Wishlist show games too.
//
// The rules are the site's own module (src/lib/mediaTypes.ts): an empty choice
// means "everything you track", and "what you track" is the account setting
// (users.media_types), which is a default and never a wall.

import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MEDIA_TYPES, enabledMediaTypes, sanitizeMediaTypes, visibleTypes } from '@/lib/mediaTypes';
import { useAuth } from '~/lib/AuthProvider';
import { getMeta, setMeta } from '~/lib/db';

const KEY = 'rr_type_filter';

interface TypeFilter {
  /** What was explicitly picked. Empty means no pick. */
  active: string[];
  /** The account's tracked types, or null when not set. */
  stored: string[] | null;
  /** What a list should show right now. */
  shown: string[];
  toggle: (type: string) => void;
  /** The "all" circle: clear the pick, or widen it when the account tracks only some types. */
  selectAll: () => void;
  /** Drop the chip selection, so the account's default shows again. */
  reset: () => void;
  isVisible: (type: string) => boolean;
}

const Ctx = createContext<TypeFilter | null>(null);

export function TypeFilterProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const [active, setActive] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void getMeta(db, KEY).then((raw) => {
      if (!live || !raw) return;
      try { setActive(sanitizeMediaTypes(JSON.parse(raw))); } catch { /* an unreadable value is no pick */ }
    });
    return () => { live = false; };
  }, [db]);

  const save = useCallback((next: string[]) => {
    setActive(next);
    void setMeta(db, KEY, JSON.stringify(next)).catch(() => {});
  }, [db]);

  const stored = auth.profile?.user.mediaTypes ?? null;

  const value = useMemo<TypeFilter>(() => {
    const shown = visibleTypes(active, stored);
    return {
      active,
      stored,
      shown,
      toggle: (type) => save(active.includes(type) ? active.filter((t) => t !== type) : [...active, type]),
      reset: () => save([]),
      selectAll: () => save(enabledMediaTypes(stored).length === MEDIA_TYPES.length ? [] : [...MEDIA_TYPES]),
      isVisible: (type) => shown.includes(type as never),
    };
  }, [active, stored, save]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTypeFilter(): TypeFilter {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTypeFilter outside TypeFilterProvider');
  return v;
}
