/**
 * `prsctl role` — 실제 PostgreSQL (CR-091 / DEV-695, FR-AUTH-004 AC-1·AC-6).
 *
 * 세션 인증을 켠 배포에서 `operator`를 얻는 유일한 경로다. 여기서 거는 것은 넷이다.
 *
 *   1. 지정·회수가 `app_user.roles[]`를 바꾸고 **같은 트랜잭션에서** 감사 한 행을 남긴다
 *   2. 감사를 남기지 못하면 역할도 바뀌지 않는다
 *   3. 바뀐 것이 없는 재실행은 아무것도 쓰지 않는다
 *   4. 대상·역할·행위 주체를 추측하지 않는다 — 로그인 전 사용자, 팀 매핑 역할, 모호한 이름, 주체 없음
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authRepo, type Pool } from '@prs/db';
import { runRoleCommand, type RoleCommandDeps } from '../../src/auth/role-command.js';
import { migratedPool } from '../helpers.js';

const USER = 'github:992';
const LOGIN = 'cr091-lee';

let pool: Pool;

interface Captured {
  readonly out: string[];
  readonly err: string[];
  readonly deps: RoleCommandDeps;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    // 상관 ID는 명령이 스스로 만든다(`audit_record.correlation_id`는 UUID 열이다).
    deps: { pool, out: (line) => out.push(line), err: (line) => err.push(line) },
  };
}

async function roles(userId = USER): Promise<string[]> {
  return (await authRepo.findAssignedRoles(pool, userId)) ?? [];
}

async function auditRows(): Promise<{ user_id: string; action: string; target: string | null; query: string | null; result_code: string }[]> {
  const { rows } = await pool.query<{ user_id: string; action: string; target: string | null; query: string | null; result_code: string }>(
    `SELECT user_id, action, target, query, result_code FROM audit_record
      WHERE action LIKE 'user_role.%' AND target LIKE $1 ORDER BY audit_id`,
    [`${USER}/%`],
  );
  return rows;
}

beforeAll(async () => {
  pool = await migratedPool();
}, 90_000);

beforeEach(async () => {
  await pool.query("DELETE FROM app_user WHERE login ILIKE 'cr091-%'");
  // 감사 기록은 갱신·삭제할 수 없다(AC-3). 이 파일의 대상 키로만 세므로 앞 시험의 행은 기준선으로 뺀다.
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: LOGIN, github_user_id: 992 });
});

afterAll(async () => {
  await pool?.end();
});

describe('DEV-695: 관리자 지정 역할을 지정·회수한다', () => {
  it('operator를 지정하면 정본이 바뀌고 같은 트랜잭션에서 감사 한 행이 남는다', async () => {
    const before = (await auditRows()).length;
    const run = capture();

    expect(await runRoleCommand(['grant', LOGIN, 'operator', '--actor', 'ops-kim'], run.deps)).toBe(0);

    expect(await roles()).toEqual(['developer', 'operator']);
    const rows = (await auditRows()).slice(before);
    expect(rows).toEqual([
      { user_id: 'prsctl:ops-kim', action: 'user_role.grant', target: `${USER}/operator`, query: null, result_code: 'applied' },
    ]);
    expect(run.out.join('\n')).toContain('다음 요청부터 반영된다');
  });

  it('회수하면 역할이 빠지고 감사가 남는다 — developer는 그대로다', async () => {
    await runRoleCommand(['grant', LOGIN, 'operator', '--actor', 'ops-kim'], capture().deps);
    const before = (await auditRows()).length;

    expect(await runRoleCommand(['revoke', LOGIN, 'operator', '--actor', 'ops-park'], capture().deps)).toBe(0);

    expect(await roles()).toEqual(['developer']);
    expect((await auditRows()).slice(before)).toEqual([
      { user_id: 'prsctl:ops-park', action: 'user_role.revoke', target: `${USER}/operator`, query: null, result_code: 'applied' },
    ]);
  });

  it('바뀐 것이 없는 재실행은 아무것도 쓰지 않는다 — 감사 건수가 지정 횟수를 말한다', async () => {
    await runRoleCommand(['grant', LOGIN, 'security_officer', '--actor', 'ops-kim'], capture().deps);
    const before = (await auditRows()).length;
    const again = capture();

    expect(await runRoleCommand(['grant', LOGIN, 'security_officer', '--actor', 'ops-kim'], again.deps)).toBe(0);
    expect(await runRoleCommand(['revoke', LOGIN, 'release_manager', '--actor', 'ops-kim'], again.deps)).toBe(0);

    expect(await roles()).toEqual(['developer', 'security_officer']);
    expect((await auditRows()).length).toBe(before);
    expect(again.out.join('\n')).toContain('바꾼 것이 없어');
  });

  /**
   * **기록 없는 권한 변경이 실패한 권한 변경보다 나쁘다** (AC-6의 예외, CR-090과 같은 근거).
   *
   * 감사 표를 잠시 다른 이름으로 옮겨 INSERT만 실패하게 한다. 역할 UPDATE는 이미 실행된 뒤이므로
   * 트랜잭션이 아니었다면 역할만 바뀐 채 남는다.
   */
  it('감사를 쓰지 못하면 역할도 바뀌지 않는다', async () => {
    await pool.query('ALTER TABLE audit_record RENAME TO audit_record_cr091_hidden');
    try {
      await expect(runRoleCommand(['grant', LOGIN, 'operator', '--actor', 'ops-kim'], capture().deps)).rejects.toThrow(
        /audit_record/,
      );
    } finally {
      await pool.query('ALTER TABLE audit_record_cr091_hidden RENAME TO audit_record');
    }
    expect(await roles()).toEqual(['developer']);
  });

  it('동시에 같은 지정을 두 번 해도 한 번만 적용되고 감사도 하나다', async () => {
    const before = (await auditRows()).length;

    const results = await Promise.all([
      runRoleCommand(['grant', LOGIN, 'operator', '--actor', 'ops-a'], capture().deps),
      runRoleCommand(['grant', LOGIN, 'operator', '--actor', 'ops-b'], capture().deps),
    ]);

    expect(results).toEqual([0, 0]);
    expect(await roles()).toEqual(['developer', 'operator']);
    expect((await auditRows()).length - before).toBe(1);
  });

  it('list가 지정 역할을 가진 사용자만 보여 준다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: 'github:993', login: 'cr091-plain', github_user_id: 993 });
    await runRoleCommand(['grant', LOGIN, 'release_manager', '--actor', 'ops-kim'], capture().deps);
    const run = capture();

    expect(await runRoleCommand(['list'], run.deps)).toBe(0);

    const lines = run.out.join('\n');
    expect(lines).toContain(`${LOGIN}\t${USER}\trelease_manager`);
    expect(lines).not.toContain('cr091-plain');
  });
});

