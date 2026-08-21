/**
 * 내비게이션 구성과 역할 필터링 (C-002 / QA-A001-10).
 *
 * **순수 모듈이다.** 어떤 항목이 보이는가는 보안 판정이므로 렌더링 코드와
 * 섞지 않고 여기서 정해 시험으로 건다.
 *
 * ## 존재를 노출하지 않는다
 *
 * C-002의 사용 규칙: "`operator`·`security_officer`가 아니면 운영 그룹 항목을
 * **렌더링하지 않는다. 비활성으로 보여 주지 않는다**". 비활성 항목은 "여기에
 * 운영 콘솔이 있다"를 알려 준다 — 접근 범위 밖 문서를 403이 아니라 404로
 * 내는 것(THR-004)과 같은 이유다.
 *
 * 클라이언트가 이 파일을 쓰므로 `@prs/authz`의 **진입점이 아니라 서브패스**를
 * 가져온다 (CR-018, DEV-068). 진입점은 `@prs/es`를 재수출해 Node 전용
 * Elasticsearch 클라이언트를 브라우저 번들로 끌어온다.
 */

import type { Role } from '@prs/authz/roles';

/** 내비게이션 그룹. 운영 그룹만 역할 제한이 있다. */
export type NavSection = 'search' | 'analysis' | 'ops';

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly section: NavSection;
}

/**
 * 운영 그룹을 볼 수 있는 역할.
 *
 * `security_officer`가 들어 있는 이유는 감사 화면(A-004)이 같은 그룹에
 * 있기 때문이다 — `operator`만 두면 보안 담당자가 자기 화면을 못 본다.
 */
export const OPS_ROLES: ReadonlySet<Role> = new Set<Role>(['operator', 'security_officer']);

/**
 * 셸이 아는 전체 항목.
 *
 * 화면이 아직 없는 것도 포함한다 — 셸은 **경로 구조**를 소유하고, 각 화면은
 * 자기 WP에서 붙는다. 없는 경로로 가면 Next.js가 404를 낸다.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'search', label: '통합 검색', href: '/search', section: 'search' },
  { id: 'ranges', label: '범위 조사', href: '/ranges', section: 'analysis' },
  { id: 'releases', label: '릴리스', href: '/releases', section: 'analysis' },
  { id: 'stats', label: '통계', href: '/stats', section: 'analysis' },
  { id: 'ops-pipeline', label: '파이프라인', href: '/ops/pipeline', section: 'ops' },
  { id: 'ops-repositories', label: '저장소 등록', href: '/ops/repositories', section: 'ops' },
  { id: 'ops-audit', label: '감사 기록', href: '/ops/audit', section: 'ops' },
];

export const SECTION_LABELS: Readonly<Record<NavSection, string>> = {
  search: '검색',
  analysis: '분석',
  ops: '운영',
};

/** 역할 하나라도 운영 그룹을 볼 수 있는가. */
export function canSeeOps(roles: readonly Role[]): boolean {
  return roles.some((role) => OPS_ROLES.has(role));
}

/**
 * 역할에 따라 보이는 항목만 남긴다 (QA-A001-10).
 *
 * 제한이 걸린 그룹은 `ops` 하나뿐이지만, 판정을 `section`으로 하는 이유는
 * 항목이 늘 때 **기본이 안전한 쪽**이기 때문이다 — 새 운영 화면을 `ops`에
 * 넣으면 필터를 고치지 않아도 저절로 가려진다.
 */
export function visibleNavEntries(roles: readonly Role[]): readonly NavEntry[] {
  const ops = canSeeOps(roles);
  return NAV_ENTRIES.filter((entry) => entry.section !== 'ops' || ops);
}

/**
 * 현재 경로에 해당하는 항목 id.
 *
 * 접두 일치를 쓴다 — `/search/abc`도 `search`가 현재 항목이다. 다만 `/`로
 * 경계를 확인해 `/searchable`이 `/search`에 걸리지 않게 한다.
 */
export function activeNavId(pathname: string): string | null {
  let best: NavEntry | null = null;
  for (const entry of NAV_ENTRIES) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      // 더 긴 경로가 이긴다 — `/ops/pipeline`이 `/ops`보다 구체적이다.
      if (best === null || entry.href.length > best.href.length) best = entry;
    }
  }
  return best?.id ?? null;
}
