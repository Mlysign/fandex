// The four legal pages, as one row of links. They are static pages on the
// website (mobile/web/build.mjs writes them from the site's legal content), so
// in a browser these are plain anchors and on a device they open the address.
//
// German law wants the Impressum two clicks from anywhere, which is why this
// row is on every public page and on the You tab, and not only behind a menu.

import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { color, font, space } from '~/theme';

export const SITE_URL = 'https://fandex.org';

// The old site's four, in its order and under its labels (src/components/legal/LegalLinks.tsx).
const DOCS: [string, string][] = [
  ['privacy', 'Privacy'],
  ['terms', 'Terms'],
  ['support', 'Contact'],
  ['imprint', 'Imprint'],
];

export function LegalLinks() {
  const web = Platform.OS === 'web';
  return (
    <View style={styles.row} accessibilityRole={web ? ('navigation' as never) : undefined} accessibilityLabel="Legal">
      {DOCS.map(([doc, label]) => {
        const path = `/legal/en/${doc}`;
        // react-native-web renders a Text with an `href` as an <a>. React Native
        // itself has no such prop, hence the cast.
        const link = web ? ({ href: path } as object) : { onPress: () => void Linking.openURL(`${SITE_URL}${path}`) };
        return (
          <Text key={doc} {...link} accessibilityRole="link" style={styles.link}>
            {label}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.sm },
  // 44 tall, so each word is a tap target and not only a word.
  link: { fontFamily: font.mono, fontSize: 11, lineHeight: 44, letterSpacing: 0.5, color: color.textSecondary },
});
