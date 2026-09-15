/**
 * 역할 모델 (보안 문서 5.1, NFR-005).
 *
 * 역할은 **화면·액션 접근**만 결정한다. 데이터 범위는 역할과 무관하게 접근
 * 범위가 결정한다 — `operator`도 권한 없는 저장소의 PR 본문은 볼 수 없다
 * (THR-016). 그래서 이 파일은 접근 범위를 전혀 모른다.
 */

/** 보안 문서 5.1의 역할 여섯. 이 밖의 값은 역할이 아니다. */
export const ROLES = [
  'developer',
  'release_manager',
  'manager',
  'qa',
  'operator',
  'security_officer',
] as const;

export type Role = (typeof ROLES)[number];

/** 인증된 모든 사용자가 갖는 기본 역할. */
export const DEFAULT_ROLE: Role = 'developer';

const ROLE_SET = new Set<string>(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/**
 * IdP 그룹 클레임으로 부여할 수 있는 역할 (CR-015, DEV-049).
 *
 * 보안 문서 5.1의 "부여 방식" 열이 그대로 이 집합이다. `manager`와 `qa`만
 * "IdP 그룹 매핑"이고 나머지는 "관리자 지정" 또는 기본값이다.
 *
 * **이 경계를 넓히면 그룹을 만들 수 있는 사람이 운영 권한을 발급하게 된다.**
 * 사내 IdP의 그룹 생성 권한과 PR Search의 운영 권한은 다른 조직이 관리한다.
 */
export const IDP_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>(['manager', 'qa']);

/** 관리자가 `app_user.roles[]`에 직접 적어야만 부여되는 역할. */
export const ADMIN_ASSIGNED_ROLES: ReadonlySet<Role> = new Set<Role>([
  'release_manager',
  'operator',
  'security_officer',
]);

/**
 * IdP 그룹 이름 → 역할 매핑 구성.
 *
 * 그룹 이름은 조직마다 다르므로 환경 변수로 받는다. 값이 역할이 아니거나
 * IdP가 부여할 수 없는 역할이면 구성 오류다 — 조용히 버리면 운영자가
 * "매핑했는데 왜 안 되지"를 로그 없이 겪는다.
 */
export type GroupRoleMap = ReadonlyMap<string, Role>;

export function parseGroupRoleMap(raw: string | undefined): GroupRoleMap {
  const map = new Map<string, Role>();
  if (raw === undefined || raw.trim() === '') return map;

  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;

    const separator = trimmed.lastIndexOf(':');
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new Error(`IdP 그룹 매핑 형식이 잘못됐다: '${trimmed}' (기대: 'group:role')`);
    }

    const group = trimmed.slice(0, separator).trim();
    const role = trimmed.slice(separator + 1).trim();

    if (!isRole(role)) {
      throw new Error(`'${role}'는 역할이 아니다. 보안 문서 5.1의 여섯 중 하나여야 한다`);
    }
    if (!IDP_ASSIGNABLE_ROLES.has(role)) {
      throw new Error(
        `'${role}'는 IdP 그룹으로 부여할 수 없다 (CR-015, DEV-049). ` +
          `IdP가 부여할 수 있는 역할: ${[...IDP_ASSIGNABLE_ROLES].join(', ')}`,
      );
    }
    map.set(group, role);
  }

  return map;
}

/**
 * 최종 역할을 만든다 (CR-015, DEV-049).
 *
 * `{developer}` ∪ (IdP 그룹 매핑) ∪ (DB 지정값).
 *
 * **합집합이지 대입이 아니다.** IdP 클레임으로 `roles[]`를 덮어쓰면 관리자가
 * 지정한 `operator`가 다음 로그인에 조용히 사라진다. 반대로 IdP 그룹을
 * `operator`까지 믿으면 그룹 관리자가 운영 권한을 발급할 수 있게 된다.
 * `IDP_ASSIGNABLE_ROLES`가 그 두 번째를 막는다.
 *
 * @param groups IdP가 준 그룹 클레임
 * @param assigned `app_user.roles[]`의 DB 지정값
 */
export function composeRoles(
  groups: readonly string[],
  assigned: readonly string[],
  groupMap: GroupRoleMap,
): Role[] {
  const roles = new Set<Role>([DEFAULT_ROLE]);

  for (const group of groups) {
    const mapped = groupMap.get(group);
    if (mapped !== undefined) roles.add(mapped);
  }

  // DB 지정값은 관리자가 적은 것이므로 IdP 제한을 받지 않는다. 다만 역할이
  // 아닌 문자열은 버린다 — 오타 하나가 권한이 되어서는 안 된다.
  for (const role of assigned) {
    if (isRole(role)) roles.add(role);
  }

  return ROLES.filter((role) => roles.has(role));
}

/**
 * 세션에 담긴 역할에 DB 지정값을 더한다 (CR-091 / DEV-695).
 *
 * `composeRoles`의 합집합은 **로그인 시점에 절반만** 성립했다. 로그인 콜백을 도는
 * `web`은 DB에 닿지 않으므로 지정값 자리에 빈 배열을 넘겼고, 세션을 읽는 두 서비스는
 * 세션의 역할만 봤다. 그래서 `app_user.roles[]`에 `operator`를 적어도 **어디에도
 * 반영되지 않았다** — 보안 문서 5.1과 API-AUTH-001이 적은 합집합이 코드에 없었다.
 *
 * 나머지 절반은 **세션을 읽는 자리가 요청마다** 이 함수로 더한다. 세션에 되써 넣지
 * 않는다 — 세션 레코드는 읽을 때마다 통째로 다시 쓰이므로(유휴 시각 갱신) 되써 넣으면
 * 두 서비스의 쓰기가 서로 덮고, 무엇보다 회수가 세션 수명(최대 12시간) 동안 늦어진다.
 *
 * 규칙은 `composeRoles`와 같다: `developer`는 늘 있고, 역할이 아닌 문자열은 버린다.
 *
 * @param sessionRoles 로그인 때 합성한 역할 (IdP 그룹·GHE 팀 매핑)
 * @param assigned `app_user.roles[]`의 DB 지정값
 */
export function withAssignedRoles(sessionRoles: readonly string[], assigned: readonly string[]): Role[] {
  const roles = new Set<Role>([DEFAULT_ROLE]);
  for (const role of [...sessionRoles, ...assigned]) {
    if (isRole(role)) roles.add(role);
  }
  return ROLES.filter((role) => roles.has(role));
}

export function hasRole(roles: readonly string[], required: Role): boolean {
  return roles.includes(required);
}
