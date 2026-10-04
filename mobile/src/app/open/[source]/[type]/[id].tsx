// The doorway from a provider id to an item.
//
// A calendar card or a search result names a title the way its provider does:
// tmdb movie 603. An item page is addressed by Fandex's own id. This screen asks
// the Worker which item that is (fetching it from the provider if nobody holds
// it yet), then replaces itself with the item page, so Back returns to the list
// and not to a spinner.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Screen, StateBlock } from '~/components/ui';
import { api, ApiError } from '~/lib/api';

function describe(e: unknown): { title: string; detail: string; retry: boolean } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline':
        return { title: 'No connection', detail: 'This title is not on your device yet, so it needs a connection to open.', retry: true };
      case 'not-found':
        return { title: 'Not found', detail: 'The database this came from no longer lists this title.', retry: false };
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
  const [failure, setFailure] = useState<ReturnType<typeof describe> | null>(null);

  const open = useCallback(async () => {
    setFailure(null);
    try {
      const res = await api.resolve(source, type, id);
      router.replace(`/item/${res.id}`);
    } catch (e) {
      setFailure(describe(e));
    }
  }, [source, type, id, router]);

  useEffect(() => {
    void open();
  }, [open]);

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
