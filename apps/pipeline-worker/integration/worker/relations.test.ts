/**
 * 되돌림·체리픽·스택 간선 파생 (WP-030 / CR-041, JOB-REL-002·003·004).
 *
 * **실제 PostgreSQL · 실제 Elasticsearch를 쓴다.** 이 WP가 증명해야 할 것 대부분이
 * 그 둘의 동작 그 자체다:
 *
 * - "후보가 나중에 나타나도 관계가 수렴한다"는 **source 이벤트 없이** 색인이
 *   바뀌는지로만 증명된다 (DEV-242)
 * - "상위 PR이 머지되면 해제된다"는 **하위 PR에 이벤트를 주지 않고** 확인해야
 *   의미가 있다 (DEV-232)
 * - "요약 boolean이 active 집합에서 재계산된다"는 **남은 간선이 있을 때**만
 *   드러난다 (DEV-241)
 * - "상위 5건이 재실행에도 같다"는 두 번 돌려 **문서 ID 집합을 비교**해야 한다
 *
 * 검증: `pnpm run test:integration worker/relations`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { EVENT_NAMES, commitDocId, pullRequestDocId } from '@prs/domain';
import {
  commitSnapshotRepo,
  prSnapshotRepo,
  repositoryRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { SERVING_ONLY, applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';

import { handleLinkEvent, handleSourceReady, runReferenceRebuild, type LinkDeps } from '../../src/link.js';
import { deriveRelations, handleRelationsReady } from '../../src/relations.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4801;
const OTHER_ID = 4802;
const OWNER = 'acme';
const NAME = 'rel-wp030';
const OTHER_NAME = 'rel-wp030-other';
const TEAM = 7301;

let pool: Pool;
let es: Client;
let repository: RepositoryRow;

function deps(overrides: Partial<LinkDeps> = {}): LinkDeps {
  return {
    pool,
    es,
    bus: { publish: () => Promise.resolve() } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    gheHost: 'https://ghe.acme.example',
    log: () => undefined,
    refresh: true,
    ...overrides,
  };
}

/**
 * 시험용 40자 SHA.
 *
 * **hex만 받는다.** 파서는 `[0-9a-f]{40}`을 요구하므로 `z` 같은 글자가 섞이면
 * 트레일러가 조용히 매칭되지 않고, 그러면 시험이 "간선이 없다"를 통과시킨다 —
 * 실제로 이 시험에서 한 번 그렇게 새 케이스가 헛돌았다. 여기서 막는다.
 */
function sha(seed: string): string {
  if (!/^[0-9a-f]+$/.test(seed)) throw new Error(`hex가 아닌 시험용 SHA seed: ${seed}`);
  return seed.padEnd(40, '0').slice(0, 40);
}

async function seedCommit(
  input: {
    readonly sha: string;
    readonly message: string;
    readonly committedAt?: string;
    readonly patchId?: string | null;
    readonly repositoryId?: number;
  },
): Promise<void> {
  const at = new Date(input.committedAt ?? '2026-08-01T00:00:00.000Z');
  await commitSnapshotRepo.upsertCommitSnapshot(pool, {
    repositoryId: input.repositoryId ?? REPOSITORY_ID,
    commitSha: input.sha,
    parentShas: [],
    message: input.message,
    author: 'dev',
    committer: 'dev',
    authoredAt: at,
    committedAt: at,
    changedPaths: [],
    changedPathsTruncated: false,
    patchId: input.patchId ?? null,
    // 값이 없으면 **시도하지 않았다**는 사유를 남긴다 — `compute_failed`와 다르다.
    patchIdUnavailable: input.patchId === undefined || input.patchId === null ? 'no_mirror' : null,
    metadataSource: 'mirror',
  });
}

async function seedPullRequest(input: {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: string;
  readonly base?: string;
  readonly head?: string;
  readonly repositoryId?: number;
}): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: input.repositoryId ?? REPOSITORY_ID,
    prNumber: input.number,
    documentVersion: Date.now(),
    source: 'webhook',
    document: {
      pr_number: input.number,
      title: input.title ?? '',
      body: input.body ?? '',
      state: input.state ?? 'open',
      base_branch: input.base ?? 'main',
      head_branch: input.head ?? `feature-${String(input.number)}`,
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  });
}

/** 색인 문서. 요약 leaf가 실제로 쓰이는지 보려면 문서가 있어야 한다. */
async function indexPullRequest(prNumber: number, referenceCount = 3): Promise<void> {
  await es.index({
    index: 'prs-pull-requests',
    id: pullRequestDocId(REPOSITORY_ID, prNumber),
    routing: String(REPOSITORY_ID),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: REPOSITORY_ID,
      repository: `${OWNER}/${NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      pr_number: prNumber,
      links_pending: false,
      link_summary: { reference_count: referenceCount },
    },
  });
}

async function indexCommit(commitSha: string): Promise<void> {
  await es.index({
    index: 'prs-commits',
    id: commitDocId(REPOSITORY_ID, commitSha),
    routing: String(REPOSITORY_ID),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: REPOSITORY_ID,
      repository: `${OWNER}/${NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      commit_sha: commitSha,
      role: 'direct_push',
    },
  });
}

