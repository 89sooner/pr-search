/**
 * 관리자 지정 역할 명령 — `prsctl role` (CR-091 / DEV-695).
 *
 * ## 왜 필요한가
 *
 * `operator`·`release_manager`·`security_officer`는 IdP 그룹이나 GHE 팀으로 부여할 수 없다(CR-015,
 * DEV-049). 보안 문서 5.1은 그 부여 방식을 「관리자 지정」이라 적었고 그 값이 `app_user.roles[]`다.
 * 그런데 **그 값을 쓰는 운영 경로가 없었다** — API도, CLI도, 런북 절차도. 세션 인증을 켠 배포는
 * 관리 토큰을 쓸 수 없으므로(DEV-048) 사내 `0.1.0-pilot.6`은 누구도 운영 콘솔을 쓸 수 없었다.
 *
 * ## 왜 화면이 아니라 호스트 명령인가
 *
 * **최초의 `operator`는 화면으로 만들 수 없다** — 화면으로 역할을 주려면 그 화면을 쓸 `operator`가
 * 먼저 있어야 한다. 호스트에 접근해 `prsctl`을 돌릴 수 있는 사람은 이미 DB와 시크릿을 쥔 사람이므로
 * 이 명령이 새 권한 경계를 열지 않는다. 역할 관리 화면은 이 판의 범위가 아니다.
 *
 * ## 규칙
 *
 * - 지정할 수 있는 역할은 `ADMIN_ASSIGNED_ROLES`뿐이다. `manager`·`qa`는 팀 매핑으로 준다 — 두 경로가
 *   같은 역할을 주면 어느 쪽을 지워야 회수되는지 운영자가 알 수 없다.
 * - 대상은 **한 번 로그인한 사용자**다. 로그인 전에는 `user_id`(GHE 숫자 id)를 알 수 없고, 이름만으로
 *   행을 지어내면 로그인 때 다른 키의 행과 부딪친다.
 * - 대상은 GHE 로그인 이름이나 `user_id`로 가리킨다. 이름이 대소문자만 다른 여러 행에 걸리면 **고르지 않는다** —
 *   후보의 `user_id`와 마지막 접속을 보여 주고 `user_id`로 다시 실행하게 한다(독립 검토 A).
 * - 변경과 감사가 한 트랜잭션이다(`changeAssignedRole`). 바뀐 것이 없으면 감사도 없다.
 */

import { randomUUID } from 'node:crypto';
import { ADMIN_ASSIGNED_ROLES, type Role } from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { ActiveAuditAction } from '@prs/domain';

/** 감사 기록의 행위 주체 접두. 사람 세션(`github:`·OIDC `sub`)·관리 토큰(`admin:`)·시스템(`system:`)과 섞이지 않는다. */
export const ROLE_COMMAND_ACTOR_PREFIX = 'prsctl:';

const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const AUDIT_ACTION: Readonly<Record<'grant' | 'revoke', ActiveAuditAction>> = {
  grant: 'user_role.grant',
  revoke: 'user_role.revoke',
};

export interface RoleCommandDeps {
  readonly pool: Pool;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly correlationId?: () => string;
}

/** 종료 코드. 0 성공(바뀐 것이 없어도), 2 사람이 고칠 입력 오류. */
export type RoleCommandExit = 0 | 2;

const USAGE = [
  '사용법:',
  '  prsctl role list',
  '  prsctl role grant <login 또는 user_id> <역할>',
  '  prsctl role revoke <login 또는 user_id> <역할>',
  '',
  `지정할 수 있는 역할: ${[...ADMIN_ASSIGNED_ROLES].join(', ')}`,
  'manager·qa는 GHE_TEAM_ROLE_MAP(또는 IDP 그룹 매핑)으로 준다.',
].join('\n');

export async function runRoleCommand(argv: readonly string[], deps: RoleCommandDeps): Promise<RoleCommandExit> {
  const { positional, actor } = parseArgs(argv);
  const [command, login, role] = positional;

  if (command === 'list' && positional.length === 1) return list(deps);
  if ((command === 'grant' || command === 'revoke') && positional.length === 3 && login !== undefined && role !== undefined) {
    return change(command, login, role, actor, deps);
  }

  deps.err(USAGE);
  return 2;
}

function parseArgs(argv: readonly string[]): { positional: string[]; actor: string | undefined } {
  const positional: string[] = [];
  let actor: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--actor') {
      actor = argv[i + 1];
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  return { positional, actor };
}

