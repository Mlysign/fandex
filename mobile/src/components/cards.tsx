// The poster card and the three ways the site lays cards out: a rail, a grid,
// and a grid cut into months. Ports of src/components/PosterCard.tsx,
// ActionCells.tsx, Rail.tsx and GroupedView.tsx. Sizes are theirs: a 10 px
// card with a 2:3 poster, a type chip on the poster, a serif title, a mono
// date, a serif score, and a Rate and Bookmark bar 32 px tall.

import { useRouter } from 'expo-router';
import { ArrowRight, Bookmark, Star } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
  type GestureResponderEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import { Img } from '~/components/Img';
import { CommunityScore, FandexScore, Popover, useAnchor } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { useToast } from '~/components/Toast';
import { cardHref, useCardActions, useCardStates, type CardItem, type CardState } from '~/lib/cards';
import { monthYear } from '~/lib/dates';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { breakpoint, color, font, radius, type } from '~/theme';

const fmt = (r: number) => (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1));
/** A rating's colour: green from 7, amber from 5, red under (QuickActions.tsx). */
export const ratingColor = (r: number) => (r >= 7 ? color.success : r >= 5 ? color.warning : color.danger);

/** A tap that is also a link in a browser: follow it inside the app, without a page load. */
function useLink(href: string) {
  const router = useRouter();
  const onPress = useCallback((e?: GestureResponderEvent) => {
    (e as unknown as { preventDefault?: () => void } | undefined)?.preventDefault?.();
    router.push(href as never);
  }, [router, href]);
  // react-native-web renders a pressable with an `href` as an <a>, so the
  // address can be copied and opened in a new tab.
  const anchor = Platform.OS === 'web' ? ({ href } as object) : null;
  return { onPress, anchor };
}

// ── The star picker ──────────────────────────────────────────────────────────

