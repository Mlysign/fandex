// The site's small parts, ported one for one from src/components/ui/* and the
// badge components: Button, Panel, Eyebrow, EmptyState, Skeleton, Avatar,
// StatStrip, the two score badges, SearchBar, and the popover a menu or a star
// picker opens in. Each says which file it came from. Sizes are that file's.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, Search, User, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { Img } from '~/components/Img';
import type { ScoreBand } from '~/lib/fandexScore';
import { breakpoint, color, font, radius, space, type } from '~/theme';

// ── Button (ui/Button.tsx) ───────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_FILL: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.borderStrong },
  outline: { borderWidth: 1, borderColor: color.borderStrong },
  danger: { backgroundColor: color.danger },
  ghost: {},
};
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: color.textOnAccent, secondary: color.textPrimary, outline: color.textSecondary,
  danger: color.surfaceInset, ghost: color.textSecondary,
};
const BUTTON_SIZE: Record<ButtonSize, ViewStyle> = {
  sm: { paddingHorizontal: 12, minHeight: 30, borderRadius: radius.sm },
  md: { paddingHorizontal: 16, minHeight: 38, borderRadius: radius.lg },
  lg: { paddingHorizontal: 16, height: 44, borderRadius: radius.lg },
};

export function Button({ label, onPress, onPressIn, onPressOut, variant = 'secondary', size = 'sm', pill, loading, disabled, icon, style, href }: {
  label: string;
  onPress?: () => void;
  /** For a button whose icon answers the touch itself (Save's pop, components/feel.tsx). */
  onPressIn?: () => void;
  onPressOut?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** In a browser the button is then a real link. */
  href?: string;
}) {
  const off = disabled || loading;
  const anchor = href && Platform.OS === 'web' ? ({ href } as object) : null;
  return (
    <Pressable
      {...anchor}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={off}
      accessibilityRole={href ? 'link' : 'button'}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      // The visible button may be 30 tall; the tap target is 44 (the site's .tap-44).
      hitSlop={size === 'sm' ? { top: 7, bottom: 7 } : undefined}
      style={({ pressed }) => [
        styles.button, BUTTON_FILL[variant], BUTTON_SIZE[size], pill && { borderRadius: radius.full },
        off && { opacity: 0.4 }, pressed && { opacity: 0.7 }, style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={BUTTON_TEXT[variant]} /> : (
        <>
          {icon}
          <Text style={[size === 'lg' ? type.labelLg : type.label, { color: BUTTON_TEXT[variant] }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ── Panel, Eyebrow (ui/Panel.tsx, ui/Eyebrow.tsx) ────────────────────────────

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.eyebrow, { color: color.accent }, style]}>{children}</Text>;
}

// ── EmptyState (ui/EmptyState.tsx) ───────────────────────────────────────────

export function EmptyState({ title, hint, actions, icon }: { title: string; hint?: string | null; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <View style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <Text style={[type.serifMd, { textAlign: 'center', marginBottom: 6 }]}>{title}</Text>
      {hint ? <Text style={[type.bodySm, { textAlign: 'center', marginBottom: actions ? 20 : 0 }]}>{hint}</Text> : null}
      {actions ? <View style={styles.emptyActions}>{actions}</View> : null}
    </View>
  );
}

// ── Skeleton (ui/Skeleton.tsx) ───────────────────────────────────────────────

/** A placeholder block. The site sweeps a highlight across it; this one breathes, which needs no gradient. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.55, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View aria-hidden style={[{ backgroundColor: color.neutral800, opacity: pulse }, style]} />;
}

// ── Avatar, StatStrip (ui/Avatar.tsx, ui/StatStrip.tsx) ──────────────────────

export function Avatar({ src, name, size = 34 }: { src?: string | null; name?: string | null; size?: 34 | 64 | 84 }) {
  const initial = name?.trim()?.[0]?.toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      {src ? <Img uri={src} width={size} alt={name ?? ''} style={{ width: size, height: size }} />
        : initial ? <Text style={{ fontFamily: font.serif, fontSize: size * 0.4, color: color.textPrimary }}>{initial}</Text>
        : <User size={size * 0.5} color={color.textMuted} />}
    </View>
  );
}

export function StatStrip({ cells }: { cells: { label: string; value: string }[] }) {
  if (!cells.length) return null;
  return (
    <Panel style={styles.statStrip}>
      {cells.map((c, i) => (
        <View key={c.label} style={[styles.statCell, i > 0 && { borderLeftWidth: 1, borderLeftColor: color.border }]}>
          <Text style={[type.serifLg, { fontVariant: ['tabular-nums'] }]}>{c.value}</Text>
          <Text style={[type.meta, { marginTop: 6, textAlign: 'center' }]}>{c.label}</Text>
        </View>
      ))}
    </Panel>
  );
}

// ── The score badges (FandexScoreBadge.tsx, CommunityScoreBadge.tsx) ─────────

/** The theme colour a score band wears: green above your usual for the medium, grey about it, orange below (the site's ramp, re-anchored per medium). */
export const bandColor = (band: ScoreBand): string => (band === 'high' ? color.scoreHigh : band === 'low' ? color.scoreLow : color.scoreBaseline);

/**
 * Your Fandex Score for a title on a card: the number in its band's colour on
 * a faint fill. A whole number, no decimals: it is right to about a point
 * (docs/fandex-score.md §7), and "72.4" would claim a tenth.
 */
export function FandexScoreBadge({ score, band }: { score: number; band: ScoreBand }) {
  const tint = bandColor(band);
  return (
    <View accessibilityLabel={`Your Fandex Score ${Math.round(score)}`} style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.full, backgroundColor: `${tint}22` }}>
      <Text style={{ fontFamily: font.serif, fontSize: 16, lineHeight: 19, color: tint, fontVariant: ['tabular-nums'] }}>{Math.round(score)}</Text>
    </View>
  );
}

/** The crowd's rating: serif "7.4" with a mono "/10". `score` is 0 to 100. */
export function CommunityScore({ score, size = 'sm' }: { score: number; size?: 'sm' | 'md' }) {
  const px = size === 'md' ? 21 : 19;
  const value = (score / 10).toFixed(1);
  return (
    <Text accessibilityLabel={`Crowd rating ${value} out of 10`} style={{ fontFamily: font.serif, fontSize: px, lineHeight: px + 2, color: color.textPrimary, fontVariant: ['tabular-nums'] }}>
      {value}
      <Text style={[type.micro, { textTransform: 'none' }]}>/10</Text>
    </Text>
  );
}

// ── SearchBar (SearchBar.tsx) ────────────────────────────────────────────────

export function SearchBar({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && { borderColor: 'rgba(200,162,75,0.45)' }]}>
      <Search size={16} color={color.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textSecondary}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.searchClear}>
          <X size={16} color={color.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Popover, Menu (ui/Menu.tsx) ──────────────────────────────────────────────

interface Anchor { x: number; y: number; w: number; h: number }

/**
 * Something that opens next to the control that asked for it and closes on a
 * tap outside: the sort menu, the star picker. The site positions these with
 * CSS or a portal; here the anchor is measured and the panel placed in a
 * transparent modal, which is the one thing that works the same on a phone and
 * in a browser.
 */
export function Popover({ anchor, width, onClose, children, align = 'left', estimatedHeight = 240 }: {
  anchor: Anchor | null;
  width: number;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  estimatedHeight?: number;
}) {
  const win = useWindowDimensions();
  if (!anchor) return null;
  const wanted = align === 'right' ? anchor.x + anchor.w - width : align === 'center' ? anchor.x + anchor.w / 2 - width / 2 : anchor.x;
  const left = Math.max(8, Math.min(wanted, win.width - width - 8));
  const below = anchor.y + anchor.h + 6;
  // Flip above the control when there is no room under it.
  const top = below + estimatedHeight > win.height ? Math.max(8, anchor.y - estimatedHeight - 6) : below;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <PopIn style={[styles.popover, { top, left, width }]} fromAbove={top < anchor.y}>{children}</PopIn>
    </Modal>
  );
}

/** A popover's arrival: a quick fade and grow from the side of its control, so it reads as opened from there. */
function PopIn({ style, fromAbove, children }: { style: StyleProp<ViewStyle>; fromAbove: boolean; children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 170, easing: EMPHASIZED, useNativeDriver: NATIVE_DRIVER }).start();
  }, [t]);
  return (
    <Animated.View style={[style, {
      opacity: t,
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [fromAbove ? 6 : -6, 0] }) },
        { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

/** Measure a control on screen, for a Popover to open beside. */
export function useAnchor() {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = () => ref.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  const close = () => setAnchor(null);
  return { ref, anchor, open, close, isOpen: anchor != null };
}

/** The sort control: the current choice in mono with a chevron, opening a checked list. */
export function SortMenu<K extends string>({ value, options, onChange }: { value: K; options: [K, string][]; onChange: (v: K) => void }) {
  const a = useAnchor();
  const current = options.find(([k]) => k === value)?.[1] ?? options[0]?.[1] ?? '';
  return (
    <>
      <Pressable
        ref={a.ref}
        onPress={a.open}
        accessibilityRole="button"
        accessibilityLabel={`Sort results: ${current}`}
        accessibilityState={{ expanded: a.isOpen }}
        hitSlop={{ top: 14, bottom: 14 }}
        style={styles.sortTrigger}>
        <Text style={type.meta}>{current}</Text>
        <ChevronDown size={14} color={color.textSecondary} />
      </Pressable>
      <Popover anchor={a.anchor} width={180} align="right" onClose={a.close} estimatedHeight={options.length * 44 + 8}>
        {options.map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => { onChange(k); a.close(); }}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: k === value }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.menuItem, (pressed || hovered) && { backgroundColor: color.fillIdle }]}>
            <Check size={14} color={color.accent} style={{ opacity: k === value ? 1 : 0 }} />
            <Text style={[type.bodySm, { color: color.textPrimary, flex: 1 }]}>{label}</Text>
          </Pressable>
        ))}
      </Popover>
    </>
  );
}

