// Your Fandex Score on a title's page (since 0.3.50, Nils's B3b mockup,
// 2026-11-07): a round seal at the right end of the row over the picture, its
// ring filled to the score, "YOUR FANDEX SCORE" running round the rim, and a
// small ? that opens the Why sheet. The sheet leads with a ring of what moved
// the number, solid for up and striped for down, then every row and a link to
// /score, which explains the score and says how right it has been on your own
// ratings (docs/fandex-score.md §7).
//
// Five states, as the old panel had:
//   anon     → "Sign in" in the seal. The seal is the button (a link on a static page).
//   settling → signed in, your library still arriving on this device: "…".
//   cold     → fewer than three ratings: "Rate a few", no number.
//   none     → enough ratings, but this title shares nothing with them.
//   scored   → the number in its band's colour, and the ?.
// No state (null) is the seal's empty ring, held while the session or the
// profile is read, so the row does not jump when the answer arrives.
//
// Rendered on a server too (the website's static title page shows the anon
// seal): plain react-native and react-native-svg, no database, router or window.
import { useId } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect, Text as SvgText, TextPath } from 'react-native-svg';
import { FACET_HEX, facetClassOf } from '@/lib/facetPalette';
import { bandColor, Sheet } from '~/components/kit';
import { PRESS, usePressScale } from '~/components/pressFeel';
import { facetId, type FandexScore, type FollowMode, type ScoreReason } from '~/lib/fandexScore';
import { axisRows, cappedRows, PULL_SHOWN, pullLine, pullSentence, reasonHref, tasteSentence } from '~/lib/scoreReasons';
import { color, font, radius, TYPE_LABEL } from '~/theme';

/** `settling`: signed in, and your library is still arriving on this device. */
export type ScorePanelState = 'anon' | 'settling' | 'cold' | 'none' | 'scored';

/** The page the sheet ends with a link to (app/(tabs)/score.tsx). */
const HOW_IT_WORKS = '/score';

/** The seal's size on a title's page. The small circles beside it are `RATING_CIRCLE`. */
export const SEAL_SIZE = 88;

// The site's ROLE_LABELS (src/lib/constants.ts). Franchise is singular on
// purpose: a title belongs to one, so it reads as a row heading.
const ROLE_LABELS: Record<string, string> = {
  director: 'Director', writer: 'Writer', creator: 'Creator', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network', ip: 'Franchise',
};

/** A row's points on the score's own scale, whole (the number is whole, so its parts are too). Under half a point is "0", unsigned. */
const points = (n: number) => {
  const r = Math.round(n);
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
};

/** What the seal says in words, for a screen reader and for the states with no number. */
const SAYS: Record<ScorePanelState, string> = {
  anon: 'Sign in to see your Fandex Score',
  settling: 'Your Fandex Score: reading your library',
  cold: 'Your Fandex Score: rate a few titles to unlock it',
  none: 'Your Fandex Score: not enough ratings yet to score this',
  scored: 'Your Fandex Score',
};

