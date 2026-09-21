/**
 * PSI-B identity binding — 실제 mTLS + PostgreSQL + Redis (CR-112).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authRepo, pipeIntegrationRepo } from '@prs/db';
import { runPipeIntegrationCommand } from '../../../src/integrations/pipe/command.js';
import {
  GHE_HOST,
  ISSUER,
  OPERATOR,
  STRANGER,
  USER_A,
  USER_B,
  bind,
  clearIntegrationTables,
  startHarness,
  type Harness,
} from './fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.faults.directoryDown = false;
  h.faults.scopeDown = false;
  h.clockOffsetMs = 0;
  h.gheUsers.set(USER_A.login, USER_A.gheId);
  h.gheUsers.set(USER_B.login, USER_B.gheId);
  await clearIntegrationTables(h.pool);
  for (const user of [USER_A, USER_B, OPERATOR]) await bind(h.pool, user);
  await h.resetScopeCache();
});

interface ErrorBody {
  readonly error: { readonly code: string; readonly retryable: boolean };
}

async function count(table: string): Promise<number> {
  const { rows } = await h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

function cli(argv: readonly string[], files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const run = runPipeIntegrationCommand(argv, {
    pool: h.pool,
    gheBaseUrl: `https://${GHE_HOST}`,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
  });
  return { run, out, err };
}

describe('PSI-B01 정상 매핑', () => {
  it('같은 기존 prs_user_id를 쓰고 GHE login은 서버 정본에서 얻는다', async () => {
    const response = await h.exchange(await h.signAssertion({ user: USER_A }));
    expect(response.status).toBe(200);
    expect(response.json<{ identity: { ghe_login: string } }>().identity.ghe_login).toBe(USER_A.login);
    const { rows } = await h.pool.query<{ prs_user_id: string }>('SELECT prs_user_id FROM pipe_integration_grant');
    expect(rows.map((row) => row.prs_user_id)).toEqual([USER_A.userId]);
  });
});

describe('PSI-B03 매핑 없음', () => {
  it('IDENTITY_BINDING_REQUIRED이며 사용자·grant·범위를 만들지 않는다', async () => {
    const usersBefore = await count('app_user');
    const response = await h.exchange(await h.signAssertion({ user: STRANGER }));
    expect(response.status).toBe(403);
    expect(response.json<ErrorBody>().error).toMatchObject({ code: 'IDENTITY_BINDING_REQUIRED', retryable: false });
    expect(await count('app_user')).toBe(usersBefore);
    expect(await count('pipe_integration_grant')).toBe(0);
  });
});

describe('PSI-B04 매핑 disabled·conflict', () => {
  it('disabled는 403 IDENTITY_DISABLED, conflict는 409 IDENTITY_BINDING_CONFLICT로 갈린다', async () => {
    await h.pool.query(`UPDATE pipe_integration_identity_binding SET status = 'disabled' WHERE subject = $1`, [USER_A.subject]);
    await h.pool.query(`UPDATE pipe_integration_identity_binding SET status = 'conflict' WHERE subject = $1`, [USER_B.subject]);
    const disabled = await h.exchange(await h.signAssertion({ user: USER_A }));
    const conflict = await h.exchange(await h.signAssertion({ user: USER_B }));
    expect([disabled.status, disabled.json<ErrorBody>().error.code]).toEqual([403, 'IDENTITY_DISABLED']);
    expect([conflict.status, conflict.json<ErrorBody>().error.code]).toEqual([409, 'IDENTITY_BINDING_CONFLICT']);
    expect(await count('pipe_integration_grant')).toBe(0);
  });
});

describe('PSI-B05 같은 login의 개명·재사용', () => {
  it('정본 login이 GHE에서 다른 숫자 ID를 가리키면 거절한다 — 다른 사람의 권한을 조회하지 않는다', async () => {
    // bob이 개명했고, 옛 이름을 다른 사람(숫자 ID 9999)이 가져갔다. pr-search 정본은 아직 옛 이름이다.
    h.gheUsers.set(USER_B.login, 9999);
    const response = await h.exchange(await h.signAssertion({ user: USER_B }));
    expect(response.status).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('IDENTITY_BINDING_CONFLICT');
    expect(await count('pipe_integration_grant')).toBe(0);
  });

  it('login이 GHE에 없으면(개명 뒤 미점유) 역시 충돌이다', async () => {
    h.gheUsers.delete(USER_B.login);
    expect((await h.exchange(await h.signAssertion({ user: USER_B }))).json<ErrorBody>().error.code).toBe('IDENTITY_BINDING_CONFLICT');
  });

  it('정본의 GHE 숫자 ID가 binding과 다르면 거절한다', async () => {
    await h.pool.query('UPDATE app_user SET github_user_id = 4242 WHERE user_id = $1', [USER_B.userId]);
    try {
      expect((await h.exchange(await h.signAssertion({ user: USER_B }))).json<ErrorBody>().error.code).toBe('IDENTITY_BINDING_CONFLICT');
    } finally {
      await h.pool.query('UPDATE app_user SET github_user_id = $2 WHERE user_id = $1', [USER_B.userId, USER_B.gheId]);
    }
  });

  it('GHE 사용자 조회가 실패하면 503 PERMISSION_UNAVAILABLE이다 — 확인 못 한 신원을 통과시키지 않는다', async () => {
    h.faults.directoryDown = true;
    const response = await h.exchange(await h.signAssertion({ user: USER_A }));
    expect(response.status).toBe(503);
    expect(response.json<ErrorBody>().error).toMatchObject({ code: 'PERMISSION_UNAVAILABLE', retryable: true });
  });
});

describe('PSI-B06 같은 숫자 ID의 다른 GHE 호스트', () => {
  it('binding의 호스트가 이 배포와 다르면 계정을 합치지 않는다', async () => {
    await h.pool.query(`UPDATE pipe_integration_identity_binding SET ghe_host = 'other-ghe.test' WHERE subject = $1`, [USER_A.subject]);
    const response = await h.exchange(await h.signAssertion({ user: USER_A }));
    expect(response.status).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('IDENTITY_BINDING_CONFLICT');
  });

  it('가져오기가 다른 호스트의 항목을 충돌로 보고한다', async () => {
    const entries = [{ issuer: ISSUER, subject: 'pipe-user-z', prs_user_id: USER_A.userId, ghe_host: 'other-ghe.test', ghe_user_id: USER_A.gheId, verification_reference: 'T-1' }];
    const { run, out } = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester'], { '/in.json': JSON.stringify(entries) });
    expect(await run).toBe(2);
    expect(out.join('\n')).toContain('ghe_host_mismatch');
  });
});

describe('PSI-B07 기존 canonical app_user 없음', () => {
  it('없는 사용자에게는 binding 자체를 만들 수 없다 (외래 키) — 가져오기도 충돌로 멈춘다', async () => {
    await expect(bind(h.pool, STRANGER)).rejects.toThrow();
    const entries = [{ issuer: ISSUER, subject: STRANGER.subject, prs_user_id: STRANGER.userId, ghe_host: GHE_HOST, ghe_user_id: STRANGER.gheId, verification_reference: 'T-2' }];
    const { run, out } = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester', '--apply'], { '/in.json': JSON.stringify(entries) });
    expect(await run).toBe(2);
    expect(out.join('\n')).toContain('canonical_user_missing');
  });
});

describe('PSI-B08 매핑 변경 중 이전 grant 사용', () => {
  it('끈 뒤에 판정되는 요청은 옛 grant로 통과하지 않고, 다시 켜도 옛 grant는 되살아나지 않는다', async () => {
    const grant = await h.grantFor(USER_A);
    expect((await h.get('/context', grant)).status).toBe(200);

    const disable = cli(['bindings', 'disable', '--issuer', ISSUER, '--subject', USER_A.subject, '--reason', '퇴사', '--actor', 'tester', '--apply']);
    expect(await disable.run).toBe(0);
    const afterDisable = await h.get('/context', grant);
    expect([afterDisable.status, afterDisable.json<ErrorBody>().error.code]).toEqual([403, 'IDENTITY_DISABLED']);

    const entries = [{ issuer: ISSUER, subject: USER_A.subject, prs_user_id: USER_A.userId, ghe_host: GHE_HOST, ghe_user_id: USER_A.gheId, verification_reference: 'T-3' }];
    const reactivate = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester', '--apply'], { '/in.json': JSON.stringify(entries) });
    expect(await reactivate.run).toBe(0);
    expect(reactivate.out.join('\n')).toContain('reactivate');
    const stale = await h.get('/context', grant);
    expect([stale.status, stale.json<ErrorBody>().error.code]).toEqual([401, 'GRANT_REVOKED']);

    const fresh = await h.exchange(await h.signAssertion({ user: USER_A, contextId: 'ctx-b08-fresh-000001' }));
    expect(fresh.json<{ binding_version: number }>().binding_version).toBe(3);
  });
});

describe('PSI-B09 mapping import dry-run·충돌', () => {
  const good = { issuer: ISSUER, subject: 'pipe-user-new', prs_user_id: OPERATOR.userId, ghe_host: GHE_HOST, ghe_user_id: OPERATOR.gheId, verification_reference: 'HR-1234' };

  it('dry-run은 계획만 출력하고 쓰지 않는다', async () => {
    await h.pool.query(`DELETE FROM pipe_integration_identity_binding WHERE subject = $1`, [OPERATOR.subject]);
    const before = await count('pipe_integration_identity_binding');
    const { run, out } = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester'], { '/in.json': JSON.stringify([good]) });
    expect(await run).toBe(0);
    expect(out.join('\n')).toContain('\tcreate\t');
    expect(out.join('\n')).toContain('dry-run');
    expect(await count('pipe_integration_identity_binding')).toBe(before);
  });

  it('충돌이 하나라도 있으면 --apply여도 아무것도 쓰지 않는다 (기존 매핑을 덮어쓰지 않는다)', async () => {
    // 사유가 서로 가리지 않도록 항목마다 다른 사용자를 쓴다.
    await authRepo.upsertUserOnLogin(h.pool, { user_id: 'github:5100', login: 'carol-psi', github_user_id: 5100 });
    await authRepo.upsertUserOnLogin(h.pool, { user_id: 'github:5101', login: 'dave-psi', github_user_id: 5101 });
    const before = await count('pipe_integration_identity_binding');
    const entries = [
      // 역방향 충돌: USER_A는 이미 다른 subject에 활성으로 묶여 있다.
      { ...good, subject: 'pipe-user-a-alias', prs_user_id: USER_A.userId, ghe_user_id: USER_A.gheId },
      // 같은 subject를 다른 사용자로 바꾸려는 항목.
      { ...good, subject: USER_B.subject },
      // 파일 안 중복 (같은 subject 둘).
      { ...good, subject: 'dup', prs_user_id: 'github:5100', ghe_user_id: 5100 },
      { ...good, subject: 'dup', prs_user_id: 'github:5100', ghe_user_id: 5100 },
      // 숫자 ID가 정본과 다르다.
      { ...good, subject: 'pipe-user-wrong-id', prs_user_id: 'github:5101', ghe_user_id: 1 },
    ];
    const { run, out, err } = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester', '--apply'], { '/in.json': JSON.stringify(entries) });
    expect(await run).toBe(2);
    const plan = out.join('\n');
    for (const reason of ['user_already_bound', 'subject_bound_to_other_user', 'duplicate_subject_in_file', 'ghe_user_id_mismatch']) {
      expect(plan).toContain(reason);
    }
    expect(err.join('\n')).toContain('아무것도 쓰지 않는다');
    expect(await count('pipe_integration_identity_binding')).toBe(before);
  });

  it('충돌이 없으면 --apply가 쓰고 행위 주체와 참조를 남기며 변경 이벤트를 기록한다', async () => {
    await h.pool.query(`DELETE FROM pipe_integration_identity_binding WHERE subject = $1`, [OPERATOR.subject]);
    const { run } = cli(['bindings', 'import', '--file', '/in.json', '--actor', 'tester', '--apply'], { '/in.json': JSON.stringify([good]) });
    expect(await run).toBe(0);
    const row = await pipeIntegrationRepo.findBindingBySubject(h.pool, ISSUER, 'pipe-user-new');
    expect(row).toMatchObject({ prs_user_id: OPERATOR.userId, status: 'active', binding_version: 1, verified_by: 'prsctl:tester', verification_reference: 'HR-1234' });
    const { rows } = await h.pool.query<{ actor: string; event_type: string }>(`SELECT actor, event_type FROM pipe_integration_event WHERE event_type = 'binding.import'`);
    expect(rows).toEqual([{ actor: 'prsctl:tester', event_type: 'binding.import' }]);
  });

  it('행위 주체 없이는 바꾸지 않는다', async () => {
    const { run } = cli(['bindings', 'import', '--file', '/in.json', '--apply'], { '/in.json': JSON.stringify([good]) });
    expect(await run).toBe(2);
  });
});
