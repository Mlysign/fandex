// Where the device keeps the two things that prove who it is: the Fandex
// session token and the Trakt tokens.
//
// On Android that is the system keystore, through expo-secure-store. A browser
// has no such thing, so the web build uses localStorage, which any script on
// the page can read. That is the same exposure every single-page app with a
// token has, and it is why nothing else is ever stored under these keys.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const web = Platform.OS === 'web';

/** Where the Fandex session token is kept. Read by the app and by the widget's background task. */
export const SESSION_KEY = 'fandex.session';

export async function secretGet(key: string): Promise<string | null> {
  try {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    // A private window, or a keystore that was reset. Treated as "not signed in".
    return null;
  }
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (web) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function secretDelete(key: string): Promise<void> {
  try {
    if (web) globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch { /* already gone */ }
}