export function ScoreSeal({ state, fandex, size = SEAL_SIZE, onWhy, onSignIn, signInHref }: {
  /** Null while the session or the profile is still being read: the empty ring. */
  state: ScorePanelState | null;
  /** The score, when `state` is `scored`. */
  fandex: FandexScore | null;
  size?: number;
  /** Open the Why sheet. The seal is its button when the score has rows behind it. */
  onWhy?: () => void;
  onSignIn?: () => void;
  /** Where signing in happens, for a page that cannot run `onSignIn` (the static title page). */
  signInHref?: string;
}) {
  const id = `seal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const press = usePressScale(PRESS.person);
  const scored = state === 'scored' && !!fandex;
  const shown = scored ? Math.round(fandex.score) : null;
  const tone = scored ? bandColor(fandex.band) : color.textMuted;
  const R = 40;
  const C = 2 * Math.PI * R;
  const fill = shown != null ? Math.max(0, Math.min(100, shown)) / 100 : 0;
  const why = scored && fandex.reasons.length > 0 && !!onWhy;

  const face = (
    <Animated.View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }, { transform: [{ scale: press.scale }] }]}>
      <Svg width={size} height={size} viewBox="0 0 120 120" style={StyleSheet.absoluteFill}>
        <Defs>
          <Path id={id} d="M60,60 m-50,0 a50,50 0 1,1 100,0 a50,50 0 1,1 -100,0" />
        </Defs>
        <Circle cx="60" cy="60" r={R} fill="none" stroke="rgba(237,231,220,0.08)" strokeWidth={5} />
        {fill > 0 ? (
          <Circle
            cx="60" cy="60" r={R} fill="none" stroke={tone} strokeWidth={5} strokeLinecap="round"
            strokeDasharray={`${C * fill} ${C}`} transform="rotate(-90 60 60)"
          />
        ) : null}
        <SvgText fontFamily={font.mono} fontSize={6.4} letterSpacing={2.3} fill={color.accent}>
          <TextPath href={`#${id}`} startOffset="2%">YOUR FANDEX SCORE · YOUR FANDEX SCORE ·</TextPath>
        </SvgText>
      </Svg>
      {shown != null ? (
        <Text style={[styles.number, { color: tone, fontSize: size * 0.3, lineHeight: size * 0.34 }]}>{shown}</Text>
      ) : state === 'settling' ? (
        <Text style={[styles.number, { color: color.textSecondary, fontSize: size * 0.24, lineHeight: size * 0.3 }]}>…</Text>
      ) : state && state !== 'scored' ? (
        <Text style={[styles.word, state === 'anon' && { color: color.accent }]}>
          {state === 'anon' ? 'Sign in' : state === 'cold' ? 'Rate\na few' : 'No score\nyet'}
        </Text>
      ) : null}
      {why ? <View style={styles.q}><Text style={styles.qText}>?</Text></View> : null}
    </Animated.View>
  );

  const label = scored ? `${SAYS.scored} ${shown}${why ? '. Show why' : ''}` : state ? SAYS[state] : 'Your Fandex Score';
  if (state === 'anon') {
    // On a page with no script (the website's static title page) it is a link instead: `signInHref`.
    const anchor = signInHref && Platform.OS === 'web' ? ({ href: signInHref } as object) : null;
    if (!onSignIn && !anchor) return <View accessibilityLabel={label}>{face}</View>;
    return (
      <Pressable {...anchor} onPress={onSignIn} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole={anchor ? 'link' : 'button'} accessibilityLabel={label}>
        {face}
      </Pressable>
    );
  }
  if (!why) return <View accessible accessibilityLabel={label}>{face}</View>;
  return (
    <Pressable onPress={() => { press.pop(); onWhy(); }} onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}>
      {face}
    </Pressable>
  );
}

