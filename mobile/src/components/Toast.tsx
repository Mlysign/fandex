// A short message that goes away by itself. Port of src/components/ui/Toast.tsx:
// bottom right, 320 wide, an error stays five seconds and anything else three.

import { X } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, navHeight, radius, type } from '~/theme';

export type ToastType = 'error' | 'success' | 'info';
interface ToastEntry { id: number; message: string; type: ToastType }

const Ctx = createContext<{ toast: (message: string, type?: ToastType) => void }>({ toast: () => {} });

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
  const { bottom } = useSafeAreaInsets();

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), type === 'error' ? 5000 : 3000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Above the bottom nav bar, which a toast must not cover. */}
      <View pointerEvents="box-none" style={[styles.stack, { bottom: bottom + navHeight.bottom + 16 }]}>
        {toasts.map((t) => (
          <View key={t.id} accessibilityRole="alert" style={[styles.toast, { backgroundColor: TONE[t.type].bg, borderColor: TONE[t.type].border }]}>
            <Text style={[type.bodySm, { flex: 1, color: TONE[t.type].text }]}>{t.message}</Text>
            <Pressable onPress={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={12}>
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
});
