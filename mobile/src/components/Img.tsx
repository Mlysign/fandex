// A remote image. On a device this is expo-image, with its cache and fade.
// Img.web.tsx is the browser's version, a real <img>, which is what puts the
// picture in the HTML a crawler reads.

import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';
import { cdnImageUrl } from '@/lib/imageLoader';

export interface ImgProps {
  uri: string;
  /** How wide it is drawn, in px. Picks the CDN's own variant so a 3 MB original is never fetched for a thumbnail. */
  width: number;
  style?: StyleProp<ImageStyle>;
  alt?: string;
  /** The first thing on the page: load it now, not lazily. */
  priority?: boolean;
  onError?: () => void;
}

export function Img({ uri, width, style, alt, priority, onError }: ImgProps) {
  return (
    <Image
      source={{ uri: cdnImageUrl(uri, width * 2) }}
      style={style}
      contentFit="cover"
      transition={120}
      priority={priority ? 'high' : 'normal'}
      accessibilityLabel={alt}
      onError={onError}
    />
  );
}
