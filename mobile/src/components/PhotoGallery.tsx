// A person's photos, full screen: one at a time, arrows and the keyboard's
// arrow keys on a wide window, a swipe on a phone, and a strip of thumbnails to
// jump. Opened by tapping the portrait on a person's page (FacetScreen.tsx).
// The photos are TMDB's (`/person/{id}/images`), best voted first.

import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Img } from '~/components/Img';
import { color, radius, type } from '~/theme';

export interface Photo { full: string; thumb: string; width: number; height: number }

export function PhotoGallery({ photos, name, start, onClose }: { photos: Photo[]; name: string; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(start);
  const pager = useRef<ScrollView>(null);
  const strip = useRef<ScrollView>(null);
  const wide = width >= 768;

  const go = (i: number) => {
    const next = Math.max(0, Math.min(photos.length - 1, i));
    setAt(next);
    pager.current?.scrollTo({ x: next * width, animated: true });
  };

  // Open on the photo that was tapped, and follow the window if it is resized.
  useEffect(() => {
    const t = setTimeout(() => pager.current?.scrollTo({ x: at * width, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  // Keep the current thumbnail in view.
  useEffect(() => { strip.current?.scrollTo({ x: Math.max(0, at * 64 - width / 2 + 32), animated: true }); }, [at, width]);

  // The keyboard, in a browser: arrows to step, Escape to close.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onSwipe = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== at) setAt(i);
  };

  const stage = height - 150;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root} accessibilityViewIsModal accessibilityLabel={`Photos of ${name}`}>
        <View style={styles.top}>
          <Text style={[type.label, { color: color.textSecondary }]}>{name} · {at + 1} of {photos.length}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.round}>
            <X size={18} color={color.textPrimary} />
          </Pressable>
        </View>
        <ScrollView
          ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSwipe} onScroll={Platform.OS === 'web' ? onSwipe : undefined} scrollEventThrottle={64}
          style={{ flexGrow: 0, height: stage }}>
          {photos.map((p, i) => {
            const h = Math.min(stage - 16, (width - 32) * (p.height / p.width));
            const w = h * (p.width / p.height);
            return (
              <View key={p.full} style={{ width, height: stage, alignItems: 'center', justifyContent: 'center' }}>
                {Math.abs(i - at) <= 2 ? <Img uri={p.full} width={Math.round(w)} alt={`${name}, photo ${i + 1}`} style={{ width: w, height: h, borderRadius: radius.md }} /> : null}
              </View>
            );
          })}
        </ScrollView>
        {wide && at > 0 ? (
          <Pressable onPress={() => go(at - 1)} accessibilityRole="button" accessibilityLabel="Previous photo" style={[styles.round, styles.arrow, { left: 16, top: stage / 2 + 30 }]}>
            <ChevronLeft size={20} color={color.textPrimary} />
          </Pressable>
        ) : null}
        {wide && at < photos.length - 1 ? (
          <Pressable onPress={() => go(at + 1)} accessibilityRole="button" accessibilityLabel="Next photo" style={[styles.round, styles.arrow, { right: 16, top: stage / 2 + 30 }]}>
            <ChevronRight size={20} color={color.textPrimary} />
          </Pressable>
        ) : null}
        <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.map((p, i) => (
            <Pressable key={p.thumb} onPress={() => go(i)} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1}`}
              style={[styles.thumb, i === at && { borderColor: color.accent, opacity: 1 }]}>
              <Img uri={p.thumb} width={56} alt="" style={{ width: 56, height: 72 }} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(8,7,6,0.96)' },
  top: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  round: {
    width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.border,
  },
  arrow: { position: 'absolute', marginTop: -20 },
  strip: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  thumb: { width: 56, height: 72, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', opacity: 0.6 },
});
