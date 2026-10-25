// What a poster card and a rail look like, with nothing that needs the app.
//
// components/cards.tsx is the app's: its cards follow a link through the
// router and act on your rows. This module is the half a server can render:
// the card's face, a rail's frame, and the static card, rail and grid the
// website's build draws with them (mobile/web/render.tsx). No router, no
// database, no session, no hooks but useState. ⚠️ Keep it that way: importing
// anything that reaches expo-router here breaks the site's build.

import { Bookmark, ChevronLeft, ChevronRight, Star } from 'lucide-react-native';
import { Children, isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Img } from '~/components/Img';
import { CommunityScore, MatchLabel } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { cardHref } from '~/lib/cardHref';
import type { CardItem, CardMatch } from '~/lib/cards';
import { monthYear } from '~/lib/dates';
import { breakpoint, color, font, radius, type, TYPE_LABEL } from '~/theme';

/** Fewer crowd votes than this is no crowd rating on a card: an unreleased film read 9.0 off a handful of festival votes (2026-10-23). */
const MIN_CROWD_VOTES = 20;

/** What PosterCard and StaticPosterCard share: everything but how the card is followed and its bar. */
export function CardFace({ item, match, link, bar, style, dateText, explain }: {
  item: CardItem;
  /** In place of the month and year: a calendar page names the day. */
  dateText?: string;
  /** Your match for it, when there is one. The crowd's rating is shown otherwise. */
  match: CardMatch | null;
  link: { anchor: object | null; onPress?: (e?: GestureResponderEvent) => void };
  bar: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * The app's score explainer (cards.tsx): told when the pointer rests on the
   * card or leaves it, with the card's place on screen, and when it is long
   * pressed. A static page has none.
   */
  explain?: { hover: (on: boolean, at?: { left: number; right: number; top: number }) => void; longPress: () => void };
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const box = useRef<View>(null);
  const placeOf = () => {
    const r = (box.current as unknown as { getBoundingClientRect?: () => DOMRect } | null)?.getBoundingClientRect?.();
    return r ? { left: r.left, right: r.right, top: r.top } : undefined;
  };
  return (
    <View ref={box} style={[cardStyles.card, hovered && { borderColor: color.borderStrong }, style]}>
      <Pressable
        {...link.anchor}
        onPress={link.onPress}
        onLongPress={explain?.longPress}
        onHoverIn={() => { setHovered(true); explain?.hover(true, placeOf()); }}
        onHoverOut={() => { setHovered(false); explain?.hover(false); }}
        accessibilityRole="link"
        accessibilityLabel={`${item.title}, view details`}
        style={({ pressed }) => pressed && { opacity: 0.8 }}>
        <View style={cardStyles.poster}>
          {item.posterUrl && !imgFailed ? (
            <Img uri={item.posterUrl} width={200} alt={item.title} style={cardStyles.fill} onError={() => setImgFailed(true)} />
          ) : (
            <View style={[cardStyles.fill, cardStyles.posterEmpty]}>
              <TypeIcon type={item.type} size={28} tint={color.textMuted} />
              <Text style={{ fontFamily: font.sansBold, fontSize: 24, color: color.textMuted }}>{item.title[0]}</Text>
            </View>
          )}
          <View style={cardStyles.typeChip}>
            <View style={[cardStyles.typeDot, { backgroundColor: color.media[item.type] ?? '#888' }]} />
            <Text style={[type.micro, { color: color.textPrimary }]}>{(TYPE_LABEL[item.type] ?? item.type).toLowerCase()}</Text>
          </View>
        </View>
        <View style={cardStyles.body}>
          <Text numberOfLines={1} style={type.serifSm}>{item.title}</Text>
          {item.role ? <Text numberOfLines={1} style={[type.caption, cardStyles.role]}>{item.role}</Text> : null}
          <View style={cardStyles.metaRow}>
            <Text numberOfLines={1} style={[type.meta, { flexShrink: 1 }]}>{dateText ?? monthYear(item.releaseDate)}</Text>
            {match ? <MatchLabel label={match.label} taste={match.taste} pull={match.pull} />
              : item.communityScore != null && (item.communityVotes == null || item.communityVotes >= MIN_CROWD_VOTES) ? <CommunityScore score={item.communityScore} /> : null}
          </View>
        </View>
      </Pressable>
      <View style={cardStyles.barWrap}>{bar}</View>
    </View>
  );
}

/** A rail's title row: serif title, an optional FOR YOU pill, and whatever goes on the right. */
export function RailTitle({ title, forYou, action }: { title: string; forYou?: boolean; action?: ReactNode }) {
  return (
    <View style={cardStyles.railHead}>
      <View style={cardStyles.railTitle}>
        {/* An <h2> on the web: as a bare header it was a third <h1> on every title page (2026-10-23). */}
        <Text accessibilityRole="header" {...({ 'aria-level': 2 } as object)} style={type.serifMd}>{title}</Text>
        {forYou ? <View style={cardStyles.forYou}><Text style={[type.micro, { color: color.accent }]}>For you</Text></View> : null}
      </View>
      {action}
    </View>
  );
}

/** A titled row that scrolls sideways. */
export function RailFrame({ title, forYou, action, children }: { title: string; forYou?: boolean; action?: ReactNode; children: ReactNode }) {
  // The site's chevrons (Rail.tsx): on a wide window, fading in while the
  // pointer is over the rail, each a step of 320 px. A phone scrolls by finger.
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.md;
  const [hovering, setHovering] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const list = useRef<FlatList<ReactNode>>(null);
  const x = useRef(0);
  const step = (dir: 1 | -1) => {
    const to = Math.max(0, x.current + dir * 320);
    if (list.current) list.current.scrollToOffset({ offset: to, animated: true });
    else scroller.current?.scrollTo({ x: to, animated: true });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { x.current = e.nativeEvent.contentOffset.x; };
  // On a device a rail is a windowed list: only the cards near the screen are
  // mounted and hold a decoded poster. Home drew 65 cards at once, three a
  // rail in view, and their posters queued ahead of the ones on screen (RV31,
  // 2026-10-23). A browser and a server render every card: the static page's
  // HTML needs them all, and a browser loads an image only when it is near.
  const cells = Platform.OS === 'web' ? null : Children.toArray(children);
  return (
    <View>
      <RailTitle title={title} forYou={forYou} action={action} />
      <View
        style={{ position: 'relative' }}
        {...(wide ? ({ onPointerEnter: () => setHovering(true), onPointerLeave: () => setHovering(false) } as object) : null)}>
        {cells ? (
          <FlatList
            ref={list} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.railList}
            data={cells} keyExtractor={(cell, i) => (isValidElement(cell) && cell.key != null ? String(cell.key) : String(i))}
            renderItem={({ item }) => item as ReactElement}
            // A spacer, not the row's gap: the list's stand-ins for unmounted cards would take a gap too.
            ItemSeparatorComponent={RailGap}
            initialNumToRender={4} maxToRenderPerBatch={4} windowSize={3}
            onScroll={onScroll} scrollEventThrottle={64}
          />
        ) : (
          <ScrollView
            ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.railRow}
            onScroll={onScroll} scrollEventThrottle={64}>
            {children}
          </ScrollView>
        )}
        {wide ? (
          <>
            <RailArrow dir={-1} title={title} shown={hovering} onPress={() => step(-1)} />
            <RailArrow dir={1} title={title} shown={hovering} onPress={() => step(1)} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function RailGap() {
  return <View style={{ width: cardStyles.railRow.gap }} />;
}

function RailArrow({ dir, title, shown, onPress }: { dir: 1 | -1; title: string; shown: boolean; onPress: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Scroll ${title} ${dir < 0 ? 'left' : 'right'}`}
      pointerEvents={shown ? 'auto' : 'none'}
      style={[cardStyles.railArrow, dir < 0 ? { left: -18 } : { right: -18 }, { opacity: shown ? 1 : 0 }]}>
      <Icon size={16} color={color.textPrimary} />
    </Pressable>
  );
}

/**
 * The card for a page with no app behind it: the website's static pages, which
 * a server renders and nothing runs on. The same face, a plain link, and the
 * bar a signed-out visitor sees, whose two buttons lead to sign-in (/profile).
 */
export function StaticPosterCard({ item, style, dateText }: { item: CardItem; style?: StyleProp<ViewStyle>; dateText?: string }) {
  const bar = (
    <View style={cardStyles.bar}>
      <Pressable {...({ href: '/profile' } as object)} accessibilityRole="link" accessibilityLabel="Sign in to rate this"
        style={[cardStyles.barBtn, { flex: 1 }, cardStyles.barBtnIdle]}>
        <Star size={14} color={color.textPrimary} fill="none" />
        <Text style={[type.label, { color: color.textPrimary }]}>Rate</Text>
      </Pressable>
      <Pressable {...({ href: '/profile' } as object)} accessibilityRole="link" accessibilityLabel="Sign in to add this to your wishlist"
        style={[cardStyles.barBtn, { width: 32 }, cardStyles.barBtnIdle]}>
        <Bookmark size={14} color={color.textSecondary} fill="none" />
      </Pressable>
    </View>
  );
  return <CardFace item={item} match={null} link={{ anchor: { href: cardHref(item) } }} style={style} bar={bar} dateText={dateText} />;
}

/** A rail of static cards, 150 px each: the item page's two rails on the website's static pages. */
export function StaticRail({ title, items }: { title: string; items: CardItem[] }) {
  return (
    <RailFrame title={title}>
      {items.map((item) => <StaticPosterCard key={item.key} item={item} style={{ width: 150 }} />)}
    </RailFrame>
  );
}

/**
 * The grid for a static page: StaticPosterCards in rows that wrap, inside the
 * same content box PosterGrid uses. A server cannot measure the window, so the
 * column count comes from STATIC_GRID_CSS, which the page must carry.
 */
export function StaticGrid({ items, header, footer, dateOf }: { items: CardItem[]; header?: ReactNode; footer?: ReactNode; dateOf?: (item: CardItem) => string }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={cardStyles.gridContent}>
      {header}
      <View {...({ dataSet: { grid: 'static' } } as object)} style={cardStyles.staticGrid}>
        {items.map((item) => <StaticPosterCard key={item.key} item={item} dateText={dateOf?.(item)} />)}
      </View>
      {footer}
    </ScrollView>
  );
}

/** gridColumns (cards.tsx) as CSS: 2 columns, then 3, 4, 5 and 6 at the same widths, with PosterGrid's 16 px gap. */
export const STATIC_GRID_CSS = [[0, 2], [breakpoint.sm, 3], [breakpoint.md, 4], [breakpoint.lg, 5], [breakpoint.xl, 6]]
  .map(([min, n]) => {
    const rule = `[data-grid="static"]>*{width:calc((100% - ${(n - 1) * 16}px)/${n})}`;
    return min ? `@media (min-width:${min}px){${rule}}` : rule;
  }).join('');

/** The card's and the rail's styles. cards.tsx spreads these into its own. */
export const cardStyles = StyleSheet.create({
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
  // Under the name, in the body's own gap: the part somebody had in the title (a person's or a studio's page).
  role: { marginTop: -3, color: color.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 21 },
  barWrap: { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 10 },
  bar: { flexDirection: 'row', gap: 6 },
  barBtn: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, borderWidth: 1 },
  barBtnIdle: { backgroundColor: color.fillIdle, borderColor: color.fillIdleBorder },
  railHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingHorizontal: 4 },
  railTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  forYou: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.accentSubtle },
  railRow: { gap: 12, paddingBottom: 4 },
  railList: { paddingBottom: 4 },
  railArrow: {
    position: 'absolute', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: radius.full, zIndex: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.border,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  gridContent: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44 },
  staticGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
