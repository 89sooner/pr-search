/**
 * WP-100 FR-SEQ-012 AC-11 — M 번호 태그를 Git revision으로 쓸 수 있는가.
 *
 * 사내 보고의 요청 6이 나열한 명령(`rev-parse`·`show`·`log a..b`·`diff a..b`·`checkout`·
 * `log --decorate`·`describe --tags`)을 **실제 git 저장소**에서 돌린다. 원격 GHE는 가짜(HTTP)이므로
 * 이 시험은 두 단계로 정직하게 잇는다: (1) 태그 work가 가짜 GHE에 만든 ref(이름·SHA)를 기록하고,
 * (2) **그 이름·SHA를 그대로** 실제 저장소에 `git update-ref refs/tags/<name> <sha>`로 적용한다.
 * lightweight 태그는 ref 하나라 GHE가 만든 것과 이 적용의 결과가 같은 객체이며, 그래서 (2) 뒤의
 * git 동작이 곧 원격에 태그가 있을 때의 동작이다. 태그 객체·서명·메시지는 없다.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, type Pool } from '@prs/db';
import { WriteGate } from '@prs/github';
import { TagClient, resolveTagConfig } from '@prs/github-tag';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import { generateTestKeyPair, startMockTagGhe, type MockTagGhe } from '../../../../packages/github-tag/testing/mock-tag-ghe.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { materializeTag, type TagDeps } from '../../src/mnumber-tag.js';
import { makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, type SquashFixture } from './squash-fixture.js';

const KEYS = generateTestKeyPair();
const REPOSITORY_ID = 90_771;
const OWNER = 'wp100git';
const NAME = 'smp1900';
const BRANCH = 'main';
const EPOCH = 1;

let pool: Pool;
let origin: SquashFixture;
let mock: MockTagGhe | undefined;
let cloneDir: string | undefined;

/** 손으로 선언한 기대값: squash PR → M 번호 (squash-fixture의 A=1, B=2, C=3, E=4). */
const EXPECTED: readonly { pr: number; seq: number; m: number }[] = [
  { pr: 21, seq: 2, m: 1 },
  { pr: 25, seq: 4, m: 2 },
  { pr: 27, seq: 5, m: 3 },
  { pr: 29, seq: 6, m: 4 },
];

function depsFor(ghe: MockTagGhe): TagDeps {
  const config = resolveTagConfig({
    MNUMBER_TAG_ENABLED: 'true',
    GHE_API_URL: ghe.apiUrl,
    GHE_TAG_APP_ID: '99002',
    GHE_TAG_PRIVATE_KEY: KEYS.privateKey,
    GHE_TAG_INSTALLATIONS: `${OWNER}:5151`,
    GHE_TAG_REQUEST_TIMEOUT_MS: '2000',
  });
  return { pool, config, metrics: createWorkerMetrics(), client: new TagClient({ config }), sleep: async () => {}, log: () => {}, gate: new WriteGate({ spacingMs: 1_000 }) };
}

