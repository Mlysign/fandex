// `/franchise/{key}`: a franchise's page, every title the catalog puts in it
// across media (2026-10-18). The screen is shared with the tag, person and
// studio pages.

import { FacetScreen } from '~/components/FacetScreen';

export default function Route() {
  return <FacetScreen kind="franchise" />;
}
