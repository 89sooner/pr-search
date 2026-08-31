/**
 * JOB-ING-006 무중단 재색인 (WP-035 / FR-ING-008, CR-045~047).
 *
 * **실제 PostgreSQL + 실제 Elasticsearch를 쓴다.** 이 WP가 지켜야 할 것 대부분이
 * Elasticsearch 자체의 동작이다 — 별칭 전환의 원자성, `strict` 매핑이 만드는
 * 항목 단위 실패, 그리고 "옛 인덱스를 읽지 않았다"는 사실.
 *
 * 대상 별칭으로 `prs-releases`를 고른 이유는 정본이 표 하나(`release`)라
 * 재구축 경로가 짧고, 그래서 **무엇이 증명되는지가 흐려지지 않기** 때문이다.
 * 이중 쓰기·울타리·전환·보관은 별칭과 무관한 기계다.
 *
 * 이 파일은 공유 별칭을 실제로 옮기므로 `afterAll`에서 **원래 인덱스로 되돌린다.**
 *
 * 검증: `pnpm test:integration reindex`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  jobRepo,
  prSnapshotRepo,
  releaseRepo,
  teamMembershipRepo,
  reindexRepo,
  repositoryRepo,
  withReindexWrite,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { pullRequestDocId } from '@prs/domain';
import {
  applyMappings,
  bulkUpsert,
  concreteIndexName,
  createEsClient,
  listIndexVersions,
  parseIndexVersion,
  createVersionedIndex,
  resolveServingIndex,
  schemaOf,
  switchAlias,
  upsertReleaseDocuments,
  type VersionedIndexSchema,
} from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

import {
  REINDEX_TYPE,
  reconcileSwitchedJobs,
  runReindexJob,
  runRetentionSweep,
  verifyBeforeCutover,
  type ReindexDeps,
} from '../../src/reindex.js';
import { migratedPool } from '../helpers.js';

const ALIAS = 'prs-releases';
/** PR 축 시험이 쓰는 별칭. 레지스트리 소유 필드의 정본성을 여기서 건다. */
const PR_ALIAS = 'prs-pull-requests';
const REPOSITORY_ID = 9351;
const OWNER = 'acme';
const NAME = 'reindex-wp035';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;
/** 이 파일이 시작할 때 별칭이 가리키던 인덱스. `afterAll`이 여기로 되돌린다. */
let originalIndex: string;
let originalPrIndex: string;
/** 이 파일이 만든 인덱스. 전부 지운다. */
const created = new Set<string>();

function deps(overrides: Partial<ReindexDeps> = {}): ReindexDeps {
  return { pool, es, ...overrides };
}

async function seedRelease(tag: string, seq: number): Promise<void> {
  await releaseRepo.upsertRelease(pool, {
    repository_id: REPOSITORY_ID,
    tag_name: tag,
    commit_sha: String(seq).padStart(40, 'e'),
    base_branch: 'main',
    seq_epoch: 1,
    merge_seq: seq,
    released_at: new Date(`2026-08-${String(10 + seq).padStart(2, '0')}T00:00:00Z`),
    source: 'git_tag',
  });
}

/** 이 저장소의 문서를 구체 인덱스에서 직접 읽는다. 별칭을 거치지 않는다. */
async function docsIn(index: string): Promise<readonly Record<string, unknown>[]> {
  await es.indices.refresh({ index });
  const found = await es.search<Record<string, unknown>>({
    index,
    size: 50,
    query: { term: { repository_id: REPOSITORY_ID } },
  });
  return found.hits.hits.map((hit) => hit._source as Record<string, unknown>);
}

/** 정본 릴리스를 평시 쓰기 경로로 색인한다. 재색인 중이면 이중 쓰기가 된다. */
async function projectReleases(): Promise<{ readonly hasFailures: boolean }> {
  const rows = await releaseRepo.listReleases(pool, REPOSITORY_ID);
  return withReindexWrite(pool, (targets) =>
    upsertReleaseDocuments(
      es,
      { repositoryId: REPOSITORY_ID, orgId: 71, visibility: 'internal', repository: `${OWNER}/${NAME}` },
      rows.map((row) => ({
        tagName: row.tag_name,
        commitSha: row.commit_sha,
        baseBranch: row.base_branch,
        seqEpoch: row.seq_epoch,
        mergeSeq: row.merge_seq === null ? null : Number(row.merge_seq),
        releasedAt: row.released_at.toISOString(),
        source: row.source,
        sequenceSpace: `${OWNER}/${NAME}@main`,
      })),
      Date.now(),
      targets,
    ),
  );
}

async function enqueue(): Promise<{ jobId: number; targetIndex: string; sourceIndex: string }> {
  const outcome = await reindexRepo.enqueueReindex(
    pool,
    {
      resolveServingIndex: (alias) => resolveServingIndex(es, alias),
      async nextTargetIndex(alias) {
        const versions = await listIndexVersions(es, alias);
        const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
        return concreteIndexName(alias, highest + 1);
      },
      isAlias: (value) => value === ALIAS,
    },
    ALIAS,
    'test',
  );
  if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
  created.add(outcome.targetIndex);
  return { jobId: outcome.jobId, targetIndex: outcome.targetIndex, sourceIndex: outcome.sourceIndex };
}

/** 러너가 집는 것과 같은 상태로 만든다 — `claimNextJob`이 하는 일이다. */
async function claim(jobId: number): Promise<void> {
  await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [jobId]);
}

async function runClaimed(jobId: number, overrides: Partial<ReindexDeps> = {}): Promise<void> {
  const row = await jobRepo.findJobById(pool, jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  await runReindexJob(deps(overrides), row);
}

async function jobRow(jobId: number): Promise<{ state: string; progress: Record<string, unknown> }> {
  const row = await jobRepo.findJobById(pool, jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  return { state: row.state, progress: row.progress };
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  await applyMappings(es);
  originalIndex = await resolveServingIndex(es, ALIAS);
  originalPrIndex = await resolveServingIndex(es, PR_ALIAS);

  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 71,
    visibility: 'internal',
    sequence_branches: ['main'],
    mirror_enabled: false,
    status: 'active',
  });
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  repository = found;
});

