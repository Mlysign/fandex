// Every screen sits inside the navigation: a bar along the bottom on a phone, a
// bar across the top from 768 px, as on the site (src/components/AppNav.tsx,
// which lived in the root layout and so was on every page, the item page too).
//
// The navigator's own tab bar is switched off and AppNav drawn around it. The
// bar has five slots; the routes that are not one of them (an item, Settings)
// are screens of the same navigator, which is what keeps the bar on them.

import { usePathname, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useCallback, useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppNav } from '~/components/AppNav';
import { NavSearch } from '~/components/NavSearch';
import { Onboarding } from '~/components/Onboarding';
import { useAuth } from '~/lib/AuthProvider';
import { haptics } from '~/lib/feel';
import { sendPageview } from '~/lib/pageview';
import { signInLanding, takeReturnTo } from '~/lib/returnTo';
import { browserLikeHistory } from '~/lib/tabHistory';
import { breakpoint, color } from '~/theme';

/** The sign-in (`LastSignIn.at`) already landed, kept outside the layout so a remount does not land it twice. */
let landed = 0;

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoint.md;
  const pathname = usePathname();
  // Every screen is a child of this layout, so this is every page opened. The website only: see lib/pageview.ts.
  useEffect(() => { sendPageview(pathname); }, [pathname]);
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  // Back to the title somebody signed in from (lib/returnTo.ts), wherever the
  // sign-in finished: You for Trakt, Settings for Google in a browser. With no
  // title to go back to, a sign-in made on You lands on Home, and so does one
  // that made a new account, wherever it was made: Home is where its first-run
  // questions open (components/Onboarding.tsx; Nils, 2026-11-07). Adding a way
  // in from Settings ("linked", "merged") stays where it is.
  const auth = useAuth();
  const { lastSignIn } = auth;
  useEffect(() => {
    if (auth.status !== 'signedIn') return;
    const fresh = lastSignIn && landed !== lastSignIn.at ? lastSignIn : null;
    if (fresh) landed = fresh.at;
    const to = takeReturnTo();
    if (to) { router.replace(to as never); return; }
    const home = fresh ? signInLanding(fresh.outcome, pathname) : null;
    if (home && home !== pathname) router.replace(home as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- where the sign-in finished, read once when it lands
  }, [auth.status, lastSignIn, router]);
  // A light tick with every tab tapped: the bar's own pop is in AppNav.
  const go = useCallback((href: string) => { haptics.tap(); router.navigate(href as never); }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      {desktop ? <AppNav variant="top" pathname={pathname} onNavigate={go} search={<NavSearch />} /> : null}
      <View style={{ flex: 1 }}>
        <Tabs
          // Back returns to the screen you came from, every step of the way, as
          // a browser's does; the web's history is written from this one.
          backBehavior="fullHistory"
          UNSTABLE_router={browserLikeHistory}
          tabBar={() => null}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.surface } }}
        />
      </View>
      {desktop ? null : <AppNav variant="bottom" pathname={pathname} onNavigate={go} bottomInset={bottom} />}
      {/* A new account's first-run questions, over Home. */}
      <Onboarding />
    </View>
  );
}
