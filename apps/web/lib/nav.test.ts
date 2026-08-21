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
  activeNavId,
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

  it('나머지 역할에게는 **렌더링되지 않는다**', () => {
    // 비활성으로 보여 주면 "여기에 운영 콘솔이 있다"를 알려 준다 (C-002 사용 규칙).
    for (const role of ['developer', 'manager', 'qa', 'release_manager'] as const) {
      const ids = idsFor(role);
      expect(ids, role).not.toContain('ops-pipeline');
      expect(ids, role).not.toContain('ops-repositories');
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
      expect(idsFor(role), role).toEqual(expect.arrayContaining(['search', 'ranges', 'releases', 'stats']));
    }
  });

  it('허용 역할 하나만 있어도 열린다 — 전부 필요한 것이 아니다', () => {
    expect(canSeeOps(['developer', 'operator'])).toBe(true);
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
    for (const entry of NAV_ENTRIES) {
      expect(['search', 'analysis', 'ops'], entry.id).toContain(entry.section);
    }
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

  it('더 구체적인 경로가 이긴다', () => {
    expect(activeNavId('/ops/pipeline')).toBe('ops-pipeline');
  });

  it('모르는 경로는 `null`이다', () => {
    expect(activeNavId('/')).toBeNull();
    expect(activeNavId('/nowhere')).toBeNull();
  });
});