beforeEach(async () => {
  // 내 저장소의 상태만 지운다 — 공유 `prs_test`의 다른 행은 건드리지 않는다 (risks 16).
  await pool.query('DELETE FROM release WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM job WHERE type = $1', [REINDEX_TYPE]);

  /*
   * **색인 문서도 지운다** (risks 30). 앞선 케이스가 남긴 문서가 그대로 있으면
   * "정본에서 재구축했다"를 확인하는 단언이 옛 케이스의 태그까지 보게 되고,
   * 파일 하나로 돌리면 통과하고 케이스 순서를 바꾸면 깨지는 시험이 된다.
   *
   * 별칭이 이 파일 안에서 옮겨 다니므로 **버전 인덱스 전부**를 훑는다.
   */
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);

  for (const alias of [ALIAS, PR_ALIAS]) {
    for (const version of await listIndexVersions(es, alias)) {
      const index = concreteIndexName(alias, version);
      if (!(await es.indices.exists({ index }))) continue;
      // `delete_by_query`는 **검색으로** 대상을 찾는다 — 먼저 refresh 한다 (risks 17).
      await es.indices.refresh({ index });
      await es.deleteByQuery({
        index,
        refresh: true,
        conflicts: 'proceed',
        query: { term: { repository_id: REPOSITORY_ID } },
      });
    }
  }
});

afterAll(async () => {
  try {
    // 별칭을 원래 자리로 되돌린다. 이 파일이 공유 상태를 옮겼기 때문이다.
    const serving = await resolveServingIndex(es, ALIAS);
    if (serving !== originalIndex && (await es.indices.exists({ index: originalIndex }))) {
      await switchAlias(es, ALIAS, serving, originalIndex);
    }
    const servingPr = await resolveServingIndex(es, PR_ALIAS);
    if (servingPr !== originalPrIndex && (await es.indices.exists({ index: originalPrIndex }))) {
      await switchAlias(es, PR_ALIAS, servingPr, originalPrIndex);
    }
    const current = await resolveServingIndex(es, ALIAS);
    const currentPr = await resolveServingIndex(es, PR_ALIAS);
    for (const index of created) {
      if (index === originalIndex || index === current) continue;
      if (index === originalPrIndex || index === currentPr) continue;
      await es.indices.delete({ index, ignore_unavailable: true });
    }
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM release WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM job WHERE type = $1', [REINDEX_TYPE]);
  } finally {
    await es.close();
    await pool.end();
  }
});

describe('T1 정상 재색인 — 정본에서 채우고 별칭을 원자적으로 옮긴다', () => {
  it('전환 뒤 별칭이 새 인덱스를 가리키고 옛 인덱스는 남는다', async () => {
    await seedRelease('v1.0', 1);
    await seedRelease('v1.1', 2);

    const before = await resolveServingIndex(es, ALIAS);
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);

    const after = await resolveServingIndex(es, ALIAS);
    expect(after).toBe(targetIndex);
    expect(after).not.toBe(before);

    // 옛 인덱스는 **보관 기간 동안 남는다** (FR-ING-008 AC-4).
    expect(await es.indices.exists({ index: before })).toBe(true);

    const docs = await docsIn(targetIndex);
    expect(docs.map((one) => one['tag_name']).sort()).toEqual(['v1.0', 'v1.1']);

    const row = await jobRow(jobId);
    expect(row.state).toBe('completed');
    expect(row.progress['phase']).toBe('retention');
    expect(row.progress['switched_at']).toEqual(expect.any(String));
  });
});

describe('T2 재색인 중 신규 이벤트가 양쪽에 기록된다 (FR-ING-008 AC-2)', () => {
  it('활성화 뒤의 논리 쓰기가 serving과 shadow 둘 다에 닿는다', async () => {
    await seedRelease('v2.0', 1);

    const serving = await resolveServingIndex(es, ALIAS);
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);

    // 대상 인덱스를 만들고 이중 쓰기를 켠다 — 러너의 prepare·dual_write와 같은 상태다.
    const schema = schemaOf(ALIAS);
    await es.indices.create({
      index: targetIndex,
      settings: { ...schema.settings, number_of_shards: schema.shards },
      mappings: schema.mappings,
    });
    await reindexRepo.patchReindexProgress(pool, jobId, {
      phase: 'dual_write',
      dual_write_since: new Date().toISOString(),
    });

    // 평시 릴리스 반영과 **같은 경로**로 쓴다.
    await seedRelease('v2.1', 2);
    await projectReleases();

    const servingTags = (await docsIn(serving)).map((one) => one['tag_name']).sort();
    const shadowTags = (await docsIn(targetIndex)).map((one) => one['tag_name']).sort();
    expect(servingTags).toEqual(['v2.0', 'v2.1']);
    expect(shadowTags, 'shadow가 신규 쓰기를 놓쳤다').toEqual(['v2.0', 'v2.1']);
  });
});

describe('T3·T4 shadow 실패 — 서비스는 살고 전환은 막힌다 (DEV-297·298)', () => {
  it('항목 단위 실패가 잡을 `failed`로 만들고 별칭을 그대로 둔다', async () => {
    await seedRelease('v3.0', 1);

    const serving = await resolveServingIndex(es, ALIAS);
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);

    /*
     * shadow를 **빈 `strict` 매핑**으로 만든다. bulk는 HTTP 200을 주면서 항목마다
     * `strict_dynamic_mapping_exception`을 담는다 — 그것이 "HTTP 200이 완료가
     * 아니다"를 실물로 만드는 가장 짧은 길이다.
     */
    await es.indices.create({ index: targetIndex, mappings: { dynamic: 'strict', properties: {} } });
    await reindexRepo.patchReindexProgress(pool, jobId, { phase: 'dual_write' });

    const result = await projectReleases();

    // 서비스 결과는 **보존된다** (불변식 6).
    expect(result.hasFailures, '서비스 인덱스 쓰기가 shadow 실패에 끌려갔다').toBe(false);
    expect((await docsIn(serving)).map((one) => one['tag_name'])).toEqual(['v3.0']);

    // 그러나 잊지 않는다 (불변식 7).
    const row = await jobRow(jobId);
    expect(row.state).toBe('failed');
    expect(Number(row.progress['failures'])).toBeGreaterThan(0);

    // 그리고 그 상태에서는 전환하지 않는다.
    const verdict = await verifyBeforeCutover(deps(), jobId, 1);
    expect(verdict.ok).toBe(false);
    expect(await resolveServingIndex(es, ALIAS)).toBe(serving);
  });

  it('실패한 뒤에는 shadow 쓰기를 더 하지 않는다 (DEV-298)', async () => {
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await es.indices.create({ index: targetIndex, mappings: { dynamic: 'strict', properties: {} } });
    await reindexRepo.patchReindexProgress(pool, jobId, { phase: 'dual_write' });
    await pool.query("UPDATE job SET state = 'failed' WHERE job_id = $1", [jobId]);

    const shadows = await reindexRepo.findDualWriteShadows(pool);
    expect(shadows[ALIAS], '실패한 재색인이 여전히 shadow 대상이다').toBeUndefined();
  });
});

