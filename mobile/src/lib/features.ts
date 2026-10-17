// Which optional media types the API has switched on (GET /v1/features).
// Board games need a BGG application token on the Worker; until it has one,
// the board-game chips stay hidden, because a type nothing can be found for
// reads as broken (2026-10-17). Asked once per run; the answer is kept here.

import { useEffect, useState } from 'react';
import { MEDIA_TYPES } from '@/lib/mediaTypes';
import type { MediaType } from '@/types';
import { api } from '~/lib/api';

let known: { boardgames: boolean } | null = null;
let asking: Promise<{ boardgames: boolean }> | null = null;
const listeners = new Set<() => void>();

function ask(): Promise<{ boardgames: boolean }> {
  asking ??= api.features()
    .then((f) => ({ boardgames: !!f.boardgames }))
    // No answer: show what certainly works. A later run asks again.
    .catch(() => ({ boardgames: false }))
    .then((f) => { known = f; for (const l of listeners) l(); return f; });
  return asking;
}

/** The media types to offer as chips: every type, less the ones switched off. */
export function useOfferedTypes(): MediaType[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    if (!known) void ask();
    return () => { listeners.delete(l); };
  }, []);
  return MEDIA_TYPES.filter((t) => t !== 'boardgame' || known?.boardgames === true);
}

/** Whether to ask the API for board games at all. Asked once; a "no" saves a refused request per screen. */
export async function boardgamesOn(): Promise<boolean> {
  return (known ?? (await ask())).boardgames;
}
