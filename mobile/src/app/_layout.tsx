import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { StateBlock } from '~/components/ui';
import { AuthProvider } from '~/lib/AuthProvider';
import { CatalogSyncProvider } from '~/lib/CatalogSyncProvider';
import { DATABASE_NAME, migrate } from '~/lib/db';
import { dropPlaceholder } from '~/lib/prerender';
import { ScoreProvider } from '~/lib/ScoreProvider';
import { TypeFilterProvider } from '~/lib/typeFilter';
import { ToastProvider } from '~/components/Toast';
import { color, font } from '~/theme';

SplashScreen.preventAutoHideAsync();

/** How many times a browser page reloads itself over a locked database before the error is shown. */
const MAX_LOCK_RELOADS = 4;
const LOCK_RELOADS_KEY = 'fandex.lockReloads';

/**
 * What the app shows when something below throws while rendering, the database
 * failing to open included. A blank screen is the alternative, and a blank
 * screen cannot be told apart from an app that never started.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // In a browser the database file is locked by whichever page opened it, and a
  // reload starts the new page before the old one has let go. Seen on
  // 2026-10-04: a quick reload failed with NoModificationAllowedError, and a
  // retry inside the same page then failed with "Invalid VFS state", because
  // the SQLite worker does not recover from a failed open. A fresh page a second
  // later was fine. So in a browser those two errors reload the page, quietly, a
  // few times, before anything is shown. The counter lives in sessionStorage
  // because a reload is exactly what resets a module-level one.
  const web = Platform.OS === 'web';
  const locked = web && /NoModificationAllowedError|createSyncAccessHandle|Invalid VFS state/.test(`${error.name} ${error.message}`);
  const attempts = locked ? Number(globalThis.sessionStorage?.getItem(LOCK_RELOADS_KEY) ?? 0) : 0;
  const quiet = locked && attempts < MAX_LOCK_RELOADS;
  useEffect(() => {
    // The splash is still up if this is the very first render.
    void SplashScreen.hideAsync();
    // The website's placeholder lies over the app. An error under it is an error nobody sees.
    if (!quiet) dropPlaceholder();
    if (!quiet) return;
    globalThis.sessionStorage?.setItem(LOCK_RELOADS_KEY, String(attempts + 1));
    // Twice is a reload that came too soon. More than that and somebody else has the
    // file for good: take the next slot instead of asking for this one again.
    // Long enough for the previous page's worker to be torn down. At 900 ms it
    // took three or four reloads to get through; the lock is held for about
    // that long after a navigation.
    const timer = setTimeout(() => globalThis.location?.reload(), 1800);
    return () => clearTimeout(timer);
  }, [quiet, attempts]);

  if (quiet) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surface }}>
        <StateBlock loading />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StateBlock
        title="Fandex could not start"
        detail={locked
          ? 'Its storage is held by another tab. Reload this page; if that does not help, close the other Fandex tabs first.'
          : error.message || 'Something went wrong while opening the app.'}
        action={{
          label: 'Try again',
          // In a browser a retry inside the same page cannot reopen the
          // database (see above). Only a new page can.
          onPress: () => (web ? globalThis.location?.reload() : void retry()),
        }}
      />
    </View>
  );
}

/**
 * Renders only once the database has opened, which is the moment the reload
 * counter above stops being relevant. Without this a session that needed two
 * reloads today would have two fewer tomorrow.
 */
function DatabaseOpened() {
  useEffect(() => {
    if (Platform.OS === 'web') globalThis.sessionStorage?.removeItem(LOCK_RELOADS_KEY);
    // The website's home page shows a placeholder until the app is up. It is up now.
    dropPlaceholder();
  }, []);
  return null;
}

/**
 * On Android this app's screen gets a database connection of its own.
 *
 * By default expo-sqlite hands every opener of one file the same native
 * connection. Android can start the app's root twice in one process (seen when
 * an update lands while the app is in the background: "Running main" twice in
 * the log), and when the first root goes away its provider closes that shared
 * connection under the second. Reads worked for half a minute, then every
 * prepared statement failed with a NullPointerException, Search listed nothing
 * and the library read "Could not refresh" (Pixel 8, 2026-10-10; filed once
 * before as "seen once, not explained"). With a connection each, one closing
 * cannot take the other's.
 *
 * Not on the web: one tab is one root there, and its storage has rules of its
 * own (mobile/patches, docs/app.md).
 */
const OWN_CONNECTION = Platform.OS === 'android' ? { useNewConnection: true } : undefined;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSerifDisplay_400Regular,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_600SemiBold,
    SpaceMono_400Regular,
  });

  // A font that fails to load must not hold the splash screen forever. The app
  // is readable in the system font; it is not readable behind a splash.
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    // In a browser a second tab of the site gets this database in memory: the
    // first tab holds the stored one (mobile/patches, docs/app.md).
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} options={OWN_CONNECTION}>
      <DatabaseOpened />
      <AuthProvider>
      <CatalogSyncProvider>
      <ScoreProvider>
      <TypeFilterProvider>
      <ToastProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.surface },
            headerTintColor: color.textPrimary,
            headerTitleStyle: { fontFamily: font.sansBold, fontSize: 15 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: color.surface },
          }}>
          {/* Every screen is inside the tabs layout, which draws the navigation around it. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth/trakt" options={{ headerShown: false }} />
        </Stack>
      </ToastProvider>
      </TypeFilterProvider>
      </ScoreProvider>
      </CatalogSyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