describe('T5 전환 전 취소 — 성공한 전환을 만들지 않는다 (DEV-298)', () => {
  it('취소된 잡은 별칭을 옮기지 않고 `completed`로 덮이지도 않는다', async () => {
    await seedRelease('v5.0', 1);

    const serving = await resolveServingIndex(es, ALIAS);
    const { jobId } = await enqueue();
    await pool.query("UPDATE job SET state = 'cancelled' WHERE job_id = $1", [jobId]);

    await runClaimed(jobId);

    expect(await resolveServingIndex(es, ALIAS)).toBe(serving);
    const row = await jobRow(jobId);
    expect(row.state, '늦은 종료가 취소를 덮었다').toBe('cancelled');
  });
});

describe('T6 대상 버전 — 아직 쓰이지 않은 다음 번호다 (CR-046, DEV-309)', () => {
  it('실패로 남은 shadow가 다음 재색인을 막지 않는다', async () => {
    const serving = await resolveServingIndex(es, ALIAS);
    const servingVersion = parseIndexVersion(ALIAS, serving);
    expect(servingVersion, '서비스 인덱스가 버전 형식이 아니다').not.toBeNull();

    // 앞선 회차가 실패로 남긴 고아 shadow를 만든다.
    const orphan = concreteIndexName(ALIAS, (servingVersion as number) + 1);
    created.add(orphan);
    if (!(await es.indices.exists({ index: orphan }))) {
      await es.indices.create({ index: orphan });
    }

    const { targetIndex } = await enqueue();
    expect(targetIndex, '고아 shadow의 번호를 다시 골랐다').not.toBe(orphan);
    expect(parseIndexVersion(ALIAS, targetIndex)).toBeGreaterThan((servingVersion as number) + 1);
  });
});

describe('T7 보관 — 7일 뒤에 지우되 현재 별칭은 건드리지 않는다 (FR-ING-008 AC-4)', () => {
  it('6일째는 남고 8일째에 지워진다', async () => {
    await seedRelease('v7.0', 1);
    const { jobId, sourceIndex, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);
    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);

    const switchedAt = new Date((await jobRow(jobId)).progress['switched_at'] as string);
    const day = 24 * 60 * 60 * 1000;

    const sixth = new Date(switchedAt.getTime() + 6 * day);
    expect(await runRetentionSweep(deps({ now: () => sixth }))).toBe(0);
    expect(await es.indices.exists({ index: sourceIndex }), '보관 기간 안에 지웠다').toBe(true);

    const eighth = new Date(switchedAt.getTime() + 8 * day);
    expect(await runRetentionSweep(deps({ now: () => eighth }))).toBe(1);
    expect(await es.indices.exists({ index: sourceIndex })).toBe(false);
    // 현재 별칭 대상은 어떤 경우에도 남는다.
    expect(await es.indices.exists({ index: targetIndex })).toBe(true);
    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);
  });

  it('현재 별칭이 가리키는 인덱스는 기한이 지나도 지우지 않는다', async () => {
    const serving = await resolveServingIndex(es, ALIAS);
    /*
     * 잡 `progress`가 낡아 **서비스 중인 인덱스를 보관 대상으로 가리키는** 상태를
     * 만든다. 정본을 그대로 믿으면 서비스를 지운다 — 지우기 직전에 다시 묻는
     * 이유다.
     */
    const jobId = await jobRepo.enqueueJob(pool, REINDEX_TYPE, ALIAS, 'test');
    await reindexRepo.setReindexProgress(pool, jobId, {
      phase: 'retention',
      alias: ALIAS,
      source_index: serving,
      target_index: serving,
      switched_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    });
    await pool.query("UPDATE job SET state = 'completed' WHERE job_id = $1", [jobId]);

    expect(await runRetentionSweep(deps({ now: () => new Date('2026-08-27T00:00:00Z') }))).toBe(0);
    expect(await es.indices.exists({ index: serving }), '서비스 중인 인덱스를 지웠다').toBe(true);
  });
});

describe('T8 PostgreSQL 정본만으로 재구축한다 (ADR-004)', () => {
  it('옛 인덱스에만 있던 문서는 새 인덱스에 오지 않는다', async () => {
    await seedRelease('v8.0', 1);

    const serving = await resolveServingIndex(es, ALIAS);
    /*
     * **옛 인덱스에만** 있는 표식을 심는다. 정본(`release` 표)에는 대응 행이 없다.
     * 재구축이 옛 인덱스를 읽었다면 이 문서가 따라온다 — 그러면 "색인은 정본만으로
     * 재구축 가능하다"가 증명되지 않는다.
     */
    await es.index({
      index: serving,
      id: `${String(REPOSITORY_ID)}:es-only-marker`,
      routing: String(REPOSITORY_ID),
      refresh: true,
      document: {
        release_id: `${String(REPOSITORY_ID)}:es-only-marker`,
        doc_id: `${String(REPOSITORY_ID)}:es-only-marker`,
        repository_id: REPOSITORY_ID,
        org_id: 71,
        visibility: 'internal',
        tag_name: 'es-only-marker',
        display_name: 'es-only-marker',
        commit_sha: 'f'.repeat(40),
        released_at: '2026-08-01T00:00:00Z',
        source: 'git_tag',
        indexed_at: '2026-08-01T00:00:00Z',
        document_version: 1,
      },
    });
    /*
     * 이 시점의 서비스 인덱스에는 표식뿐이다 — 정본의 `v8.0`은 아직 색인되지
     * 않았다. 그래서 재구축 결과가 정확히 뒤집힌다: **정본에만 있는 것이 오고
     * 색인에만 있는 것은 오지 않는다.**
     */
    expect((await docsIn(serving)).map((one) => one['tag_name'])).toEqual(['es-only-marker']);

    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);

    const rebuilt = (await docsIn(targetIndex)).map((one) => one['tag_name']).sort();
    expect(rebuilt, '옛 인덱스의 문서가 따라왔다 — 정본에서 재구축한 것이 아니다').toEqual(['v8.0']);
    expect(repository.repository_id).toBe(REPOSITORY_ID);
  });
});

