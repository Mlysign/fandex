// The item page's Fandex Score panel. A port of the site's
// src/components/item/FandexScoreSection.tsx: a big serif number, an accent
// eyebrow and one line that says why, with the reasons behind "Why?".
//
// Four states, as on the site:
//   anon     → "Sign in to see your taste-match Score." The whole panel is the button.
//   cold     → fewer than three ratings: a nudge, no number.
//   none     → enough ratings, but this title shares nothing with them.
//   scored   → the number, the band in words, and the breakdown.
//
// The breakdown adds up: your baseline, plus every counted row, is the score.
// The baseline and the sum are rows of their own so the arithmetic can be seen.
//
// One difference a phone forces: the site's breakdown floated under the panel.
// Here it is a sheet, which cannot be clipped by a scroll view or sit under the
// navigation bar.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FACET_HEX, facetClassOf } from '@/lib/facetPalette';
import { Sheet } from '~/components/kit';
import type { FandexScore, ScoreReason } from '~/lib/fandexScore';
import { reasonHref, scoreBand, scoreReasonLine, signed, sortReasons } from '~/lib/scoreReasons';
import { color, font, radius, type } from '~/theme';

// The site's ROLE_LABELS (src/lib/constants.ts). Franchise is singular on
// purpose: a title belongs to one, so it reads as a row heading.
const ROLE_LABELS: Record<string, string> = {
  director: 'Directors', writer: 'Writers', creator: 'Creators', cast: 'Cast',
  developer: 'Developers', publisher: 'Publishers', studio: 'Studios', network: 'Networks', ip: 'Franchise',
};

const TONE = { high: color.scoreHigh, baseline: color.scoreBaseline, low: color.scoreLow } as const;

function Shell({ number, tone, eyebrow, line, muted, action }: {
  number: string; tone: string; eyebrow: string; line: string; muted?: boolean; action?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.number, { color: tone }]}>{number}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.eyebrow, { color: color.accent }]}>{eyebrow}</Text>
        <Text style={[styles.line, muted && { color: color.textSecondary, fontFamily: font.sans }]}>{line}</Text>
      </View>
      {action}
    </View>
  );
}

/** `settling`: signed in, and your library is still arriving on this device. Not one of the site's four: its server always had the whole library. */
export type ScorePanelState = 'anon' | 'settling' | 'cold' | 'none' | 'scored';