// ── Sheet (ui/Sheet.tsx) ─────────────────────────────────────────────────────

/** The curve the app's own motion uses: off fast, a long soft landing. */
const EMPHASIZED = Easing.bezier(0.2, 0, 0, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';
const SHEET_IN_MS = 300;
const SHEET_OUT_MS = 200;

/**
 * A bottom sheet on a phone, a centred dialog from 640 px. It moves itself
 * rather than leaving it to the system's modal animation, which is linear on
 * Android: in, the sheet rises on a long soft curve while the dark fades up;
 * out, it drops away quicker. The modal stays up until the drop has played.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const wide = width >= breakpoint.sm;
  // Android draws a modal edge to edge, under the system's navigation bar. Without
  // this the last row of a sheet (the filter sheet's "Show N titles") sits beneath it.
  const { bottom } = useSafeAreaInsets();
  const t = useRef(new Animated.Value(0)).current;
  const [sheetH, setSheetH] = useState(0);
  // Still drawn after `open` went false, until the drop has played.
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }
  useEffect(() => {
    if (open) {
      t.setValue(0);
      Animated.timing(t, { toValue: 1, duration: SHEET_IN_MS, easing: EMPHASIZED, useNativeDriver: NATIVE_DRIVER }).start();
    } else {
      Animated.timing(t, { toValue: 0, duration: SHEET_OUT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE_DRIVER })
        .start(() => setClosing(false));
    }
  }, [open, t]);

  const travel = sheetH || height * 0.6;
  const motion = wide
    ? { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }
    : { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }] };
  return (
    <Modal transparent visible={open || closing} animationType="none" onRequestClose={onClose}>
      <View style={[styles.sheetRoot, wide && { justifyContent: 'center' }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal accessibilityLabel={title}
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={[styles.sheet, wide ? styles.sheetWide : { paddingBottom: bottom }, motion]}>
          {wide ? null : <View style={styles.sheetGrip}><View style={styles.sheetGripBar} /></View>}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 44 },
  panel: { backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg },
  empty: {
    width: '100%', maxWidth: 448, alignSelf: 'center', alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  emptyIcon: {
    width: 40, height: 40, marginBottom: 16, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.accentSubtle,
  },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  avatar: {
    alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, overflow: 'hidden',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  statStrip: { flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
  statCell: { flex: 1, paddingHorizontal: 8, paddingVertical: 16, alignItems: 'center' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingLeft: 14,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  searchInput: {
    flex: 1, minWidth: 0, height: 42, paddingVertical: 0, color: color.textPrimary, fontFamily: font.sans, fontSize: 13,
    // A browser draws its own focus ring on an input; the border above is the site's.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  searchClear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  popover: {
    position: 'absolute', paddingVertical: 4, backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.border,
    borderRadius: radius.lg, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 20 }, elevation: 12,
  },
  sortTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  menuItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.border,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
  },
  sheetWide: { maxWidth: 480, borderRadius: radius.xl },
  sheetGrip: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  sheetGripBar: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: color.neutral600 },
});