describe('T9 무중단 — 재색인 내내 별칭 조회가 실패하지 않는다 (FR-ING-008 AC-3)', () => {
  it('전환을 포함한 전 구간에서 별칭 조회가 한 번도 실패하지 않는다', async () => {
    await seedRelease('v9.0', 1);
    await projectReleases();

    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);

    /*
     * **전환과 조회를 실제로 겹친다.** `updateAliases`가 한 번이라는 것을 정적으로
     * 거는 회귀는 이미 있지만, 그것이 무중단을 뜻하려면 그 사이에 들어온 조회가
     * 살아남아야 한다. 두 호출로 나뉘면 별칭이 사라지는 창이 생기고 그 창의
     * 조회가 `index_not_found_exception`을 받는다.
     */
    let stopped = false;
    const failures: string[] = [];
    let attempts = 0;

    const poller = (async (): Promise<void> => {
      while (!stopped) {
        attempts += 1;
        try {
          await es.search({ index: ALIAS, size: 1, query: { match_all: {} } });
        } catch (error) {
          failures.push(String(error));
        }
      }
    })();

    await runClaimed(jobId);
    stopped = true;
    await poller;

    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);
    expect(attempts, '조회를 한 번도 못 던졌다 — 이 시험이 아무것도 증명하지 않는다').toBeGreaterThan(10);
    expect(failures, `재색인 중 별칭 조회가 ${String(failures.length)}회 실패했다`).toEqual([]);
  });
});

describe('T10 전환 뒤 늦은 취소 — 성공한 전환을 되돌리지 않는다 (DEV-298)', () => {
  it('전환 뒤에 취소가 들어와도 별칭은 새 인덱스를 가리키고 러너가 그것을 덮지 않는다', async () => {
    await seedRelease('v10.0', 1);
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);
    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);

    /*
     * 운영자의 취소가 **전환 뒤에** 도착한 상황이다. 이미 일어난 전환은
     * 되돌리지 않는다 — 되돌리면 그 순간이 진짜 중단이다. 대신 러너가
     * `cancelled`를 `completed`로 덮지 않는다는 것이 CAS의 몫이다.
     */
    await pool.query("UPDATE job SET state = 'cancelled' WHERE job_id = $1", [jobId]);
    const overwrote = await jobRepo.finishJobIfRunning(pool, jobId, 'completed');

    expect(overwrote, '늦은 종료가 취소를 덮었다').toBe(false);
    expect((await jobRow(jobId)).state).toBe('cancelled');
    expect(await resolveServingIndex(es, ALIAS), '늦은 취소가 전환을 되돌렸다').toBe(targetIndex);
  });
});

