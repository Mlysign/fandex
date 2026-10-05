// A link that leaves Fandex. In a browser it is a real anchor, so it is in the
// HTML, opens in a new tab and can be copied; on a device it opens the address.
// The old page's links were Pressables with an onPress, which a crawler cannot
// follow and a person cannot long-press.

import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, type StyleProp, type ViewStyle } from 'react-native';

export function ExtLink({ href, label, style, children, sponsored }: {
  href: string;
  /** What a screen reader says, when the content is only a logo. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** A paid link. Search engines are told so. */
  sponsored?: boolean;
}) {
  // react-native-web renders any view with an `href` as an <a>. React Native
  // itself has no such prop, hence the cast.
  const anchor = Platform.OS === 'web'
    ? ({ href, hrefAttrs: { target: '_blank', rel: `${sponsored ? 'sponsored ' : ''}noopener noreferrer` } } as object)
    : null;
  return (
    <Pressable
      {...anchor}
      onPress={anchor ? undefined : () => void Linking.openURL(href)}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>
      {children}
    </Pressable>
  );
}