beforeAll(async () => {
  pool = await migratedPool();
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM sequence_work WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query(`DELETE FROM audit_record WHERE user_id = 'system:tag'`);
  origin = await createSquashFixture();
  await repositoryRepo.upsertRepository(pool, { repository_id: REPOSITORY_ID, owner: OWNER, name: NAME, org_id: 911, visibility: 'internal', sequence_branches: [BRANCH] });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  // 정본: 체인 서수 1..6 중 squash 커밋 넷이 번호를 받았다. 값은 손으로 선언한 기대값이다.
  for (let index = 0; index < origin.chain.length; index += 1) {
    const seq = index + 1;
    const numbered = EXPECTED.find((one) => one.seq === seq);
    await pool.query(
      `INSERT INTO merge_sequence (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at, merge_number)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [REPOSITORY_ID, BRANCH, EPOCH, seq, origin.chain[index], numbered?.pr ?? null, numbered?.m ?? null],
    );
  }
}, 60_000);

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  if (cloneDir !== undefined) await removeDir(cloneDir);
  cloneDir = undefined;
  await removeDir(origin.dir);
});

afterAll(async () => {
  await pool?.query('DELETE FROM sequence_work WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query(`DELETE FROM audit_record WHERE user_id = 'system:tag'`);
  await pool?.end();
});

/** 태그 work를 돌려 가짜 GHE가 받은 ref를 실제 저장소에 적용한다. */
async function materializeAll(): Promise<Map<string, string>> {
  mock = await startMockTagGhe({ knownShas: [...origin.chain] });
  const deps = depsFor(mock);
  for (const one of EXPECTED) {
    const work = await sequenceWorkRepo.requestWork(pool, { kind: 'tag', repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: EPOCH, keyExtra: [one.pr], payload: { pr_number: one.pr } });
    expect((await materializeTag(deps, work)).result).toBe('created');
  }
  const applied = new Map<string, string>();
  for (const [name, ref] of mock.refs()) {
    expect(ref.type).toBe('commit');
    await run(origin.dir, ['update-ref', `refs/tags/${name}`, ref.sha]);
    applied.set(name, ref.sha);
  }
  return applied;
}

describe('M 번호 태그는 Git revision이다 (AC-11)', () => {
  it('태그가 squash 머지 커밋을 가리키고 `rev-parse`·`show`가 그것을 돌려준다', async () => {
    const tags = await materializeAll();
    expect([...tags.keys()].sort()).toEqual(['M-1900-1', 'M-1900-2', 'M-1900-3', 'M-1900-4']);
    for (const one of EXPECTED) {
      const sha = origin.squash.get(one.pr) as string;
      expect(tags.get(`M-1900-${String(one.m)}`)).toBe(sha);
      expect((await run(origin.dir, ['rev-parse', `M-1900-${String(one.m)}`])).trim()).toBe(sha);
      expect((await run(origin.dir, ['show', '-s', '--format=%H', `M-1900-${String(one.m)}`])).trim()).toBe(sha);
    }
    // lightweight다 — 태그 객체가 없다.
    expect((await run(origin.dir, ['cat-file', '-t', 'M-1900-1'])).trim()).toBe('commit');
  });

  it('`log M-a..M-b`·`diff M-a..M-b`가 두 번호 사이의 first-parent 구간을 준다', async () => {
    await materializeAll();
    // M-2(seq 4, B)와 M-4(seq 6, E) 사이: seq 5(C)·seq 6(E).
    const log = (await run(origin.dir, ['log', '--format=%H', 'M-1900-2..M-1900-4'])).trim().split('\n');
    expect(log).toEqual([origin.chain[5], origin.chain[4]]);
    const diff = await run(origin.dir, ['diff', '--stat', 'M-1900-2..M-1900-4']);
    expect(diff).toContain('|');
    expect(diff).toMatch(/\d+ files? changed/);
  });

  it('`describe --tags`가 가장 가까운 M 태그를 말한다 — 직접 푸시 커밋도 앞선 번호로 설명된다', async () => {
    await materializeAll();
    expect((await run(origin.dir, ['describe', '--tags', origin.squash.get(29) as string])).trim()).toBe('M-1900-4');
    // seq 3(직접 푸시 D)은 M-1900-1(seq 2) 바로 다음이다.
    expect((await run(origin.dir, ['describe', '--tags', origin.directSha])).trim()).toMatch(/^M-1900-1-1-g[0-9a-f]+$/);
  });

  it('클론에서 `checkout M-…`이 되고 `log --oneline --decorate`에 태그가 보인다', async () => {
    await materializeAll();
    cloneDir = await makeTempDir('prs-tag-clone-');
    await run(cloneDir, ['clone', '-q', origin.dir, '.']);
    await run(cloneDir, ['checkout', '-q', 'M-1900-2']);
    expect((await run(cloneDir, ['rev-parse', 'HEAD'])).trim()).toBe(origin.squash.get(25) as string);
    const decorated = await run(cloneDir, ['log', '--oneline', '--decorate', '-1']);
    expect(decorated).toContain('tag: M-1900-2');
  });

  it('가짜 GHE가 받은 요청은 조회와 생성뿐이다 — 이동·삭제는 없다', async () => {
    await materializeAll();
    const methods = new Set((mock as MockTagGhe).requests.filter((one) => !one.path.includes('/access_tokens')).map((one) => `${one.method} ${one.path.replace(/\/M-1900-\d+$/, '/M-…')}`));
    expect([...methods].sort()).toEqual(['GET /api/v3/repos/wp100git/smp1900/git/ref/tags/M-…', 'POST /api/v3/repos/wp100git/smp1900/git/refs']);
  });
});