describe('R1 레지스트리 소유 필드는 현재 값으로 덮는다 (PR #52 리뷰 P1)', () => {
  /** PR 별칭에 대해 잡을 만든다. 대상 버전은 아직 쓰이지 않은 다음 번호다. */
  async function enqueuePr(): Promise<{ jobId: number; targetIndex: string }> {
    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (alias) => resolveServingIndex(es, alias),
        async nextTargetIndex(alias) {
          const versions = await listIndexVersions(es, alias);
          const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
          return concreteIndexName(alias, highest + 1);
        },
        isAlias: (value) => value === PR_ALIAS,
      },
      PR_ALIAS,
      'test',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    return { jobId: outcome.jobId, targetIndex: outcome.targetIndex };
  }

  it('**회수된 팀이 전환으로 되살아나지 않는다**', async () => {
    /*
     * 스냅숏은 투영 시점의 사본이다. 그 뒤 팀이 회수되면 `applyRepositoryTeams`가
     * **색인에만** 소급 반영하고 스냅숏은 옛 값을 그대로 들고 있다. 재구축이
     * 스냅숏을 그대로 쓰면 전환이 그 회수를 되돌린다 — 접근 통제 유출이다.
     */
    await pool.query('UPDATE repository SET allowed_team_ids = $2 WHERE repository_id = $1', [
      REPOSITORY_ID,
      [11, 22],
    ]);
    const stale = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    if (stale === undefined) throw new Error('저장소를 찾지 못했다');

    // 옛 권한으로 투영된 스냅숏을 남긴다.
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 501,
      documentVersion: 1_000,
      source: 'webhook',
      document: {
        document_version: 1_000,
        doc_id: pullRequestDocId(REPOSITORY_ID, 501),
        pr_number: 501,
        title: '결제 게이트웨이',
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: 71,
        visibility: 'internal',
        allowed_team_ids: [11, 22],
        repository_archived: false,
        state: 'merged',
        indexed_at: '2026-08-01T00:00:00Z',
        source_commit_shas: ['a'.repeat(40)],
        merge_commit_sha: 'b'.repeat(40),
        base_branch: 'main',
      },
    });

    // 그 뒤 팀 22가 회수되고 저장소가 해제됐다 — 정본만 바뀐 상태다.
    await pool.query(
      "UPDATE repository SET allowed_team_ids = $2, status = 'archived' WHERE repository_id = $1",
      [REPOSITORY_ID, [11]],
    );

    const { jobId, targetIndex } = await enqueuePr();
    await claim(jobId);
    await runClaimed(jobId);

    // 실패했으면 별칭이 아니라 **그 이유**가 먼저 보여야 한다.
    const outcome = await jobRow(jobId);
    expect(outcome.state, `재구축이 완료되지 않았다: ${JSON.stringify(outcome.progress)}`).toBe('completed');
    expect(await resolveServingIndex(es, PR_ALIAS)).toBe(targetIndex);

    await es.indices.refresh({ index: targetIndex });
    const found = await es.search<Record<string, unknown>>({
      index: targetIndex,
      query: { term: { repository_id: REPOSITORY_ID } },
    });
    const doc = found.hits.hits.find(
      (one) => (one._source as Record<string, unknown>)['pr_number'] === 501,
    )?._source as Record<string, unknown> | undefined;

    expect(doc, 'PR 문서를 재구축하지 못했다').toBeDefined();
    expect(doc?.['allowed_team_ids'], '회수된 팀이 전환으로 되살아났다').toEqual([11]);
    expect(doc?.['repository_archived'], '해제 상태가 되돌아갔다').toBe(true);
    // 스냅숏이 소유한 값은 그대로다.
    expect(doc?.['title']).toBe('결제 게이트웨이');

    // 정리 — 다음 케이스가 이 저장소 상태를 물려받지 않게 한다.
    await pool.query(
      "UPDATE repository SET allowed_team_ids = $2, status = 'active' WHERE repository_id = $1",
      [REPOSITORY_ID, []],
    );
  });

  it('**본문에 `document_version`이 없는 스냅숏도 재구축한다** (CI가 잡았다)', async () => {
    /*
     * 버전의 정본은 `pull_request_snapshot.document_version` **열**이다. 본문에
     * 같은 값이 들어 있는 것은 투영이 그렇게 만들었기 때문일 뿐이고, 본문에 그
     * 키가 없는 행도 실재한다(`worker/link.test.ts`의 픽스처가 그렇다).
     *
     * 본문을 믿으면 조건부 업서트 스크립트가 `null`과 비교하다
     * `script_exception`으로 거부하고, **그 한 행이 저장소 전체의 재구축을
     * 막는다** — 그리고 그 실패는 전환 거절로만 보여 원인이 드러나지 않는다.
     */
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 503,
      documentVersion: 3_000,
      source: 'webhook',
      document: { pr_number: 503, title: '버전이 본문에 없다', body: '' },
    });

    // 서비스 인덱스에 이미 그 문서가 있어야 스크립트가 실제로 비교를 한다.
    await withReindexWrite(pool, (targets) =>
      bulkUpsert(
        es,
        [
          {
            alias: 'prs-pull-requests' as const,
            id: pullRequestDocId(REPOSITORY_ID, 503),
            routing: String(REPOSITORY_ID),
            doc: {
              document_version: 3_000,
              doc_id: pullRequestDocId(REPOSITORY_ID, 503),
              pr_number: 503,
              repository_id: REPOSITORY_ID,
              repository: `${OWNER}/${NAME}`,
              org_id: 71,
              visibility: 'internal',
              allowed_team_ids: [],
              repository_archived: false,
              indexed_at: '2026-08-01T00:00:00Z',
            },
          },
        ],
        targets,
      ),
    );

    const { jobId, targetIndex } = await enqueuePr();
    await claim(jobId);
    await runClaimed(jobId);

    const row = await jobRow(jobId);
    expect(row.state, `재구축이 실패했다: ${String(row.progress['failures'] ?? '')}`).toBe('completed');
    expect(await resolveServingIndex(es, PR_ALIAS)).toBe(targetIndex);

    await es.indices.refresh({ index: targetIndex });
    const found = await es.search<Record<string, unknown>>({
      index: targetIndex,
      query: { bool: { filter: [{ term: { repository_id: REPOSITORY_ID } }, { term: { pr_number: 503 } }] } },
    });
    expect(found.hits.hits.length, '버전이 본문에 없는 PR이 재구축에서 빠졌다').toBe(1);
    expect((found.hits.hits[0]?._source as Record<string, unknown>)['document_version']).toBe(3_000);
  });

  it('**PR 유래 커밋 문서도 정본에서 다시 만든다**', async () => {
    /*
     * `commit_snapshot`은 first-parent 체인만 덮는다. 그것만 읽으면 PR의 원본
     * 커밋 문서가 통째로 빠진 인덱스로 전환하게 되고, FR-SRCH-002(SHA → PR)가
     * 그 커밋들에 대해 "그런 커밋은 없다"로 답한다.
     */
    const source = 'c'.repeat(40);
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 502,
      documentVersion: 2_000,
      source: 'webhook',
      document: {
        document_version: 2_000,
        doc_id: pullRequestDocId(REPOSITORY_ID, 502),
        pr_number: 502,
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: 71,
        visibility: 'internal',
        allowed_team_ids: [],
        repository_archived: false,
        state: 'merged',
        indexed_at: '2026-08-01T00:00:00Z',
        source_commit_shas: [source],
        base_branch: 'main',
      },
    });

    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (alias) => resolveServingIndex(es, alias),
        async nextTargetIndex(alias) {
          const versions = await listIndexVersions(es, alias);
          const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
          return concreteIndexName(alias, highest + 1);
        },
        isAlias: (value) => value === 'prs-commits',
      },
      'prs-commits',
      'test',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    const commitsOriginal = await resolveServingIndex(es, 'prs-commits');

    await claim(outcome.jobId);
    await runClaimed(outcome.jobId);

    const target = outcome.targetIndex;
    await es.indices.refresh({ index: target });
    const found = await es.search<Record<string, unknown>>({
      index: target,
      query: { bool: { filter: [{ term: { repository_id: REPOSITORY_ID } }, { term: { commit_sha: source } }] } },
    });
    const doc = found.hits.hits[0]?._source as Record<string, unknown> | undefined;

    expect(doc, 'PR 원본 커밋 문서가 재구축에서 빠졌다').toBeDefined();
    expect(doc?.['role']).toBe('source_commit');
    expect(doc?.['pull_request_numbers']).toEqual([502]);

    // `prs-commits` 별칭을 원래 자리로 되돌린다 — 다른 시험 파일이 쓰는 별칭이다.
    const servingNow = await resolveServingIndex(es, 'prs-commits');
    if (servingNow !== commitsOriginal && (await es.indices.exists({ index: commitsOriginal }))) {
      await switchAlias(es, 'prs-commits', servingNow, commitsOriginal);
    }
  });
});

describe('R2 큐에 보이는 순간 잡은 완전하다 (PR #52 리뷰 P2)', () => {
  it('`enqueueReindex`가 만든 행은 즉시 진행 상태를 갖는다', async () => {
    const { jobId, targetIndex, sourceIndex } = await enqueue();
    const row = await jobRepo.findJobById(pool, jobId);

    expect(row?.state).toBe('queued');
    expect(row?.progress['phase'], '초기화 전 행이 큐에 보인다 — 러너가 집으면 영구 실패다').toBe('prepare');
    expect(row?.progress['target_index']).toBe(targetIndex);
    expect(row?.progress['source_index']).toBe(sourceIndex);
  });
});

