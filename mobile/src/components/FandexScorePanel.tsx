// The item page's score panel. Since 2026-10-27 the score is the number again,
// read as the rating you would probably give, times ten: "72", then "You'd
// probably give this a 7, above your usual for films", your average for the
// medium under it so the number has an anchor, and how often you pick this
// kind of thing, which is said beside the number and is not in it. "Why?"
// opens the sheet with every row behind it, so the arithmetic can be seen,
// and ends with how right the number has been on your own ratings
// (docs/fandex-score.md §7).
//
// Five states:
//   anon     → "Sign in to see your score." The whole panel is the button.
//   settling → signed in, your library still arriving on this device.
//   cold     → fewer than three ratings: a nudge, no number.
//   none     → enough ratings, but this title shares nothing with them.
//   scored   → the number, the sentences, and the breakdown.
//
// On a phone the breakdown is a sheet, which cannot be clipped by a scroll
// view or sit under the navigation bar.
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FACET_HEX, facetClassOf } from '@/lib/facetPalette';
import { bandColor, Sheet } from '~/components/kit';
import { facetId, type FandexScore, type FollowMode, type ScoreReason } from '~/lib/fandexScore';
import type { MediumCalibration } from '~/lib/scoreCalibration';
import { axisRows, calibrationLine, cappedRows, centreSentence, mediumPlural, pullLine, pullSentence, reasonHref, rungLine, scoreSentence, signed, tasteSentence } from '~/lib/scoreReasons';
import { color, font, radius, type } from '~/theme';

// The site's ROLE_LABELS (src/lib/constants.ts). Franchise is singular on
// purpose: a title belongs to one, so it reads as a row heading.
const ROLE_LABELS: Record<string, string> = {
  director: 'Director', writer: 'Writer', creator: 'Creator', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network', ip: 'Franchise',
};

function Shell({ eyebrow, line, muted }: { eyebrow: string; line: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.eyebrow, { color: color.accent }]}>{eyebrow}</Text>
        <Text style={[styles.line, muted && { color: color.textSecondary, fontFamily: font.sans }]}>{line}</Text>
      </View>
    </View>
  );
}

/** `settling`: signed in, and your library is still arriving on this device. */
export type ScorePanelState = 'anon' | 'settling' | 'cold' | 'none' | 'scored';

