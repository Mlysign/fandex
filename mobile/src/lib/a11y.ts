// What a button that stays on or off tells assistive technology.
//
// React Native says "selected". A browser has no "selected" for a button, and
// react-native-web writes nothing for it, so on the web the state was not in the
// page at all: a toggle is `aria-pressed` there (SM68, SM75).

import { Platform } from 'react-native';

/** The same for a checkbox, whose state a browser calls `aria-checked`. */
export function checked(on: boolean): object {
  return Platform.OS === 'web'
    ? { accessibilityState: { checked: on }, 'aria-checked': on }
    : { accessibilityState: { checked: on } };
}

export function toggled(on: boolean): object {
  return Platform.OS === 'web'
    ? { accessibilityState: { selected: on }, 'aria-pressed': on }
    : { accessibilityState: { selected: on } };
}
