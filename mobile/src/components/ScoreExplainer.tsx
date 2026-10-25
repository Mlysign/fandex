// The poster card's explainer: the title, your match label with its sentence,
// your rating, and the strongest row or two of each axis. Without a match, the
// date and the type, and why there is none.
//
// On a mouse it opens after the pointer rests on a card (cards.tsx); on a
// phone a long press opens it in a sheet. The rows are worked out on the
// device from the catalog copy, as the item page's panel does.
//
// ⚠️ The label shown is the one the CARD shows, passed in. The site once gave
// its explainer the payload's score instead, and a card reading 78 opened an
// explainer that said there was none (posterCardTooltipScore.test.ts there).

import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { createPortal } from '~/components/portal';
import { AxisBars, labelColor } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem, CardMatch, CardState } from '~/lib/cards';
import { shortDate } from '~/lib/dates';
import type { FandexScore } from '~/lib/fandexScore';
import { axisRows, LABEL_TEXT, labelSentence, pullSentence, signed, tasteSentence } from '~/lib/scoreReasons';
import { parseFacets, useScores } from '~/lib/ScoreProvider';
import { color, font, radius, type, TYPE_LABEL } from '~/theme';

/** The whole match for one title, worked out once it is shown. */
function useMatch(item: CardItem, enabled: boolean): FandexScore | null {
  const db = useSQLiteContext();
  const { score } = useScores();
  const [match, setMatch] = useState<FandexScore | null>(null);
  // Whose match is held, so another title's never shows while this one's load.
  const [matchFor, setMatchFor] = useState<string | null>(null);
  const id = item.id;
  useEffect(() => {
    if (!enabled || !id) return;
    let live = true;
    void db.getFirstAsync<{ facets: string }>('SELECT facets FROM catalog WHERE id = ?', [id]).then((row) => {
      if (!live || !row) return;
      setMatch(score(id, parseFacets(row.facets), item.type));
      setMatchFor(id);
    }, (e: unknown) => {
      console.warn('score_reasons_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      if (live) { setMatch(null); setMatchFor(id); }
    });
    return () => { live = false; };
  }, [db, id, item.type, enabled, score]);
  return matchFor === id ? match : null;
}

export function ScoreExplainerBody({ item, match: row, state }: { item: CardItem; match: CardMatch | null; state: CardState }) {
  const auth = useAuth();
  const match = useMatch(item, row != null);
  const rated = state.rating != null && state.rating > 0;
  const top = match ? [...axisRows(match.reasons, 'pull').slice(0, 2), ...axisRows(match.reasons, 'taste').slice(0, 2)] : [];

  return (
    <View style={styles.body}>
      <Text style={type.serifSm}>{item.title}</Text>
      {row ? (
        <>
          <View style={styles.labelLine}>
            <Text style={[styles.label, { color: labelColor(row.label) }]}>{LABEL_TEXT[row.label]}</Text>
            <AxisBars taste={{ points: 0, band: row.taste }} pull={row.pull ? { points: 0, band: row.pull } : null} />
          </View>
          {match ? <Text style={type.caption}>{labelSentence(match)}</Text> : null}
          {rated || state.wishlisted ? (
            <Text style={type.caption}>
              {rated ? `★ ${state.rating!.toFixed(1)}/10` : ''}{rated && state.wishlisted ? ' · ' : ''}{state.wishlisted ? 'On your wishlist' : ''}
            </Text>
          ) : null}
          {top.length ? (
            <View style={styles.reasons}>
              {top.map((r) => (
                <View key={`${r.axis}|${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={type.caption} numberOfLines={1}>{r.label}</Text>
                    <Text style={styles.tiny} numberOfLines={1}>{r.axis === 'pull' ? pullSentence(r, item.type) : tasteSentence(r)}</Text>
                  </View>
                  <Text style={[styles.impact, { color: r.contribution >= 0 ? color.success : color.danger }]}>{signed(r.contribution)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={type.meta}>{item.releaseDate ? shortDate(item.releaseDate) : 'TBA'} · {TYPE_LABEL[item.type] ?? item.type}</Text>
          {/* Said in words: an explainer showing only what the card already says reads as broken (the site, 2026-09-03). */}
          <Text style={type.caption}>
            {auth.status !== 'signedIn' ? 'Sign in and rate a few titles to see how well this matches your taste.'
              : !item.id ? 'Not in the catalog yet, so there is nothing to match it on.'
              : 'Not enough about this title, or about your taste yet, to match the two.'}
          </Text>
        </>
      )}
    </View>
  );
}

const WIDTH = 260;
const MAX_H = 340;

/** The desktop popover: beside the card, on the right unless the window ends first. Never takes the pointer. */
export function ScoreExplainerPopover(props: { item: CardItem; match: CardMatch | null; state: CardState; anchor: { left: number; right: number; top: number } }) {
  if (Platform.OS !== 'web') return null;
  const { anchor } = props;
  let left = anchor.right + 12;
  if (left + WIDTH > window.innerWidth) left = anchor.left - WIDTH - 12;
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - MAX_H));
  return createPortal(
    <View pointerEvents="none" style={[styles.popover, { left, top } as object]}>
      <ScoreExplainerBody {...props} />
    </View>,
  );
}

const styles = StyleSheet.create({
  body: { padding: 12, gap: 8 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontFamily: font.serif, fontSize: 20, lineHeight: 24 },
  reasons: { gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: color.border },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiny: { fontFamily: font.sans, fontSize: 11, lineHeight: 14, color: color.textMuted },
  impact: { fontFamily: font.sansBold, fontSize: 12 },
  popover: {
    position: 'fixed' as never, zIndex: 9999, width: WIDTH, maxHeight: MAX_H, overflow: 'hidden',
    backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.xl,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
});
