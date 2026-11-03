// The trailer on a device: its still with a play button, and a tap plays it in
// place through YouTube's embedded player in a web view. A browser gets the
// player itself (Trailer.web.tsx).
//
// The web view mounts only once the play button is tapped, so a title page
// costs no web view and tells YouTube nothing until then. It unmounts when the
// page loses focus or the app goes to the background: every screen is a tab
// that stays mounted, so a player left alone would keep talking.

import { useFocusEffect } from 'expo-router';
import { Play } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { isWebUrl } from '~/components/ExtLink';
import { Img } from '~/components/Img';
import { color, radius } from '~/theme';

// The page the player frame sits in. YouTube refuses to play an embed that
// arrives with no referrer (error 153), and a page loaded from a string has
// none unless it is given an origin, so it is given the site's.
const PLAYER_ORIGIN = 'https://fandex.org/';

const playerPage = (youtubeKey: string) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe src="https://www.youtube.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&playsinline=1&rel=0"
  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
</body></html>`;

/** Anything that would replace the player page leaves the app for the browser or YouTube. */
function keepInPlayer(req: WebViewNavigation & { isTopFrame?: boolean }): boolean {
  if (req.isTopFrame === false || req.url.startsWith(PLAYER_ORIGIN) || req.url === 'about:blank') return true;
  if (isWebUrl(req.url)) void Linking.openURL(req.url);
  return false;
}

export function Trailer({ youtubeKey, title }: { youtubeKey: string; title: string }) {
  // Which trailer is playing, not a flag: the item screen is reused from one
  // title to the next, and the next title starts on its still.
  const [playing, setPlaying] = useState<string | null>(null);

  useFocusEffect(useCallback(() => () => setPlaying(null), []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next !== 'active') setPlaying(null); });
    return () => sub.remove();
  }, []);

  if (playing === youtubeKey) {
    return (
      <View style={styles.frame}>
        <WebView
          source={{ html: playerPage(youtubeKey), baseUrl: PLAYER_ORIGIN }}
          style={styles.player}
          originWhitelist={['*']}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onShouldStartLoadWithRequest={keepInPlayer}
          onOpenWindow={({ nativeEvent }) => { if (isWebUrl(nativeEvent.targetUrl)) void Linking.openURL(nativeEvent.targetUrl); }}
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => setPlaying(youtubeKey)}
      accessibilityRole="button"
      accessibilityLabel={`Play the trailer for ${title}`}
      style={({ pressed }) => [styles.frame, pressed && { opacity: 0.8 }]}>
      <Img uri={`https://i.ytimg.com/vi/${youtubeKey}/hqdefault.jpg`} width={360} style={styles.still} alt="" />
      <View style={styles.play}>
        <Play size={22} color={color.textPrimary} fill={color.textPrimary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: color.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  player: { width: '100%', height: '100%', backgroundColor: '#000' },
  still: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  play: {
    width: 56, height: 56, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,10,8,0.66)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
});
