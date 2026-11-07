// Which media types the lists show. One choice for the whole app, remembered
// between launches, exactly as the site's `rr_type_filter` was: pick Games on
// Home and Discover, the Calendar and your Wishlist show games too.
//
// The rules are the site's own module (src/lib/mediaTypes.ts): an empty choice
// means "everything you track", and "what you track" is the account setting
// (users.media_types), which is a default and never a wall.

import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { sanitizeMediaTypes, visibleTypes } from '@/lib/mediaTypes';
import { useAuth } from '~/lib/AuthProvider';
import { getMeta, setMeta } from '~/lib/db';
import { excludePick, tapPick } from '~/lib/typePick';

const KEY = 'rr_type_filter';

interface TypeFilter {
  /** What was explicitly picked. Empty means no pick. */
  active: string[];
  /** The account's tracked types, or null when not set. */
  stored: string[] | null;
  /** What a list should show right now. */
  shown: string[];
  /** No pick: the account's default types are showing. */
  atDefault: boolean;
  toggle: (type: string) => void;
  /**
   * One tap on a type's circle (Nils, 2026-10-18, the three stories: "only this
   * type", "hide this type", "these two only"). With every type showing, a tap
   * narrows to that type alone; with some showing, a tap adds a type that is
   * off or drops one that is on, and dropping the last one shows everything
   * again. So "only games" is one tap, "games and films" is two, and a long
   * press (`exclude`) hides one type from a full row in one. Dropping the
   * last one goes back to the account's default (lib/typePick.ts).
   */
  tapType: (type: string, offered: readonly string[]) => void;
  /** Hide one type and keep the rest: a long press on its circle. */
  exclude: (type: string, offered: readonly string[]) => void;
  /**
   * Drop the chip selection, so the account's default shows again: Settings,
   * and the row's logo circle. That circle used to pick every type, which
   * turned on the types Settings had off (Nils, 2026-11-07).
   */
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
    const atDefault = active.length === 0;
    return {
      active,
      stored,
      shown,
      atDefault,
      toggle: (type) => save(active.includes(type) ? active.filter((t) => t !== type) : [...active, type]),
      tapType: (type, offered) => save(tapPick(type, shown, offered, stored, atDefault)),
      exclude: (type, offered) => save(excludePick(type, shown, offered, stored)),
      reset: () => save([]),
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
