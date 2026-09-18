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
import { regressionEnabled } from './regression/flags';

/** 내비게이션 그룹. 운영 그룹만 역할 제한이 있다. */
export type NavSection = 'search' | 'analysis' | 'github' | 'ops';

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly section: NavSection;
  /**
   * 이 항목을 볼 수 있는 역할.
   *
   * **`ops` 항목은 반드시 지정한다** (CR-054, DEV-408). 없으면
   * `visibleNavEntries`가 그 항목을 아무에게도 보이지 않는다 — 새 운영 화면의
   * 기본값이 **보이지 않음**이어야 하기 때문이다. `ops`가 아닌 항목은 역할
   * 제한이 없으므로 비워 둔다.
   */
  readonly allowedRoles?: readonly Role[];
}

/**
 * 운영 그룹 전체를 볼 자격이 있는 역할.
 *
 * **어느 항목이 보이는가는 이 집합이 정하지 않는다** (CR-054, DEV-408).
 * 이전 판은 이 집합 하나로 `ops` 섹션을 통째로 열어 **`operator`에게 감사
 * 화면(A-004)이, `security_officer`에게 저장소 등록(A-002)이 보였다** — 권한
 * 매트릭스가 둘 다 막는 자리다. 지금은 항목마다 `allowedRoles`가 정하고 이
 * 집합은 **섹션 머리글을 그릴지**만 판정한다.
 */
export const OPS_ROLES: ReadonlySet<Role> = new Set<Role>(['operator', 'security_officer']);

/**
 * 셸이 아는 전체 항목.
 *
 * 화면이 아직 없는 것도 포함한다 — 셸은 **경로 구조**를 소유하고, 각 화면은
 * 자기 WP에서 붙는다. 없는 경로로 가면 Next.js가 404를 낸다.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'search', label: 'Search', href: '/search', section: 'search' },
  ...(regressionEnabled ? [{ id: 'regression', label: 'Regression', href: '/regression', section: 'analysis' as const }] : []),
  { id: 'saved-searches', label: 'Saved searches', href: '/saved-searches', section: 'search' },
  { id: 'repositories', label: 'Repositories', href: '/repositories', section: 'analysis' },
  { id: 'ranges', label: 'Range investigation', href: '/ranges', section: 'analysis' },
  { id: 'releases', label: 'Releases', href: '/releases', section: 'analysis' },
  { id: 'analytics', label: 'Analytics', href: '/analytics', section: 'analysis' },
  /*
   * A-001 파이프라인. `security_officer`도 보되 그 역할에게는 `A-001-ARCHIVE`
   * 섹션만 렌더링된다 (CR-052, DEV-375). 진입점은 열고 내용은 화면이 가른다 —
   * 권한을 화면 단위로 넓히지 않는 것이 `CR-050`부터의 규율이다.
   */
  {
    id: 'ops-pipeline',
    label: 'Pipeline',
    href: '/ops/pipeline',
    section: 'ops',
    allowedRoles: ['operator', 'security_officer'],
  },
  /* A-002 저장소 등록. `operator` 전용이다 (권한 매트릭스). */
  {
    id: 'ops-repositories',
    label: 'Repository registration',
    href: '/ops/repositories',
    section: 'ops',
    allowedRoles: ['operator'],
  },
  /*
   * A-003 인덱스·잡 운영. `operator` 전용이다 (권한 매트릭스).
   *
   * 와이어프레임의 진입 경로가 "운영 > 잡"이고, 경로 규칙은 다른 `ops` 항목과
   * 같은 형태를 따른다 (CR-055).
   */
  {
    id: 'ops-jobs',
    label: 'Jobs',
    href: '/ops/jobs',
    section: 'ops',
    allowedRoles: ['operator'],
  },
  /* A-004 감사 기록. `security_officer` 전용이다 (FR-AUTH-004 AC-5). */
  {
    id: 'ops-audit',
    label: 'Audit log',
    href: '/ops/audit',
    section: 'ops',
    allowedRoles: ['security_officer'],
  },
  /*
   * A-006 gh capability·버전 레지스트리 (WP-078 / CR-088). 읽기 전용이며 `operator`와 `security_officer`
   * 둘 다 본다 — 드리프트는 운영 사건이자 보안 사건이다(FR-GH-011 예외 처리 「관리자에게 보고」). A-005
   * 정책 편집은 이 화면에 없다. 배포가 GitHub 작업을 끄면 API의 404를 「열리지 않았다」로 그린다.
   */
  {
    id: 'ops-gh-registry',
    label: 'gh registry',
    href: '/ops/gh-registry',
    section: 'ops',
    allowedRoles: ['operator', 'security_officer'],
  },
  /*
   * A-005 gh 실행 정책 — 최소 부분 (WP-080 / CR-090). 실행이 열린 capability의 차단·재개만 있다. 조회는 A-006과 같은
   * 두 역할이 하고, 변경은 `operator`만 한다(API-GH-008이 요청마다 판정한다).
   */
  {
    id: 'ops-gh-policy',
    label: 'gh execution policy',
    href: '/ops/gh-policy',
    section: 'ops',
    allowedRoles: ['operator', 'security_officer'],
  },
  /*
   * GitHub Operations (REL-007 R0 / WP-077, CR-086) — 제품 IA의 두 번째 표면이다.
   *
   * **역할 제한이 없다.** 실행 자격은 역할이 아니라 **위임 신원**(Operations App 연결)이
   * 정하고, 그 판정은 서버가 한다 (FR-GH-008). 배포가 이 기능을 끄면(`GH_OPERATIONS_ENABLED=false`)
   * 화면은 API의 404를 「이 배포에서는 열리지 않았다」로 그린다 — web은 플래그를 읽지
   * 않는다(DEV-589의 규율).
   */
  { id: 'gh-command-center', label: 'GitHub operations', href: '/gh', section: 'github' },
  { id: 'gh-history', label: 'Run history', href: '/gh/history', section: 'github' },
];

