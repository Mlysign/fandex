// `/import`: a Letterboxd or IMDb export into the library. A port of the site's
// src/app/import/ImportPageClient.tsx; the reasoning behind each step is in
// docs/letterboxd-import.md, and the work is in lib/listImport.ts.
//
// Two things here are load-bearing, as on the site:
//   1. The Android warning. The Letterboxd app claims letterboxd.com links and
//      its export does nothing inside the app (measured on a Pixel 8).
//   2. Looking before signing in. The file is read and matched on the device
//      and nothing is written, so a visitor sees what they would get first.
//      Keeping it takes an account.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AlertTriangle, ArrowUpRight, Check, Monitor, Upload } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Eyebrow, Panel } from '~/components/kit';
import { SignIn } from '~/components/SignIn';
import { useToast } from '~/components/Toast';
import { Screen, T } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { pickFiles, readFiles, type PickedFile } from '~/lib/files';
import { analyzeImport, applyImport, ImportParseError, readImportFiles, type ImportAnalysis, type ImportPhase } from '~/lib/listImport';
import { usePageTitle } from '~/lib/pageTitle';
import { color, radius, space } from '~/theme';

const EXPORT_URL = 'https://letterboxd.com/settings/data/';
/** Where an analysis waits while a browser leaves for a sign-in and comes back. */
const HELD_KEY = 'fandex.import.analysis';

const PHASE_LABEL: Record<ImportPhase, string> = {
  finding: 'Looking the titles up',
  adding: 'Adding new titles to the catalog',
  trakt: 'Sending them to Trakt',
  saving: 'Saving to your library',
};

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'matching'; done: number; total: number }
  | { kind: 'ready'; analysis: ImportAnalysis }
  | { kind: 'applying'; analysis: ImportAnalysis; phase: ImportPhase; done: number; total: number };

function held(): ImportAnalysis | null {
  if (Platform.OS !== 'web') return null;
  try { const raw = globalThis.sessionStorage?.getItem(HELD_KEY); return raw ? (JSON.parse(raw) as ImportAnalysis) : null; } catch { return null; }
}
function hold(a: ImportAnalysis | null) {
  if (Platform.OS !== 'web') return;
  try { if (a) globalThis.sessionStorage?.setItem(HELD_KEY, JSON.stringify(a)); else globalThis.sessionStorage?.removeItem(HELD_KEY); } catch { /* storage refused: the file is chosen again */ }
}

const isAndroid = () => Platform.OS === 'android' || (Platform.OS === 'web' && /Android/i.test(globalThis.navigator?.userAgent ?? ''));

