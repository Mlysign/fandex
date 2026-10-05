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
import { ScoreProvider } from '~/lib/ScoreProvider';
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
    if (!quiet) return;
    globalThis.sessionStorage?.setItem(LOCK_RELOADS_KEY, String(attempts + 1));
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
        detail={error.message || 'Something went wrong while opening the app.'}
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
  }, []);
  return null;
}

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
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
      <DatabaseOpened />
      <AuthProvider>
      <CatalogSyncProvider>
      <ScoreProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.surface },
            headerTintColor: color.textPrimary,
            headerTitleStyle: { fontFamily: font.sansBold, fontSize: 15 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: color.surface },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* No header: the page's hero carries its own back and share buttons. */}
          <Stack.Screen name="item/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="open/[source]/[type]/[id]" options={{ title: '' }} />
        </Stack>
      </ScoreProvider>
      </CatalogSyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
