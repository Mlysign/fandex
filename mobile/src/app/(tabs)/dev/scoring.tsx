// /dev/scoring: the taste engine's knobs and the tag taxonomy. A port of the
// site's src/app/dev/scoring/ScoringAdmin.tsx. What it edits lives in D1 and
// every device reads it through /v1/taxonomy, so a change here reaches everyone.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminOnly, DashHeader, devStyles } from '~/components/dev/parts';
import { WeightsPanel } from '~/components/dev/WeightsPanel';
import { Screen } from '~/components/ui';
import { api } from '~/lib/api';
import { prepareTaxonomy, type TaxonomyJson } from '~/lib/fandexScore';
import { useScores } from '~/lib/ScoreProvider';
import { color, font } from '~/theme';

type Tab = 'weights' | 'taxonomy';
const TABS: [Tab, string][] = [['weights', 'Weights & Tuning']];

function Admin() {
  const scores = useScores();
  const [tab, setTab] = useState<Tab>('weights');
  const [json, setJson] = useState<TaxonomyJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const first = useRef(true);

  const load = useCallback(async () => {
    if (!first.current) setRefreshing(true);
    setError(null);
    try {
      setJson(await api.taxonomy());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      first.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // After a save: this page reads what is now stored, and the app's own scores
  // switch to it without waiting for the twelve-hour check.
  const saved = useCallback(async () => {
    await Promise.all([load(), scores.reloadTaxonomy()]);
  }, [load, scores]);

  const taxonomy = json ? prepareTaxonomy(json) : null;
  return (
    <Screen wide>
      <ScrollView contentContainerStyle={[devStyles.main, { maxWidth: 896 }]} keyboardShouldPersistTaps="handled">
        <DashHeader
          title="Fandex Score · Admin" here="scoring"
          subtitle="Tune the taste-match engine and edit the tag taxonomy. Changes here affect every user's Fandex Score."
        />
        <View style={styles.tabs}>
          {TABS.map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={[styles.tab, tab === key && styles.tabOn]}>
              <Text style={[styles.tabText, tab === key && { color: color.textPrimary }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {!json && !error ? <Text style={devStyles.small}>Loading…</Text> : null}
        {error ? <Text style={[devStyles.small, { color: color.danger }]}>{error}</Text> : null}
        <Text style={[devStyles.small, { height: 16 }]}>{refreshing ? 'Saving…' : ''}</Text>
        {json && taxonomy && tab === 'weights' ? (
          // Keyed on the stored version, so a save redraws the panel from what was stored.
          <WeightsPanel key={json.scoring?.version ?? 0} config={taxonomy.config} categories={json.tagCategories} taxonomy={taxonomy} onSaved={saved} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function DevScoringScreen() {
  return <AdminOnly><Admin /></AdminOnly>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: color.border },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: color.textPrimary },
  tabText: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, color: color.textSecondary },
});
