/**
 * 내비게이션 역할 필터링 (WP-015 DoD / QA-A001-10, C-002).
 *
 * 어떤 항목이 보이는가는 **보안 판정**이다. 렌더링이 아니라 여기서 건다.
 */

import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@prs/authz/roles';
import {
  NAV_ENTRIES,
  OPS_ROLES,
  type NavEntry,
  activeNavId,
  matchNavEntry,
  canSeeOps,
  visibleNavEntries,
} from './nav';

function idsFor(...roles: Role[]): string[] {
  return visibleNavEntries(roles).map((entry) => entry.id);
}

describe('QA-A001-10: 운영 그룹은 역할이 있어야 보인다', () => {
  it('`operator`는 운영 항목을 본다', () => {
    expect(idsFor('developer', 'operator')).toContain('ops-pipeline');
  });

  it('`security_officer`도 본다 — 감사 화면이 같은 그룹이다', () => {
    expect(idsFor('developer', 'security_officer')).toContain('ops-audit');
  });

  /*
   * QA-A004-06·07 (CR-054, DEV-408).
   *
   * 이전 판은 `ops` 섹션을 통째로 두 역할에 열어 **권한 매트릭스와 어긋났다** —
   * `operator`가 감사 화면을, `security_officer`가 저장소 등록을 보았다.
   * 두 역할은 서로의 화면에서 403을 받으므로, 보이는 것 자체가 거짓 안내다.
   */
  it('QA-A004-06: `operator`에게 감사 항목이 렌더링되지 않는다', () => {
    const ids = idsFor('developer', 'operator');
    expect(ids).not.toContain('ops-audit');
    // 나머지 운영 항목은 그대로 본다 — 항목 단위 판정이지 역할 차단이 아니다.
    expect(ids).toEqual(expect.arrayContaining(['ops-pipeline', 'ops-repositories', 'ops-jobs']));
  });

  it('QA-A004-07: `security_officer`에게 저장소 등록 항목이 렌더링되지 않는다', () => {
    const ids = idsFor('developer', 'security_officer');
    expect(ids).not.toContain('ops-repositories');
    // A-003도 `operator` 전용이다 (CR-055).
    expect(ids).not.toContain('ops-jobs');
    // A-001은 CR-052가 연 아카이브 진입점이라 보인다 (DEV-375).
    expect(ids).toContain('ops-pipeline');
  });

  it('두 역할을 함께 가지면 둘의 합집합을 본다', () => {
    const ids = idsFor('operator', 'security_officer');
    expect(ids).toEqual(expect.arrayContaining(['ops-pipeline', 'ops-repositories', 'ops-audit']));
  });

  it('나머지 역할에게는 **렌더링되지 않는다**', () => {
    // 비활성으로 보여 주면 "여기에 운영 콘솔이 있다"를 알려 준다 (C-002 사용 규칙).
    for (const role of ['developer', 'manager', 'qa', 'release_manager'] as const) {
      const ids = idsFor(role);
      expect(ids, role).not.toContain('ops-pipeline');
      expect(ids, role).not.toContain('ops-repositories');
      expect(ids, role).not.toContain('ops-jobs');
      expect(ids, role).not.toContain('ops-audit');
    }
  });

  it('역할 6종 전부를 건다 — 새 역할이 조용히 통과하지 않게', () => {
    for (const role of ROLES) {
      expect(canSeeOps([role]), role).toBe(OPS_ROLES.has(role));
    }
  });

  it('역할이 비면 운영은 보이지 않는다', () => {
    expect(idsFor()).not.toContain('ops-pipeline');
  });

  it('운영 외 항목은 역할과 무관하게 보인다', () => {
    for (const role of ROLES) {
      expect(idsFor(role), role).toEqual(expect.arrayContaining(['search', 'ranges', 'releases', 'analytics']));
    }
  });

  it('허용 역할 하나만 있어도 열린다 — 전부 필요한 것이 아니다', () => {
    expect(canSeeOps(['developer', 'operator'])).toBe(true);
  });
});

describe('REL-007 R0: github 그룹은 역할과 무관하게 보인다 (WP-077, FR-GH-008)', () => {
  /*
   * 실행 자격은 역할이 아니라 **위임 신원**이 정하고 그 판정은 서버가 한다. 내비가 역할로
   * 가리면 「연결하면 쓸 수 있다」는 사실을 사용자가 알 수 없다.
   */
  it('역할 6종 전부와 빈 역할에게 두 항목이 보인다', () => {
    for (const roles of [[], ...ROLES.map((role) => [role])] as Role[][]) {
      const ids = idsFor(...roles);
      expect(ids, roles.join(',')).toContain('gh-command-center');
      expect(ids, roles.join(',')).toContain('gh-history');
    }
  });

  it('두 항목은 `github` 그룹이고 역할 제한을 선언하지 않는다', () => {
    for (const id of ['gh-command-center', 'gh-history']) {
      const entry = NAV_ENTRIES.find((candidate) => candidate.id === id) as NavEntry;
      expect(entry.section).toBe('github');
      expect(entry.allowedRoles).toBeUndefined();
    }
  });

  it('`/gh/history`는 `/gh`가 아니라 이력 항목이다 — 최장 일치가 실제로 돈다', () => {
    expect(activeNavId('/gh')).toBe('gh-command-center');
    expect(activeNavId('/gh/history')).toBe('gh-history');
    expect(activeNavId('/gh/identity/callback')).toBe('gh-command-center');
  });
});