export default function ImportScreen() {
  usePageTitle('Import');
  const db = useSQLiteContext();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<State>(() => {
    const a = held();
    return a ? { kind: 'ready', analysis: a } : { kind: 'idle' };
  });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drop = useRef<View>(null);
  const signedIn = auth.status === 'signedIn';

  const read = async (files: PickedFile[] | null) => {
    if (!files?.length) return;
    setError(null);
    setState({ kind: 'reading' });
    try {
      const parsed = readImportFiles(files);
      setState({ kind: 'matching', done: 0, total: 0 });
      const analysis = await analyzeImport(db, parsed, (done, total) => setState({ kind: 'matching', done, total }));
      hold(analysis);
      setState({ kind: 'ready', analysis });
    } catch (e) {
      setError(e instanceof ImportParseError ? e.message : 'That file could not be read. Please try again.');
      setState({ kind: 'idle' });
    }
  };

  // A browser takes the file dropped on the panel, as the site did.
  useEffect(() => {
    if (Platform.OS !== 'web' || state.kind !== 'idle') return;
    const el = drop.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const over = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
    const leave = () => setDragging(false);
    const dropped = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const list = [...(e.dataTransfer?.files ?? [])];
      if (list.length) void readFiles(list).then(read);
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', dropped);
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', dropped); };
  });

  const apply = async (analysis: ImportAnalysis) => {
    setError(null);
    setState({ kind: 'applying', analysis, phase: 'finding', done: 0, total: 0 });
    try {
      const res = await applyImport(db, analysis, (phase, done, total) => setState({ kind: 'applying', analysis, phase, done, total }));
      hold(null);
      const parts = [
        `${res.imported.toLocaleString('en')} titles added to your library`,
        res.keptRated ? `${res.keptRated.toLocaleString('en')} you had already rated kept your rating` : null,
        res.notAdded ? `${res.notAdded.toLocaleString('en')} new titles could not be added today, so import the file again tomorrow` : null,
      ].filter(Boolean);
      toast(`${parts.join('. ')}.`, 'success');
      router.replace('/insights' as never);
    } catch (e) {
      setError(e instanceof Error && /Trakt/.test(e.message) ? e.message : 'The import could not be finished. What was saved stays saved; import the file again to add the rest.');
      setState({ kind: 'ready', analysis });
    }
  };

  const busy = state.kind === 'reading' || state.kind === 'matching';
  const analysis = state.kind === 'ready' || state.kind === 'applying' ? state.analysis : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.main}>
        <View style={styles.head}>
          <Eyebrow>Import</Eyebrow>
          <T variant="serifXl">Bring your films with you</T>
          <T variant="body" style={{ color: color.textSecondary }}>
            Letterboxd and IMDb both let you download your own data for free. Fandex reads your ratings and your watchlist from it.
            Nothing else in the file is opened, and the file stays on this device.
          </T>
        </View>

        {!analysis ? (
          <>
            <Panel style={styles.panel}>
              <T variant="title">Get your export</T>
              <View style={{ gap: 6 }}>
                <T variant="bodySm">1. Open your Letterboxd data settings and press Export Data.</T>
                <T variant="bodySm">2. A ZIP file downloads.</T>
                <T variant="bodySm">3. Choose it below, exactly as it downloaded.</T>
              </View>
              <Button
                label="Open Letterboxd export page" size="md" style={{ alignSelf: 'flex-start' }}
                icon={<ArrowUpRight size={14} color={color.textPrimary} />}
                href={EXPORT_URL} onPress={Platform.OS === 'web' ? undefined : () => void Linking.openURL(EXPORT_URL)}
              />
              {isAndroid() ? (
                // Measured on a Pixel 8, not a precaution: see the file header.
                <View style={styles.warn}>
                  <AlertTriangle size={16} color={color.warning} />
                  <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                    <T variant="bodySm">
                      On Android this link usually opens the Letterboxd app, and the download does not work there. If that happens, tap
                      the three dots and choose Open in browser.
                    </T>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Monitor size={12} color={color.textMuted} />
                      <T variant="caption" style={{ color: color.textMuted, flex: 1 }}>Or open fandex.org/import on a computer, where this takes about ten seconds.</T>
                    </View>
                  </View>
                </View>
              ) : null}
            </Panel>

            <View ref={drop} style={[styles.drop, dragging && { borderColor: color.accent, backgroundColor: color.surfaceInset }]}>
              <Upload size={22} color={color.textMuted} />
              <T variant="body">{Platform.OS === 'web' ? 'Drop your export here' : 'Choose your export'}</T>
              <T variant="caption" style={{ color: color.textMuted }}>The ZIP as downloaded, or a ratings.csv / watchlist.csv</T>
              <Button
                label={state.kind === 'reading' ? 'Reading' : state.kind === 'matching' ? (state.total ? `Matching ${state.done} of ${state.total}` : 'Matching') : 'Choose file'}
                variant="primary" size="md" loading={busy && !(state.kind === 'matching' && state.total)} disabled={busy}
                onPress={() => void pickFiles().then(read, () => setError('That file could not be opened.'))}
              />
            </View>
          </>
        ) : null}

        {error ? (
          <Panel style={[styles.panel, styles.errorPanel]}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <AlertTriangle size={16} color={color.danger} />
              <T variant="bodySm" style={{ flex: 1 }}>{error}</T>
            </View>
          </Panel>
        ) : null}

        {analysis ? (
          <Panel style={styles.panel}>
            <View style={{ gap: 4 }}>
              <T variant="title">
                {(analysis.matchedLocally + analysis.matchedAtProvider).toLocaleString('en')} of {analysis.total.toLocaleString('en')} titles matched
              </T>
              <T variant="bodySm">
                {analysis.ratings.toLocaleString('en')} ratings and {analysis.wishlist.toLocaleString('en')} watchlist entries, read from {analysis.filesRead.join(' and ')}.
              </T>
              {analysis.matchedAtProvider > 0 ? (
                <T variant="bodySm">
                  {analysis.matchedLocally.toLocaleString('en')} were already in the catalog. The other {analysis.matchedAtProvider.toLocaleString('en')} were found on TMDB
                  and are added when you import.
                </T>
              ) : null}
            </View>

            <View style={styles.sample}>
              {analysis.rows.filter((r) => r.mediaItemId || r.tmdbId != null).slice(0, 12).map((r, i) => (
                <View key={i} style={styles.chip}>
                  <T variant="caption" style={{ color: color.textSecondary }}>
                    {r.title}{r.year ? ` (${r.year})` : ''}{r.rating != null ? ` · ${r.rating}/10` : ''}
                  </T>
                </View>
              ))}
            </View>

            {analysis.unmatched > 0 ? (
              // Shown before anything is written. An import that quietly drops a tail is the failure this exists to avoid.
              <View style={{ gap: 4 }}>
                <T variant="bodySm">{analysis.unmatched.toLocaleString('en')} could not be identified, in the catalog or on TMDB:</T>
                <T variant="caption" style={{ color: color.textMuted }}>
                  {analysis.rows.filter((r) => !r.mediaItemId && r.tmdbId == null).slice(0, 30).map((r) => `${r.title}${r.year ? ` (${r.year})` : ''}`).join(', ')}
                  {analysis.unmatched > 30 ? `, and ${(analysis.unmatched - 30).toLocaleString('en')} more` : ''}
                </T>
              </View>
            ) : null}

            <T variant="bodySm" style={{ color: color.textMuted }}>
              Titles you have already rated keep your rating. {auth.traktSync.onDevice && signedIn ? 'With Trakt signed in on this device, the new ratings and watchlist go to Trakt too.' : ''}
            </T>

            {state.kind === 'applying' ? (
              <View style={styles.progress}>
                <T variant="bodySm">{PHASE_LABEL[state.phase]}{state.total ? ` · ${state.done.toLocaleString('en')} of ${state.total.toLocaleString('en')}` : ''}</T>
                {state.phase === 'adding' && state.total > 30 ? (
                  <T variant="caption" style={{ color: color.textMuted }}>About {Math.ceil((state.total - state.done) / 30)} min: the catalog adds 30 titles a minute.</T>
                ) : null}
              </View>
            ) : signedIn ? (
              <Button
                label={`Import ${(analysis.matchedLocally + analysis.matchedAtProvider).toLocaleString('en')} titles`}
                variant="primary" size="lg" icon={<Check size={14} color={color.surface} />}
                onPress={() => void apply(analysis)}
              />
            ) : (
              // Import before signup: they have seen what they get, a better reason to make an account than a wall.
              <View style={{ gap: 12 }}>
                <T variant="bodySm">Sign in to keep these. They wait here while you do.</T>
                <SignIn title="Sign in to keep these" />
              </View>
            )}
            {state.kind === 'ready' ? (
              <Button label="Choose another file" variant="ghost" onPress={() => { hold(null); setState({ kind: 'idle' }); }} />
            ) : null}
          </Panel>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  main: { width: '100%', maxWidth: 672, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 32, gap: 24 },
  head: { gap: 8 },
  panel: { padding: 16, gap: 12 },
  errorPanel: { borderColor: color.danger },
  warn: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.border },
  drop: {
    alignItems: 'center', gap: 12, padding: 32, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed',
    borderColor: color.borderStrong, backgroundColor: color.surfaceElevated,
  },
  sample: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: color.surfaceInset },
  progress: { gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: color.surfaceInset },
});
