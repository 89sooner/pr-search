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
  { id: 'search', label: '통합 검색', href: '/search', section: 'search' },
  { id: 'saved-searches', label: '저장된 검색', href: '/saved-searches', section: 'search' },
  { id: 'repositories', label: '저장소', href: '/repositories', section: 'analysis' },
  { id: 'ranges', label: '범위 조사', href: '/ranges', section: 'analysis' },
  { id: 'releases', label: '릴리스', href: '/releases', section: 'analysis' },
  { id: 'analytics', label: '통계', href: '/analytics', section: 'analysis' },
  /*
   * A-001 파이프라인. `security_officer`도 보되 그 역할에게는 `A-001-ARCHIVE`
   * 섹션만 렌더링된다 (CR-052, DEV-375). 진입점은 열고 내용은 화면이 가른다 —
   * 권한을 화면 단위로 넓히지 않는 것이 `CR-050`부터의 규율이다.
   */
  {
    id: 'ops-pipeline',
    label: '파이프라인',
    href: '/ops/pipeline',
    section: 'ops',
    allowedRoles: ['operator', 'security_officer'],
  },
  /* A-002 저장소 등록. `operator` 전용이다 (권한 매트릭스). */
  {
    id: 'ops-repositories',
    label: '저장소 등록',
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
    label: '잡',
    href: '/ops/jobs',
    section: 'ops',
    allowedRoles: ['operator'],
  },
  /* A-004 감사 기록. `security_officer` 전용이다 (FR-AUTH-004 AC-5). */
  {
    id: 'ops-audit',
    label: '감사 기록',
    href: '/ops/audit',
    section: 'ops',
    allowedRoles: ['security_officer'],
  },
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
 * 위해서다. 지금 `NAV_ENTRIES`에는 서로 접두가 되는 항목이 없어 그 규칙이
 * 한 번도 실행되지 않는다 — 목록을 고정해 두면 검증할 수 없는 방어 코드가
 * 되고, 나중에 `/ops` 같은 그룹 항목이 들어오는 순간 아무도 모르게 틀린다.
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
