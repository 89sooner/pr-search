'use client';

import type { ReactNode } from 'react';

/** WP-073 / NFR-007: 긴 상세의 섹션으로 이동하며 키보드 포커스도 함께 옮긴다. */
export function DetailSectionNav({ sections }: {
  readonly sections: readonly { readonly id: string; readonly label: string }[];
}): ReactNode {
  return <nav className="prs-detail-nav" aria-label="Detail sections">
    {sections.map(({ id, label }) => <a key={id} href={`#${id}`} onClick={(event) => {
      const target = document.getElementById(id);
      if (target === null || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    }}>{label}</a>)}
  </nav>;
}
