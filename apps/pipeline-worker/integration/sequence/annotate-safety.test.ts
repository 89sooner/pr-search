/**
 * 표기 안전성 보강을 실제 PostgreSQL로 잰다 (WP-075 안전성 보강).
 *
 * ## 여기서만 잴 수 있는 것
 *
 * - 마이그레이션 027이 만든 상태값과 근거 열이 **실제 제약을 통과하는가**
 * - `body_changed`가 대상 질의에서 빠지고 `unknown`은 들어오는가 — SQL 자체의 문제다
 * - 실행자 배제가 **다른 세션·다른 프로세스**를 실제로 막는가
 *
 * 마지막 항목은 대역으로 대신할 수 없다. advisory lock이 배제하는 단위는 함수
 * 호출이 아니라 **데이터베이스 세션**이므로, 같은 프로세스에서 함수를 두 번 부르는
 * 시험은 그 경계를 한 번도 지나지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/annotate-safety`
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  annotateRunnerLockKey,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  releaseAdvisorySessionLock,
  tryAdvisorySessionLock,
  type Pool,
} from '@prs/db';
import { AnnotateClient, resolveAnnotateConfig } from '@prs/github-annotate';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import {
  generateTestKeyPair,
  startMockAnnotateGhe,
  type MockAnnotateGhe,
} from '../../../../packages/github-annotate/testing/mock-annotate-ghe.js';
import { runAnnotationPass, type AnnotateDeps } from '../../src/annotate.js';
import { createWorkerMetrics } from '../../src/metrics.js';

const KEYS = generateTestKeyPair();
const REPOSITORY_ID = 90_761;
/*
 * `(owner, name)`은 전역 유일이고 통합 시험은 DB 하나를 공유한다. 소유자를 이 파일
 * 전용으로 둔다 — 이름을 `smp1900`으로 유지하는 것은 저장소 **코드**가 이름에서만
 * 나오기 때문이다 (`OD-009`).
 */
const OWNER = 'wp075safety';
const NAME = 'smp1900';
const BRANCH = 'main';
const EPOCH = 3;

let pool: Pool;
let mock: MockAnnotateGhe | undefined;

async function seedRepository(): Promise<void> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 9_076,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  await pool.query('UPDATE sequence_space SET seq_epoch = $3 WHERE repository_id = $1 AND base_branch = $2', [
    REPOSITORY_ID,
    BRANCH,
    EPOCH,
  ]);
}