export const SECTION_LABELS: Readonly<Record<NavSection, string>> = {
  search: 'Search',
  analysis: 'Analysis',
  github: 'GitHub',
  ops: 'Operations',
};

/** 역할 하나라도 운영 그룹을 볼 수 있는가. */
export function canSeeOps(roles: readonly Role[]): boolean {
  return roles.some((role) => OPS_ROLES.has(role));
}

/**
 * 역할에 따라 보이는 항목만 남긴다 (QA-A001-10, QA-A004-06·07).
 *
 * **`ops` 항목은 `allowedRoles`에 자기 역할이 있을 때만 보인다** (CR-054,
 * DEV-408). 목록을 비워 두거나 필드를 빠뜨리면 **아무에게도 보이지 않는다** —
 * 새 운영 화면의 기본값이 "보이지 않음"이어야 하고, 그것이 섹션 단위 판정이
 * 주지 못한 안전성이다. 이전 판은 `ops`이기만 하면 두 역할 모두에게 열려
 * 권한 매트릭스와 어긋났다.
 *
 * `ops`가 아닌 항목은 역할 제한이 없다.
 */
export function visibleNavEntries(roles: readonly Role[]): readonly NavEntry[] {
  const held = new Set(roles);
  return NAV_ENTRIES.filter((entry) => {
    if (entry.section !== 'ops') return true;
    return (entry.allowedRoles ?? []).some((role) => held.has(role));
  });
}

/**
 * 주어진 목록에서 현재 경로에 해당하는 항목을 고른다.
 *
 * 접두 일치를 쓴다 — `/search/abc`도 `search`가 현재 항목이다. 다만 `/`로
 * 경계를 확인해 `/searchable`이 `/search`에 걸리지 않게 한다.
 *
 * **목록을 인자로 받는 이유**는 최장 일치 규칙을 시험할 수 있게 하기
 * 위해서다. 처음에는 `NAV_ENTRIES`에 서로 접두가 되는 항목이 없어 그 규칙이
 * 한 번도 실행되지 않았다 — 목록을 고정해 두면 검증할 수 없는 방어 코드가
 * 되고, 그룹 항목이 들어오는 순간 아무도 모르게 틀린다. `/gh`·`/gh/history`
 * (WP-077)가 그 첫 쌍이며, `nav.test.ts`가 실제 목록으로도 그 규칙을 건다.
 */
export function matchNavEntry(
  pathname: string,
  entries: readonly NavEntry[],
): NavEntry | null {
  let best: NavEntry | null = null;
  for (const entry of entries) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      // 더 긴 경로가 이긴다 — `/ops/pipeline`이 `/ops`보다 구체적이다.
      if (best === null || entry.href.length > best.href.length) best = entry;
    }
  }
  return best;
}

/** 현재 경로에 해당하는 항목 id. 셸이 쓰는 것은 이쪽이다. */
export function activeNavId(pathname: string): string | null {
  return matchNavEntry(pathname, NAV_ENTRIES)?.id ?? null;
}
