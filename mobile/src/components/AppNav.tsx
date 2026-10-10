// The app's navigation: Home, Search, Calendar, Wishlist, You. A bar along the
// bottom on a phone, a bar across the top from 768 px. Port of the site's
// src/components/AppNav.tsx, slot for slot.
//
// It takes the current address and a way to go somewhere, and nothing else, so
// the website's build can render it into a static page (mobile/web/render.tsx)
// where every slot is a plain link.

import { Bookmark, CalendarDays, House, Search, User } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Logo } from '~/components/Logo';
import { color, font, navHeight, radius, type } from '~/theme';

const ITEMS = [
  { key: 'home', href: '/', label: 'Home', Icon: House, match: (p: string) => p === '/' },
  { key: 'search', href: '/discover', label: 'Search', Icon: Search, match: (p: string) => p.startsWith('/discover') },
  { key: 'calendar', href: '/calendar', label: 'Calendar', Icon: CalendarDays, match: (p: string) => p.startsWith('/calendar') },
  { key: 'library', href: '/wishlist', label: 'Wishlist', Icon: Bookmark, match: (p: string) => p.startsWith('/library') || p.startsWith('/wishlist') },
] as const;

// "navigation" is a role a browser knows and Android does not: handing it to a
// native view crashed the app at launch (seen on the Pixel, 2026-10-10).
const NAV_ROLE = Platform.OS === 'web' ? ('navigation' as never) : undefined;

const youActive = (p: string) => p.startsWith('/profile') || p.startsWith('/settings');

export interface AppNavProps {
  variant: 'top' | 'bottom';
  pathname: string;
  /** Leave out on a static page: the slots are then links and nothing more. */
  onNavigate?: (href: string) => void;
  /** What the bottom bar has to clear on a phone that draws under its gesture bar. */
  bottomInset?: number;
}

function useSlot(href: string, onNavigate?: (href: string) => void) {
  return {
    // react-native-web renders a pressable with an `href` as an <a>.
    ...(Platform.OS === 'web' ? ({ href } as object) : null),
    onPress: onNavigate
      ? (e?: GestureResponderEvent) => {
          (e as unknown as { preventDefault?: () => void } | undefined)?.preventDefault?.();
          onNavigate(href);
        }
      : undefined,
  };
}

function Slot({ href, label, Icon, active, variant, onNavigate }: {
  href: string; label: string; Icon: typeof House; active: boolean; variant: 'top' | 'bottom'; onNavigate?: (href: string) => void;
}) {
  const slot = useSlot(href, onNavigate);
  const tint = active ? color.accent : color.textSecondary;
  return (
    <Pressable
      {...slot}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        variant === 'bottom' ? styles.bottomSlot : styles.topSlot,
        variant === 'top' && active && { backgroundColor: color.surfaceElevated },
        pressed && { opacity: 0.7 },
      ]}>
      <Icon size={variant === 'bottom' ? 20 : 16} color={tint} strokeWidth={active ? 2.4 : 2} />
      <Text style={variant === 'bottom' ? [type.micro, styles.bottomLabel, { color: tint }] : [type.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

export function AppNav({ variant, pathname, onNavigate, bottomInset = 0 }: AppNavProps) {
  const you = youActive(pathname);
  const home = useSlot('/', onNavigate);
  const search = useSlot('/discover', onNavigate);
  const profile = useSlot('/profile', onNavigate);

  if (variant === 'bottom') {
    return (
      <View accessibilityRole={NAV_ROLE} accessibilityLabel="Primary" style={[styles.bottom, { paddingBottom: bottomInset }]}>
        {ITEMS.map((it) => (
          <Slot key={it.key} href={it.href} label={it.label} Icon={it.Icon} active={it.match(pathname)} variant="bottom" onNavigate={onNavigate} />
        ))}
        <Slot href="/profile" label="You" Icon={User} active={you} variant="bottom" onNavigate={onNavigate} />
      </View>
    );
  }

  return (
    <View accessibilityRole={NAV_ROLE} accessibilityLabel="Primary" style={styles.top}>
      <Pressable {...home} accessibilityRole="link" accessibilityLabel="Fandex home" style={styles.brand}>
        <Logo size={24} />
        <Text style={styles.wordmark}>Fandex</Text>
      </Pressable>
      <View style={styles.topRight}>
        {ITEMS.map((it) => (
          <Slot key={it.key} href={it.href} label={it.label} Icon={it.Icon} active={it.match(pathname)} variant="top" onNavigate={onNavigate} />
        ))}
        <View style={styles.rule} />
        <Pressable {...search} accessibilityRole="link" accessibilityLabel="Search titles" hitSlop={4} style={styles.circle}>
          <Search size={16} color={color.textSecondary} />
        </Pressable>
        <Pressable
          {...profile}
          accessibilityRole="link"
          accessibilityLabel="Your profile"
          accessibilityState={{ selected: you }}
          hitSlop={4}
          style={[styles.circle, you && { borderColor: color.accent, backgroundColor: 'transparent' }]}>
          <User size={16} color={you ? color.accent : color.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border },
  bottomSlot: { flex: 1, minHeight: navHeight.bottom - 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  bottomLabel: { letterSpacing: 0.4 },
  top: {
    height: navHeight.top, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { fontFamily: font.serif, fontSize: 17, lineHeight: 20, letterSpacing: -0.4, color: color.textPrimary },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topSlot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.lg, minHeight: 28 },
  rule: { width: 1, height: 16, marginHorizontal: 4, backgroundColor: color.borderStrong },
  circle: {
    width: 36, height: 36, marginLeft: 4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
});
