// A month coming in from the side it was asked from: the site's
// cal-slide-from-right / -left (globals.css), 22 px and a fade over 200 ms on
// its emphasized curve. Remount it with a new key to play it again; `from` 0
// shows the content where it is, which is the first paint and "Today".

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

export function SlideIn({ from, children, style }: { from: -1 | 0 | 1; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(from === 0 ? 1 : 0)).current;
  useEffect(() => {
    if (from === 0) return;
    Animated.timing(t, { toValue: 1, duration: 200, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [from, t]);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [from * 22, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}
