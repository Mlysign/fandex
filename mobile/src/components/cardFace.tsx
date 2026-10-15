// What a poster card and a rail look like, with nothing that needs the app.
//
// components/cards.tsx is the app's: its cards follow a link through the
// router and act on your rows. This module is the half a server can render:
// the card's face, a rail's frame, and the static card, rail and grid the
// website's build draws with them (mobile/web/render.tsx). No router, no
// database, no session, no hooks but useState. ⚠️ Keep it that way: importing
// anything that reaches expo-router here breaks the site's build.

import { Bookmark, Star } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Img } from '~/components/Img';
import { CommunityScore, FandexScore } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { cardHref } from '~/lib/cardHref';
import type { CardItem } from '~/lib/cards';
import { monthYear } from '~/lib/dates';
import { breakpoint, color, font, radius, type } from '~/theme';

/** What PosterCard and StaticPosterCard share: everything but how the card is followed and its bar. */
export function CardFace({ item, score, center, link, bar, style }: {
  item: CardItem;
  score: number | null;
  center: number | null;
  link: { anchor: object | null; onPress?: (e?: GestureResponderEvent) => void };
  bar: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <View style={[cardStyles.card, hovered && { borderColor: color.borderStrong }, style]}>
      <Pressable
        {...link.anchor}
        onPress={link.onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
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
            <Text style={[type.micro, { color: color.textPrimary }]}>{item.type}</Text>
          </View>
        </View>
        <View style={cardStyles.body}>
          <Text numberOfLines={1} style={type.serifSm}>{item.title}</Text>
          <View style={cardStyles.metaRow}>
            <Text numberOfLines={1} style={[type.meta, { flexShrink: 1 }]}>{monthYear(item.releaseDate)}</Text>
            {score != null ? <FandexScore score={score} center={center} />
              : item.communityScore != null ? <CommunityScore score={item.communityScore} /> : null}
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
        <Text accessibilityRole="header" style={type.serifMd}>{title}</Text>
        {forYou ? <View style={cardStyles.forYou}><Text style={[type.micro, { color: color.accent }]}>For you</Text></View> : null}
      </View>
      {action}
    </View>
  );
}

/** A titled row that scrolls sideways. */
export function RailFrame({ title, forYou, action, children }: { title: string; forYou?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <View>
      <RailTitle title={title} forYou={forYou} action={action} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.railRow}>
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * The card for a page with no app behind it: the website's static pages, which
 * a server renders and nothing runs on. The same face, a plain link, and the
 * bar a signed-out visitor sees, whose two buttons lead to sign-in (/profile).
 */
export function StaticPosterCard({ item, style }: { item: CardItem; style?: StyleProp<ViewStyle> }) {
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
  return <CardFace item={item} score={null} center={null} link={{ anchor: { href: cardHref(item) } }} style={style} bar={bar} />;
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
export function StaticGrid({ items, header, footer }: { items: CardItem[]; header?: ReactNode; footer?: ReactNode }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={cardStyles.gridContent}>
      {header}
      <View {...({ dataSet: { grid: 'static' } } as object)} style={cardStyles.staticGrid}>
        {items.map((item) => <StaticPosterCard key={item.key} item={item} />)}
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
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 21 },
  barWrap: { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 10 },
  bar: { flexDirection: 'row', gap: 6 },
  barBtn: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, borderWidth: 1 },
  barBtnIdle: { backgroundColor: color.fillIdle, borderColor: color.fillIdleBorder },
  railHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, paddingHorizontal: 4 },
  railTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  forYou: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: color.accentSubtle },
  railRow: { gap: 12, paddingBottom: 4 },
  gridContent: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44 },
  staticGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