describe('DEV-695: 추측하지 않는다', () => {
  it('로그인한 적이 없는 이름이면 아무것도 만들지 않고 이유를 말한다', async () => {
    const run = capture();

    expect(await runRoleCommand(['grant', 'cr091-nobody', 'operator', '--actor', 'ops-kim'], run.deps)).toBe(2);

    expect(run.err.join('\n')).toContain('한 번 로그인해야');
    const { rowCount } = await pool.query("SELECT 1 FROM app_user WHERE login = 'cr091-nobody'");
    expect(rowCount).toBe(0);
  });

  it.each(['manager', 'qa', 'developer', 'admin', 'OPERATOR'])('%s는 이 명령으로 지정하지 않는다', async (role) => {
    const run = capture();

    expect(await runRoleCommand(['grant', LOGIN, role, '--actor', 'ops-kim'], run.deps)).toBe(2);

    expect(await roles()).toEqual(['developer']);
    expect(run.err.join('\n')).toContain('GHE_TEAM_ROLE_MAP');
  });

  it.each([[[]], [['--actor']], [['--actor', '']], [['--actor', 'ops kim']], [['--actor', 'a'.repeat(65)]]])(
    '행위 주체가 없거나 형식이 아니면 바꾸지 않는다 %j',
    async (actorArgs) => {
      const run = capture();

      expect(await runRoleCommand(['grant', LOGIN, 'operator', ...actorArgs], run.deps)).toBe(2);
      expect(await roles()).toEqual(['developer']);
    },
  );

  it('대소문자가 다른 이름도 하나뿐이면 찾는다 — GHE 로그인은 대소문자를 가리지 않는다', async () => {
    expect(await runRoleCommand(['grant', 'CR091-LEE', 'operator', '--actor', 'ops-kim'], capture().deps)).toBe(0);
    expect(await roles()).toEqual(['developer', 'operator']);
  });

  it('대소문자만 다른 사용자가 여럿이면 고르지 않는다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: 'github:994', login: 'CR091-Lee', github_user_id: 994 });
    const run = capture();

    expect(await runRoleCommand(['grant', 'cr091-LEE', 'operator', '--actor', 'ops-kim'], run.deps)).toBe(2);

    expect(await roles()).toEqual(['developer']);
    expect(await roles('github:994')).toEqual(['developer']);
    expect(run.err.join('\n')).toContain('여럿');
  });

  it('정확히 같은 이름이 있으면 그것을 고른다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: 'github:994', login: 'CR091-Lee', github_user_id: 994 });

    expect(await runRoleCommand(['grant', 'CR091-Lee', 'operator', '--actor', 'ops-kim'], capture().deps)).toBe(0);

    expect(await roles('github:994')).toEqual(['developer', 'operator']);
    expect(await roles()).toEqual(['developer']);
  });

  it.each([[['grant']], [['grant', LOGIN]], [['list', 'extra']], [['delete', LOGIN, 'operator']], [[]]])(
    '형식이 아니면 사용법을 말한다 %j',
    async (argv) => {
      const run = capture();
      expect(await runRoleCommand(argv, run.deps)).toBe(2);
      expect(run.err.join('\n')).toContain('사용법');
    },
  );
});
