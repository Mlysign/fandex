// Close a folded group opened on a phone (the type circles, the calendar's
// sources) when the person taps anywhere else, as the site's CollapsibleChips
// did. In a browser that is a pointer-down outside the group; in the app, where
// there is no document to listen on, it closes when the screen is left.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

export function useOutsideClose(open: boolean, close: () => void, box: RefObject<View | null>): void {
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onDown = (e: PointerEvent) => {
      const node = box.current as unknown as HTMLElement | null;
      if (node && !node.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close, box]);
  useFocusEffect(useCallback(() => () => close(), [close]));
}