export function FandexScorePanel({ state, fandex, categoryLabel, onSignIn, onOpenFacet }: {
  state: ScorePanelState;
  /** The score, when `state` is `scored`. */
  fandex: FandexScore | null;
  /** A tag category's name, from the live taxonomy. */
  categoryLabel: (id: string | undefined) => string | null;
  onSignIn?: () => void;
  /** Follow a reason's chip to its tag, person or studio page. */
  onOpenFacet?: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (state === 'anon') {
    // The whole panel is the instruction, so the whole panel is the button. Named outright, not by its text run.
    return (
      <Pressable onPress={onSignIn} disabled={!onSignIn} accessibilityRole="button" accessibilityLabel="Sign in to see your Fandex Score" style={({ pressed }) => [styles.panel, pressed && { opacity: 0.7 }]}>
        <Shell number="-" tone={color.textMuted} eyebrow="Fandex Score" line="Sign in to see your taste-match Score." muted />
      </Pressable>
    );
  }
  if (state === 'settling') {
    // Said in words. A held box with nothing in it reads as a panel that broke.
    return (
      <View style={styles.panel}>
        <Shell number="-" tone={color.textMuted} eyebrow="Fandex Score" line="Reading your library. Your score shows when it is all here." muted />
      </View>
    );
  }
  if (state === 'cold') {
    return (
      <View style={styles.panel}>
        <Shell number="-" tone={color.textMuted} eyebrow="Fandex Score" muted
          line="Rate a few titles to unlock your Fandex Score, a personalized 0-100 taste match for everything you browse." />
      </View>
    );
  }
  if (state === 'none' || !fandex) {
    return (
      <View style={styles.panel}>
        <Shell number="-" tone={color.textMuted} eyebrow="Fandex Score" line="Not enough ratings yet to score this." muted />
      </View>
    );
  }

  const rounded = Math.round(fandex.score);
  const tone = TONE[scoreBand(fandex.score, fandex.center)];
  const sorted = sortReasons(fandex.reasons);
  const baseline = Math.round(fandex.center);
  const groupLabel = (r: ScoreReason) => (r.kind === 'tag' ? categoryLabel(r.category ?? 'other') ?? r.category ?? 'other' : ROLE_LABELS[r.role ?? ''] ?? 'Person');

  return (
    <View style={styles.panel}>
      <Shell
        number={String(rounded)} tone={tone} eyebrow="Your Fandex Score"
        line={scoreReasonLine(fandex.score, fandex.center, sorted.find((r) => !r.capped))}
        action={sorted.length ? (
          // The one control on the panel: the number and the sentence are not buttons.
          <Pressable onPress={() => setOpen(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Show Fandex Score breakdown" style={({ pressed }) => [styles.why, pressed && { opacity: 0.6 }]}>
            <Text style={styles.whyText}>Why? ▼</Text>
          </Pressable>
        ) : null}
      />

      <Sheet open={open} onClose={() => setOpen(false)} title="Fandex Score breakdown">
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={styles.breakdown}>
          <View style={[styles.sumRow, styles.ruleBelow]}>
            <Text style={styles.small}>Your baseline (average rating × 10)</Text>
            <Text style={[styles.small, styles.strong]}>{baseline}</Text>
          </View>

          {sorted.map((r, i) => {
            const tint = FACET_HEX[facetClassOf(r)];
            const href = reasonHref(r);
            // One line of explanation where the left-out rows start, not one per row.
            const firstCapped = r.capped && sorted[i - 1]?.capped !== true;
            return (
              <View key={`${r.kind}|${r.role ?? ''}|${r.label}`}>
                {firstCapped ? (
                  <Text style={styles.cappedNote}>Not counted for this title, being outside the top matches this item selects</Text>
                ) : null}
                <View style={[styles.reason, r.capped && { opacity: 0.4 }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.reasonHead}>
                      <Text style={[styles.group, { color: tint }]}>{groupLabel(r)}</Text>
                      {href && onOpenFacet ? (
                        <Pressable onPress={() => { setOpen(false); onOpenFacet(href); }} accessibilityRole="link" accessibilityLabel={r.label} style={({ pressed }) => [styles.chip, { backgroundColor: `${tint}21` }, pressed && { opacity: 0.6 }]}>
                          <Text numberOfLines={1} style={[styles.small, { color: tint }]}>{r.label}</Text>
                        </Pressable>
                      ) : <Text numberOfLines={1} style={[styles.small, { flexShrink: 1 }]}>{r.label}</Text>}
                    </View>
                    <Text style={styles.small}>you rate this {r.BA.toFixed(1)} avg over {r.n} title{r.n === 1 ? '' : 's'}</Text>
                  </View>
                  {r.capped ? (
                    // What the facet is worth on any title, greyed with its row: "how much would this have counted".
                    <Text style={[styles.small, styles.strong, { color: color.textSecondary }]}>{signed(r.impact)}</Text>
                  ) : (
                    <Text style={[styles.small, styles.strong, { color: r.contribution >= 0 ? color.success : color.danger }]}>{signed(r.contribution)}</Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={[styles.sumRow, styles.ruleAbove]}>
            <Text style={styles.small}>Baseline + contributions</Text>
            <Text style={[styles.small, { fontFamily: font.sansBold, color: tone }]}>{rounded}</Text>
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  number: { fontFamily: font.serif, fontSize: 30, lineHeight: 30, fontVariant: ['tabular-nums'] },
  line: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, color: color.textPrimary, marginTop: 4 },
  why: { paddingHorizontal: 8, paddingVertical: 4, marginRight: -4, borderRadius: radius.sm },
  whyText: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  breakdown: { padding: 14, gap: 8 },
  small: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  strong: { fontFamily: font.sansBold, color: color.textPrimary },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  ruleBelow: { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: color.border },
  ruleAbove: { paddingTop: 8, borderTopWidth: 1, borderTopColor: color.border },
  reason: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  reasonHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  group: { fontFamily: font.sansBold, fontSize: 10, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase' },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, maxWidth: '100%' },
  cappedNote: {
    fontFamily: font.sans, fontSize: 10, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textSecondary,
    paddingTop: 10, paddingBottom: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: color.border,
  },
});
