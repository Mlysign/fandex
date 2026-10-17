// Draw something outside the tree it belongs to. On a phone there is no page to
// draw onto, so it stays where it is; the web version (portal.web.tsx) puts it
// on document.body.

import type { ReactNode } from 'react';

export function createPortal(node: ReactNode): ReactNode {
  return node;
}