async function list(deps: RoleCommandDeps): Promise<RoleCommandExit> {
  const holders = await authRepo.listAssignedRoleHolders(deps.pool, [...ADMIN_ASSIGNED_ROLES]);
  if (holders.length === 0) {
    deps.out('관리자 지정 역할을 가진 사용자가 없다.');
    deps.out('최초 운영자는 그 사람이 한 번 로그인한 뒤 `prsctl role grant <login> operator`로 지정한다.');
    return 0;
  }

  deps.out('login\tuser_id\t지정 역할\t마지막 접속');
  for (const holder of holders) {
    const assigned = holder.roles.filter((one) => ADMIN_ASSIGNED_ROLES.has(one as Role));
    const seen = holder.last_seen_at === null ? '-' : holder.last_seen_at.toISOString();
    deps.out(`${holder.login}\t${holder.user_id}\t${assigned.join(',')}\t${seen}`);
  }
  return 0;
}

async function change(
  kind: 'grant' | 'revoke',
  login: string,
  role: string,
  actor: string | undefined,
  deps: RoleCommandDeps,
): Promise<RoleCommandExit> {
  if (!ADMIN_ASSIGNED_ROLES.has(role as Role)) {
    deps.err(
      `'${role}'는 이 명령으로 ${kind === 'grant' ? '지정' : '회수'}할 수 있는 역할이 아니다. ` +
        `가능한 역할: ${[...ADMIN_ASSIGNED_ROLES].join(', ')}. manager·qa는 GHE_TEAM_ROLE_MAP으로 준다 (CR-015).`,
    );
    return 2;
  }

  /*
   * **행위 주체 없이 권한을 바꾸지 않는다.** `prsctl`이 호스트 사용자 이름을 넘긴다. 이 명령을 직접
   * 부르는 사람도 자기 이름을 적어야 한다 — 감사 기록의 "누가"가 비면 이 명령이 존재하는 이유의
   * 절반이 사라진다.
   */
  if (actor === undefined || !ACTOR_PATTERN.test(actor)) {
    deps.err('--actor <호스트 사용자>가 필요하다 (영문·숫자·`._-` 1~64자). `prsctl role`은 이 값을 스스로 채운다.');
    return 2;
  }

  const candidates = await authRepo.findAssignableUsers(deps.pool, login);
  if (candidates.length === 0) {
    deps.err(
      `'${login}'으로 로그인한 사용자가 없다. 대상이 PR Search에 한 번 로그인해야 정본에 행이 생긴다 (DEV-613). ` +
        'GHE 로그인 이름(표시 이름이 아니다)을 확인한다. `prsctl role list`는 이미 지정된 사용자만 보여 준다.',
    );
    return 2;
  }
  if (candidates.length > 1) {
    deps.err(
      `'${login}'이 대소문자만 다른 사용자 여럿에 걸린다 — 개명 흔적일 수 있어 고르지 않는다. ` +
        '마지막 접속을 보고 지금 쓰는 신원의 user_id로 다시 실행한다:',
    );
    for (const candidate of candidates) {
      const seen = candidate.last_seen_at === null ? '-' : candidate.last_seen_at.toISOString();
      deps.err(`  ${candidate.login}\t${candidate.user_id}\t마지막 접속 ${seen}`);
    }
    return 2;
  }

  const target = candidates[0];
  if (target === undefined) return 2;

  const result = await authRepo.changeAssignedRole(deps.pool, {
    userId: target.user_id,
    role,
    change: kind,
    actor: `${ROLE_COMMAND_ACTOR_PREFIX}${actor}`,
    auditAction: AUDIT_ACTION[kind],
    correlationId: (deps.correlationId ?? randomUUID)(),
  });

  switch (result.outcome) {
    case 'applied': {
      const assigned = result.roles.filter((one) => ADMIN_ASSIGNED_ROLES.has(one as Role));
      deps.out(
        `${target.login} (${target.user_id})의 ${role}를 ${kind === 'grant' ? '지정' : '회수'}했다. ` +
          `지금 지정 역할: ${assigned.length === 0 ? '없음' : assigned.join(', ')}.`,
      );
      deps.out('그 사용자의 다음 요청부터 반영된다 — 다시 로그인할 필요가 없다. 화면은 새로 고치면 메뉴가 바뀐다.');
      return 0;
    }
    case 'unchanged':
      deps.out(
        `${target.login}은 이미 ${role}를 ${kind === 'grant' ? '가지고 있다' : '가지고 있지 않다'} — 바꾼 것이 없어 감사도 남기지 않았다.`,
      );
      return 0;
    case 'user_not_found':
      // 이름으로 찾은 뒤 트랜잭션 사이에 행이 사라진 경우다. 추측해 만들지 않는다.
      deps.err(`${target.login}의 정본 행이 사라졌다 — 다시 실행한다.`);
      return 2;
  }
}