/** Ten stars. The one that is already your rating takes the rating away. */
export function StarPicker({ rating, onPick }: { rating: number | null; onPick: (n: number | null) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating || 0;
  return (
    <View style={styles.stars}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const clears = rating != null && Math.round(rating) === n;
        return (
          <Pressable
            key={n}
            onPress={() => onPick(clears ? null : n)}
            onHoverIn={() => setHover(n)}
            onHoverOut={() => setHover(0)}
            accessibilityRole="button"
            accessibilityLabel={clears ? 'Remove your rating' : `Rate ${n} out of 10`}
            hitSlop={{ top: 12, bottom: 12 }}
            style={styles.star}>
            <Text style={{ fontSize: 18, lineHeight: 20, color: shown >= n ? ratingColor(shown) : color.neutral600 }}>★</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const STAR_PICKER_WIDTH = 230;

// ── The Rate and Bookmark bar ────────────────────────────────────────────────

export type Actions = ReturnType<typeof useCardActions>;

/** `compact` is the bar a list row carries: the star and your number, no word. */
export function ActionBar({ item, state, actions, compact }: { item: CardItem; state: CardState; actions: Actions; compact?: boolean }) {
  const picker = useAnchor();
  const rated = actions.signedIn && state.rating != null && state.rating > 0;
  const onList = actions.signedIn && state.wishlisted;
  const busy = actions.busy === item.key;
  return (
    <View ref={picker.ref} style={styles.bar}>
      <Pressable
        // Signed out this leads to sign-in, as on the site: the button is always there.
        onPress={() => (actions.signedIn ? picker.open() : actions.rate(item, null))}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={!actions.signedIn ? 'Sign in to rate this' : rated ? `Your rating ${fmt(state.rating as number)} out of 10, change rating` : 'Rate this'}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [styles.barBtn, compact ? { width: 56 } : { flex: 1 }, rated ? styles.barBtnOn : styles.barBtnIdle, (pressed || busy) && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator size="small" color={color.textSecondary} /> : (
          <>
            <Star size={14} color={rated ? color.accent : color.textPrimary} fill={rated ? color.accent : 'none'} />
            {rated || !compact ? <Text style={[type.label, { color: rated ? color.accent : color.textPrimary }]}>{rated ? fmt(state.rating as number) : 'Rate'}</Text> : null}
          </>
        )}
      </Pressable>
      <Pressable
        onPress={() => actions.toggleWishlist(item, !onList)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ selected: onList }}
        accessibilityLabel={!actions.signedIn ? 'Sign in to add this to your wishlist' : onList ? 'On your wishlist, remove' : 'Add to wishlist'}
        hitSlop={{ top: 6, bottom: 6, left: 3, right: 6 }}
        style={({ pressed }) => [styles.barBtn, { width: 32 }, onList ? styles.barBtnOn : styles.barBtnIdle, (pressed || busy) && { opacity: 0.6 }]}>
        <Bookmark size={14} color={onList ? color.accent : color.textSecondary} fill={onList ? color.accent : 'none'} />
      </Pressable>
      <Popover anchor={picker.anchor} width={STAR_PICKER_WIDTH} align="center" onClose={picker.close} estimatedHeight={44}>
        <StarPicker rating={state.rating} onPick={(n) => { picker.close(); actions.rate(item, n); }} />
      </Popover>
    </View>
  );
}

// ── The card ─────────────────────────────────────────────────────────────────

export const PosterCard = memo(function PosterCard({ item, state, score, center, actions, style }: {
  item: CardItem;
  state: CardState;
  /** Your Fandex Score for it, when there is one. The crowd's rating is shown otherwise. */
  score: number | null;
  center: number | null;
  actions: Actions;
  style?: StyleProp<ViewStyle>;
}) {
  const link = useLink(cardHref(item));
  const [imgFailed, setImgFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <View style={[styles.card, hovered && { borderColor: color.borderStrong }, style]}>
      <Pressable
        {...link.anchor}
        onPress={link.onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="link"
        accessibilityLabel={`${item.title}, view details`}
        style={({ pressed }) => pressed && { opacity: 0.8 }}>
        <View style={styles.poster}>
          {item.posterUrl && !imgFailed ? (
            <Img uri={item.posterUrl} width={200} alt={item.title} style={styles.fill} onError={() => setImgFailed(true)} />
          ) : (
            <View style={[styles.fill, styles.posterEmpty]}>
              <TypeIcon type={item.type} size={28} tint={color.textMuted} />
              <Text style={{ fontFamily: font.sansBold, fontSize: 24, color: color.textMuted }}>{item.title[0]}</Text>
            </View>
          )}
          <View style={styles.typeChip}>
            <View style={[styles.typeDot, { backgroundColor: color.media[item.type] ?? '#888' }]} />
            <Text style={[type.micro, { color: color.textPrimary }]}>{item.type}</Text>
          </View>
        </View>
        <View style={styles.body}>
          <Text numberOfLines={1} style={type.serifSm}>{item.title}</Text>
          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={[type.meta, { flexShrink: 1 }]}>{monthYear(item.releaseDate)}</Text>
            {score != null ? <FandexScore score={score} center={center} />
              : item.communityScore != null ? <CommunityScore score={item.communityScore} /> : null}
          </View>
        </View>
      </Pressable>
      <View style={styles.barWrap}>
        <ActionBar item={item} state={state} actions={actions} />
      </View>
    </View>
  );
});

/** What a list of cards needs alongside the cards: your state, your scores, and the two actions. */
export function useCardKit(items: CardItem[]) {
  const { toast } = useToast();
  const onError = useCallback((m: string) => toast(m, 'error'), [toast]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const stateOf = useCardStates(ids);
  const scores = useRowScores(useMemo(() => ids.filter((id): id is string => !!id), [ids]));
  const { center } = useScores();
  const actions = useCardActions(onError);
  return { stateOf, scores, center, actions };
}

// ── Rail ─────────────────────────────────────────────────────────────────────

/** A titled row that scrolls sideways. The header is the site's: serif title, an optional FOR YOU pill, See all. */
export function Rail({ title, forYou, seeAllHref, action, children }: {
  // `action` replaces See all: the calendar's day rail puts Close there.
  title: string;
  forYou?: boolean;
  seeAllHref?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View>
      <RailHeader title={title} forYou={forYou} seeAllHref={seeAllHref} action={action} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
        {children}
      </ScrollView>
    </View>
  );
}

export function RailHeader({ title, forYou, seeAllHref, action }: { title: string; forYou?: boolean; seeAllHref?: string; action?: ReactNode }) {
  return (
    <View style={styles.railHead}>
      <View style={styles.railTitle}>
        <Text accessibilityRole="header" style={type.serifMd}>{title}</Text>
        {forYou ? <View style={styles.forYou}><Text style={[type.micro, { color: color.accent }]}>For you</Text></View> : null}
      </View>
      {action ?? (seeAllHref ? <SeeAll href={seeAllHref} /> : null)}
    </View>
  );
}

function SeeAll({ href }: { href: string }) {
  const link = useLink(href);
  return (
    <Pressable {...link.anchor} onPress={link.onPress} accessibilityRole="link" hitSlop={14} style={styles.seeAll}>
      <Text style={[type.label, { color: color.textSecondary }]}>See all</Text>
      <ArrowRight size={14} color={color.textSecondary} />
    </Pressable>
  );
}

/** A rail of poster cards, 150 px each. */
export function CardRail({ title, items, forYou, seeAllHref }: { title: string; items: CardItem[]; forYou?: boolean; seeAllHref?: string }) {
  const kit = useCardKit(items);
  return (
    <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
      {items.map((item) => (
        <PosterCard
          key={item.key} item={item} style={{ width: 150 }}
          state={kit.stateOf(item.id)} score={(item.id ? kit.scores.get(item.id) : null) ?? item.fandexScore ?? null} center={kit.center} actions={kit.actions}
        />
      ))}
    </Rail>
  );
}

// ── Grid ─────────────────────────────────────────────────────────────────────

/** The site's grid: 2 columns on a phone, then 3, 4, 5 and 6 as the window widens (GroupedView.tsx). */
export function gridColumns(width: number): number {
  return width >= breakpoint.xl ? 6 : width >= breakpoint.lg ? 5 : width >= breakpoint.md ? 4 : width >= breakpoint.sm ? 3 : 2;
}

export interface CardSection { key: string; label: string; past?: boolean; current?: boolean; items: CardItem[] }

type Row = { kind: 'divider'; key: string; label: string; past?: boolean; current?: boolean } | { kind: 'cards'; key: string; items: CardItem[] };

/**
 * A grid of poster cards, or several under month dividers. One vertical list of
 * rows either way, so two thousand titles cost what is on screen.
 */
export function PosterGrid({ items, sections, header, footer, empty, onEndReached }: {
  items?: CardItem[];
  /** Given instead of `items` when the list is sorted by release date. */
  sections?: CardSection[];
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  onEndReached?: () => void;
}) {
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  const all = useMemo(() => sections ? sections.flatMap((s) => s.items) : items ?? [], [items, sections]);
  const kit = useCardKit(all);

  const rows = useMemo<Row[]>(() => {
    const chunk = (list: CardItem[], prefix: string): Row[] => {
      const out: Row[] = [];
      for (let i = 0; i < list.length; i += columns) out.push({ kind: 'cards', key: `${prefix}${list[i].key}`, items: list.slice(i, i + columns) });
      return out;
    };
    if (!sections) return chunk(items ?? [], '');
    return sections.flatMap((s): Row[] => [{ kind: 'divider', key: `d:${s.key}`, label: s.label, past: s.past, current: s.current }, ...chunk(s.items, `${s.key}:`)]);
  }, [items, sections, columns]);

  return (
    <FlatList
      // The column count is part of each row's shape, so a resize rebuilds the list.
      key={columns}
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={styles.gridContent}
      // A View, not a fragment: the list hands these an onLayout, which a fragment cannot take.
      ListHeaderComponent={header ? <View>{header}</View> : null}
      ListFooterComponent={footer ? <View>{footer}</View> : null}
      ListEmptyComponent={empty ? <View>{empty}</View> : null}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      initialNumToRender={6}
      windowSize={7}
      renderItem={({ item: row }) => row.kind === 'divider' ? (
        <MonthDivider label={row.label} past={row.past} current={row.current} />
      ) : (
        <View style={styles.gridRow}>
          {row.items.map((item) => (
            <PosterCard
              key={item.key} item={item} style={styles.gridCell}
              state={kit.stateOf(item.id)} score={(item.id ? kit.scores.get(item.id) : null) ?? item.fandexScore ?? null} center={kit.center} actions={kit.actions}
            />
          ))}
          {/* Empty cells, so a short last row keeps the column width. */}
          {Array.from({ length: columns - row.items.length }, (_, i) => <View key={`pad${i}`} style={styles.gridCell} />)}
        </View>
      )}
    />
  );
}

/** "OCTOBER 2026" with a rule beside it. The current month is a gold pill. */
export function MonthDivider({ label, past, current }: { label: string; past?: boolean; current?: boolean }) {
  return (
    <View style={styles.divider}>
      {current ? (
        <View style={styles.dividerNow}><Text style={[styles.dividerText, { color: color.textOnAccent }]}>{label}</Text></View>
      ) : (
        <Text style={[styles.dividerText, { color: past ? color.neutral400 : color.textSecondary }]}>{label}</Text>
      )}
      <View style={[styles.dividerRule, { backgroundColor: current ? 'rgba(200,162,75,0.3)' : past ? color.border : color.borderStrong }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  card: { backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  poster: {
    width: '100%', aspectRatio: 2 / 3, overflow: 'hidden', backgroundColor: color.neutral800,
    borderTopLeftRadius: radius.md - 1, borderTopRightRadius: radius.md - 1,
  },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  typeChip: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 6, paddingRight: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.scrimChip,
  },
  typeDot: { width: 6, height: 6, borderRadius: radius.full },
  body: { paddingHorizontal: 10, paddingTop: 10, gap: 7 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 21 },
  barWrap: { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 10 },
  bar: { flexDirection: 'row', gap: 6 },
  barBtn: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, borderWidth: 1 },
  barBtnIdle: { backgroundColor: color.fillIdle, borderColor: color.fillIdleBorder },
  barBtnOn: { backgroundColor: color.accentSubtle, borderColor: color.accentSubtle },
  stars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 6 },
  star: { paddingHorizontal: 2 },
  railHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingHorizontal: 4 },
  railTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  forYou: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.accentSubtle },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  railRow: { gap: 12, paddingBottom: 4 },
  gridContent: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44 },
  gridRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  gridCell: { flex: 1, minWidth: 0 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, marginTop: 8, marginBottom: 8 },
  dividerText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
  dividerNow: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.accent },
  dividerRule: { flex: 1, height: 1 },
});