/** **내 저장소의 간선만** 센다. 공유 ES에서 전역 질의는 오답이다. */
async function links(filter: {
  readonly fromId?: string;
  readonly toId?: string;
  readonly linkType?: string;
}): Promise<readonly Record<string, unknown>[]> {
  await es.indices.refresh({ index: 'prs-links' });
  const must: Record<string, unknown>[] = [{ term: { repository_id: REPOSITORY_ID } }];
  if (filter.fromId !== undefined) must.push({ term: { from_id: filter.fromId } });
  if (filter.toId !== undefined) must.push({ term: { to_id: filter.toId } });
  if (filter.linkType !== undefined) must.push({ term: { link_type: filter.linkType } });
  const response = await es.search<Record<string, unknown>>({
    index: 'prs-links',
    size: 200,
    sort: [{ link_id: 'asc' }],
    query: { bool: { filter: must } },
  });
  return response.hits.hits.map((hit) => ({ _id: hit._id, ...hit._source }));
}

async function prDoc(prNumber: number): Promise<Record<string, unknown>> {
  await es.indices.refresh({ index: 'prs-pull-requests' });
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-pull-requests',
    id: pullRequestDocId(REPOSITORY_ID, prNumber),
    routing: String(REPOSITORY_ID),
  });
  return response._source ?? {};
}

/** 간선 쓰기(`index` 연산)만 항목 수준에서 실패시킨다. */
function withIndexItemFailure(inner: Client): Client {
  return {
    bulk: (params: { readonly operations?: readonly unknown[] }) => {
      const ops = params.operations ?? [];
      const isIndex = ops.some((one) => typeof one === 'object' && one !== null && 'index' in one);
      if (!isIndex) return inner.bulk(params as never);
      return Promise.resolve({ items: [{ index: { _id: 'x', status: 500, error: { type: 'internal' } } }] });
    },
    msearch: (params: unknown) => inner.msearch(params as never),
    search: (params: unknown) => inner.search(params as never),
    update: (params: unknown) => inner.update(params as never),
    get: (params: unknown) => inner.get(params as never),
    index: (params: unknown) => inner.index(params as never),
    deleteByQuery: (params: unknown) => inner.deleteByQuery(params as never),
    indices: inner.indices,
  } as unknown as Client;
}

const prSource = (n: number) => ({ kind: 'pull_request' as const, id: String(n) });
const commitSource = (s: string) => ({ kind: 'commit' as const, id: s });

