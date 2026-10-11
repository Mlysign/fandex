// Home's rails as a hook, because the profile page shows one of them too.
// What the rails are made from is lib/homeFeed.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '~/lib/AuthProvider';
import { useCardStates, type CardItem } from '~/lib/cards';
import { useHiddenIds } from '~/lib/hidden';
import { genreFacets, loadHomeFeed, recommend, type HomeFeed } from '~/lib/homeFeed';
import { useScores } from '~/lib/ScoreProvider';

export function useHomeRails() {
  const auth = useAuth();
  const scores = useScores();
  const { region } = useAuth();

  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    loadHomeFeed(region).then(setFeed).catch(() => setFailed(true));
  }, [region]);
  useEffect(load, [load]);

  const hidden = useHiddenIds();

  const candidates = feed?.candidates;
  const stateOf = useCardStates(useMemo(() => (candidates ?? []).map((c) => c.id), [candidates]));
  const { score, center } = scores;
  /** Null until there is a taste profile to rank by: signed out, or fewer than three ratings. */
  const recommendation = useMemo(() => {
    if (!candidates || center == null) return null;
    return recommend(
      candidates,
      // A calendar card carries its genres and nothing finer, so this is your taste in genres.
      (c) => score(c.id ?? c.key, genreFacets(c.genres))?.score ?? null,
      // Not what you already watched or played, and not what you asked not to be shown.
      (c) => (c.id ? hidden.has(c.id) || stateOf(c.id).inLibrary : false),
    );
  }, [candidates, center, score, hidden, stateOf]);

  const withoutHidden = useCallback(<T extends CardItem>(items: T[]) => items.filter((i) => !(i.id && hidden.has(i.id))), [hidden]);
  const signedIn = auth.status === 'signedIn';

  return {
    feed, failed, load, recommendation, withoutHidden, signedIn,
    /** Signed in, and the personal rail cannot be drawn yet. */
    personalPending: signedIn && (!feed || !scores.ready) && !failed,
  };
}