async function seedRow(options: {
  mergeSeq: number;
  pullRequestNumber: number;
  mergeNumber: number;
  annotateState?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number,
        committed_at, merge_number, annotate_state)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)`,
    [
      REPOSITORY_ID,
      BRANCH,
      EPOCH,
      options.mergeSeq,
      options.mergeSeq.toString(16).padStart(40, 'a'),
      options.pullRequestNumber,
      options.mergeNumber,
      options.annotateState ?? null,
    ],
  );
}

function depsFor(): AnnotateDeps {
  const config = resolveAnnotateConfig({
    MNUMBER_ANNOTATE_ENABLED: 'true',
    GHE_API_URL: (mock as MockAnnotateGhe).apiUrl,
    GHE_ANNOTATE_APP_ID: '77001',
    GHE_ANNOTATE_PRIVATE_KEY: KEYS.privateKey,
    GHE_ANNOTATE_INSTALLATIONS: `${OWNER}:5150`,
    GHE_ANNOTATE_REQUEST_TIMEOUT_MS: '2000',
  });
  return {
    pool,
    bus: undefined as never,
    config,
    metrics: createWorkerMetrics(),
    sleep: async () => {},
    log: () => {},
    client: new AnnotateClient({ config }),
  };
}

beforeEach(async () => {
  pool = await migratedPool();
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await seedRepository();
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

afterAll(async () => {
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.end();
});

describe('마이그레이션 027 — 결과의 확실성을 담는 열', () => {
  it('새 상태값과 근거를 함께 저장한다', async () => {
    await seedRow({ mergeSeq: 10, pullRequestNumber: 1234, mergeNumber: 1 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 10 };

    await mergeSequenceRepo.markAnnotateState(pool, key, 'body_changed', {
      attemptId: '11111111-1111-4111-8111-111111111111',
      expectedDigest: 'abcdef0123456789',
      reason: 'title_body_changed',
    });

    const row = await pool.query<{
      annotate_state: string;
      annotate_attempt_id: string;
      annotate_expected_digest: string;
      annotate_result_reason: string;
    }>(
      `SELECT annotate_state, annotate_attempt_id, annotate_expected_digest, annotate_result_reason
         FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 10`,
      [REPOSITORY_ID],
    );
    expect(row.rows[0]?.annotate_state).toBe('body_changed');
    expect(row.rows[0]?.annotate_attempt_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(row.rows[0]?.annotate_expected_digest).toBe('abcdef0123456789');
    expect(row.rows[0]?.annotate_result_reason).toBe('title_body_changed');
  });

  it('지문이 16자를 넘으면 제약이 막는다 — 제목 원문이 흘러들지 않는다', async () => {
    await seedRow({ mergeSeq: 11, pullRequestNumber: 1235, mergeNumber: 2 });
    await expect(
      pool.query(
        `UPDATE merge_sequence SET annotate_expected_digest = $1
          WHERE repository_id = $2 AND merge_seq = 11`,
        ['이 자리에 제목 원문을 넣으려 하면 길이 제약이 막는다', REPOSITORY_ID],
      ),
    ).rejects.toThrow();
  });

  it('근거를 주지 않으면 옛 사유가 남지 않는다', async () => {
    await seedRow({ mergeSeq: 12, pullRequestNumber: 1236, mergeNumber: 3 });
    const key = { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, mergeSeq: 12 };
    await mergeSequenceRepo.markAnnotateState(pool, key, 'failed', { reason: 'server' });
    await mergeSequenceRepo.markAnnotateState(pool, key, 'done');

    const row = await pool.query<{ annotate_result_reason: string | null }>(
      'SELECT annotate_result_reason FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 12',
      [REPOSITORY_ID],
    );
    expect(row.rows[0]?.annotate_result_reason).toBeNull();
  });
});

describe('대상 질의 — 무엇을 다시 보고 무엇을 보지 않는가', () => {
  it('`unknown`은 다시 본다 — 보냈는지조차 모르는 행이라 확인이 필요하다', async () => {
    await seedRow({ mergeSeq: 20, pullRequestNumber: 1240, mergeNumber: 1, annotateState: 'unknown' });
    const targets = await mergeSequenceRepo.listAnnotateTargets(pool, {
      limit: 10,
      repositoryId: REPOSITORY_ID,
    });
    expect(targets.map((row) => row.merge_seq)).toEqual([20]);
  });

  it('**`body_changed`는 보지 않는다** — 자동 재시도가 확인된 차이를 덮는다', async () => {
    await seedRow({ mergeSeq: 21, pullRequestNumber: 1241, mergeNumber: 1, annotateState: 'body_changed' });
    const targets = await mergeSequenceRepo.listAnnotateTargets(pool, {
      limit: 10,
      repositoryId: REPOSITORY_ID,
    });
    expect(targets).toHaveLength(0);
  });

  it('운영자가 재개하면 다시 대상이 된다', async () => {
    await seedRow({ mergeSeq: 22, pullRequestNumber: 1242, mergeNumber: 1, annotateState: 'body_changed' });
    await seedRow({ mergeSeq: 23, pullRequestNumber: 1243, mergeNumber: 2, annotateState: 'mismatch' });

    const reopened = await mergeSequenceRepo.resumeAnnotateTargets(pool, REPOSITORY_ID);

    expect(reopened).toBe(1);
    const targets = await mergeSequenceRepo.listAnnotateTargets(pool, {
      limit: 10,
      repositoryId: REPOSITORY_ID,
    });
    // `mismatch`는 열지 않는다 — 그것은 남의 접두를 지키는 상태이지 멈춘 상태가 아니다.
    expect(targets.map((row) => row.merge_seq)).toEqual([22]);
  });
});

describe('사전 점검 집계 — 켜기 전에 무엇이 몇 건인가', () => {
  it('상태별로 세고 번호 없는 행을 따로 센다', async () => {
    await seedRow({ mergeSeq: 30, pullRequestNumber: 1250, mergeNumber: 1 });
    await seedRow({ mergeSeq: 31, pullRequestNumber: 1251, mergeNumber: 2, annotateState: 'done' });
    await seedRow({ mergeSeq: 32, pullRequestNumber: 1252, mergeNumber: 3, annotateState: 'body_changed' });
    await seedRow({ mergeSeq: 33, pullRequestNumber: 1253, mergeNumber: 4, annotateState: 'unknown' });
    await pool.query(
      `INSERT INTO merge_sequence
         (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
       VALUES ($1, $2, $3, 34, $4, 1254, now())`,
      [REPOSITORY_ID, BRANCH, EPOCH, 'b'.repeat(40)],
    );

    const counts = await mergeSequenceRepo.countAnnotateReadiness(pool, REPOSITORY_ID, BRANCH);

    expect(counts.numbered).toBe(4);
    expect(counts.pending).toBe(1);
    expect(counts.done).toBe(1);
    expect(counts.body_changed).toBe(1);
    expect(counts.unknown).toBe(1);
    expect(counts.unnumbered).toBe(1);
  });
});

describe('실행자 배제 — 다른 세션·다른 프로세스를 실제로 막는다 (DEV-629)', () => {
  it('다른 세션이 락을 쥐고 있으면 회차가 아무것도 쓰지 않는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    await seedRow({ mergeSeq: 40, pullRequestNumber: 1260, mergeNumber: 1 });

    // **다른 세션**이다. 같은 풀에서 빌렸어도 advisory lock이 보는 단위는 세션이다.
    const holder = await pool.connect();
    try {
      const locked = await tryAdvisorySessionLock(holder, annotateRunnerLockKey());
      expect(locked).toBe(true);

      const summary = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });

      expect(summary.notRunner).toBe(true);
      expect(mock.requests).toHaveLength(0);
      const row = await pool.query<{ annotate_state: string | null }>(
        'SELECT annotate_state FROM merge_sequence WHERE repository_id = $1 AND merge_seq = 40',
        [REPOSITORY_ID],
      );
      expect(row.rows[0]?.annotate_state).toBeNull();
    } finally {
      await releaseAdvisorySessionLock(holder, annotateRunnerLockKey());
      holder.release();
    }
  });

  it('락을 쥔 세션이 사라지면 다음 실행자가 이어받는다', async () => {
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    await seedRow({ mergeSeq: 41, pullRequestNumber: 1261, mergeNumber: 1 });

    const holder = await pool.connect();
    await tryAdvisorySessionLock(holder, annotateRunnerLockKey());
    // 정상 종료가 아니라 **연결을 버린다.** 죽은 프로세스가 남긴 상태와 같다.
    holder.release(true);

    const summary = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });

    expect(summary.notRunner).toBeUndefined();
    expect(summary.results['updated']).toBe(1);
    expect(mock.currentTitle()).toBe('[M-1900-1] 제목');
  });

  it('**다른 프로세스**가 락을 쥐고 있어도 막힌다', async () => {
    /*
     * 같은 프로세스의 다른 커넥션으로도 배제는 증명되지만, 이 잡이 막으려는 것은
     * 「파드가 둘 뜨는 것」이다. 실제로 다른 Node 프로세스를 띄워 같은 키를 잡게 하고,
     * 그동안 이쪽 회차가 아무것도 쓰지 않는지 본다.
     */
    mock = await startMockAnnotateGhe({ initialTitle: '제목' });
    await seedRow({ mergeSeq: 42, pullRequestNumber: 1262, mergeNumber: 1 });

    /*
     * `-e`로 띄운 프로세스는 **모듈을 cwd 기준으로 찾는다.** pnpm 배치에서는 그것이
     * 어긋나므로 여기서 실제 경로를 풀어 넘긴다 — 자식이 조용히 죽어 시험이
     * 시간 초과로만 실패하는 자리다.
     */
    const pgEntry = pathToFileURL(
      createRequire(new URL('../../../../packages/db/package.json', import.meta.url)).resolve('pg'),
    ).href;
    const script = `
      import pg from ${JSON.stringify(pgEntry)};
      const client = new pg.Client({ connectionString: process.env.PRS_TEST_DSN });
      await client.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [process.env.PRS_LOCK_KEY]);
      process.stdout.write(rows[0].locked ? 'LOCKED\\n' : 'BUSY\\n');
      await new Promise((resolve) => { process.on('SIGTERM', resolve); });
      await client.end();
    `;
    const dsn = await currentDsn();
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, PRS_TEST_DSN: dsn, PRS_LOCK_KEY: annotateRunnerLockKey() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childStderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      childStderr += chunk.toString('utf8');
    });
    try {
      const held = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('자식 프로세스가 락을 보고하지 않았다')), 15_000);
        child.stdout.on('data', (chunk: Buffer) => {
          clearTimeout(timer);
          resolve(chunk.toString('utf8').trim());
        });
        child.on('error', reject);
        // 보고하기 전에 죽으면 그 사실과 이유를 그대로 드러낸다.
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`자식 프로세스가 ${String(code)}로 먼저 끝났다: ${childStderr.trim()}`));
        });
      });
      expect(held).toBe('LOCKED');

      const summary = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });

      expect(summary.notRunner).toBe(true);
      expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
    } finally {
      // **이미 죽었으면 기다리지 않는다.** 끝난 프로세스의 `exit`는 다시 오지 않는다.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child.on('exit', () => resolve()));
      }
    }

    // 그 프로세스가 사라지면 이쪽이 이어받는다.
    const after = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });
    expect(after.results['updated']).toBe(1);
  }, 40_000);
});

describe('실제 SQL + 실제 HTTP — 재시도가 최신 상태를 다시 본다', () => {
  it('첫 PATCH가 실패한 뒤 사람이 고친 제목을 덮지 않는다', async () => {
    let patchSeen = 0;
    mock = await startMockAnnotateGhe({
      initialTitle: '원래 제목',
      patchScript: [{ status: 500, body: { message: 'boom' } }],
      onRequest: (request, control) => {
        if (request.method !== 'PATCH') return;
        patchSeen += 1;
        if (patchSeen === 1) control.setTitle('사람이 고친 제목');
      },
    });
    await seedRow({ mergeSeq: 50, pullRequestNumber: 1270, mergeNumber: 1 });

    const summary = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });

    expect(summary.results['updated']).toBe(1);
    expect(mock.currentTitle()).toBe('[M-1900-1] 사람이 고친 제목');
  });

  it('응답 본문이 바뀌면 `body_changed`로 남고 다음 회차가 건드리지 않는다', async () => {
    mock = await startMockAnnotateGhe({
      initialTitle: '아주 긴 원래 제목이 여기에 있다',
      patchScript: [{ status: 200, body: { number: 1271, title: '[M-1900-1] 아주 긴' } }],
    });
    await seedRow({ mergeSeq: 51, pullRequestNumber: 1271, mergeNumber: 1 });

    const first = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });
    expect(first.results['body_changed']).toBe(1);

    const stored = await pool.query<{ annotate_state: string; annotate_result_reason: string }>(
      `SELECT annotate_state, annotate_result_reason FROM merge_sequence
        WHERE repository_id = $1 AND merge_seq = 51`,
      [REPOSITORY_ID],
    );
    expect(stored.rows[0]?.annotate_state).toBe('body_changed');
    expect(stored.rows[0]?.annotate_result_reason).toBe('title_body_changed');

    // 다음 회차는 이 행을 아예 보지 않는다 — 요청이 한 건도 늘지 않는다.
    const requestsBefore = mock.requests.length;
    const second = await runAnnotationPass(depsFor(), { limit: 10, repositoryId: REPOSITORY_ID });
    expect(second.processed).toBe(0);
    expect(mock.requests).toHaveLength(requestsBefore);
  });
});

/**
 * 시험 풀이 붙은 DB의 DSN. 자식 프로세스가 **같은 DB**를 봐야 락이 겨뤄진다.
 *
 * 서버에 묻지 않고 이 프로세스의 접속 설정에서 만든다 — `inet_server_port()`는
 * 유닉스 소켓 연결에서 비어 있고, 그 빈 값으로 만든 DSN은 자식을 조용히 죽인다.
 */
async function currentDsn(): Promise<string> {
  const row = await pool.query<{ db: string; usr: string }>(
    'SELECT current_database() AS db, current_user AS usr',
  );
  const info = row.rows[0];
  const url = process.env['DATABASE_URL'];
  if (url !== undefined && url !== '') return url;
  const host = process.env['POSTGRES_HOST'] ?? 'localhost';
  const port = process.env['POSTGRES_PORT'] ?? '5432';
  const password = process.env['POSTGRES_PASSWORD'] ?? 'prs';
  return `postgres://${String(info?.usr)}:${password}@${host}:${port}/${String(info?.db)}`;
}
