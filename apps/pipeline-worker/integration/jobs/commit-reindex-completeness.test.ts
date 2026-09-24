/**
 * 커밋 재색인의 완전성 — 기대 집합과 메타데이터 (CR-119 / WP-103, FR-ING-008 AC-10).
 *
 * ## 이 시험이 막는 것
 *
 * 사내 `0.1.0-pilot.18`에서 prs-commits 재색인이 전환 전 검증에서 멈췄다. 원인은 두 겹이다.
 *
 * 1. **기대 건수가 쓰기 결과와 무관하게 세어졌다.** 재구축은 `commit_snapshot`의 모든 행을
 *    기대 문서 ID에 넣었지만, 체인 밖이고 어느 PR 스냅숏에도 없는 행은 문서를 만들 근거가
 *    없어(`createWith` 없음) 새 인덱스에 문서가 생기지 않는다. 그 404는 `noop`으로 삼켜졌다.
 * 2. **숨은 결함: 원본 커밋의 메타데이터가 새 인덱스에서 비었다.** 메타데이터 쓰기가 PR 유래
 *    문서 생성보다 먼저 돌아서, 새 인덱스에는 메시지·작성자가 없는 원본 커밋 문서가 섰다.
 *    기대 건수만 고치면 이 누락이 그대로 전환을 통과한다.
 *
 * 그래서 기대 집합은 정본과 생성 정책에서 문서 ID로 계산하고, 전환 전 검증은 개수가 아니라
 * **필수 ID의 존재와 알려진 메타데이터의 값**을 본다. 웹훅도 러너도 돌리지 않는다 (ADR-004).
 *
 * 검증: `pnpm test:integration jobs/commit-reindex-completeness`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  commitSnapshotRepo,
  jobRepo,
  mergeSequenceRepo,
  prCommitLinkRepo,
  prSnapshotRepo,
  reindexRepo,
  repositoryRepo,
  withReindexWrite,
  withTransaction,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { commitDocId } from '@prs/domain';
import {
  applyMappings,
  bulkUpsert,
  concreteIndexName,
  createEsClient,
  createVersionedIndex,
  listIndexVersions,
  resolveServingIndex,
  schemaOf,
  switchAlias,
  upsertCommitMetadata,
} from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { runReindexJob, verifyBeforeCutover, type ReindexDeps, type ReindexLogFields } from '../../src/reindex.js';
import { buildProjectedCommitDocument } from '../../src/documents.js';
import { commitMetadataFields } from '../../src/commit-enrich.js';
import { migratedPool, removeOrphanCommitLinks } from '../helpers.js';

const ALIAS = 'prs-commits';
const REPOSITORY_ID = 9371;
const OWNER = 'acme';
const NAME = 'commit-reindex-completeness';

/** 체인 커밋(직접 푸시). */
const SHA_D = 'dd01000000000000000000000000000000000001';
/** 체인 커밋(PR 200의 머지 커밋). */
const SHA_M = 'dd02000000000000000000000000000000000002';
/** PR 유래 원본 커밋. 스냅숏이 있다. */
const SHA_S1 = 'ee01000000000000000000000000000000000001';
/** PR 유래 원본 커밋. 스냅숏이 있다 (두 PR이 함께 가진다 — N:M). */
const SHA_S2 = 'ee02000000000000000000000000000000000002';
/** PR 유래 원본 커밋. **스냅숏이 아직 없다** (미수집). */
const SHA_S3 = 'ee03000000000000000000000000000000000003';
/** 스냅숏만 있고 체인에도 PR 스냅숏에도 없다 — 생성 근거가 없다. */
const SHA_X = 'ff01000000000000000000000000000000000001';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;
let originalIndex: string;
const created = new Set<string>();

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  await applyMappings(es);
  originalIndex = await resolveServingIndex(es, ALIAS);
}, 120_000);

afterAll(async () => {
  /*
   * 별칭을 원래 인덱스로 되돌리고 이 파일이 만든 인덱스를 지운다 (`link-reindex.test.ts`와 같다).
   * 이미 원래 인덱스를 가리키면 건드리지 않는다 — 같은 인덱스로 remove·add를 보내면 거부된다.
   */
  const serving = await resolveServingIndex(es, ALIAS).catch(() => originalIndex);
  if (serving !== originalIndex) {
    await switchAlias(es, ALIAS, serving, originalIndex).catch(() => undefined);
  }
  for (const index of created) {
    if (index === originalIndex) continue;
    await es.indices.delete({ index, ignore_unavailable: true }).catch(() => undefined);
  }
  await cleanCanonical();
  await es.close();
  await pool.end();
});