export function FandexScorePanel({ state, fandex, type: mediaType, categoryLabel, calibration, onSignIn, signInHref, onOpenFacet, follows, onFollow }: {
  /** Where signing in happens, for a page that cannot run `onSignIn`. */
  signInHref?: string;
  state: ScorePanelState;
  /** The score, when `state` is `scored`. */
  fandex: FandexScore | null;
  /** The title's medium, for the sentences. */
  type?: string;
  /** A tag category's name, from the live taxonomy. */
  categoryLabel: (id: string | undefined) => string | null;
  /** How right the score has been on your own ratings, for the sheet's last lines. Absent until the device has measured. */
  calibration?: MediumCalibration | null;
  onSignIn?: () => void;
  /** Follow a row's chip to its tag, person, studio or franchise page. */
  onOpenFacet?: (href: string) => void;
  /** What you follow or avoid, by facet id, so a row can say so. */
  follows?: ReadonlyMap<string, FollowMode>;
  /** Follow the facet behind a pull row, or take the follow back (`null`). Absent on a page that cannot write. */
  onFollow?: (reason: ScoreReason, mode: FollowMode | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (state === 'anon') {
    // The whole panel is the instruction, so the whole panel is the button. Named outright, not by its text run.
    // On a page with no script (the website's static title page) it is a link instead: `signInHref`.
    const anchor = signInHref && Platform.OS === 'web' ? ({ href: signInHref } as object) : null;
    return (
      <Pressable {...anchor} onPress={onSignIn} disabled={!onSignIn && !anchor} accessibilityRole={anchor ? 'link' : 'button'} accessibilityLabel="Sign in to see your Fandex Score" style={({ pressed }) => [styles.panel, pressed && { opacity: 0.7 }]}>
        <Shell eyebrow="Your Fandex Score" line="Sign in to see what you would probably rate this." muted />
      </Pressable>
    );
  }
  if (state === 'settling') {
    // Said in words. A held box with nothing in it reads as a panel that broke.
    return <View style={styles.panel}><Shell eyebrow="Your Fandex Score" line="Reading your library. Your score shows when it is all here." muted /></View>;
  }
  if (state === 'cold') {
    return <View style={styles.panel}><Shell eyebrow="Your Fandex Score" muted line="Rate a few titles to unlock your score: what you would probably rate what you browse." /></View>;
  }
  if (state === 'none' || !fandex) {
    return <View style={styles.panel}><Shell eyebrow="Your Fandex Score" line="Not enough ratings yet to score this." muted /></View>;
  }

  const tone = bandColor(fandex.band);
  const shown = Math.round(fandex.score);
  const pull = pullLine(fandex.pull, mediaType);
  const pullRows = axisRows(fandex.reasons, 'pull');
  const tasteRows = axisRows(fandex.reasons, 'taste');
  const capped = cappedRows(fandex.reasons);
  const honest = calibrationLine(calibration ?? null);
  const rung = rungLine(calibration ?? null, fandex.score);
  const groupLabel = (r: ScoreReason) => (r.kind === 'tag' ? categoryLabel(r.category ?? 'other') ?? r.category ?? 'other' : ROLE_LABELS[r.role ?? ''] ?? 'Person');

  const row = (r: ScoreReason) => {
    const tint = FACET_HEX[facetClassOf(r)];
    const href = reasonHref(r);
    const mode = follows?.get(facetId(r)) ?? r.followed ?? null;
    return (
      <View key={`${r.axis}|${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.reasonHead}>
            {href && onOpenFacet ? (
              <Pressable onPress={() => { setOpen(false); onOpenFacet(href); }} accessibilityRole="link" accessibilityLabel={r.label} style={({ pressed }) => [styles.chip, { backgroundColor: `${tint}21` }, pressed && { opacity: 0.6 }]}>
                <Text numberOfLines={1} style={[styles.small, { color: tint }]}>{r.label}</Text>
              </Pressable>
            ) : <Text numberOfLines={1} style={[styles.small, styles.strong, { flexShrink: 1 }]}>{r.label}</Text>}
            <Text style={styles.group}>{groupLabel(r)}</Text>
            {/* A tag's tier on this title (§3.9): a genre, theme or voted tag is core; an editor's keyword is detail, and counts half. */}
            {r.kind === 'tag' && r.tier ? <Text style={styles.group}>{r.tier === 'keyword' ? 'detail' : 'core'}</Text> : null}
            {mode === 'avoid' ? <Text style={[styles.group, { color: color.scoreLow }]}>avoiding</Text> : null}
          </View>
          <Text style={styles.small}>{r.axis === 'pull' ? pullSentence(r) : tasteSentence(r)}</Text>
        </View>
        {r.axis === 'pull' && onFollow ? (
          // The one thing a person sets by hand: a follow moves this row to the most anyone can seek out, and nothing else.
          <Pressable
            onPress={() => onFollow(r, mode === 'follow' ? null : 'follow')} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={mode === 'follow' ? `Stop following ${r.label}` : `Follow ${r.label}`}
            style={({ pressed }) => [styles.follow, mode === 'follow' && styles.followOn, pressed && { opacity: 0.6 }]}>
            <Text style={[styles.followText, mode === 'follow' && { color: color.textOnAccent }]}>{mode === 'follow' ? 'Following' : 'Follow'}</Text>
          </Pressable>
        ) : null}
        {/* A pull row carries no points: it is beside the number, not in it. */}
        {r.axis === 'taste' ? <Text style={[styles.small, styles.strong, { color: r.contribution >= 0 ? color.success : color.danger, minWidth: 36, textAlign: 'right' }]}>{signed(r.contribution)}</Text> : null}
      </View>
    );
  };

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.eyebrow, { color: color.accent }]}>{fandex.leftOut ? 'Your Fandex Score, without your rating' : 'Your Fandex Score'}</Text>
          <View style={styles.numberLine}>
            <Text accessibilityLabel={`Your Fandex Score ${shown}`} style={[styles.number, { color: tone }]}>{shown}</Text>
            <Text style={[styles.line, { flex: 1, minWidth: 0, marginTop: 0 }]}>{scoreSentence(fandex, mediaType)}</Text>
          </View>
          <Text style={[styles.small, { marginTop: 6 }]}>{centreSentence(fandex.center, mediaType)}</Text>
          {pull ? <Text style={styles.small}>{pull}</Text> : null}
        </View>
        {fandex.reasons.length ? (
          // The one control on the panel: the number and the sentences are not buttons.
          <Pressable onPress={() => setOpen(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Show why" style={({ pressed }) => [styles.why, pressed && { opacity: 0.6 }]}>
            <Text style={styles.whyText}>Why? ▼</Text>
          </Pressable>
        ) : null}
      </View>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Why ${shown}?`}>
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.breakdown}>
          <Text style={styles.small}>
            {centreSentence(fandex.center, mediaType, fandex.leftOut)} The score starts there, and every counted row below moves it.
          </Text>

          <View style={styles.groupBlock}>
            <View style={styles.groupHead}>
              <Text style={[styles.groupTitle, { color: color.scoreHigh }]}>What you rate</Text>
              <Text style={[styles.small, styles.strong]}>{signed(fandex.taste.points)}</Text>
            </View>
            {tasteRows.length ? tasteRows.map(row) : <Text style={styles.small}>None of your ratings touch this title's facets.</Text>}
          </View>

          {fandex.pull ? (
            <View style={styles.groupBlock}>
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: color.accent }]}>What you pick</Text>
                <Text style={styles.small}>not in the number</Text>
              </View>
              {pull ? <Text style={styles.small}>{pull}</Text> : null}
              {pullRows.length ? pullRows.map(row) : <Text style={styles.small}>Nothing on this title stands out from how often you usually pick things.</Text>}
            </View>
          ) : (
            // No pull axis: the device has no baseline for this medium yet. Said, so a missing group never reads as broken.
            <Text style={styles.small}>How often you pick this kind of thing is not measured here yet: the ordinary titles it is compared with are still arriving on this device.</Text>
          )}

          {capped.length ? (
            <View style={styles.groupBlock}>
              <Text style={styles.cappedNote}>Also here, not counted: only the strongest few of each kind count</Text>
              <View style={styles.cappedWrap}>
                {capped.slice(0, 12).map((r) => (
                  <Text key={`${r.axis}|${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.cappedChip} numberOfLines={1}>{r.label} {signed(r.impact)}</Text>
                ))}
                {capped.length > 12 ? <Text style={styles.cappedChip}>+{capped.length - 12} more</Text> : null}
              </View>
            </View>
          ) : null}

          <Text style={[styles.small, styles.how]}>
            <Text style={styles.strong}>How this works. </Text>
            The number is what you would probably rate this, times ten. It starts from your average for {mediumPlural(mediaType)} and moves by what this title is made of: its setting and themes, its people, its studio and its franchise, each by how you rated the titles you have met it on. A facet you met once barely moves it; one you met forty times moves it fully. Only ratings you typed count, nobody else&apos;s. How often you pick this kind of thing is said beside the number and never moves it. Tap any row to see the titles behind it.
          </Text>
          {honest || rung ? (
            <Text style={styles.small}>
              <Text style={styles.strong}>How right it has been. </Text>
              {[honest, rung].filter(Boolean).join(' ')}
            </Text>
          ) : null}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 },
  numberLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  number: { fontFamily: font.serif, fontSize: 36, lineHeight: 40, fontVariant: ['tabular-nums'] },
  line: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, color: color.textPrimary, marginTop: 4 },
  why: { paddingHorizontal: 8, paddingVertical: 4, marginRight: -4, borderRadius: radius.sm },
  whyText: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  breakdown: { padding: 14, gap: 14 },
  small: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  strong: { fontFamily: font.sansBold, color: color.textPrimary },
  groupBlock: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: color.border },
  groupTitle: { fontFamily: font.sansBold, fontSize: 10, lineHeight: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  reason: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  reasonHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  group: { fontFamily: font.sans, fontSize: 10, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textMuted },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, maxWidth: '100%' },
  follow: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1, borderColor: color.border },
  followOn: { backgroundColor: color.accent, borderColor: color.accent },
  followText: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textSecondary },
  cappedNote: { fontFamily: font.sans, fontSize: 10, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textSecondary },
  cappedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cappedChip: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textMuted, borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  how: { paddingTop: 10, borderTopWidth: 1, borderTopColor: color.border, lineHeight: 17 },
});
