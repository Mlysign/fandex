// `/library`: the site's address for the Library tab. One screen holds all
// three tabs here, so this only sends you to it.

import { Redirect } from 'expo-router';

export default function LibraryRedirect() {
  return <Redirect href={'/wishlist?tab=library' as never} />;
}