async function cleanCanonical(): Promise<void> {
  await pool.query('DELETE FROM commit_link_state WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_commit_link WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_link_observation WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_work WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query("DELETE FROM job WHERE type = 'reindex'");
}

beforeEach(async () => {
  await cleanCanonical();
  // 재색인은 DB 전체를 본다 — 다른 파일이 남긴 근거 없는 관계 행이 판정을 막지 않게 한다 (DEV-763).
  await removeOrphanCommitLinks(pool);
  /*
   * **서비스 인덱스와 앞 시험의 버전 인덱스에 남은 이 저장소 문서를 지운다.** 남아 있으면
   * 다음 시험의 재구축이 그 흔적 위에서 판정되어, 시험이 제품이 아니라 앞 시험을 재게 된다.
   */
  await es.deleteByQuery({
    index: `${ALIAS}*`,
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
    ignore_unavailable: true,
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 71,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  repository = found;
});

/* ------------------------------------------------------------------------- */
/* 정본 시드                                                                   */
/* ------------------------------------------------------------------------- */

const COMMITTED_AT = new Date('2026-09-01T00:00:00.000Z');

interface SnapshotSeed {
  readonly author?: string | null;
  readonly committer?: string | null;
  readonly patchId?: string | null;
  readonly patchIdUnavailable?: string | null;
}

async function seedCommitSnapshot(sha: string, seed: SnapshotSeed = {}): Promise<void> {
  await commitSnapshotRepo.upsertCommitSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    commitSha: sha,
    parentShas: ['a'.repeat(40)],
    message: `message of ${sha.slice(0, 8)}`,
    author: seed.author === undefined ? `author-${sha.slice(0, 4)}` : seed.author,
    committer: seed.committer === undefined ? `committer-${sha.slice(0, 4)}` : seed.committer,
    authoredAt: COMMITTED_AT,
    committedAt: COMMITTED_AT,
    changedPaths: [`src/${sha.slice(0, 6)}.ts`],
    changedPathsTruncated: false,
    patchId: seed.patchId === undefined ? `patch-${sha.slice(0, 6)}` : seed.patchId,
    patchIdUnavailable: seed.patchIdUnavailable ?? null,
    metadataSource: 'api',
  });
}

let spaceSeeded = false;

async function seedChain(sha: string, seq: number, prNumber: number | null): Promise<void> {
  if (!spaceSeeded) {
    await pool.query(
      `INSERT INTO sequence_space (repository_id, base_branch, seq_epoch, head_sha, head_seq, state)
       VALUES ($1, 'main', 1, $2, $3, 'ok')
       ON CONFLICT (repository_id, base_branch) DO UPDATE SET head_sha = EXCLUDED.head_sha, head_seq = EXCLUDED.head_seq`,
      [REPOSITORY_ID, sha, seq],
    );
  } else {
    await pool.query(
      `UPDATE sequence_space SET head_sha = $2, head_seq = $3 WHERE repository_id = $1 AND base_branch = 'main'`,
      [REPOSITORY_ID, sha, seq],
    );
  }
  spaceSeeded = true;
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: REPOSITORY_ID,
    base_branch: 'main',
    seq_epoch: 1,
    merge_seq: seq,
    commit_sha: sha,
    pull_request_number: prNumber,
    committed_at: COMMITTED_AT,
  });
}

beforeEach(() => {
  spaceSeeded = false;
});

interface PrSeed {
  readonly state: 'open' | 'merged';
  readonly sources: readonly string[];
  readonly mergeSha?: string;
}

async function seedPullRequest(prNumber: number, seed: PrSeed): Promise<void> {
  const version = Date.parse('2026-09-02T00:00:00Z') + prNumber;
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    documentVersion: version,
    source: 'webhook',
    document: {
      document_version: version,
      repository_id: REPOSITORY_ID,
      pr_number: prNumber,
      state: seed.state,
      base_branch: 'main',
      source_commit_shas: [...seed.sources],
      ...(seed.mergeSha === undefined ? {} : { merge_commit_sha: seed.mergeSha }),
      enrichment_pending: false,
    },
  });
}

