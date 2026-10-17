// The poster card and the three ways the site lays cards out: a rail, a grid,
// and a grid cut into months. Ports of src/components/PosterCard.tsx,
// ActionCells.tsx, Rail.tsx and GroupedView.tsx. Sizes are theirs: a 10 px
// card with a 2:3 poster, a type chip on the poster, a serif title, a mono
// date, a serif score, and a Rate and Bookmark bar 32 px tall.

import { useRouter } from 'expo-router';
import { ArrowRight, Bookmark, Star } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
  type GestureResponderEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import { CardFace, cardStyles, RailFrame, RailTitle } from '~/components/cardFace';
import { Popover, Sheet, useAnchor } from '~/components/kit';
import { ScoreExplainerBody, ScoreExplainerPopover } from '~/components/ScoreExplainer';
import { useToast } from '~/components/Toast';
import { cardHref, useCardActions, useCardStates, type CardItem, type CardState } from '~/lib/cards';
import { toggled } from '~/lib/a11y';
import { useReportScroll } from '~/lib/barScroll';
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
        {...toggled(onList)}
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
  const explainer = useExplainer();
  return (
    <>
      <CardFace
        item={item} score={score} center={center} link={link} style={style} explain={explainer.explain}
        bar={<ActionBar item={item} state={state} actions={actions} />}
      />
      {explainer.at ? <ScoreExplainerPopover item={item} score={score} center={center} state={state} anchor={explainer.at} /> : null}
      {explainer.sheet ? (
        <Sheet open onClose={explainer.close} title={item.title}>
          <ScoreExplainerBody item={item} score={score} center={center} state={state} />
        </Sheet>
      ) : null}
    </>
  );
});

/** How long the pointer rests on a card before the explainer opens: long enough that sweeping across a grid opens nothing. */
const HOVER_INTENT_MS = 350;

/**
 * When a card's explainer is open. On a pointer that can hover, after the
 * pointer rests on the card; anywhere, on a long press, as a sheet.
 *
 * ⚠️ Only a pointer that can hover: a tap on a touch screen fires a hover too,
 * and on the site that popped the explainer whenever a card's buttons were
 * tapped (PosterCard.tsx there, the `(hover: hover)` test).
 */
function useExplainer() {
  const [at, setAt] = useState<{ left: number; right: number; top: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const canHover = Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
  const explain = useMemo(() => ({
    hover: (on: boolean, place?: { left: number; right: number; top: number }) => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (!on) { setAt(null); return; }
      if (!canHover || !place) return;
      timer.current = setTimeout(() => setAt(place), HOVER_INTENT_MS);
    },
    longPress: () => { setAt(null); setSheet(true); },
  }), [canHover]);
  return { at, sheet, explain, close: () => setSheet(false) };
}

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
  return <RailFrame title={title} forYou={forYou} action={action ?? (seeAllHref ? <SeeAll href={seeAllHref} /> : null)}>{children}</RailFrame>;
}

export function RailHeader({ title, forYou, seeAllHref, action }: { title: string; forYou?: boolean; seeAllHref?: string; action?: ReactNode }) {
  return <RailTitle title={title} forYou={forYou} action={action ?? (seeAllHref ? <SeeAll href={seeAllHref} /> : null)} />;
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
  const reportScroll = useReportScroll();

  const rows = useMemo<Row[]>(() => {
    const chunk = (list: CardItem[], prefix: string): Row[] => {
      const out: Row[] = [];
      for (let i = 0; i < list.length; i += columns) out.push({ kind: 'cards', key: `${prefix}${list[i].key}`, items: list.slice(i, i + columns) });
      return out;
    };
    if (!sections) return chunk(items ?? [], '');
    return sections.flatMap((s): Row[] => [{ kind: 'divider', key: `d:${s.key}`, label: s.label, past: s.past, current: s.current }, ...chunk(s.items, `${s.key}:`)]);
  }, [items, sections, columns]);

  // The site's month scrubber (GroupedView.tsx, MonthNav): on a wide window a
  // column of the sections beside the grid, the one in view lit, each a jump.
  const list = useRef<FlatList<Row>>(null);
  const withNav = !!sections && sections.length > 1 && width >= breakpoint.lg;
  const [inView, setInView] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: Row }[] }) => {
    const first = viewableItems[0]?.item;
    if (first) setInView(first.key.startsWith('d:') ? first.key.slice(2) : first.key.split(':')[0]);
  }).current;
  const jump = (key: string) => {
    const index = rows.findIndex((r) => r.key === `d:${key}`);
    if (index >= 0) list.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
  };

  const grid = (
    <FlatList
      ref={list}
      style={withNav ? { flex: 1 } : undefined}
      onViewableItemsChanged={withNav ? onViewable : undefined}
      // Rows have no fixed height. A jump past what is drawn goes most of the way, then again.
      onScrollToIndexFailed={(info) => {
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 }), 60);
      }}
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
      onScroll={reportScroll}
      scrollEventThrottle={32}
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
  if (!withNav) return grid;
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {grid}
      <ScrollView style={styles.sectionNav} contentContainerStyle={{ paddingVertical: 24, gap: 2 }} showsVerticalScrollIndicator={false}>
        {sections!.map((s, i) => {
          const active = (inView ?? sections![0].key) === s.key;
          const at = sections!.findIndex((x) => x.key === (inView ?? sections![0].key));
          // Further from the month in view, smaller and fainter, as the site's did.
          const d = Math.min(Math.abs(i - at) / 4, 1);
          const t = d * d * (3 - 2 * d);
          return (
            <Pressable key={s.key} onPress={() => jump(s.key)} accessibilityRole="button" accessibilityLabel={`Jump to ${s.label}`}
              style={(state: { hovered?: boolean }) => [styles.sectionNavItem, state.hovered && { backgroundColor: color.neutral800 }]}>
              <Text style={[type.caption, { textAlign: 'right', color: color.textPrimary, opacity: active || s.current ? 1 : 1 - t * 0.65, transform: [{ scale: 1 - t * 0.22 }], fontFamily: s.current ? font.sansBold : undefined }]} numberOfLines={1}>
                {shortSection(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const MONTH_ABBR: Record<string, string> = { JANUARY: 'Jan', FEBRUARY: 'Feb', MARCH: 'Mar', APRIL: 'Apr', MAY: 'May', JUNE: 'Jun', JULY: 'Jul', AUGUST: 'Aug', SEPTEMBER: 'Sep', OCTOBER: 'Oct', NOVEMBER: 'Nov', DECEMBER: 'Dec' };
/** "OCTOBER 2026" as "Oct 26", the scrubber's form; anything else as it is. */
export function shortSection(label: string): string {
  const m = /^([A-Za-z]+) (\d{4})$/.exec(label.trim());
  const abbr = m ? MONTH_ABBR[m[1].toUpperCase()] : null;
  return abbr ? `${abbr} ${m![2].slice(2)}` : label;
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

const styles = { ...cardStyles, ...StyleSheet.create({
  barBtnOn: { backgroundColor: color.accentSubtle, borderColor: color.accentSubtle },
  sectionNav: { width: 96, flexGrow: 0, paddingLeft: 16 },
  sectionNavItem: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  stars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 6 },
  star: { paddingHorizontal: 2 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  gridCell: { flex: 1, minWidth: 0 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, marginTop: 8, marginBottom: 8 },
  dividerText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
  dividerNow: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.accent },
  dividerRule: { flex: 1, height: 1 },
}) };
