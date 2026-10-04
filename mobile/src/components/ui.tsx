// The handful of primitives every screen is built from. Deliberately few: a
// screen that needs something else writes it where it is used.

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color, radius, space, type, TYPE_LABEL } from '~/theme';

type Variant = keyof typeof type;

export function T({ variant = 'body', style, children, numberOfLines }: {
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return <Text style={[type[variant], style]} numberOfLines={numberOfLines}>{children}</Text>;
}

/**
 * A full screen: the surface colour, the safe area at the top, a readable width
 * on a wide window. `headed` is for a screen under the stack's own header, which
 * already clears the status bar: insetting again leaves an empty band below it.
 */
export function Screen({ children, style, headed }: { children: ReactNode; style?: StyleProp<ViewStyle>; headed?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={headed ? ['left', 'right'] : ['top', 'left', 'right']}>
      <View style={[styles.column, style]}>{children}</View>
    </SafeAreaView>
  );
}

export function ScreenTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <T variant="eyebrow">{eyebrow}</T> : null}
        <T variant="serifLg" numberOfLines={1}>{title}</T>
      </View>
      {right}
    </View>
  );
}

/** The small coloured dot and word that says game, film or show. */
export function TypeTag({ kind }: { kind: string }) {
  return (
    <View style={styles.typeTag}>
      <View style={[styles.dot, { backgroundColor: color.media[kind] ?? color.textMuted }]} />
      <T variant="meta">{TYPE_LABEL[kind] ?? kind}</T>
    </View>
  );
}

export function Poster({ uri, width, kind }: { uri: string | null; width: number; kind?: string }) {
  const height = Math.round(width * 1.5);
  if (!uri) {
    // No art yet is common for a just-announced title. Say what it is instead
    // of leaving a hole.
    return (
      <View style={[styles.poster, styles.posterEmpty, { width, height }]}>
        <T variant="meta" style={{ color: color.textMuted }}>{TYPE_LABEL[kind ?? ''] ?? 'No art'}</T>
      </View>
    );
  }
  return <Image source={{ uri }} style={[styles.poster, { width, height }]} contentFit="cover" transition={120} />;
}

/** One title in a list: poster, name, a line of meta, and whatever goes on the right. */
export function TitleRow({ title, kind, posterUrl, meta, right, onPress }: {
  title: string;
  kind: string;
  posterUrl: string | null;
  meta?: string | null;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${TYPE_LABEL[kind] ?? kind}${meta ? `, ${meta}` : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Poster uri={posterUrl} width={46} kind={kind} />
      <View style={styles.rowBody}>
        <T variant="title" numberOfLines={2}>{title}</T>
        <View style={styles.rowMeta}>
          <TypeTag kind={kind} />
          {meta ? <T variant="meta" numberOfLines={1} style={{ flexShrink: 1 }}>{meta}</T> : null}
        </View>
      </View>
      {right}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}>
      <T variant="label" style={{ color: selected ? color.textOnAccent : color.textSecondary }}>{label}</T>
    </Pressable>
  );
}

export function Button({ label, onPress, quiet }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, quiet && styles.buttonQuiet, pressed && styles.pressed]}>
      <T variant="label" style={{ color: quiet ? color.textPrimary : color.textOnAccent }}>{label}</T>
    </Pressable>
  );
}

/**
 * What a screen shows in place of its content: loading, failed, or empty. Each
 * says which it is. A blank screen reads as broken whatever the reason.
 */
export function StateBlock({ loading, title, detail, action }: {
  loading?: boolean;
  title?: string;
  detail?: string | null;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={color.accent} /> : null}
      {title ? <T variant="serifSm" style={{ textAlign: 'center' }}>{title}</T> : null}
      {detail ? <T variant="caption" style={{ textAlign: 'center' }}>{detail}</T> : null}
      {action ? <Button label={action.label} onPress={action.onPress} quiet /> : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  column: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  titleRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.md,
    paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md,
  },
  typeTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: radius.full },
  poster: { borderRadius: radius.sm, backgroundColor: color.surfaceElevated },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.border },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56,
  },
  rowBody: { flex: 1, minWidth: 0, gap: space.xs },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pressed: { opacity: 0.6 },
  chip: {
    paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
  },
  chipSelected: { backgroundColor: color.accent, borderColor: color.accent },
  button: {
    paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.md, backgroundColor: color.accent,
  },
  buttonQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.borderStrong },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  divider: { height: 1, backgroundColor: color.border, marginHorizontal: space.lg },
});
