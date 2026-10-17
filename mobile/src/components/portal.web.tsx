// On document.body. A `position: fixed` panel inside the page is trapped by any
// ancestor with a transform, a translate or a filter, even a zero-valued one
// (AGENTS.md, "A position: fixed overlay is trapped"), and a rail scrolls.

import type { ReactNode } from 'react';
import { createPortal as domPortal } from 'react-dom';

export function createPortal(node: ReactNode): ReactNode {
  return typeof document === 'undefined' ? null : domPortal(node, document.body);
}
