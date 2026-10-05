// expo-image for the server render: react-native-web's own Image, which draws
// the same <img> without expo's native module layer. Two elements on the page.

import { Image as RNImage, type ImageStyle, type StyleProp } from 'react-native';

export function Image({ source, style }: {
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  contentFit?: string;
  transition?: number;
}) {
  return <RNImage source={source} style={style} resizeMode="cover" />;
}
