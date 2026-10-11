// The browser tab's title, per screen. Every address in the app used to read
// "Fandex", so a row of tabs or a history list said nothing about which was
// which (SM60, 2026-10-11). The old site had a title per route.
//
// A screen stays mounted when you leave it, so the title is set when a screen
// gains focus and not when it mounts. A phone has no tab title; there this
// does nothing.

import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

export const SITE_TITLE = 'Fandex: your index of every game, movie & show';

/** `name` is the screen's own part: "Calendar", "Alien (1979)". Null or empty means the site's own title. */
export function titleFor(name: string | null | undefined): string {
  return name ? `${name} · Fandex` : SITE_TITLE;
}

export function usePageTitle(name: string | null | undefined): void {
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: { title: string } }).document;
    if (doc) doc.title = titleFor(name);
  }, [name]));
}