/** 관계 정본. 관계 replay와 그 검증이 이 시험의 대상과 어긋나지 않게 스냅숏과 같은 모양으로 둔다. */
async function seedLinks(prNumber: number, sources: readonly string[], mergeSha: string | null): Promise<void> {
  await withTransaction(pool, async (client) => {
    await prCommitLinkRepo.adoptLinkObservation(client, {
      repositoryId: REPOSITORY_ID,
      prNumber,
      observedVersion: 1_000,
      sourceShas: sources,
      mergeSha,
      commitsComplete: true,
      pullRequestAuthoritative: true,
      commitsErrorKind: null,
      apiCommitCount: sources.length,
      sourceCommitsTruncated: false,
      headSha: null,
      baseSha: null,
      baseBranch: 'main',
      prState: mergeSha === null ? 'open' : 'merged',
      reason: null,
    });
  });
  const shas = mergeSha === null ? [...sources] : [...sources, mergeSha];
  await pool.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT $1, sha, 1, 1, 'done' FROM unnest($2::text[]) AS sha
     ON CONFLICT DO NOTHING`,
    [REPOSITORY_ID, shas],
  );
}

/* ------------------------------------------------------------------------- */
/* 재색인 실행                                                                 */
/* ------------------------------------------------------------------------- */

interface Enqueued {
  readonly jobId: number;
  readonly targetIndex: string;
}

async function enqueue(): Promise<Enqueued> {
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
  await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
  return { jobId: outcome.jobId, targetIndex: outcome.targetIndex };
}

async function run(
  enqueued: Enqueued,
  client: Client = es,
  log?: (fields: ReindexLogFields) => void,
): Promise<{ readonly state: string; readonly error: string | null }> {
  const row = await jobRepo.findJobById(pool, enqueued.jobId);
  if (row === undefined) throw new Error('잡을 찾지 못했다');
  const deps: ReindexDeps = { pool, es: client, ...(log === undefined ? {} : { log }) };
  await runReindexJob(deps, row);
  await es.indices.refresh({ index: enqueued.targetIndex });
  const after = await jobRepo.findJobById(pool, enqueued.jobId);
  return { state: after?.state ?? 'missing', error: after?.error ?? null };
}

async function enqueueAndRun(): Promise<Enqueued & { readonly state: string; readonly error: string | null }> {
  const enqueued = await enqueue();
  const outcome = await run(enqueued);
  return { ...enqueued, ...outcome };
}

type Source = Record<string, unknown>;

async function docIn(index: string, sha: string): Promise<Source | null> {
  try {
    const found = await es.get<Source>({ index, id: commitDocId(REPOSITORY_ID, sha), routing: String(REPOSITORY_ID) });
    return found._source ?? null;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

/** 정본 스냅숏이 약속한 메타데이터가 문서에 그대로 있는지 — 값 비교이며 `null`도 값이다. */
function expectMetadataOf(doc: Source | null, sha: string, seed: SnapshotSeed = {}): void {
  expect(doc).not.toBeNull();
  const source = doc as Source;
  expect(source['message']).toBe(`message of ${sha.slice(0, 8)}`);
  expect(source['parent_shas']).toEqual(['a'.repeat(40)]);
  expect('author' in source).toBe(true);
  expect(source['author']).toBe(seed.author === undefined ? `author-${sha.slice(0, 4)}` : seed.author);
  expect('committer' in source).toBe(true);
  expect(source['committer']).toBe(seed.committer === undefined ? `committer-${sha.slice(0, 4)}` : seed.committer);
  expect(source['authored_at']).toBe(COMMITTED_AT.toISOString());
  expect(source['committed_at']).toBe(COMMITTED_AT.toISOString());
  expect(source['changed_paths']).toEqual([`src/${sha.slice(0, 6)}.ts`]);
  expect(source['changed_paths_truncated']).toBe(false);
  expect(source['patch_id']).toBe(seed.patchId === undefined ? `patch-${sha.slice(0, 6)}` : seed.patchId ?? undefined);
}

/* ------------------------------------------------------------------------- */
/* 시험                                                                        */
/* ------------------------------------------------------------------------- */

describe('기대 집합은 정본과 생성 정책에서 나온다 (CR-119, FR-ING-008 AC-10)', () => {
  it('**생성 근거 없는 체인 밖 스냅숏은 기대 집합에 없고 문서도 만들지 않는다** — 전환이 막히지 않는다', async () => {
    await seedChain(SHA_D, 1, null);
    await seedCommitSnapshot(SHA_D);
    // 체인 밖이고 어느 PR 스냅숏의 원본 목록에도 없다 — rebase로 PR에서 빠진 옛 커밋의 모양이다.
    await seedCommitSnapshot(SHA_X);
    /*
     * **서비스 인덱스에는 그 커밋의 옛 문서가 있다** — PR에 속해 있던 시절 투영이 만든 것이다. 재구축은
     * 서비스 쪽 결과(문서가 있어 갱신됨)가 아니라 **대상 쪽 결과**(문서 없음)로 판정해야 한다.
     * 서비스 결과로 판정하면 새 인덱스에 없는 값을 반영했다고 센다.
     */
    await withReindexWrite(pool, (targets) =>
      bulkUpsert(
        es,
        [
          buildProjectedCommitDocument({
            repository,
            commitSha: SHA_X,
            role: 'source_commit',
            pullRequestNumber: 90,
            baseBranch: 'main',
            documentVersion: Date.parse('2026-08-01T00:00:00Z'),
            enrichmentPending: false,
            indexedAt: new Date().toISOString(),
          }),
        ],
        targets,
      ),
    );

    const enqueued = await enqueue();
    const logs: ReindexLogFields[] = [];
    const outcome = await run(enqueued, es, (fields) => logs.push(fields));

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    expect(await resolveServingIndex(es, ALIAS)).toBe(enqueued.targetIndex);
    expect(await docIn(enqueued.targetIndex, SHA_D)).not.toBeNull();
    // 근거 없는 문서를 만들지 않는다 (DEV-213, fail closed) — 서비스에 있던 옛 문서를 옮기지도 않는다 (ADR-004).
    expect(await docIn(enqueued.targetIndex, SHA_X)).toBeNull();
    // 스냅숏도 지우지 않는다.
    const kept = await pool.query('SELECT 1 FROM commit_snapshot WHERE repository_id = $1 AND commit_sha = $2', [REPOSITORY_ID, SHA_X]);
    expect(kept.rowCount).toBe(1);
    // 대상 결과로 셌다 — 반영 0, 문서 없음 1.
    const pass = logs.find((one) => one.message === '원본 커밋 메타데이터 반영' && (one.detail ?? '').includes(`repository_id=${String(REPOSITORY_ID)} `));
    expect(pass?.detail).toBe(`repository_id=${String(REPOSITORY_ID)} applied=0 without_document=1`);
  }, 120_000);

  it('**PR 원본 커밋 문서에 정본 메타데이터가 채워진다** — 문서 생성보다 먼저 쓴 메타데이터가 사라지지 않는다', async () => {
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1] });
    await seedCommitSnapshot(SHA_S1);

    const outcome = await enqueueAndRun();

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    const doc = await docIn(outcome.targetIndex, SHA_S1);
    expectMetadataOf(doc, SHA_S1);
    // 역할은 PR 투영이 정한 원본 커밋이다 — 메타데이터 경로가 덮지 않는다 (DEV-207).
    expect(doc?.['role']).toBe('source_commit');
  }, 120_000);

  it('직접 푸시 체인 커밋·병합 PR의 머지 커밋·N:M 원본 커밋·미수집 원본 커밋이 함께 복원된다', async () => {
    await seedChain(SHA_D, 1, null);
    await seedChain(SHA_M, 2, 200);
    await seedCommitSnapshot(SHA_D);
    await seedCommitSnapshot(SHA_M);
    await seedCommitSnapshot(SHA_S2);
    // S3은 스냅숏이 없다 — 보강이 아직 닿지 않은 원본 커밋이다.
    await seedPullRequest(200, { state: 'merged', sources: [SHA_S2], mergeSha: SHA_M });
    await seedPullRequest(201, { state: 'open', sources: [SHA_S2, SHA_S3] });
    await seedLinks(200, [SHA_S2], SHA_M);
    await seedLinks(201, [SHA_S2, SHA_S3], null);

    const outcome = await enqueueAndRun();

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');

    const d = await docIn(outcome.targetIndex, SHA_D);
    expectMetadataOf(d, SHA_D);
    expect(d?.['role']).toBe('direct_push');

    const m = await docIn(outcome.targetIndex, SHA_M);
    expectMetadataOf(m, SHA_M);
    expect(m?.['role']).toBe('merge_commit');
    expect(m?.['pull_request_numbers']).toEqual([200]);

    const s2 = await docIn(outcome.targetIndex, SHA_S2);
    expectMetadataOf(s2, SHA_S2);
    expect([...((s2?.['pull_request_numbers'] as number[] | undefined) ?? [])].sort()).toEqual([200, 201]);

    // 미수집 원본 커밋: 문서는 있고, 모르는 메타데이터를 지어내지 않는다.
    const s3 = await docIn(outcome.targetIndex, SHA_S3);
    expect(s3).not.toBeNull();
    expect(s3?.['message']).toBeUndefined();
    expect(s3?.['pull_request_numbers']).toEqual([201]);
  }, 120_000);

  it('**관측이 불완전해 남은 `source` 연결의 커밋도 문서를 복원한다** — 최신 목록에 없어도 정본은 그 PR에 속한다고 말한다 (CR-116)', async () => {
    // 완전한 관측이 [S1, S2]를 채택했다.
    await seedLinks(100, [SHA_S1, SHA_S2], null);
    // 그 뒤 관측은 250건에서 잘려 불완전했고 목록에 S1만 있었다 — S2 연결은 지우지 못하고 남는다.
    await withTransaction(pool, async (client) => {
      const outcome = await prCommitLinkRepo.adoptLinkObservation(client, {
        repositoryId: REPOSITORY_ID,
        prNumber: 100,
        observedVersion: 2_000,
        sourceShas: [SHA_S1],
        mergeSha: null,
        commitsComplete: false,
        pullRequestAuthoritative: true,
        commitsErrorKind: null,
        apiCommitCount: 251,
        sourceCommitsTruncated: true,
        headSha: null,
        baseSha: null,
        baseBranch: 'main',
        prState: 'open',
        reason: 'truncated',
      });
      expect(outcome.withheld).toEqual([SHA_S2]);
    });
    // PR 스냅숏은 최신 관측의 목록이다.
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1] });
    await seedCommitSnapshot(SHA_S2);

    const outcome = await enqueueAndRun();

    // 전에는 관계 replay가 `commit_link_replay_document_missing`으로 재색인을 실패시켰다.
    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    const s2 = await docIn(outcome.targetIndex, SHA_S2);
    expectMetadataOf(s2, SHA_S2);
    expect(s2?.['role']).toBe('source_commit');
    expect(s2?.['pull_request_numbers']).toEqual([100]);
  }, 120_000);

  it('실제 `null` 메타데이터는 값으로 복원된다 — 필드 부재와 다르다', async () => {
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1] });
    await seedCommitSnapshot(SHA_S1, { author: null, patchId: null, patchIdUnavailable: 'no_mirror' });

    const outcome = await enqueueAndRun();

    expect(outcome.state).toBe('completed');
    const doc = await docIn(outcome.targetIndex, SHA_S1);
    expectMetadataOf(doc, SHA_S1, { author: null, patchId: null });
    expect(doc?.['patch_id_unavailable']).toBe('no_mirror');
  }, 120_000);
});

describe('전환 전 검증은 개수가 아니라 필수 ID와 값을 본다 (CR-119, FR-ING-008 AC-10)', () => {
  async function builtTarget(): Promise<Enqueued> {
    await seedChain(SHA_D, 1, null);
    await seedCommitSnapshot(SHA_D);
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1, SHA_S2, SHA_S3] });
    await seedCommitSnapshot(SHA_S1, { author: null });
    await seedCommitSnapshot(SHA_S2);
    const outcome = await enqueueAndRun();
    expect(outcome.state).toBe('completed');
    return outcome;
  }

  it('**필수 문서 하나를 지우고 무관한 문서 하나를 더해 개수만 맞추면 검증이 실패한다**', async () => {
    const built = await builtTarget();
    const before = await es.count({ index: built.targetIndex, query: { term: { repository_id: REPOSITORY_ID } } });

    const kept = await docIn(built.targetIndex, SHA_S2);
    await es.delete({ index: built.targetIndex, id: commitDocId(REPOSITORY_ID, SHA_S2), routing: String(REPOSITORY_ID), refresh: true });
    const stranger = 'b'.repeat(40);
    await es.index({
      index: built.targetIndex,
      id: commitDocId(REPOSITORY_ID, stranger),
      routing: String(REPOSITORY_ID),
      document: { ...(kept as Source), commit_sha: stranger, doc_id: commitDocId(REPOSITORY_ID, stranger) },
      refresh: true,
    });
    const after = await es.count({ index: built.targetIndex, query: { term: { repository_id: REPOSITORY_ID } } });
    expect(after.count).toBe(before.count);

    const verdict = await verifyBeforeCutover({ pool, es }, built.jobId, null);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes('커밋 문서 누락') && reason.includes(SHA_S2.slice(0, 12)))).toBe(true);
  }, 120_000);

  it('**알려진 메타데이터 하나가 빠지면 검증이 실패한다** — 실제 `null`과 미수집은 실패가 아니다', async () => {
    const built = await builtTarget();

    const clean = await verifyBeforeCutover({ pool, es }, built.jobId, null);
    // 전환이 끝난 잡이라 상태 사유는 남는다. 커밋 문서 사유는 없어야 한다.
    expect(clean.reasons.filter((reason) => reason.includes('커밋 문서') || reason.includes('메타데이터'))).toEqual([]);

    await es.update({
      index: built.targetIndex,
      id: commitDocId(REPOSITORY_ID, SHA_S2),
      routing: String(REPOSITORY_ID),
      refresh: true,
      script: { lang: 'painless', source: "ctx._source.remove('committer')" },
    });

    const verdict = await verifyBeforeCutover({ pool, es }, built.jobId, null);

    expect(verdict.ok).toBe(false);
    const flagged = verdict.reasons.filter((reason) => reason.includes('메타데이터'));
    expect(flagged.some((reason) => reason.includes(SHA_S2.slice(0, 12)) && reason.includes('committer'))).toBe(true);
    // S1의 `author: null`은 정본의 값이고, S3은 스냅숏이 없다 — 둘 다 사유가 아니다.
    expect(flagged.some((reason) => reason.includes(SHA_S1.slice(0, 12)))).toBe(false);
    expect(flagged.some((reason) => reason.includes(SHA_S3.slice(0, 12)))).toBe(false);
  }, 120_000);

  it('`null`인 값의 **필드 자체가 사라지면** 누락으로 잡는다', async () => {
    const built = await builtTarget();
    await es.update({
      index: built.targetIndex,
      id: commitDocId(REPOSITORY_ID, SHA_S1),
      routing: String(REPOSITORY_ID),
      refresh: true,
      script: { lang: 'painless', source: "ctx._source.remove('author')" },
    });

    const verdict = await verifyBeforeCutover({ pool, es }, built.jobId, null);

    expect(verdict.reasons.some((reason) => reason.includes('메타데이터') && reason.includes(SHA_S1.slice(0, 12)) && reason.includes('author'))).toBe(true);
  }, 120_000);
});

describe('재색인과 겹친 쓰기·중단·반복 (CR-119)', () => {
  it('**재구축이 문서를 만들기 전에 도착한 늦은 메타데이터**도 새 인덱스에 남는다', async () => {
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1] });
    // 서비스 인덱스에는 평시 투영이 만든 문서가 있다.
    await withReindexWrite(pool, (targets) =>
      bulkUpsert(
        es,
        [
          buildProjectedCommitDocument({
            repository,
            commitSha: SHA_S1,
            role: 'source_commit',
            pullRequestNumber: 100,
            baseBranch: 'main',
            documentVersion: Date.parse('2026-09-02T00:00:00Z'),
            enrichmentPending: false,
            indexedAt: new Date().toISOString(),
          }),
        ],
        targets,
      ),
    );

    // 잡이 이중 쓰기를 켠 뒤·재구축이 문서를 만들기 전이다.
    const enqueued = await enqueue();
    await createVersionedIndex(es, ALIAS, Number(/-v(\d+)$/.exec(enqueued.targetIndex)?.[1]), schemaOf(ALIAS));
    await reindexRepo.patchReindexProgress(pool, enqueued.jobId, { phase: 'dual_write', dual_write_since: new Date().toISOString() });

    // 보강이 정본을 먼저 쓰고 색인에 쓴다. 대상 인덱스에는 아직 문서가 없다.
    await seedCommitSnapshot(SHA_S1);
    const snapshot = (await commitSnapshotRepo.listCommitSnapshotsAfter(pool, REPOSITORY_ID, '', 10))[0];
    if (snapshot === undefined) throw new Error('스냅숏이 없다');
    const live = await withReindexWrite(pool, (targets) =>
      upsertCommitMetadata(
        es,
        {
          repositoryId: REPOSITORY_ID,
          commitSha: SHA_S1,
          docId: commitDocId(REPOSITORY_ID, SHA_S1),
          fields: commitMetadataFields({
            parentShas: snapshot.parent_shas,
            message: snapshot.message,
            author: snapshot.author,
            committer: snapshot.committer,
            authoredAt: snapshot.authored_at.toISOString(),
            committedAt: snapshot.committed_at.toISOString(),
            changedPaths: snapshot.changed_paths,
            changedPathsTruncated: snapshot.changed_paths_truncated,
            patchId: snapshot.patch_id,
            patchIdUnavailable: snapshot.patch_id_unavailable,
          }),
        },
        targets,
      ),
    );
    expect(live.result).toBe('updated');

    const outcome = await run(enqueued);

    expect(outcome.error).toBeNull();
    expect(outcome.state).toBe('completed');
    expectMetadataOf(await docIn(enqueued.targetIndex, SHA_S1), SHA_S1);
  }, 120_000);

  it('**중간에 실패한 재색인 뒤 다시 돌린 재색인**이 완전한 인덱스로 전환한다', async () => {
    await seedChain(SHA_D, 1, null);
    await seedCommitSnapshot(SHA_D);
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1, SHA_S2] });
    await seedCommitSnapshot(SHA_S1);
    await seedCommitSnapshot(SHA_S2);

    const first = await enqueue();
    /*
     * 대상 인덱스에 대한 **두 번째 부분 갱신**에서 연결이 끊긴 것처럼 던진다. 서비스 쪽은
     * 멀쩡하다 — shadow 실패가 잡을 실패로 만들고 별칭은 그대로여야 한다 (FR-ING-008 AC-5).
     */
    let updates = 0;
    const flaky = new Proxy(es, {
      get(target, property, receiver) {
        if (property === 'update') {
          return async (params: Parameters<Client['update']>[0]) => {
            if (params.index === first.targetIndex) {
              updates += 1;
              if (updates === 2) throw new Error('injected: connection reset');
            }
            return target.update(params);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const failed = await run(first, flaky);
    expect(failed.state).toBe('failed');
    expect(await resolveServingIndex(es, ALIAS)).not.toBe(first.targetIndex);

    const second = await enqueue();
    expect(second.targetIndex).not.toBe(first.targetIndex);
    const done = await run(second);

    expect(done.error).toBeNull();
    expect(done.state).toBe('completed');
    expect(await resolveServingIndex(es, ALIAS)).toBe(second.targetIndex);
    expectMetadataOf(await docIn(second.targetIndex, SHA_D), SHA_D);
    expectMetadataOf(await docIn(second.targetIndex, SHA_S1), SHA_S1);
    expectMetadataOf(await docIn(second.targetIndex, SHA_S2), SHA_S2);
  }, 120_000);

  /**
   * 잡이 `phase`에 이르렀을 때 한 번, 대상 인덱스를 지우고 **쓰기 하나로 같은 이름을 자동 생성**한다.
   * 운영자 실수나 외부 정리 뒤 이중 쓰기가 닿은 모양이다. 새 인덱스는 동적 매핑이고 UUID가 다르다.
   * `method`는 그 단계에서 대상에 대해 처음 불리는 `indices` 호출이다.
   */
  function replacingTargetAt(
    enqueued: Enqueued,
    phase: 'verify' | 'cutover',
    method: 'exists' | 'getSettings',
  ): { readonly client: Client; readonly replaced: () => boolean } {
    let replaced = false;
    const indices = new Proxy(es.indices, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        const bound = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
        if (property !== method) return bound;
        return async (params: { index?: unknown }, ...rest: unknown[]) => {
          if (!replaced && params.index === enqueued.targetIndex) {
            const job = await reindexRepo.findReindexJob(pool, enqueued.jobId);
            if (job?.progress.phase === phase) {
              replaced = true;
              await es.indices.delete({ index: enqueued.targetIndex });
              await es.index({ index: enqueued.targetIndex, id: 'stray', document: { stray: true }, refresh: true });
            }
          }
          return bound(params, ...rest);
        };
      },
    });
    const client = new Proxy(es, {
      get(target, property, receiver) {
        if (property === 'indices') return indices;
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    return { client, replaced: () => replaced };
  }

  async function seedSmall(): Promise<void> {
    await seedChain(SHA_D, 1, null);
    await seedCommitSnapshot(SHA_D);
    await seedPullRequest(100, { state: 'open', sources: [SHA_S1] });
    await seedCommitSnapshot(SHA_S1);
  }

  it('**검증 전에 대상이 같은 이름의 다른 인덱스로 바뀌면 전환하지 않는다** — 이름이 아니라 UUID로 대조한다', async () => {
    await seedSmall();
    const serving = await resolveServingIndex(es, ALIAS);
    const enqueued = await enqueue();
    const probe = replacingTargetAt(enqueued, 'verify', 'exists');

    const outcome = await run(enqueued, probe.client);

    expect(probe.replaced()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('대상 인덱스가 바뀌었다');
    // 별칭은 옮겨 가지 않았다 — 기존 인덱스가 계속 서비스한다 (FR-ING-008 AC-5).
    expect(await resolveServingIndex(es, ALIAS)).toBe(serving);
  }, 120_000);

  it('**검증과 전환 사이에 대상이 바뀌어도 울타리 안에서 다시 대조해 전환하지 않는다**', async () => {
    await seedSmall();
    const serving = await resolveServingIndex(es, ALIAS);
    const enqueued = await enqueue();
    // 검증은 원래 인덱스를 보고 통과한다. 바꿔치기는 전환 단계의 UUID 조회 직전에 일어난다.
    const probe = replacingTargetAt(enqueued, 'cutover', 'getSettings');

    const outcome = await run(enqueued, probe.client);

    expect(probe.replaced()).toBe(true);
    expect(outcome.state).toBe('failed');
    expect(outcome.error ?? '').toContain('target_index_replaced');
    expect(await resolveServingIndex(es, ALIAS)).toBe(serving);
  }, 120_000);

  it('**두 번째 재색인도 같은 문서를 만든다** — 전환한 인덱스에서 다시 전환한다', async () => {
    await seedChain(SHA_D, 1, null);
    await seedChain(SHA_M, 2, 200);
    await seedCommitSnapshot(SHA_D);
    await seedCommitSnapshot(SHA_M);
    await seedCommitSnapshot(SHA_S1);
    await seedCommitSnapshot(SHA_X);
    await seedPullRequest(200, { state: 'merged', sources: [SHA_S1, SHA_S3], mergeSha: SHA_M });
    await seedLinks(200, [SHA_S1, SHA_S3], SHA_M);

    const first = await enqueueAndRun();
    expect(first.error).toBeNull();
    expect(first.state).toBe('completed');
    const second = await enqueueAndRun();
    expect(second.error).toBeNull();
    expect(second.state).toBe('completed');
    expect(await resolveServingIndex(es, ALIAS)).toBe(second.targetIndex);

    // 색인 시각은 회차마다 다르다 — 그 밖의 필드가 같아야 한다.
    const strip = (doc: Source | null): Source | null => {
      if (doc === null) return null;
      const rest: Source = { ...doc };
      delete rest['indexed_at'];
      return rest;
    };
    for (const sha of [SHA_D, SHA_M, SHA_S1, SHA_S3, SHA_X]) {
      expect(strip(await docIn(second.targetIndex, sha))).toEqual(strip(await docIn(first.targetIndex, sha)));
    }
    expect(await docIn(second.targetIndex, SHA_X)).toBeNull();
    expectMetadataOf(await docIn(second.targetIndex, SHA_S1), SHA_S1);
  }, 180_000);
});