describe('R3 보관 — 롤백 중인 인덱스는 다음 주기에 다시 본다 (PR #52 리뷰 P2)', () => {
  it('별칭을 되돌려 둔 동안은 지우지도 않고 처리했다고 적지도 않는다', async () => {
    await seedRelease('v11.0', 1);
    const { jobId, sourceIndex, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);

    const switchedAt = new Date((await jobRow(jobId)).progress['switched_at'] as string);
    const late = new Date(switchedAt.getTime() + 9 * 24 * 60 * 60 * 1000);

    // 운영자가 별칭을 옛 인덱스로 되돌렸다 (롤백).
    await switchAlias(es, ALIAS, targetIndex, sourceIndex);

    expect(await runRetentionSweep(deps({ now: () => late }))).toBe(0);
    expect(await es.indices.exists({ index: sourceIndex }), '서비스 중인 인덱스를 지웠다').toBe(true);
    expect(
      (await jobRow(jobId)).progress['retired_at'],
      '롤백 중인 인덱스를 "처리했다"고 적었다 — 다음 기회가 사라진다',
    ).toBeUndefined();

    // 다시 앞으로 옮기면 그때 회수된다.
    await switchAlias(es, ALIAS, sourceIndex, targetIndex);
    expect(await runRetentionSweep(deps({ now: () => late }))).toBe(1);
    expect(await es.indices.exists({ index: sourceIndex })).toBe(false);
  });
});

describe('R4 전환은 됐는데 기록되지 않은 잡을 스스로 고친다 (PR #52 리뷰 P2)', () => {
  it('별칭이 실제로 그 인덱스를 가리키면 `switched_at`을 되채운다', async () => {
    await seedRelease('v12.0', 1);
    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId);
    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);

    // Elasticsearch 전환은 성공했으나 뒤이은 PostgreSQL 기록이 실패한 상태를 만든다.
    await pool.query(
      `UPDATE job SET progress = progress - 'switched_at', state = 'failed' WHERE job_id = $1`,
      [jobId],
    );
    expect((await jobRow(jobId)).progress['switched_at']).toBeUndefined();

    expect(await reconcileSwitchedJobs(deps())).toBe(1);
    expect(
      (await jobRow(jobId)).progress['switched_at'],
      '전환된 잡이 보관 대상에 영영 오르지 못한다',
    ).toEqual(expect.any(String));
  });

  it('**별칭이 그 인덱스를 가리키지 않으면 채우지 않는다**', async () => {
    // 전환하지 못한 잡을 전환했다고 적으면 옛 인덱스가 서비스 중에 지워진다.
    const jobId = await jobRepo.enqueueJob(pool, REINDEX_TYPE, ALIAS, 'test', {
      phase: 'verify',
      alias: ALIAS,
      source_index: await resolveServingIndex(es, ALIAS),
      target_index: concreteIndexName(ALIAS, 9_999),
    });
    await pool.query("UPDATE job SET state = 'failed' WHERE job_id = $1", [jobId]);

    expect(await reconcileSwitchedJobs(deps())).toBe(0);
    expect((await jobRow(jobId)).progress['switched_at']).toBeUndefined();
  });
});

describe('WP-032 선행 조건 증명 — 새 분석기·다중 필드로 무중단 전환한다 (CR-043, DEV-266·267)', () => {
  /**
   * v1에 **없는** 분석기와 다중 필드를 얹은 시험용 스키마.
   *
   * 이름은 `wp035_probe`다 — **WP-032의 실제 필드 이름을 선점하지 않는다.**
   * 그 WP가 `edge_ngram`의 `min_gram`·`max_gram`·`search_analyzer`를 정하며,
   * 여기서 증명하는 것은 값이 아니라 **그 값을 배포할 기계가 있다**는 사실이다.
   */
  function probeSchema(): VersionedIndexSchema {
    const base = schemaOf(ALIAS);
    const analysis = (base.settings.analysis ?? {}) as Record<string, Record<string, unknown>>;
    return {
      shards: base.shards,
      settings: {
        ...base.settings,
        analysis: {
          ...analysis,
          filter: {
            ...(analysis['filter'] ?? {}),
            wp035_probe_edge: { type: 'edge_ngram', min_gram: 2, max_gram: 8 },
          },
          analyzer: {
            ...(analysis['analyzer'] ?? {}),
            wp035_probe: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'wp035_probe_edge'],
            },
          },
        },
      },
      mappings: {
        ...base.mappings,
        properties: {
          ...(base.mappings.properties ?? {}),
          tag_name: {
            type: 'keyword',
            fields: {
              probe: { type: 'text', analyzer: 'wp035_probe', search_analyzer: 'standard' },
            },
          },
        },
      },
    };
  }

  /** 인덱스 설정에서 분석기 이름 목록을 읽는다. */
  async function analyzersOf(index: string): Promise<readonly string[]> {
    const found = await es.indices.getSettings({ index });
    const settings = found[index]?.settings as Record<string, unknown> | undefined;
    const scope = (settings?.['index'] ?? settings) as Record<string, unknown> | undefined;
    const analysis = scope?.['analysis'] as Record<string, unknown> | undefined;
    const analyzer = analysis?.['analyzer'] as Record<string, unknown> | undefined;
    return analyzer === undefined ? [] : Object.keys(analyzer);
  }

  it('전환 뒤 분석기가 실재하고 **기존 문서에도 새 필드가 채워진다**', async () => {
    await seedRelease('payment-gateway', 1);

    const before = await resolveServingIndex(es, ALIAS);
    // v1에는 그 분석기가 없다 — 그것이 이 증명의 출발점이다.
    expect(await analyzersOf(before)).not.toContain('wp035_probe');

    const { jobId, targetIndex } = await enqueue();
    await claim(jobId);
    await runClaimed(jobId, { schemaFor: probeSchema });

    expect(await resolveServingIndex(es, ALIAS)).toBe(targetIndex);

    // 1) 새 분석기가 새 인덱스에 있다.
    expect(await analyzersOf(targetIndex)).toContain('wp035_probe');

    /*
     * 2) **기존 문서에도 채워졌다.** 이것이 두 번째 벽이었다 (DEV-267) —
     * `putMapping`으로 서브필드만 더하면 배포는 성공하고 과거 데이터의 그 필드는
     * 비어 있다. 접두 세 글자로 찾히면 재색인이 실제로 그 필드를 만든 것이다.
     */
    await es.indices.refresh({ index: targetIndex });
    const hit = await es.search<Record<string, unknown>>({
      index: targetIndex,
      query: {
        bool: {
          filter: [{ term: { repository_id: REPOSITORY_ID } }],
          must: [{ match: { 'tag_name.probe': 'pay' } }],
        },
      },
    });
    expect(
      hit.hits.hits.map((one) => (one._source as Record<string, unknown>)['tag_name']),
      '새 다중 필드가 기존 문서에서 비어 있다 — putMapping과 다를 바 없다',
    ).toEqual(['payment-gateway']);

    // 3) 전환 내내 별칭은 정확히 하나를 가리켰다 — 무중단의 전제다.
    expect(Object.keys(await es.indices.getAlias({ name: ALIAS }))).toHaveLength(1);
  });
});

