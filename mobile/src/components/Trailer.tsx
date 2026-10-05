// The trailer on a device: its still, with a play button that opens YouTube.
// A browser gets the player itself (Trailer.web.tsx). An inline player here
// would need a web view, which the app does not ship.

import { Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { ExtLink } from '~/components/ExtLink';
import { Img } from '~/components/Img';
import { color, radius } from '~/theme';

export function Trailer({ youtubeKey, title }: { youtubeKey: string; title: string }) {
  return (
    <ExtLink href={`https://www.youtube.com/watch?v=${youtubeKey}`} label={`Play the trailer for ${title}`} style={styles.frame}>
      <Img uri={`https://i.ytimg.com/vi/${youtubeKey}/hqdefault.jpg`} width={360} style={styles.still} alt="" />
      <View style={styles.play}>
        <Play size={22} color={color.textPrimary} fill={color.textPrimary} />
      </View>
    </ExtLink>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: color.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  still: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  play: {
    width: 56, height: 56, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,10,8,0.66)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
});
