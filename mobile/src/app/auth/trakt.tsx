// Where Trakt sends the person back to after the browser sign-in
// (fandex://auth/trakt). The sign-in itself is finished by AuthProvider, which
// is handed the same address by the browser tab. This file exists because the
// router sees that address too, and without a screen here it would show "not
// found" over the app while the sign-in completes underneath.

import { Redirect } from 'expo-router';

export default function TraktReturn() {
  return <Redirect href="/profile" />;
}
