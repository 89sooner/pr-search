import type { ReactNode } from 'react';

/** WP-073: 제품 탐색용 글리프. Conductor의 currentColor를 그대로 사용한다. */
const PATHS = {
  search: 'm16 16 4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  repository: 'M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14h14M7 7h8M7 10h5',
  branch: 'M6 7v10M18 7v3a4 4 0 0 1-4 4h-4M9 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  range: 'M5 5v14M19 5v14M5 12h14m-9-4-4 4 4 4m4-8 4 4-4 4',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  tag: 'M3 3h8l10 10-8 8L3 11V3ZM7 7h.01',
  chart: 'M4 3v17h17M8 15v-4m5 4V6m5 9V9',
  pipeline: 'M3 4h6v6H3V4Zm12 10h6v6h-6v-6ZM6 10v7h9M9 7h9v7',
  jobs: 'M9 5V3h6v2M3 7h18v14H3V7Zm0 6h18m-11 0v3h4v-3',
  shield: 'm12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5l8-3Zm-4 9 3 3 5-6',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v6h-6',
  filter: 'M3 5h18M6 12h12m-9 7h6',
  close: 'm6 6 12 12M6 18 18 6',
  preview: 'M3 4h18v16H3V4Zm0 10h18',
  copy: 'M9 8h12v13H9V8ZM5 16H3V3h12v2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  commit: 'M8 12H2m20 0h-6m0 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  menu: 'M3 5h18M3 12h18M3 19h18',
} as const;

export type WorkbenchIconName = keyof typeof PATHS;

export function WorkbenchIcon({ name }: { readonly name: WorkbenchIconName }): ReactNode {
  return (
    <svg className="prs-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
