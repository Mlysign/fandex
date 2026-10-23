// The doorway from a provider id to an item.
//
// A calendar card or a search result names a title the way its provider does:
// tmdb movie 603. An item page is addressed by Fandex's own id. This screen asks
// the Worker which item that is (fetching it from the provider if nobody holds
// it yet), then replaces itself with the item page, so Back returns to the list
// and not to a spinner.
//
// ⚠️ Every screen is a tab of one navigator. expo-router's own replace only
// jumped there, so this screen stayed in the Back history, Android's Back came
// back to it, nothing ran again and "Opening…" stayed forever (SM76). The
// navigator's replace drops it now (lib/tabHistory.ts), and it still takes
// itself out whenever it loses focus, for the case where it failed and the
// reader went elsewhere. It resolves on every focus, because a tab that is
// jumped to with the same title again is not remounted.

import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { CommonActions } from 'expo-router/react-navigation';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Screen, StateBlock } from '~/components/ui';
import { api, ApiError } from '~/lib/api';
import { itemHref } from '~/lib/cards';

function describe(e: unknown): { title: string; detail: string; retry: boolean } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline':
        return { title: 'No connection', detail: 'This title is not on your device yet, so it needs a connection to open.', retry: true };
      case 'not-found':
        return { title: 'Not found', detail: 'The database this came from no longer lists this title.', retry: false };
      // An unknown source or type, or an id that is not an id (`/open/tmdb/movie/abc`).
      // Asking again cannot change that (SM82).
      case 'bad-request':
        return { title: 'Nothing here', detail: 'This link does not point at a title.', retry: false };
      case 'budget-exhausted':
        return { title: 'Try again tomorrow', detail: 'Fandex has added all the new titles it can for today. Titles already in the catalog still open.', retry: false };
      case 'rate-limited':
        return { title: 'One moment', detail: 'That was a lot of new titles at once. Give it a minute.', retry: true };
      case 'provider-unavailable':
        return { title: 'The database is not answering', detail: 'The film or game database this title comes from is down right now.', retry: true };
    }
  }
  return { title: 'Could not open this title', detail: 'Something went wrong.', retry: true };
}

export default function OpenScreen() {
  const { source, type, id } = useLocalSearchParams<{ source: string; type: string; id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const db = useSQLiteContext();
  const [failure, setFailure] = useState<ReturnType<typeof describe> | null>(null);

  const open = useCallback(async () => {
    setFailure(null);
    try {
      const res = await api.resolve(source, type, id);
      // Somebody who left while this was asking has gone somewhere else on
      // purpose. A late answer must not pull them to the title.
      if (!navigation.isFocused()) return;
      // A title the device already holds has a public address, and that is the
      // one to land on. One the Worker just fetched is not in the catalog copy
      // yet, so it opens by id.
      const held = await db.getFirstAsync<{ type: string; slug: string | null }>('SELECT type, slug FROM catalog WHERE id = ?', [res.id]).catch(() => null);
      router.replace(itemHref({ id: res.id, type: held?.type ?? type, slug: held?.slug ?? null }) as never);
    } catch (e) {
      setFailure(describe(e));
    }
  }, [source, type, id, router, db, navigation]);

  useFocusEffect(useCallback(() => {
    void open();
  }, [open]));

  // Out of the Back history once something else is in front (see the header).
  useEffect(() => navigation.addListener('blur', (e) => {
    const key = e.target;
    if (!key) return;
    navigation.dispatch((state) => {
      const history = (state as { history?: { key: string }[] }).history;
      return CommonActions.reset({ ...state, history: history?.filter((h) => h.key !== key) } as never);
    });
  }), [navigation]);

  return (
    <Screen headed>
      {failure ? (
        <StateBlock
          title={failure.title}
          detail={failure.detail}
          action={failure.retry ? { label: 'Try again', onPress: () => void open() } : { label: 'Go back', onPress: () => router.back() }}
        />
      ) : (
        <StateBlock loading detail="Opening…" />
      )}
    </Screen>
  );
}
