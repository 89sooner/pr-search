import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Bookmark,
  ChartNoAxesColumn,
  ChevronRight,
  ClipboardList,
  Copy,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ListFilter,
  Menu,
  PanelRight,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Workflow,
  X,
} from 'lucide-react';

/**
 * WP-073 / CR-093: 제품 탐색용 글리프.
 *
 * ## 이 파일이 아이콘 라이브러리를 아는 유일한 곳이다
 *
 * 호출부는 **이름**만 안다. 이름 → 그림의 대응을 여기 한 표에 두므로 라이브러리를 바꾸거나
 * 그림을 고쳐도 호출부는 그대로다. Conductor 0.4.1이 `lucide-react`를 peer로 요구하고
 * README가 함께 설치하라고 적었으므로(CR-093, ADR-006의 아이콘 예외), 손으로 그린 path
 * 열일곱 개를 그 위에 계속 유지할 이유가 없었다.
 *
 * 의미는 바꾸지 않는다 — 같은 이름은 같은 자리에서 같은 뜻을 낸다. `currentColor`와
 * `aria-hidden`은 lucide가 기본으로 주고, 색은 여전히 Conductor 토큰에서 온다(QA-COMMON-16).
 * Conductor `StatusBadge`의 토큰 아이콘 이름 계약과는 무관하다.
 */
const ICONS = {
  search: Search,
  repository: FolderGit2,
  branch: GitBranch,
  pr: GitPullRequest,
  commit: GitCommitHorizontal,
  range: ArrowLeftRight,
  bookmark: Bookmark,
  tag: Tag,
  chart: ChartNoAxesColumn,
  pipeline: Workflow,
  jobs: ClipboardList,
  shield: ShieldCheck,
  chevron: ChevronRight,
  refresh: RefreshCw,
  filter: ListFilter,
  close: X,
  preview: PanelRight,
  copy: Copy,
  arrow: ArrowRight,
  menu: Menu,
} as const satisfies Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

export type WorkbenchIconName = keyof typeof ICONS;

export function WorkbenchIcon({ name }: { readonly name: WorkbenchIconName }): ReactNode {
  const Icon = ICONS[name];
  return <Icon className="prs-icon" width={18} height={18} strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}
