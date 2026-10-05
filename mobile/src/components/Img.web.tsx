// A remote image in a browser: a real <img>. react-native-web's Image draws a
// background on a <div> once its script has run, so a page rendered to HTML on
// a server came out with no picture in it at all (measured 2026-10-05: zero
// <img> in the item page). This one is in the markup, with its alt text.
//
// The style is flattened and handed to the DOM as is, so it may only use keys
// CSS shares with React Native (width, height, aspectRatio, borderRadius,
// position and the insets, backgroundColor). No marginHorizontal and friends.

import type { CSSProperties } from 'react';
import { StyleSheet } from 'react-native';
import { cdnImageUrl } from '@/lib/imageLoader';
import type { ImgProps } from './Img';

export type { ImgProps };

export function Img({ uri, width, style, alt, priority, onError }: ImgProps) {
  const flat = (StyleSheet.flatten(style) ?? {}) as CSSProperties;
  return (
    <img
      src={cdnImageUrl(uri, width * 2)}
      alt={alt ?? ''}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={onError}
      style={{ display: 'block', objectFit: 'cover', ...flat }}
    />
  );
}
