// A short message that goes away by itself. Port of src/components/ui/Toast.tsx:
// bottom right, 320 wide, an error stays five seconds and anything else three.
//
// Since 2026-10-23 a toast can carry one action ("Undo") and say how it ended,
// so a change that cannot be taken back waits for it: Remove from library is
// done when the toast times out or is dismissed, and not at all after Undo.

import { X } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, navHeight, radius, type } from '~/theme';

export type ToastType = 'error' | 'success' | 'info';
/** How a toast went: it ran out, was dismissed with its cross, or its action was pressed. */
export type ToastEnd = 'timeout' | 'dismiss' | 'action';
export interface ToastOptions {
  /** One button beside the message. Pressing it ends the toast with 'action'. */
  action?: { label: string };
  /** Called once, however the toast ends. */
  onEnd?: (how: ToastEnd) => void;
  /** How long it stays. Defaults: an error five seconds, anything else three, one with an action six. */
  ms?: number;
}
interface ToastEntry { id: number; message: string; type: ToastType; action?: { label: string } }

const Ctx = createContext<{ toast: (message: string, type?: ToastType, options?: ToastOptions) => void }>({ toast: () => {} });

export function useToast() {
  return useContext(Ctx);
}

const TONE: Record<ToastType, { bg: string; border: string; text: string }> = {
  error: { bg: '#2B1712', border: color.danger, text: color.danger },
  success: { bg: '#15241B', border: color.success, text: color.success },
  info: { bg: color.surfaceOverlay, border: color.border, text: color.textPrimary },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  /** The end callbacks of the toasts on screen, run once and then forgotten. */
  const ends = useRef(new Map<number, (how: ToastEnd) => void>());
  const { bottom } = useSafeAreaInsets();

  const end = useCallback((id: number, how: ToastEnd) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const onEnd = ends.current.get(id);
    ends.current.delete(id);
    onEnd?.(how);
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info', options: ToastOptions = {}) => {
    const id = nextId.current++;
    if (options.onEnd) ends.current.set(id, options.onEnd);
    setToasts((prev) => [...prev, { id, message, type, action: options.action }]);
    setTimeout(() => end(id, 'timeout'), options.ms ?? (options.action ? 6000 : type === 'error' ? 5000 : 3000));
  }, [end]);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Above the bottom nav bar, which a toast must not cover. */}
      <View pointerEvents="box-none" style={[styles.stack, { bottom: bottom + navHeight.bottom + 16 }]}>
        {toasts.map((t) => (
          <View key={t.id} accessibilityRole="alert" style={[styles.toast, { backgroundColor: TONE[t.type].bg, borderColor: TONE[t.type].border }]}>
            <Text style={[type.bodySm, { flex: 1, color: TONE[t.type].text }]}>{t.message}</Text>
            {t.action ? (
              <Pressable onPress={() => end(t.id, 'action')} accessibilityRole="button" hitSlop={12}>
                <Text style={[type.bodySm, styles.action]}>{t.action.label}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => end(t.id, 'dismiss')} accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={12}>
              <X size={14} color={TONE[t.type].text} />
            </Pressable>
          </View>
        ))}
      </View>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', right: 16, left: 16, alignItems: 'flex-end', gap: 8 },
  toast: {
    width: '100%', maxWidth: 320, flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: radius.xl,
  },
  action: { color: color.accent, fontFamily: font.sansBold },
});