describe('되돌림·체리픽·스택 파생 (WP-030 / CR-041)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
    await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);
  }, 180_000);

  afterAll(async () => {
    await es?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    for (const id of [REPOSITORY_ID, OTHER_ID]) {
      await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [id]);
      // 스택의 정본 (CR-121). 남으면 다음 시험의 하위 PR이 앞 시험의 관계를 해제 간선으로 물려받는다.
      await pool.query('DELETE FROM pull_request_stack WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM repository WHERE repository_id = $1', [id]);
    }
    for (const [id, name] of [
      [REPOSITORY_ID, NAME],
      [OTHER_ID, OTHER_NAME],
    ] as const) {
      await repositoryRepo.upsertRepository(pool, {
        repository_id: id,
        owner: OWNER,
        name,
        org_id: 1,
        visibility: 'private',
        sequence_branches: ['main'],
        mirror_enabled: false,
        status: 'active',
      });
      await repositoryRepo.setAllowedTeams(pool, id, [TEAM]);
    }
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;

    // 내 저장소 범위만 지운다. `delete_by_query`는 검색으로 찾으므로 앞에서 refresh.
    for (const index of ['prs-links', 'prs-pull-requests', 'prs-commits']) {
      await es.indices.refresh({ index });
      await es.deleteByQuery({
        index,
        refresh: true,
        conflicts: 'proceed',
        query: { terms: { repository_id: [REPOSITORY_ID, OTHER_ID] } },
      });
    }
  }, 60_000);

  /* --------------------------------------------------------------------- */
  /* 되돌림                                                                  */
  /* --------------------------------------------------------------------- */

  it('트레일러가 exact 간선이 되고 방향은 주체 → 대상이다 (AC-1·AC-2·AC-3)', async () => {
    const target = sha('a1');
    const reverter = sha('a2');
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `Revert "fix login"\n\nThis reverts commit ${target}` });

    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    const exact = found.filter((one) => one['confidence'] === 'exact');
    expect(exact).toHaveLength(1);
    expect(exact[0]!['to_id']).toBe(commitDocId(REPOSITORY_ID, target));
    expect(exact[0]!['resolved']).toBe(true);
  });

  it('대상 정본이 아직 없으면 **끝점은 정하고 resolved: false**로 저장한다', async () => {
    const reverter = sha('b2');
    await seedCommit({ sha: reverter, message: `This reverts commit ${sha('b1')}` });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(found).toHaveLength(1);
    expect(found[0]!['resolved']).toBe(false);
  });

  it('대상이 나중에 생기면 **같은 link_id가 갱신된다** — 새 문서가 아니다', async () => {
    const target = sha('c1');
    const reverter = sha('c2');
    await seedCommit({ sha: reverter, message: `This reverts commit ${target}` });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    const before = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });

    await seedCommit({ sha: target, message: 'fix login' });
    await handleRelationsReady(deps(), repository, commitSource(target), SERVING_ONLY);

    const after = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(after).toHaveLength(1);
    expect(after[0]!['_id']).toBe(before[0]!['_id']);
    expect(after[0]!['resolved']).toBe(true);
  });

  it('제목 후보가 2건이면 **둘 다 저장한다** — 하나를 고르지 않는다 (DEV-237)', async () => {
    const reverter = sha('d9');
    await seedPullRequest({ number: 11, title: 'fix login' });
    await seedPullRequest({ number: 12, title: 'fix login' });
    await seedCommit({ sha: reverter, message: 'Revert "fix login"' });

    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(found).toHaveLength(2);
    expect(found.every((one) => one['confidence'] === 'heuristic')).toBe(true);
    expect(new Set(found.map((one) => one['to_id']))).toEqual(
      new Set([pullRequestDocId(REPOSITORY_ID, 11), pullRequestDocId(REPOSITORY_ID, 12)]),
    );
  });

  it('**후보가 나중에 하나 더 생기면 source 이벤트 없이 간선이 둘이 된다** (DEV-242)', async () => {
    const reverter = sha('e9');
    await seedPullRequest({ number: 21, title: 'fix login' });
    await seedCommit({ sha: reverter, message: 'Revert "fix login"' });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(1);

    // 새 후보가 도착한다. **되돌림 커밋에는 아무 이벤트도 오지 않는다.**
    await seedPullRequest({ number: 22, title: 'fix login' });
    await handleRelationsReady(deps(), repository, prSource(22), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(2);
  });

  it('본문이 바뀌어 되돌림 표현이 사라지면 간선이 제거된다 (DEV-233)', async () => {
    const target = sha('f1');
    const reverter = sha('f2');
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${target}` });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(1);

    await seedCommit({ sha: reverter, message: 'unrelated work now' });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(0);
  });

  it('되돌림의 되돌림이 연쇄로 표현된다 — 전용 분기 없이 (AC-5)', async () => {
    const a = sha('1a');
    const b = sha('1b');
    const c = sha('1c');
    await seedCommit({ sha: a, message: 'feature' });
    await seedCommit({ sha: b, message: `This reverts commit ${a}` });
    await seedCommit({ sha: c, message: `This reverts commit ${b}` });

    await deriveRelations(deps(), repository, commitSource(b), SERVING_ONLY);
    await deriveRelations(deps(), repository, commitSource(c), SERVING_ONLY);

    expect((await links({ fromId: commitDocId(REPOSITORY_ID, b), linkType: 'reverts' }))[0]!['to_id']).toBe(
      commitDocId(REPOSITORY_ID, a),
    );
    expect((await links({ fromId: commitDocId(REPOSITORY_ID, c), linkType: 'reverts' }))[0]!['to_id']).toBe(
      commitDocId(REPOSITORY_ID, b),
    );
  });

  /* --------------------------------------------------------------------- */
  /* 체리픽                                                                  */
  /* --------------------------------------------------------------------- */

  it('트레일러는 **patch_id가 없어도** exact 간선을 만든다 (AC-1, DEV-235)', async () => {
    const origin = sha('2a');
    const copy = sha('2b');
    await seedCommit({ sha: origin, message: 'feature', patchId: null });
    await seedCommit({ sha: copy, message: `feature\n\n(cherry picked from commit ${origin})`, patchId: null });

    await deriveRelations(deps(), repository, commitSource(copy), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, copy), linkType: 'cherry_picks' });
    expect(found).toHaveLength(1);
    expect(found[0]!['confidence']).toBe('exact');
  });

  it('patch_id 일치가 derived로 저장되고 방향은 **나중 → 이른**이다 (AC-2, DEV-243)', async () => {
    const early = sha('3a');
    const late = sha('3b');
    await seedCommit({ sha: early, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'P1' });
    await seedCommit({ sha: late, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: 'P1' });

    await deriveRelations(deps(), repository, commitSource(late), SERVING_ONLY);
    await deriveRelations(deps(), repository, commitSource(early), SERVING_ONLY);

    const fromLate = await links({ fromId: commitDocId(REPOSITORY_ID, late), linkType: 'cherry_picks' });
    const fromEarly = await links({ fromId: commitDocId(REPOSITORY_ID, early), linkType: 'cherry_picks' });
    expect(fromLate).toHaveLength(1);
    expect(fromLate[0]!['confidence']).toBe('derived');
    expect(fromLate[0]!['to_id']).toBe(commitDocId(REPOSITORY_ID, early));
    // **미래 커밋을 원본 후보로 거꾸로 잇지 않는다.**
    expect(fromEarly).toHaveLength(0);
  });

  it('트레일러가 있으면 patch_id 경로를 돌지 않는다 — 두 간선이 생기지 않는다', async () => {
    const origin = sha('4a');
    const other = sha('4b');
    const copy = sha('4c');
    await seedCommit({ sha: origin, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'P2' });
    await seedCommit({ sha: other, message: 'feature', committedAt: '2026-08-02T00:00:00.000Z', patchId: 'P2' });
    await seedCommit({
      sha: copy,
      message: `feature\n\n(cherry picked from commit ${origin})`,
      committedAt: '2026-08-09T00:00:00.000Z',
      patchId: 'P2',
    });

    await deriveRelations(deps(), repository, commitSource(copy), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, copy), linkType: 'cherry_picks' });
    expect(found).toHaveLength(1);
    expect(found[0]!['confidence']).toBe('exact');
  });

  it('**시도하지 않은 것에는 derived 판정을 하지 않는다** (blob_fetch_disabled, AC-5)', async () => {
    const early = sha('5a');
    const late = sha('5b');
    await seedCommit({ sha: early, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: null });
    await seedCommit({ sha: late, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: null });

    await deriveRelations(deps(), repository, commitSource(late), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, late), linkType: 'cherry_picks' })).toHaveLength(0);
  });

  it('**같은 patch_id라도 저장소가 다르면 간선을 만들지 않는다** (AC-3)', async () => {
    const mine = sha('6a');
    const theirs = sha('6b');
    await seedCommit({
      sha: theirs,
      message: 'feature',
      committedAt: '2026-08-01T00:00:00.000Z',
      patchId: 'P3',
      repositoryId: OTHER_ID,
    });
    await seedCommit({ sha: mine, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: 'P3' });

    await deriveRelations(deps(), repository, commitSource(mine), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, mine), linkType: 'cherry_picks' })).toHaveLength(0);
  });

  it('후보가 5건을 넘으면 상위 5건이고 **재실행에도 같은 5건**이다 (AC-4, DEV-243)', async () => {
    const self = sha('7f');
    for (let index = 1; index <= 8; index += 1) {
      await seedCommit({
        sha: sha(`7${String(index)}`),
        message: 'feature',
        committedAt: `2026-08-0${String(index)}T00:00:00.000Z`,
        patchId: 'P4',
      });
    }
    await seedCommit({ sha: self, message: 'feature', committedAt: '2026-08-20T00:00:00.000Z', patchId: 'P4' });

    await deriveRelations(deps(), repository, commitSource(self), SERVING_ONLY);
    const first = (await links({ fromId: commitDocId(REPOSITORY_ID, self), linkType: 'cherry_picks' })).map(
      (one) => one['to_id'],
    );
    await deriveRelations(deps(), repository, commitSource(self), SERVING_ONLY);
    const second = (await links({ fromId: commitDocId(REPOSITORY_ID, self), linkType: 'cherry_picks' })).map(
      (one) => one['to_id'],
    );

    expect(first).toHaveLength(5);
    // 재실행에도 **같은 5건**이다 — 비결정론이면 같은 정본에서 다른 색인이 나온다.
    expect(second).toEqual(first);
    /*
     * **고른 집합**을 단언한다. 조회 헬퍼는 `link_id` 순으로 정렬하므로 배열의
     * 순서는 선택 순서가 아니다 — 순서를 단언하면 정렬 방식을 단언하게 되고,
     * 그것은 이 규칙이 지키려는 것이 아니다.
     *
     * 시간상 가장 가까운 이전 후보 다섯이다 (08-08 ~ 08-04). 08-03 이전은 빠진다.
     */
    expect(new Set(first)).toEqual(
      new Set(['78', '77', '76', '75', '74'].map((seed) => commitDocId(REPOSITORY_ID, sha(seed)))),
    );
  });

  it('**같은 patch_id 커밋이 나중에 들어오면 source 이벤트 없이 간선이 생긴다** (DEV-242)', async () => {
    const early = sha('8a');
    const late = sha('8b');
    await seedCommit({ sha: late, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: 'P5' });
    await deriveRelations(deps(), repository, commitSource(late), SERVING_ONLY);
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, late), linkType: 'cherry_picks' })).toHaveLength(0);

    // 원본이 뒤늦게 도착한다. **사본에는 아무 이벤트도 오지 않는다.**
    await seedCommit({ sha: early, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'P5' });
    await handleRelationsReady(deps(), repository, commitSource(early), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, late), linkType: 'cherry_picks' })).toHaveLength(1);
  });

  /* --------------------------------------------------------------------- */
  /* 스택                                                                    */
  /* --------------------------------------------------------------------- */

  it('하위 → 상위 방향으로 derived 간선이 생긴다 (AC-1·AC-2)', async () => {
    await seedPullRequest({ number: 31, head: 'feature-a', base: 'main', state: 'open' });
    await seedPullRequest({ number: 32, head: 'feature-b', base: 'feature-a', state: 'open' });

    await deriveRelations(deps(), repository, prSource(32), SERVING_ONLY);

    const found = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 32), linkType: 'stacks_on' });
    expect(found).toHaveLength(1);
    expect(found[0]!['to_id']).toBe(pullRequestDocId(REPOSITORY_ID, 31));
    expect(found[0]!['confidence']).toBe('derived');
    expect(found[0]!['detached']).toBe(false);
  });

  it('같은 head를 가진 열린 PR이 둘이면 **둘 다 평가한다** (DEV-244)', async () => {
    await seedPullRequest({ number: 41, head: 'shared', base: 'main', state: 'open' });
    await seedPullRequest({ number: 42, head: 'shared', base: 'main', state: 'open' });
    await seedPullRequest({ number: 43, head: 'child', base: 'shared', state: 'open' });

    await deriveRelations(deps(), repository, prSource(43), SERVING_ONLY);

    expect(await links({ fromId: pullRequestDocId(REPOSITORY_ID, 43), linkType: 'stacks_on' })).toHaveLength(2);
  });

  it('**상위 PR이 머지되면 하위 PR에 이벤트 없이 detached가 된다** (AC-3, DEV-232)', async () => {
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'open' });
    await seedPullRequest({ number: 52, head: 'feature-c', base: 'feature-p', state: 'open' });
    await deriveRelations(deps(), repository, prSource(52), SERVING_ONLY);
    expect((await links({ fromId: pullRequestDocId(REPOSITORY_ID, 52), linkType: 'stacks_on' }))[0]!['detached']).toBe(false);

    // 상위 PR이 머지된다. **하위 PR에는 아무 이벤트도 오지 않는다.**
    await seedPullRequest({ number: 51, head: 'feature-p', base: 'main', state: 'merged' });
    await handleRelationsReady(deps(), repository, prSource(51), SERVING_ONLY);

    const after = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 52), linkType: 'stacks_on' });
    // **지우지 않는다** — 그런 의존이 있었다는 사실을 남긴다.
    expect(after).toHaveLength(1);
    expect(after[0]!['detached']).toBe(true);
  });

  it('조건이 다시 성립하면 detached가 해제된다 (DEV-238)', async () => {
    await seedPullRequest({ number: 61, head: 'feature-p2', base: 'main', state: 'open' });
    await seedPullRequest({ number: 62, head: 'feature-c2', base: 'feature-p2', state: 'open' });
    await deriveRelations(deps(), repository, prSource(62), SERVING_ONLY);

    await seedPullRequest({ number: 61, head: 'feature-p2', base: 'main', state: 'closed' });
    await handleRelationsReady(deps(), repository, prSource(61), SERVING_ONLY);
    expect((await links({ fromId: pullRequestDocId(REPOSITORY_ID, 62), linkType: 'stacks_on' }))[0]!['detached']).toBe(true);

    await seedPullRequest({ number: 61, head: 'feature-p2', base: 'main', state: 'open' });
    await handleRelationsReady(deps(), repository, prSource(61), SERVING_ONLY);

    const after = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 62), linkType: 'stacks_on' });
    expect(after).toHaveLength(1);
    expect(after[0]!['detached']).toBe(false);
  });

  it('순환이면 간선을 만들지 않고 지표에 남는다 (AC-5, DEV-247)', async () => {
    await seedPullRequest({ number: 71, head: 'ring-a', base: 'ring-b', state: 'open' });
    await seedPullRequest({ number: 72, head: 'ring-b', base: 'ring-a', state: 'open' });

    const metrics = createWorkerMetrics();
    await deriveRelations(deps({ metrics }), repository, prSource(71), SERVING_ONLY);

    expect(await links({ fromId: pullRequestDocId(REPOSITORY_ID, 71), linkType: 'stacks_on' })).toHaveLength(0);
    expect(metrics.render()).toContain('link_stack_cycle_total');
  });

  it('**10단계보다 깊은 사슬에서도 바로 위 부모와의 간선은 남는다** (AC-4)', async () => {
    /*
     * 상한은 **추적 범위**이지 간선의 조건이 아니다. 사슬이 12단계라는 이유로
     * 간선을 없애면 깊은 스택의 PR이 자기 부모와의 의존을 잃는다 — 요구사항이
     * 말하지 않은 손실이다. (변이 M13이 이 결함을 찾아 줬다.)
     */
    for (let index = 0; index < 12; index += 1) {
      await seedPullRequest({
        number: 200 + index,
        head: `deep-${String(index)}`,
        base: index === 0 ? 'main' : `deep-${String(index - 1)}`,
        state: 'open',
      });
    }

    await deriveRelations(deps(), repository, prSource(211), SERVING_ONLY);

    const found = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 211), linkType: 'stacks_on' });
    expect(found).toHaveLength(1);
    expect(found[0]!['to_id']).toBe(pullRequestDocId(REPOSITORY_ID, 210));
  });

  it('**추적은 10단계에서 멈춘다** — 그보다 먼 순환은 감지 범위 밖이다 (AC-4의 한계)', async () => {
    /*
     * 이것은 한계를 단언하는 시험이다. AC-4가 정한 추적 범위가 10단계이므로 그
     * 밖의 순환은 찾지 않는다 — 무한 탐색으로 넓히지 않는다. **상한을 없애면
     * 이 순환이 감지되어 간선이 사라지고, 이 시험이 그 변화를 잡는다.**
     */
    const total = 13;
    for (let index = 0; index < total; index += 1) {
      await seedPullRequest({
        number: 300 + index,
        head: `ring-${String(index)}`,
        // 마지막이 첫째를 가리켜 사슬 전체가 하나의 고리가 된다.
        base: `ring-${String((index + total - 1) % total)}`,
        state: 'open',
      });
    }

    await deriveRelations(deps(), repository, prSource(300), SERVING_ONLY);

    const found = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 300), linkType: 'stacks_on' });
    expect(found).toHaveLength(1);
  });

  /* --------------------------------------------------------------------- */
  /* 요약 · 접근 통제 · 재파생                                                */
  /* --------------------------------------------------------------------- */

  it('네 leaf가 갱신되고 **reference_count가 보존된다** (DEV-241·222)', async () => {
    await indexPullRequest(81, 7);
    await seedPullRequest({ number: 81, title: 'Revert "fix login"', head: 'r', base: 'main' });
    await seedPullRequest({ number: 82, title: 'fix login', head: 'x', base: 'main' });

    await deriveRelations(deps(), repository, prSource(81), SERVING_ONLY);

    const summary = (await prDoc(81))['link_summary'] as Record<string, unknown>;
    expect(summary['has_revert']).toBe(true);
    expect(summary['is_reverted']).toBe(false);
    // WP-029가 소유한 값을 지우지 않는다.
    expect(summary['reference_count']).toBe(7);
  });

  it('**간선 하나가 사라져도 다른 간선이 남으면 boolean은 true다** (DEV-241)', async () => {
    const reverter = sha('9d');
    await indexCommit(reverter);
    await seedPullRequest({ number: 91, title: 'fix login' });
    await seedPullRequest({ number: 92, title: 'fix login' });
    await seedCommit({ sha: reverter, message: 'Revert "fix login"' });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(2);

    // 후보 하나가 사라진다.
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1 AND pr_number = $2', [
      REPOSITORY_ID,
      92,
    ]);
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(1);
    await es.indices.refresh({ index: 'prs-commits' });
    const doc = await es.get<Record<string, unknown>>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, reverter),
      routing: String(REPOSITORY_ID),
    });
    const summary = (doc._source ?? {})['link_summary'] as Record<string, unknown>;
    expect(summary['has_revert']).toBe(true);
  });

  it('**커밋 문서에는 `has_stack`을 쓰지 않는다** — 없는 것과 아닌 것은 다른 주장이다', async () => {
    const reverter = sha('9e');
    await indexCommit(reverter);
    await seedCommit({ sha: sha('9f'), message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${sha('9f')}` });

    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    await es.indices.refresh({ index: 'prs-commits' });
    const doc = await es.get<Record<string, unknown>>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, reverter),
      routing: String(REPOSITORY_ID),
    });
    const summary = (doc._source ?? {})['link_summary'] as Record<string, unknown>;
    expect(summary['has_revert']).toBe(true);
    /*
     * 스택은 PR↔PR 관계이므로 커밋 매핑에 이 leaf가 없다. `false`를 쓰면
     * `dynamic: strict`가 거부하고, 거부하는 것이 옳다 — "이 커밋은 스택이 없다"가
     * 아니라 "커밋에는 스택이라는 개념이 없다"이기 때문이다.
     */
    expect(summary).not.toHaveProperty('has_stack');
  });

  it('**대상(`to`)의 요약도 함께 갱신된다** — `is_reverted`는 대상의 필드다 (PR #46 리뷰 P1)', async () => {
    /*
     * source만 갱신하면 대상은 아무도 건드리지 않아 `is_reverted`가 영원히
     * `false`로 남고, 그 위에서 도는 `reverted_pull_request_count`가 통째로
     * 틀린 수를 낸다.
     */
    const reverter = sha('c1a');
    await indexPullRequest(121, 0);
    await indexCommit(reverter);
    await seedPullRequest({ number: 121, title: 'fix login' });
    await seedCommit({ sha: reverter, message: 'Revert "fix login"' });

    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const target = (await prDoc(121))['link_summary'] as Record<string, unknown>;
    expect(target['is_reverted']).toBe(true);
    // 대상은 되돌리는 쪽이 아니다.
    expect(target['has_revert']).toBe(false);
  });

  it('**간선이 사라지면 옛 대상의 요약도 되돌아간다** (PR #46 리뷰 P1)', async () => {
    const reverter = sha('c2a');
    await indexPullRequest(131, 0);
    await indexCommit(reverter);
    await seedPullRequest({ number: 131, title: 'fix login' });
    await seedCommit({ sha: reverter, message: 'Revert "fix login"' });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    expect(((await prDoc(131))['link_summary'] as Record<string, unknown>)['is_reverted']).toBe(true);

    // 되돌림 표현이 사라진다 → 간선 제거 → **옛 대상**이 다시 false여야 한다.
    await seedCommit({ sha: reverter, message: 'unrelated work now' });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    expect(((await prDoc(131))['link_summary'] as Record<string, unknown>)['is_reverted']).toBe(false);
  });

  it('**관계 파생이 `links_pending`을 지우지 않는다** (DEV-246, PR #46 리뷰 P1)', async () => {
    /*
     * `links_pending`은 **참조 추출**의 완결 상태다. 관계 파생이 그것을 `false`로
     * 덮으면 참조 쪽의 실패 표식이 사라져 그 문서가 재파생 대상에서 조용히 빠진다.
     */
    await es.index({
      index: 'prs-pull-requests',
      id: pullRequestDocId(REPOSITORY_ID, 141),
      routing: String(REPOSITORY_ID),
      refresh: true,
      document: {
        document_version: 1,
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: 1,
        visibility: 'private',
        allowed_team_ids: [TEAM],
        pr_number: 141,
        // 참조 추출이 실패해 남긴 표식이다.
        links_pending: true,
        link_summary: { reference_count: 2 },
      },
    });
    await seedPullRequest({ number: 141, title: 'Revert "fix login"' });
    await seedPullRequest({ number: 142, title: 'fix login' });

    await deriveRelations(deps(), repository, prSource(141), SERVING_ONLY);

    const doc = await prDoc(141);
    expect(doc['links_pending']).toBe(true);
    expect((doc['link_summary'] as Record<string, unknown>)['has_revert']).toBe(true);
    expect((doc['link_summary'] as Record<string, unknown>)['reference_count']).toBe(2);
  });

  it('**간선 쓰기의 부분 실패도 조용히 ack하지 않는다** (DEV-228 규율)', async () => {
    /*
     * WP-030에는 `links_pending` 같은 재시도 표식이 없다(DEV-246). 여기서 조용히
     * ack하면 **실패했는데 아무도 다시 하지 않는다** — 이 저장소가 반복해서 밟은
     * 모양이다. 던져서 핸들러의 재시도 예산에 맡긴다.
     *
     * 그리고 **조정을 하지 않는다**: 실패한 회차가 stale 제거를 돌면 멀쩡한 간선이
     * 사라진다.
     */
    const target = sha('c3a');
    const reverter = sha('c3b');
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${target}` });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(1);

    await expect(
      deriveRelations(deps({ es: withIndexItemFailure(es) }), repository, commitSource(reverter), SERVING_ONLY),
    ).rejects.toThrow(/관계 간선 쓰기 실패/);

    // 실패 회차가 기존 간선을 지우지 않았다.
    expect(await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' })).toHaveLength(1);
  });

  it('**스택 해제의 쓰기 실패를 성공으로 세지 않는다** (PR #46 리뷰 P1 · CR-121)', async () => {
    await seedPullRequest({ number: 151, head: 'fp', base: 'main', state: 'open' });
    await seedPullRequest({ number: 152, head: 'fc', base: 'fp', state: 'open' });
    await deriveRelations(deps(), repository, prSource(152), SERVING_ONLY);

    /*
     * 상위가 머지된다 → 해제해야 하는데 간선 쓰기의 bulk 항목이 거부된다. 해제는 이제 부분 갱신이 아니라
     * 정본 행(`pull_request_stack`)에서 나온 **전체 쓰기**다 (CR-121, OD-017) — 그 쓰기가 실패하면 던진다.
     */
    await seedPullRequest({ number: 151, head: 'fp', base: 'main', state: 'merged' });
    await expect(
      deriveRelations(deps({ es: withIndexItemFailure(es) }), repository, prSource(152), SERVING_ONLY),
    ).rejects.toThrow(/관계 간선 쓰기 실패/);

    // 정본에는 해제가 남는다 — 재시도(다음 파생)가 색인을 그 값에 맞춘다.
    const row = await pool.query<{ detached: boolean }>(
      'SELECT detached FROM pull_request_stack WHERE repository_id = $1 AND child_pr_number = 152 AND parent_pr_number = 151',
      [REPOSITORY_ID],
    );
    expect(row.rows).toEqual([{ detached: true }]);
    await deriveRelations(deps(), repository, prSource(152), SERVING_ONLY);
    const after = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 152), linkType: 'stacks_on' });
    expect(after).toHaveLength(1);
    expect(after[0]!['detached']).toBe(true);
  });

  it('**운영 설정(refresh 꺼짐)에서도 해제가 요약에 반영된다** (PR #46 리뷰 P2)', async () => {
    /*
     * 운영에서 `refresh`는 꺼져 있다. 해제 간선을 다시 쓴 bulk가 검색에 보이지 않는
     * 상태에서 요약을 세면 **방금 해제한 마지막 스택 간선이 여전히 살아 있는 것으로
     * 세어져** `has_stack: true`가 굳는다 — 뒤따르는 자동 refresh는 요약을 다시
     * 계산해 주지 않는다.
     *
     * 그래서 이 시험만 `refresh: false`로 돈다. 시험 편의를 끄면 운영과 같아진다.
     */
    await indexPullRequest(171, 0);
    await indexPullRequest(172, 0);
    await seedPullRequest({ number: 171, head: 'pp', base: 'main', state: 'open' });
    await seedPullRequest({ number: 172, head: 'cc', base: 'pp', state: 'open' });
    await deriveRelations(deps({ refresh: false }), repository, prSource(172), SERVING_ONLY);
    expect(((await prDoc(172))['link_summary'] as Record<string, unknown>)['has_stack']).toBe(true);

    await seedPullRequest({ number: 171, head: 'pp', base: 'main', state: 'merged' });
    await deriveRelations(deps({ refresh: false }), repository, prSource(172), SERVING_ONLY);

    expect(((await prDoc(172))['link_summary'] as Record<string, unknown>)['has_stack']).toBe(false);
  });

  it('**상위 PR이 retarget돼도 옛 child의 간선이 해제된다** (PR #46 리뷰 P2)', async () => {
    await seedPullRequest({ number: 161, head: 'old-head', base: 'main', state: 'open' });
    await seedPullRequest({ number: 162, head: 'child', base: 'old-head', state: 'open' });
    await deriveRelations(deps(), repository, prSource(162), SERVING_ONLY);
    expect((await links({ fromId: pullRequestDocId(REPOSITORY_ID, 162), linkType: 'stacks_on' }))[0]!['detached']).toBe(false);

    /*
     * 상위가 head를 바꾼다. 정본은 이미 새 값이라 **분기로 찾는 조회는 옛 child를
     * 보지 못한다** — 이미 있는 간선에서 찾아야 한다.
     */
    await seedPullRequest({ number: 161, head: 'new-head', base: 'main', state: 'open' });
    await handleRelationsReady(deps(), repository, prSource(161), SERVING_ONLY);

    const after = await links({ fromId: pullRequestDocId(REPOSITORY_ID, 162), linkType: 'stacks_on' });
    expect(after).toHaveLength(1);
    expect(after[0]!['detached']).toBe(true);
  });

  it('**나중 커밋이 상한을 채워도 이전 후보를 놓치지 않는다** (PR #46 리뷰 P2)', async () => {
    /*
     * 방향 술어가 질의에 없으면, 같은 patch를 가진 **나중** 커밋이 SQL 상한을
     * 채우는 순간 이전 후보가 한 건도 남지 않고 조정이 멀쩡한 간선을 지운다.
     */
    const self = sha('d0');
    await seedCommit({ sha: sha('d1'), message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'PZ' });
    await seedCommit({ sha: self, message: 'feature', committedAt: '2026-08-02T00:00:00.000Z', patchId: 'PZ' });
    for (let index = 0; index < 25; index += 1) {
      await seedCommit({
        sha: sha(`e${index.toString(16)}`.padEnd(4, '0')),
        message: 'feature',
        committedAt: `2026-09-${String(1 + index).padStart(2, '0')}T00:00:00.000Z`,
        patchId: 'PZ',
      });
    }

    await deriveRelations(deps(), repository, commitSource(self), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, self), linkType: 'cherry_picks' });
    expect(found).toHaveLength(1);
    expect(found[0]!['to_id']).toBe(commitDocId(REPOSITORY_ID, sha('d1')));
  });

  it('간선이 **접근 통제 material을 생성 시점에** 갖는다 (THR-035)', async () => {
    const reverter = sha('ab');
    await seedCommit({ sha: sha('aa'), message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${sha('aa')}` });

    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(found[0]!['org_id']).toBe(1);
    expect(found[0]!['visibility']).toBe('private');
    expect(found[0]!['allowed_team_ids']).toEqual([TEAM]);
  });

  it('**되돌림 간선에는 detached를 두지 않는다** — 없는 개념을 false로 주장하지 않는다', async () => {
    const reverter = sha('ba');
    await seedCommit({ sha: reverter, message: `This reverts commit ${sha('bb')}` });
    await deriveRelations(deps(), repository, commitSource(reverter), SERVING_ONLY);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(found[0]).not.toHaveProperty('detached');
  });

  it('**PostgreSQL 정본만으로 네 계열이 전부 재구성된다** — JOB-REL-006 (DEV-234)', async () => {
    const origin = sha('ca');
    const copy = sha('cb');
    const target = sha('cc');
    const reverter = sha('cd');
    await seedCommit({ sha: origin, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'P9' });
    await seedCommit({ sha: copy, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: 'P9' });
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `refs #31\n\nThis reverts commit ${target}` });
    await seedPullRequest({ number: 101, head: 'up', base: 'main', state: 'open' });
    await seedPullRequest({ number: 102, head: 'down', base: 'up', state: 'open' });

    // 색인을 비운 상태에서 정본만으로 다시 만든다.
    await es.indices.refresh({ index: 'prs-links' });
    await es.deleteByQuery({
      index: 'prs-links',
      refresh: true,
      conflicts: 'proceed',
      query: { term: { repository_id: REPOSITORY_ID } },
    });

    let cursor = undefined as Parameters<typeof runReferenceRebuild>[2];
    for (let round = 0; round < 6; round += 1) {
      const result = await runReferenceRebuild(deps(), repository, cursor);
      cursor = result.cursor;
      if (result.done) break;
    }

    await es.indices.refresh({ index: 'prs-links' });
    const byType = async (linkType: string): Promise<number> =>
      (await links({ linkType })).length;

    expect(await byType('reverts')).toBeGreaterThanOrEqual(1);
    expect(await byType('cherry_picks')).toBeGreaterThanOrEqual(1);
    expect(await byType('stacks_on')).toBeGreaterThanOrEqual(1);
    expect(await byType('references')).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('**직접 푸시 커밋의 되돌림이 실제 운영 방아쇠 사슬로 간선이 된다** (DEV-230)', async () => {
    /*
     * 내가 직접 부른 함수가 아니라 **운영이 부르는 경로**를 본다. `EVT-ING-005`는
     * 직접 푸시 커밋의 **유일한** 방아쇠다 — `project`가 그 문서를 만들지 않으므로
     * `EVT-ING-003`은 애초에 오지 않는다. 이 사슬이 끊기면 그 커밋의 되돌림은
     * 영원히 간선이 되지 않는다.
     */
    const target = sha('ea');
    const reverter = sha('eb');
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${target}` });

    const disposition = await handleLinkEvent(deps(), {
      event_id: 'e-1',
      event_name: EVENT_NAMES.commitMetadataReady,
      correlation_id: 'c',
      occurred_at: '2026-08-01T00:00:00.000Z',
      partition_key: String(REPOSITORY_ID),
      partition: 0,
      delivery_count: 1,
      message_id: 'm-1',
      payload: {
        repository_id: REPOSITORY_ID,
        commit_sha: reverter,
        doc_id: commitDocId(REPOSITORY_ID, reverter),
        correlation_id: 'c',
      },
    } as never);

    expect(disposition).toEqual({ kind: 'ack' });
    const found = await links({ fromId: commitDocId(REPOSITORY_ID, reverter), linkType: 'reverts' });
    expect(found).toHaveLength(1);
    expect(found[0]!['to_id']).toBe(commitDocId(REPOSITORY_ID, target));
  });

  it('**직접 푸시 커밋의 체리픽도 같은 사슬로 간선이 된다** (DEV-231)', async () => {
    const origin = sha('fa');
    const copy = sha('fb');
    await seedCommit({ sha: origin, message: 'feature', committedAt: '2026-08-01T00:00:00.000Z', patchId: 'PX' });
    await seedCommit({ sha: copy, message: 'feature', committedAt: '2026-08-05T00:00:00.000Z', patchId: 'PX' });

    await handleLinkEvent(deps(), {
      event_id: 'e-2',
      event_name: EVENT_NAMES.commitMetadataReady,
      correlation_id: 'c',
      occurred_at: '2026-08-01T00:00:00.000Z',
      partition_key: String(REPOSITORY_ID),
      partition: 0,
      delivery_count: 1,
      message_id: 'm-2',
      payload: {
        repository_id: REPOSITORY_ID,
        commit_sha: copy,
        doc_id: commitDocId(REPOSITORY_ID, copy),
        correlation_id: 'c',
      },
    } as never);

    const found = await links({ fromId: commitDocId(REPOSITORY_ID, copy), linkType: 'cherry_picks' });
    expect(found).toHaveLength(1);
    expect(found[0]!['confidence']).toBe('derived');
  });

  it('운영 진입점(`handleSourceReady`)이 네 계열을 함께 돌린다', async () => {
    const target = sha('da');
    const reverter = sha('db');
    await seedCommit({ sha: target, message: 'fix login' });
    await seedCommit({ sha: reverter, message: `This reverts commit ${target}` });

    const outcome = await handleSourceReady(deps(), repository, commitSource(reverter));

    expect(outcome.relations.reverts).toBe(1);
    expect(outcome.relations.complete).toBe(true);
  });
});
