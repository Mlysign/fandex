// An address no route matches: a `fandex://` link with segments the app does
// not know (`fandex://legal/en/privacy`). Without this file Expo shows its own
// "Unmatched Route" page, with a Sitemap link meant for developers (SM83).
// Two-segment addresses never reach here: they are a title's `/{type}/{slug}`,
// and the title page says "Nothing here" for one it does not know.

import { useRouter } from 'expo-router';
import { Screen, StateBlock } from '~/components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen headed>
      <StateBlock
        title="Nothing here"
        detail="Fandex has no page at this address."
        action={{ label: 'Go to Home', onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