/** The Why sheet's ring: one slice per counted row, as long as the row moved the number. */
function WhyRing({ rows, fandex, size = 132 }: { rows: ScoreReason[]; fandex: FandexScore; size?: number }) {
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const R = 46;
  const C = 2 * Math.PI * R;
  const total = rows.reduce((s, r) => s + Math.abs(r.contribution), 0);
  const classes = [...new Set(rows.map((r) => facetClassOf(r)))];
  let off = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 120 120" style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Striped: the row took points away. Solid: it added them. */}
          {classes.map((k) => (
            <Pattern key={k} id={`${id}${k}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Rect width={4} height={4} fill={color.surfaceOverlay} />
              <Rect width={2} height={4} fill={FACET_HEX[k]} />
            </Pattern>
          ))}
        </Defs>
        <Circle cx="60" cy="60" r={R} fill="none" stroke="rgba(237,231,220,0.06)" strokeWidth={14} />
        {total > 0 ? rows.map((r) => {
          const len = (C * Math.abs(r.contribution)) / total;
          const k = facetClassOf(r);
          const slice = (
            <Circle
              key={`${r.kind}|${r.role ?? ''}|${r.label}`} cx="60" cy="60" r={R} fill="none" strokeWidth={14}
              stroke={r.contribution >= 0 ? FACET_HEX[k] : `url(#${id}${k})`}
              strokeDasharray={`${Math.max(0, len - 2.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 60 60)"
            />
          );
          off += len;
          return slice;
        }) : null}
      </Svg>
      <Text style={[styles.ringNumber, { color: bandColor(fandex.band) }]}>{Math.round(fandex.score)}</Text>
      <Text style={styles.ringUsual}>USUAL {Math.round(fandex.center)}</Text>
    </View>
  );
}

export function WhySheet({ open, onClose, fandex, title, type: mediaType, categoryLabel, onOpenFacet, follows, onFollow }: {
  open: boolean;
  onClose: () => void;
  fandex: FandexScore | null;
  /** The title's name, beside the ring. */
  title: string;
  /** The title's medium, for "your usual for shows". */
  type?: string;
  /** A tag category's name, from the live taxonomy. */
  categoryLabel: (id: string | undefined) => string | null;
  /** Follow a row's chip to its tag, person, studio or franchise page, or the link to /score. */
  onOpenFacet?: (href: string) => void;
  /** What you follow or avoid, by facet id, so a row can say so. */
  follows?: ReadonlyMap<string, FollowMode>;
  /** Follow the facet behind a pull row, or take the follow back (`null`). Absent on a page that cannot write. */
  onFollow?: (reason: ScoreReason, mode: FollowMode | null) => void;
}) {
  if (!fandex) return null;
  const shown = Math.round(fandex.score);
  // Pull is off the screen while PULL_SHOWN is false (scoreReasons.ts): no line, no group, no Follow.
  const pull = PULL_SHOWN ? pullLine(fandex.pull, mediaType) : null;
  const pullRows = PULL_SHOWN ? axisRows(fandex.reasons, 'pull') : [];
  const tasteRows = axisRows(fandex.reasons, 'taste');
  const capped = cappedRows(fandex.reasons);
  const groupLabel = (r: ScoreReason) => (r.kind === 'tag' ? categoryLabel(r.category ?? 'other') ?? r.category ?? 'other' : ROLE_LABELS[r.role ?? ''] ?? 'Person');
  const medium = mediaType ? (TYPE_LABEL[mediaType] ?? mediaType).toLowerCase() : null;

  const row = (r: ScoreReason) => {
    const tint = FACET_HEX[facetClassOf(r)];
    const href = reasonHref(r);
    const mode = follows?.get(facetId(r)) ?? r.followed ?? null;
    const up = r.contribution >= 0;
    return (
      <View key={`${r.axis}|${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
        {/* The row's key on the ring: solid when it added points, striped (an outline here) when it took them. */}
        {r.axis === 'taste' ? <View style={[styles.swatch, up ? { backgroundColor: tint } : { borderWidth: 1.5, borderColor: tint, borderStyle: 'dashed' }]} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.reasonHead}>
            {href && onOpenFacet ? (
              <Pressable onPress={() => { onClose(); onOpenFacet(href); }} accessibilityRole="link" accessibilityLabel={r.label} style={({ pressed }) => [styles.chip, { backgroundColor: `${tint}21` }, pressed && { opacity: 0.6 }]}>
                <Text numberOfLines={1} style={[styles.small, { color: tint }]}>{r.label}</Text>
              </Pressable>
            ) : <Text numberOfLines={1} style={[styles.small, { color: tint, flexShrink: 1 }]}>{r.label}</Text>}
            <Text style={styles.group}>{groupLabel(r)}</Text>
            {mode === 'avoid' ? <Text style={[styles.group, { color: color.scoreLow }]}>avoiding</Text> : null}
          </View>
          <Text style={styles.sentence}>{r.axis === 'pull' ? pullSentence(r) : tasteSentence(r)}</Text>
        </View>
        {r.axis === 'pull' && onFollow ? (
          <Pressable
            onPress={() => onFollow(r, mode === 'follow' ? null : 'follow')} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={mode === 'follow' ? `Stop following ${r.label}` : `Follow ${r.label}`}
            style={({ pressed }) => [styles.follow, mode === 'follow' && styles.followOn, pressed && { opacity: 0.6 }]}>
            <Text style={[styles.followText, mode === 'follow' && { color: color.textOnAccent }]}>{mode === 'follow' ? 'Following' : 'Follow'}</Text>
          </Pressable>
        ) : null}
        {/* A pull row carries no points: it is beside the number, not in it. */}
        {r.axis === 'taste' ? <Text style={[styles.value, { color: Math.round(r.contribution) === 0 ? color.textMuted : up ? color.scoreHigh : color.scoreLow }]}>{points(r.contribution)}</Text> : null}
      </View>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Why ${shown}?`}>
      <ScrollView style={{ maxHeight: 600 }} contentContainerStyle={styles.breakdown}>
        <View style={styles.lead}>
          <WhyRing rows={tasteRows} fandex={fandex} />
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <Text style={styles.leadTitle} numberOfLines={3}>{title}</Text>
            <Text style={styles.leadNote}>
              {medium ? `Your usual for ${medium}s ${Math.round(fandex.center)}` : `Your usual ${Math.round(fandex.center)}`}
              {'\n'}Solid: pushed it up · striped: down
            </Text>
          </View>
        </View>

        <View style={styles.rows}>
          {tasteRows.length ? tasteRows.map(row) : <Text style={styles.small}>None of your ratings touch this title&apos;s facets.</Text>}
        </View>

        {!PULL_SHOWN ? null : fandex.pull ? (
          <View style={styles.rows}>
            <Text style={styles.groupTitle}>What you pick · not in the number</Text>
            {pull ? <Text style={styles.small}>{pull}</Text> : null}
            {pullRows.length ? pullRows.map(row) : <Text style={styles.small}>Nothing on this title stands out from how often you usually pick things.</Text>}
          </View>
        ) : (
          <Text style={styles.small}>How often you pick this kind of thing is not measured here yet: the ordinary titles it is compared with are still arriving on this device.</Text>
        )}

        {capped.length ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.groupTitle}>Also here, not counted: only the strongest few of each kind count</Text>
            <View style={styles.cappedWrap}>
              {capped.slice(0, 12).map((r) => (
                <Text key={`${r.axis}|${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.cappedChip} numberOfLines={1}>{r.label} {points(r.impact)}</Text>
              ))}
              {capped.length > 12 ? <Text style={styles.cappedChip}>+{capped.length - 12} more</Text> : null}
            </View>
          </View>
        ) : null}

        <Pressable
          {...(Platform.OS === 'web' && !onOpenFacet ? ({ href: HOW_IT_WORKS } as object) : null)}
          onPress={onOpenFacet ? () => { onClose(); onOpenFacet(HOW_IT_WORKS); } : undefined}
          accessibilityRole="link" hitSlop={8} style={({ pressed }) => [styles.how, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.small, { color: color.accent }]}>How the score works</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The disc is the seal's own box, so the circles beside it line up with its bottom.
  disc: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceInset,
    borderWidth: 1, borderColor: color.borderStrong,
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  number: { fontFamily: font.serif, textAlign: 'center', fontVariant: ['tabular-nums'] },
  word: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 13, textAlign: 'center', color: color.textSecondary },
  // The ? on the seal's lower right, ringed in the page colour so it reads as its own button.
  q: {
    position: 'absolute', right: 1, bottom: 1, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent, borderWidth: 3, borderColor: color.surface,
  },
  qText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 14, color: color.surface },

  breakdown: { padding: 16, gap: 16 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  leadTitle: { fontFamily: font.serif, fontSize: 20, lineHeight: 23, color: color.textPrimary },
  leadNote: { fontFamily: font.mono, fontSize: 10, lineHeight: 15, color: color.textSecondary },
  ringNumber: { fontFamily: font.serif, fontSize: 36, lineHeight: 40, fontVariant: ['tabular-nums'] },
  ringUsual: { fontFamily: font.mono, fontSize: 7.5, lineHeight: 10, letterSpacing: 1.4, color: color.textSecondary },
  rows: { gap: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: color.border },
  small: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  swatch: { width: 10, height: 10, borderRadius: 3, marginTop: 5 },
  reasonHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  group: { fontFamily: font.mono, fontSize: 9, lineHeight: 12, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textSecondary },
  sentence: { fontFamily: font.sans, fontSize: 11, lineHeight: 15, color: color.textMuted },
  value: { fontFamily: font.mono, fontSize: 12, lineHeight: 20, minWidth: 30, textAlign: 'right' },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, maxWidth: '100%' },
  groupTitle: { fontFamily: font.mono, fontSize: 9, lineHeight: 12, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textSecondary },
  follow: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1, borderColor: color.border },
  followOn: { backgroundColor: color.accent, borderColor: color.accent },
  followText: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textSecondary },
  cappedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cappedChip: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textMuted, borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  how: { paddingTop: 12, borderTopWidth: 1, borderTopColor: color.border },
});
