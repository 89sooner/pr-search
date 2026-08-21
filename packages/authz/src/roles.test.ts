/**
 * 역할 합성 (WP-012, CR-015 DEV-049).
 *
 * 방향을 어느 쪽으로 틀려도 조용히 위험해지는 자리다. 두 방향을 모두 건다.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIN_ASSIGNED_ROLES,
  IDP_ASSIGNABLE_ROLES,
  ROLES,
  composeRoles,
  hasRole,
  isRole,
  parseGroupRoleMap,
} from './roles.js';

const MAP = parseGroupRoleMap('eng-managers:manager,qa-guild:qa');

describe('DEV-049: 역할 합성', () => {
  it('아무것도 없으면 developer 하나다', () => {
    expect(composeRoles([], [], MAP)).toEqual(['developer']);
  });

  it('IdP 그룹이 manager·qa를 부여한다', () => {
    expect(composeRoles(['eng-managers'], [], MAP)).toEqual(['manager', 'developer'].sort((a, b) => ROLES.indexOf(a as never) - ROLES.indexOf(b as never)));
  });

  it('DB 지정값과 IdP 그룹을 합집합으로 합친다', () => {
    const roles = composeRoles(['qa-guild'], ['operator'], MAP);
    expect(roles).toContain('developer');
    expect(roles).toContain('qa');
    expect(roles).toContain('operator');
  });

  it('IdP 클레임이 DB 지정 operator를 지우지 않는다', () => {
    // 덮어쓰기였다면 그룹만 남고 operator가 사라진다.
    expect(composeRoles(['eng-managers'], ['operator'], MAP)).toContain('operator');
  });

  it('매핑에 없는 그룹은 아무 역할도 주지 않는다', () => {
    expect(composeRoles(['random-group', 'admins'], [], MAP)).toEqual(['developer']);
  });

  it('DB에 적힌 오타는 역할이 되지 않는다', () => {
    expect(composeRoles([], ['operatorr', 'OPERATOR', ''], MAP)).toEqual(['developer']);
  });

  it('중복을 접고 늘 같은 순서로 준다', () => {
    const a = composeRoles(['qa-guild', 'qa-guild'], ['qa', 'operator', 'qa'], MAP);
    const b = composeRoles(['qa-guild'], ['operator', 'qa'], MAP);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('DEV-049: IdP가 부여할 수 있는 역할의 경계', () => {
  it('manager·qa만 IdP가 부여할 수 있다', () => {
    expect([...IDP_ASSIGNABLE_ROLES].sort()).toEqual(['manager', 'qa']);
  });

  it('운영·릴리스·보안 역할은 관리자 지정 전용이다', () => {
    expect([...ADMIN_ASSIGNED_ROLES].sort()).toEqual(['operator', 'release_manager', 'security_officer']);
  });

  it('IdP 매핑에 operator를 적으면 구성 오류다', () => {
    // 여기를 열면 그룹을 만들 수 있는 사람이 운영 권한을 발급하게 된다.
    expect(() => parseGroupRoleMap('admins:operator')).toThrow(/IdP 그룹으로 부여할 수 없다/);
    expect(() => parseGroupRoleMap('sec:security_officer')).toThrow(/IdP 그룹으로 부여할 수 없다/);
  });

  it('두 집합이 겹치지 않는다', () => {
    for (const role of IDP_ASSIGNABLE_ROLES) {
      expect(ADMIN_ASSIGNED_ROLES.has(role)).toBe(false);
    }
  });
});

describe('그룹 매핑 파싱', () => {
  it('빈 값은 빈 매핑이다', () => {
    expect(parseGroupRoleMap(undefined).size).toBe(0);
    expect(parseGroupRoleMap('   ').size).toBe(0);
  });

  it('공백을 다듬는다', () => {
    expect(parseGroupRoleMap(' eng-managers : manager , qa-guild:qa ').get('eng-managers')).toBe('manager');
  });

  it('콜론이 든 그룹 이름을 마지막 콜론으로 가른다', () => {
    // LDAP DN 같은 이름에 콜론이 들어갈 수 있다.
    expect(parseGroupRoleMap('acme:eng:qa').get('acme:eng')).toBe('qa');
  });

  it('역할이 아닌 값을 거절한다', () => {
    expect(() => parseGroupRoleMap('g:admin')).toThrow(/역할이 아니다/);
  });

  it('형식이 아니면 거절한다 — 조용히 버리지 않는다', () => {
    expect(() => parseGroupRoleMap('no-colon')).toThrow(/형식이 잘못됐다/);
    expect(() => parseGroupRoleMap(':manager')).toThrow(/형식이 잘못됐다/);
    expect(() => parseGroupRoleMap('group:')).toThrow(/형식이 잘못됐다/);
  });
});

describe('역할 목록', () => {
  it('보안 문서 5.1의 여섯 그대로다', () => {
    expect([...ROLES]).toEqual([
      'developer',
      'release_manager',
      'manager',
      'qa',
      'operator',
      'security_officer',
    ]);
  });

  it('isRole은 목록 밖을 거절한다', () => {
    expect(isRole('operator')).toBe(true);
    expect(isRole('admin')).toBe(false);
  });

  it('hasRole은 정확히 일치할 때만 참이다', () => {
    expect(hasRole(['developer', 'operator'], 'operator')).toBe(true);
    expect(hasRole(['developer'], 'operator')).toBe(false);
  });
});