describe('WP-032 매핑 이행 증명 — 실제 PR 매핑을 재색인으로 배포한다 (CR-043, DEV-266·267)', () => {
  /*
   * 위 「WP-032 선행 조건 증명」은 **기계가 있다**는 사실을 임시 이름으로 보였다.
   * 여기서 보이는 것은 그 다음 단계다 — **WP-032가 실제로 정한 매핑**이 그
   * 경로로 배포되고, 그 뒤 과거 문서가 새 필드로 찾힌다.
   *
   * 출발점을 WP-032 **이전** 스키마로 만든다. 지금 별칭이 이미 새 매핑을 쓰는
   * 인덱스를 가리키고 있으면 "전환 덕분에 찾힌다"를 말할 수 없다 — 처음부터
   * 찾혔을 뿐인지 구분되지 않는다.
   */
  const LEGACY_SUFFIX = 9_000;

  /** WP-032 이전의 PR 스키마 — 부분 일치 분석기도 서브필드도 없다. */
  function legacySchema(): VersionedIndexSchema {
    const base = schemaOf(PR_ALIAS);
    const analysis = structuredClone(base.settings.analysis ?? {}) as Record<string, Record<string, unknown>>;
    delete analysis['analyzer']?.['text_partial_index'];
    delete analysis['filter']?.['edge_ngram_2_20'];

    const properties = structuredClone(base.mappings.properties ?? {}) as Record<string, Record<string, unknown>>;
    // 제목에서 `partial`만 걷어 낸다 — 나머지는 그대로 두어야 정본 재구축이 돈다.
    const title = properties['title'] as { fields?: Record<string, unknown> } | undefined;
    if (title?.fields !== undefined) delete title.fields['partial'];
    for (const field of ['base_branch', 'head_branch']) {
      const spec = properties[field] as { fields?: unknown } | undefined;
      if (spec !== undefined) delete spec.fields;
    }

    return {
      shards: base.shards,
      settings: { ...base.settings, analysis },
      mappings: { ...base.mappings, properties },
    };
  }

  /** 이 별칭의 다음 대상 인덱스. `enqueueReindex`가 쓰는 것과 같은 규칙이다. */
  async function nextPrIndex(): Promise<string> {
    const versions = await listIndexVersions(es, PR_ALIAS);
    const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
    return concreteIndexName(PR_ALIAS, highest + 1);
  }

  async function partialHits(index: string, term: string): Promise<number> {
    await es.indices.refresh({ index });
    const found = await es.search({
      index,
      size: 0,
      query: {
        bool: {
          filter: [{ term: { repository_id: REPOSITORY_ID } }],
          must: [{ match: { 'title.partial': term } }],
        },
      },
    });
    const total = found.hits.total;
    return typeof total === 'number' ? total : (total?.value ?? 0);
  }

  it('옛 매핑에서는 부분 일치 필드가 아예 없고, 전환 뒤에는 과거 문서까지 찾힌다', async () => {
    // 1) WP-032 이전 스키마의 인덱스를 세우고 별칭을 그리로 옮긴다.
    const legacyIndex = concreteIndexName(PR_ALIAS, LEGACY_SUFFIX);
    await es.indices.delete({ index: legacyIndex, ignore_unavailable: true });
    await createVersionedIndex(es, PR_ALIAS, LEGACY_SUFFIX, legacySchema());
    created.add(legacyIndex);
    const before = await resolveServingIndex(es, PR_ALIAS);
    await switchAlias(es, PR_ALIAS, before, legacyIndex);

    // 2) 정본에 문서를 남긴다 — 재구축이 읽을 것은 스냅숏이지 옛 색인이 아니다.
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber: 932,
      documentVersion: 1,
      source: 'webhook',
      document: {
        document_version: 1,
        doc_id: pullRequestDocId(REPOSITORY_ID, 932),
        pr_number: 932,
        title: '결제 재시도 로직 retry backoff',
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: 71,
        visibility: 'internal',
        allowed_team_ids: [11],
        repository_archived: false,
        state: 'merged',
        base_branch: 'main',
        head_branch: 'feature/payment-retry',
        indexed_at: '2026-08-01T00:00:00Z',
        source_commit_shas: [],
        merge_commit_sha: 'c'.repeat(40),
      },
    });
    // 옛 인덱스에도 같은 문서를 넣는다 — 전환 전후를 비교할 대상이다.
    await withReindexWrite(pool, (targets) =>
      bulkUpsert(
        es,
        [
          {
            alias: PR_ALIAS,
            id: pullRequestDocId(REPOSITORY_ID, 932),
            routing: String(REPOSITORY_ID),
            doc: {
              document_version: 1,
              doc_id: pullRequestDocId(REPOSITORY_ID, 932),
              pr_number: 932,
              title: '결제 재시도 로직 retry backoff',
              repository_id: REPOSITORY_ID,
              repository: `${OWNER}/${NAME}`,
              org_id: 71,
              visibility: 'internal',
              allowed_team_ids: [11],
              repository_archived: false,
              state: 'merged',
              base_branch: 'main',
              head_branch: 'feature/payment-retry',
              indexed_at: '2026-08-01T00:00:00Z',
            },
          },
        ],
        targets,
      ),
    );

    /*
     * 3) **옛 인덱스는 오류 없이 0건을 답한다.** 이것이 이 WP의 위험 그 자체다.
     *
     * 없는 필드에 `match`를 걸어도 Elasticsearch는 거절하지 않는다 — 조용히
     * 0건이다. 매핑만 올리고 배포하면 전문 검색이 **과거 데이터에 대해 조용히
     * 적게** 답하고, 아무 신호도 나지 않는다 (DEV-267). 배포가 터지는
     * 첫 번째 벽(비동적 설정, DEV-266)보다 이쪽이 무겁다.
     */
    expect(await partialHits(legacyIndex, '결제')).toBe(0);

    // 4) 현재 정의(= WP-032 매핑)로 재색인한다. 별도 배포 수단을 만들지 않는다.
    const targetIndex = await nextPrIndex();
    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (alias) => resolveServingIndex(es, alias),
        nextTargetIndex: async () => nextPrIndex(),
        isAlias: (value) => value === PR_ALIAS,
      },
      PR_ALIAS,
      'wp-032-migration',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    await claim(outcome.jobId);
    await runClaimed(outcome.jobId);

    const job = await jobRow(outcome.jobId);
    expect(job.state, `재구축이 완료되지 않았다: ${JSON.stringify(job.progress)}`).toBe('completed');

    // 5) 별칭이 옮겨졌고 정확히 하나를 가리킨다 — 무중단의 전제다.
    expect(await resolveServingIndex(es, PR_ALIAS)).toBe(targetIndex);
    expect(Object.keys(await es.indices.getAlias({ name: PR_ALIAS }))).toHaveLength(1);

    /*
     * 6) **과거 문서가 새 필드로 찾힌다.**
     *
     * "결제"는 제목의 독립 토큰이 아니다 — `standard` 토크나이저가 "결제"를
     * 끊어 주지 않으므로, `edge_ngram` 조각이 실제로 색인되지 않았다면 0건이다.
     * 이것이 `nori` 없이 FR-SRCH-011 AC-4가 성립한다는 증거다 (OD-005, CR-040).
     */
    expect(await partialHits(targetIndex, '결제')).toBe(1);
    expect(await partialHits(targetIndex, 'retr')).toBe(1);
    // 무관한 질의는 여전히 0건이다 — 조각이 아무거나 끌어오지 않는다.
    expect(await partialHits(targetIndex, '환불')).toBe(0);

    await es.indices.delete({ index: legacyIndex, ignore_unavailable: true });
  });
});

