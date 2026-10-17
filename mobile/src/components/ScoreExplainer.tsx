// The poster card's score explainer. A port of the site's src/components/Tooltip.tsx
// (TooltipBody and its hover popover): the title, your Fandex Score with its
// band, your rating, and the three tags that lift it most and the two that pull
// it down. Without a score, the date and the type, and why there is no score.
//
// On a mouse it opens after the pointer rests on a card (cards.tsx); on a
// phone a long press opens it in a sheet. The reasons are worked out on the
// device from the catalog copy, as the item page's panel does.
//
// ⚠️ The score shown is the one the CARD shows, passed in. The site once gave
// its explainer the payload's score instead, and a card reading 78 opened an
// explainer that said there was none (posterCardTooltipScore.test.ts there).

import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { createPortal } from '~/components/portal';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem, CardState } from '~/lib/cards';
import { shortDate } from '~/lib/dates';
import type { ScoreReason } from '~/lib/fandexScore';
import { scoreBand, signed } from '~/lib/scoreReasons';
import { parseFacets, useScores } from '~/lib/ScoreProvider';
import { color, font, radius, type, TYPE_LABEL } from '~/theme';
import { fandexScoreColor } from '~/components/kit';

const BAND_WORD = { high: 'strong match', baseline: 'about your average', low: 'weak match' } as const;

/** The reasons for one title, worked out once it is shown. */
function useReasons(id: string | null, enabled: boolean): ScoreReason[] | null {
  const db = useSQLiteContext();
  const { score } = useScores();
  const [reasons, setReasons] = useState<ScoreReason[] | null>(null);
  useEffect(() => {
    if (!enabled || !id) return;
    let live = true;
    void db.getFirstAsync<{ facets: string }>('SELECT facets FROM catalog WHERE id = ?', [id]).then((row) => {
      if (!live || !row) return;
      setReasons(score(id, parseFacets(row.facets))?.reasons ?? []);
    });
    return () => { live = false; };
  }, [db, id, enabled, score]);
  return reasons;
}

export function ScoreExplainerBody({ item, score, center, state }: { item: CardItem; score: number | null; center: number | null; state: CardState }) {
  const auth = useAuth();
  const scored = score != null;
  const reasons = useReasons(item.id, scored);
  const tags = (reasons ?? []).filter((r) => r.kind === 'tag' && !r.capped);
  const top = [
    ...tags.filter((r) => r.contribution >= 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3),
    ...tags.filter((r) => r.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 2),
  ];
  const rated = state.rating != null && state.rating > 0;

  return (
    <View style={styles.body}>
      <Text style={type.serifSm}>{item.title}</Text>
      {scored ? (
        <>
          <View style={styles.scoreLine}>
            <Text style={[styles.score, { color: fandexScoreColor(score, center) }]}>{Math.round(score)}</Text>
            <Text style={type.caption}>{BAND_WORD[scoreBand(score, center)]}</Text>
          </View>
          {rated || state.wishlisted ? (
            <Text style={type.caption}>
              {rated ? `★ ${state.rating!.toFixed(1)}/10` : ''}{rated && state.wishlisted ? ' · ' : ''}{state.wishlisted ? 'On your wishlist' : ''}
            </Text>
          ) : null}
          {top.length ? (
            <View style={styles.reasons}>
              {top.map((r) => (
                <View key={`${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
                  <Text style={[type.caption, { flex: 1 }]} numberOfLines={1}>{r.label}</Text>
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
export function ScoreExplainerPopover(props: { item: CardItem; score: number | null; center: number | null; state: CardState; anchor: { left: number; right: number; top: number } }) {
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
  scoreLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  score: { fontFamily: font.serif, fontSize: 24, lineHeight: 28 },
  reasons: { gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: color.border },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  impact: { fontFamily: font.sansBold, fontSize: 12 },
  popover: {
    position: 'fixed' as never, zIndex: 9999, width: WIDTH, maxHeight: MAX_H, overflow: 'hidden',
    backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.xl,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
});
