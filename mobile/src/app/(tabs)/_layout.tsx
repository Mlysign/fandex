// Every screen sits inside the navigation: a bar along the bottom on a phone, a
// bar across the top from 768 px, as on the site (src/components/AppNav.tsx,
// which lived in the root layout and so was on every page, the item page too).
//
// The navigator's own tab bar is switched off and AppNav drawn around it. The
// bar has five slots; the routes that are not one of them (an item, Settings)
// are screens of the same navigator, which is what keeps the bar on them.

import { usePathname, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useCallback } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppNav } from '~/components/AppNav';
import { breakpoint, color } from '~/theme';

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoint.md;
  const pathname = usePathname();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const go = useCallback((href: string) => router.navigate(href as never), [router]);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      {desktop ? <AppNav variant="top" pathname={pathname} onNavigate={go} /> : null}
      <View style={{ flex: 1 }}>
        <Tabs
          // Back returns to the screen you came from, not to the first tab.
          backBehavior="history"
          tabBar={() => null}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.surface } }}
        />
      </View>
      {desktop ? null : <AppNav variant="bottom" pathname={pathname} onNavigate={go} bottomInset={bottom} />}
    </View>
  );
}