describe('R2 작성자 소속 팀도 현재 값으로 다시 쓴다 (WP-069 / CR-058, DEV-485)', () => {
  const ORG = 71;
  const CORE = 71_001;
  const PLATFORM = 71_002;

  /** PR 별칭에 대해 잡을 만든다. R1과 같은 형태다. */
  async function enqueuePr(): Promise<{ jobId: number; targetIndex: string }> {
    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (alias) => resolveServingIndex(es, alias),
        async nextTargetIndex(alias) {
          const versions = await listIndexVersions(es, alias);
          const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
          return concreteIndexName(alias, highest + 1);
        },
        isAlias: (value) => value === PR_ALIAS,
      },
      PR_ALIAS,
      'test',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    return { jobId: outcome.jobId, targetIndex: outcome.targetIndex };
  }

  async function snapshotWithTeams(prNumber: number, authorTeamIds: readonly number[]): Promise<void> {
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
      repositoryId: REPOSITORY_ID,
      prNumber,
      documentVersion: 9_000 + prNumber,
      source: 'webhook',
      document: {
        document_version: 9_000 + prNumber,
        doc_id: pullRequestDocId(REPOSITORY_ID, prNumber),
        pr_number: prNumber,
        title: '작성자 팀 재구축',
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: ORG,
        visibility: 'internal',
        allowed_team_ids: [],
        repository_archived: false,
        author: 'alice',
        author_team_ids: [...authorTeamIds],
        state: 'merged',
        indexed_at: '2026-08-01T00:00:00Z',
        source_commit_shas: [],
        base_branch: 'main',
      },
    });
  }

  async function rebuiltDoc(targetIndex: string, prNumber: number): Promise<Record<string, unknown> | undefined> {
    await es.indices.refresh({ index: targetIndex });
    const found = await es.search<Record<string, unknown>>({
      index: targetIndex,
      query: { term: { repository_id: REPOSITORY_ID } },
    });
    return found.hits.hits.find(
      (one) => (one._source as Record<string, unknown>)['pr_number'] === prNumber,
    )?._source as Record<string, unknown> | undefined;
  }

  afterEach(async () => {
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1 AND pr_number >= 600', [
      REPOSITORY_ID,
    ]);
    await pool.query('DELETE FROM team_membership WHERE team_id = ANY($1::bigint[])', [[CORE, PLATFORM]]);
    await pool.query('DELETE FROM org_team_sync WHERE org_id = $1', [ORG]);
    await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[CORE, PLATFORM]]);
  });

  it('**스냅숏이 박제한 옛 소속이 재구축으로 되살아나지 않는다**', async () => {
    // 투영 시점에는 core에 있었다.
    await snapshotWithTeams(601, [CORE]);
    // 그 뒤 platform으로 옮겼다 — 정본만 바뀐 상태다.
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [
        { teamId: CORE, slug: 'wp069-core', logins: ['bob'] },
        { teamId: PLATFORM, slug: 'wp069-platform', logins: ['alice'] },
      ],
      new Date(),
    );

    const { jobId, targetIndex } = await enqueuePr();
    await claim(jobId);
    await runClaimed(jobId);
    expect((await jobRow(jobId)).state).toBe('completed');

    const doc = await rebuiltDoc(targetIndex, 601);
    expect(doc, 'PR 문서를 재구축하지 못했다').toBeDefined();
    expect(doc?.['author_team_ids'], '옛 소속이 재구축으로 되살아났다').toEqual([PLATFORM]);
  });

  it('**동기화가 낡았으면 스냅숏의 옛 소속을 지운다** — 모르는 것을 아는 것처럼 되살리지 않는다', async () => {
    await snapshotWithTeams(602, [CORE, PLATFORM]);
    // `org_team_sync` 행이 없다 = 한 번도 물어본 적이 없다 = 모름.

    const { jobId, targetIndex } = await enqueuePr();
    await claim(jobId);
    await runClaimed(jobId);
    expect((await jobRow(jobId)).state).toBe('completed');

    const doc = await rebuiltDoc(targetIndex, 602);
    expect(doc, 'PR 문서를 재구축하지 못했다').toBeDefined();
    expect(Object.keys(doc ?? {}), '모름인데 옛 소속이 남았다').not.toContain('author_team_ids');
  });

  it('**소속이 없어지면 빈 배열로 재구축한다** — 부재와 다르다', async () => {
    await snapshotWithTeams(603, [CORE]);
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'wp069-core', logins: ['bob'] }],
      new Date(),
    );

    const { jobId, targetIndex } = await enqueuePr();
    await claim(jobId);
    await runClaimed(jobId);
    expect((await jobRow(jobId)).state).toBe('completed');

    expect((await rebuiltDoc(targetIndex, 603))?.['author_team_ids']).toEqual([]);
  });

  it('**재구축이 GHE를 부르지 않는다** — `ReindexDeps`에 GitHub 자격이 없다 (ADR-004)', async () => {
    // 타입이 그것을 강제한다. 이 시험은 그 사실을 회귀로 고정한다.
    const keys = Object.keys(deps());
    expect(keys).not.toContain('github');
    expect(keys).not.toContain('client');
  });
});