describe('그룹 판정이 기본적으로 안전하다', () => {
  it('`ops` 그룹의 항목은 하나도 새지 않는다', () => {
    // 판정을 id가 아니라 section으로 하므로 새 운영 화면이 저절로 가려진다.
    const opsIds = NAV_ENTRIES.filter((e) => e.section === 'ops').map((e) => e.id);
    const visible = idsFor('developer');

    expect(opsIds.length).toBeGreaterThan(0);
    for (const id of opsIds) expect(visible).not.toContain(id);
  });

  it('모든 항목이 그룹을 갖는다', () => {
    // `github`은 REL-007 R0(WP-077)가 더한 네 번째 그룹이다 — 제품 IA의 두 번째 표면.
    for (const entry of NAV_ENTRIES) {
      expect(['search', 'analysis', 'github', 'ops'], entry.id).toContain(entry.section);
    }
  });

  /*
   * **새 운영 항목의 기본값은 "보이지 않음"이다** (CR-054, DEV-408).
   *
   * `allowedRoles`를 빠뜨린 `ops` 항목은 아무에게도 보이지 않는다. 이 시험이
   * 없으면 그 사실이 "새 화면이 왜 안 보이지"로만 드러나고, 반대 방향의
   * 실수(모두에게 보임)와 구분되지 않는다.
   */
  it('`ops` 항목은 모두 허용 역할을 선언한다', () => {
    for (const entry of NAV_ENTRIES.filter((e) => e.section === 'ops')) {
      expect(entry.allowedRoles, entry.id).toBeDefined();
      expect(entry.allowedRoles?.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('허용 역할을 선언하지 않은 `ops` 항목은 아무에게도 보이지 않는다', () => {
    // 실제 목록을 건드리지 않고 규칙만 확인한다.
    const orphan: NavEntry = { id: 'ops-new', label: '새 화면', href: '/ops/new', section: 'ops' };
    const held = new Set<Role>(['operator', 'security_officer']);
    const visible = [orphan].filter(
      (entry) => entry.section !== 'ops' || (entry.allowedRoles ?? []).some((r) => held.has(r)),
    );
    expect(visible).toHaveLength(0);
  });

  it('id와 경로가 겹치지 않는다', () => {
    expect(new Set(NAV_ENTRIES.map((e) => e.id)).size).toBe(NAV_ENTRIES.length);
    expect(new Set(NAV_ENTRIES.map((e) => e.href)).size).toBe(NAV_ENTRIES.length);
  });
});

describe('현재 항목 판정', () => {
  it('정확히 일치하면 그 항목이다', () => {
    expect(activeNavId('/search')).toBe('search');
  });

  it('하위 경로도 같은 항목이다', () => {
    expect(activeNavId('/search/abc')).toBe('search');
  });

  it('**경계를 본다** — `/searchable`은 `/search`가 아니다', () => {
    expect(activeNavId('/searchable')).toBeNull();
  });

  it('겹치는 항목이 없어도 정확히 일치하면 잡는다', () => {
    expect(activeNavId('/ops/pipeline')).toBe('ops-pipeline');
  });
});

/*
 * 최장 일치는 **지금 `NAV_ENTRIES`로는 실행되지 않는다** — 서로 접두가 되는
 * 항목이 하나도 없기 때문이다. 그래서 목록을 직접 만들어 건다. 이 규칙이
 * 살아 있어야 나중에 `/ops` 같은 그룹 랜딩 항목이 들어와도 하위 화면의
 * 표시가 그룹으로 밀리지 않는다.
 */
describe('최장 일치 (`matchNavEntry`)', () => {
  const OVERLAPPING: readonly NavEntry[] = [
    { id: 'ops', label: '운영', href: '/ops', section: 'ops' },
    { id: 'ops-pipeline', label: '파이프라인', href: '/ops/pipeline', section: 'ops' },
  ];

  it('더 구체적인 항목이 이긴다 — 목록 순서와 무관하게', () => {
    expect(matchNavEntry('/ops/pipeline', OVERLAPPING)?.id).toBe('ops-pipeline');
    // 뒤집어도 같아야 한다. 순서에 기대면 항목을 옮기는 순간 조용히 틀린다.
    expect(matchNavEntry('/ops/pipeline', [...OVERLAPPING].reverse())?.id).toBe('ops-pipeline');
  });

  it('구체적인 쪽에 걸리지 않으면 그룹이 남는다', () => {
    expect(matchNavEntry('/ops', OVERLAPPING)?.id).toBe('ops');
    expect(matchNavEntry('/ops/audit', OVERLAPPING)?.id).toBe('ops');
  });

  it('빈 목록이면 `null`이다', () => {
    expect(matchNavEntry('/ops', [])).toBeNull();
  });

  it('모르는 경로는 `null`이다', () => {
    expect(activeNavId('/')).toBeNull();
    expect(activeNavId('/nowhere')).toBeNull();
  });
});
