/**
 * 원본 커밋은 그 PR이 새로 가져온 커밋이다 (CR-117 / WP-102, FR-SRCH-002 AC-7, OD-016).
 *
 * ## 무엇을 재현하나
 *
 * 사내 `0.1.0-pilot.18` 보고의 모양을 **실제 git 이력**으로 만든다. dev(여기서는 `main`)에 squash로
 * 오른 커밋을, 피처 브랜치에서 `git merge dev`를 한 PR의 GitHub 커밋 목록이 함께 싣는다. 보고의
 * `ebc781d`(PR #1671의 squash 커밋)에 #983·#1855가 붙던 그 모양이며, 여기서는 픽스처의 B(#25의
 * squash 커밋)에 #983이 붙으려 한다.
 *
 * ```
 * main  R ── A(#21) ── D(직접 푸시) ── B(#25) ── C(#27) ── E(#29)
 * #983의 GitHub 목록: F1, F2, A, D, B, M, F3   ← A·D·B는 이미 main 체인에 있다
 * ```
 *
 * ## 무엇을 판정하나
 *
 * 채번은 실제 `prepareAndAssignSequence`(미러 fetch → first-parent 채번)로, 투영은 실제
 * `handleEnrichedEvent`(스냅숏·관계 채택·벌크)로, 관계 색인은 실제 러너로 돈다 — 새 규칙이 선 자리
 * 세 곳(관계 술어·투영의 체인 건너뛰기·채번의 재투영 의도)을 각각 운영 경로 그대로 지난다.
 *
 * 검증: `pnpm test:integration sequence/chain-links`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { EVENT_NAMES, commitDocId, type IngestionEnriched } from '@prs/domain';
import { prCommitLinkRepo, rawEventRepo, repositoryRepo, withTransaction, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, createEsClient, resolveClientOptions, switchAliasesForTests } from '@prs/es';
import { handleEnrichedEvent, type ProjectDeps } from '../../src/project.js';
import { runCommitLinkOnce } from '../../src/commit-links.js';
import { enrichCommit, type CommitEnrichDeps } from '../../src/commit-enrich.js';
import { applyLinkRepair, planLinkRepair } from '../../src/link-repair.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { prepareAndAssignSequence, type SequenceDeps } from '../../src/sequence.js';
import { migratedPool } from '../helpers.js';
import { makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, squashMerge, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7520;
const OWNER = 'acme';
const NAME = 'chain-links-cr117';
const BRANCH = 'main';
const CORRELATION_ID = '5d1e2f30-4a5b-4c6d-8e7f-90a1b2c3d4e5';

/** #983의 피처 브랜치에만 있는 커밋들. main 체인에는 없다. */
const F1 = 'f1f1000000000000000000000000000000000001';
const F2 = 'f2f2000000000000000000000000000000000002';
const M = 'eeee00000000000000000000000000000000000d'; // `git merge dev`로 생긴 커밋
const F3 = 'f3f3000000000000000000000000000000000003';
/** #25의 피처 브랜치 커밋. */
const FB1 = 'fb01000000000000000000000000000000000025';

let pool: Pool;
let es: Client;
let origin: SquashFixture;
let mirrorRoot: string;
let repository: RepositoryRow;
let received = 0;

function fakeBus(): EventBus {
  return {
    publish: async (): Promise<void> => undefined,
    subscribe: async (): Promise<never> => {
      throw new Error('시험에서 구독하지 않는다');
    },
    close: async (): Promise<void> => undefined,
  } as unknown as EventBus;
}

function graph(): CommitGraph {
  return new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
}

function sequenceDeps(): SequenceDeps {
  return {
    pool,
    es,
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: graph,
    freshness: { pool, mode: 'mirror', sync: new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }) },
  };
}

function enrichDeps(): CommitEnrichDeps {
  return { pool, es, bus: fakeBus(), metrics: createWorkerMetrics(), graphFor: graph };
}

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
  es = createEsClient(resolveClientOptions());
  for (let round = 0; round < 90; round += 1) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  /*
   * **이 파일의 이름 공간만 정리한다.** 전역 삭제는 다른 통합 파일의 픽스처를 지운다.
   */
  for (const table of [
    'commit_link_state',
    'pull_request_commit_link',
    'pull_request_link_observation',
    'pull_request_snapshot',
    'commit_snapshot',
    'sequence_work',
    'sequence_latency_sample',
    'mnumber_evidence',
    'merge_sequence',
    'sequence_space',
    'raw_event',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE repository_id = $1`, [REPOSITORY_ID]);
  }
  await es.indices.refresh({ index: ['prs-pull-requests', 'prs-commits'] });
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
  });

  origin = await createSquashFixture();
  mirrorRoot = await makeTempDir('prs-chain-links-mirror-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 77,
    visibility: 'internal',
    sequence_branches: [BRANCH],
    mirror_enabled: true,
    status: 'active',
  });
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  repository = found;
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

/** 픽스처의 squash 커밋. */
const squash = (pr: number): string => {
  const sha = origin.squash.get(pr);
  if (sha === undefined) throw new Error(`픽스처에 #${String(pr)}이 없다`);
  return sha;
};

interface ProjectOptions {
  readonly prNumber: number;
  readonly sourceShas: readonly string[];
  readonly mergeSha?: string | null;
  /** 원본 목록이 원격의 전부임을 증명한 관측인가. 기본 참. */
  readonly complete?: boolean;
}

/** PR 하나를 **실시간 투영 경로 그대로** 투영한다. 호출 순서가 곧 웹훅 수신 순서다. */
async function project(options: ProjectOptions): Promise<void> {
  received += 1;
  const receivedAt = new Date(Date.UTC(2026, 7, 19, 10, 0, received));
  const deliveryId = `chain-${String(options.prNumber)}-${String(received)}`;
  const merged = options.mergeSha !== undefined && options.mergeSha !== null;
  await rawEventRepo.insertRawEventIfAbsent(pool, {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: merged ? 'closed' : 'synchronize',
    repository_id: REPOSITORY_ID,
    received_at: receivedAt,
    payload: { number: options.prNumber },
    payload_hash: 'a'.repeat(64),
    correlation_id: CORRELATION_ID,
    queued_at: receivedAt,
  });

  const enriched: IngestionEnriched = {
    delivery_id: deliveryId,
    repository_id: REPOSITORY_ID,
    entity_kind: 'pull_request',
    pr_number: options.prNumber,
    pull_request: {
      number: options.prNumber,
      title: `PR ${String(options.prNumber)}`,
      body: null,
      state: merged ? 'closed' : 'open',
      draft: false,
      labels: [],
      merged,
      created_at: '2026-08-19T09:00:00.000Z',
      updated_at: '2026-08-19T10:00:00.000Z',
      closed_at: merged ? '2026-08-19T10:00:00.000Z' : null,
      merged_at: merged ? '2026-08-19T10:00:00.000Z' : null,
      merge_commit_sha: options.mergeSha ?? null,
      author: 'dev',
      head_ref: `feature/${String(options.prNumber)}`,
      head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
      base_ref: BRANCH,
      base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e',
      commits_count: options.sourceShas.length,
    },
    source_commit_shas: [...options.sourceShas],
    changed_files: [{ filename: 'src/a.ts', additions: 1, deletions: 0, status: 'modified' }],
    reviews: [],
    source_commits_truncated: false,
    source_commits_complete: options.complete ?? true,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: CORRELATION_ID,
  };

  const deps: ProjectDeps = { pool, bus: fakeBus(), es, metrics: createWorkerMetrics(), sleep: async (): Promise<void> => undefined };
  const outcome = await handleEnrichedEvent(deps, {
    event_id: `evt-${deliveryId}`,
    event_name: EVENT_NAMES.ingestionEnriched,
    correlation_id: CORRELATION_ID,
    occurred_at: receivedAt.toISOString(),
    partition_key: String(REPOSITORY_ID),
    partition: 0,
    delivery_count: 1,
    message_id: `m-${deliveryId}`,
    payload: enriched,
  });
  expect(outcome.disposition.kind).toBe('ack');
}

async function assign(): Promise<string> {
  const outcome = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
  expect(outcome.kind).toBe('done');
  return outcome.kind === 'done' ? outcome.assign.kind : outcome.kind;
}

/** 관계 투영 러너를 수렴할 때까지 돌린다. */
async function drainLinks(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    const cycle = await runCommitLinkOnce({ pool, es, metrics: createWorkerMetrics(), withWrite: (runWrite) => runWrite({ shadows: {} }), repositoryId: REPOSITORY_ID });
    if (cycle.claimed === 0) break;
  }
  await es.indices.refresh({ index: 'prs-commits' });
}

/** 커밋 문서의 `_source`를 그대로 읽는다. 없으면 `null`. */
async function commitDoc(sha: string): Promise<{ numbers?: readonly number[]; role?: string; state?: string } | null> {
  await es.indices.refresh({ index: 'prs-commits' });
  try {
    const found = await es.get<{ pull_request_numbers?: readonly number[]; role?: string; pr_links_state?: string }>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
    });
    const source = found._source;
    if (source === undefined) return null;
    return {
      ...(source.pull_request_numbers === undefined ? {} : { numbers: source.pull_request_numbers }),
      ...(source.role === undefined ? {} : { role: source.role }),
      ...(source.pr_links_state === undefined ? {} : { state: source.pr_links_state }),
    };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

describe('`git merge dev`로 받아 온 dev 체인 커밋 (FR-SRCH-002 AC-7)', () => {
  it('**머지 커밋에는 그 커밋을 올린 PR만 남는다** — 받아 온 PR의 번호는 붙지 않고, 역할도 덮이지 않는다', async () => {
    expect(await assign()).toBe('assigned');
    const a = squash(21);
    const b = squash(25);

    // #25가 B를 main에 올렸다. 그 뒤 #983의 피처 브랜치가 main을 merge해 와서 A·D·B가 목록에 섞였다.
    await project({ prNumber: 25, sourceShas: [FB1], mergeSha: b });
    await project({ prNumber: 983, sourceShas: [F1, F2, a, origin.directSha, b, M, F3] });
    await drainLinks();

    // 보고의 `ebc781d` = [983, 1671, 1855]였던 자리다. 이제 올린 PR 하나뿐이다.
    expect((await commitDoc(b))?.numbers).toEqual([25]);
    // #983이 새로 가져온 커밋은 그대로 #983의 것이다 — `git merge dev`로 생긴 M도 피처 브랜치 커밋이다.
    for (const sha of [F1, F2, M, F3]) expect((await commitDoc(sha))?.numbers).toEqual([983]);

    /*
     * **역할이 덮이지 않는다.** #983의 이벤트가 #25보다 늦게(더 큰 버전으로) 왔는데도 B는 여전히
     * 체인이 정한 머지 커밋이다. 전에는 조건부 업서트가 `role`을 `source_commit`으로 대입했다.
     */
    expect((await commitDoc(b))?.role).toBe('merge_commit');
    // A·D(체인 커밋)는 #983의 투영이 원본 커밋 문서로 만들지 않는다. 그 문서는 체인 경로의 몫이다.
    expect(await commitDoc(a)).toBeNull();
    expect(await commitDoc(origin.directSha)).toBeNull();
  });

  it('**원시 관측은 그대로 남는다** — 규칙은 읽는 자리에만 선다', async () => {
    expect(await assign()).toBe('assigned');
    const b = squash(25);
    await project({ prNumber: 983, sourceShas: [F1, b] });

    const raw = await pool.query<{ pr_number: number }>(
      `SELECT pr_number FROM pull_request_commit_link WHERE repository_id = $1 AND commit_sha = $2 AND evidence = 'source'`,
      [REPOSITORY_ID, b],
    );
    // GitHub이 말한 것은 사실로 보존된다. 체인이 바뀌면 GHE를 다시 읽지 않고 되살리려면 필요하다.
    expect(raw.rows.map((row) => row.pr_number)).toEqual([983]);
    const sets = await prCommitLinkRepo.readCommitLinkSets(pool, REPOSITORY_ID, b);
    expect(sets).toEqual({ effective: [], chainExcluded: [983] });
  });

  it('**미확정 PR 하나가 체인 규칙으로 빠지면 그 커밋을 `partial`로 만들지 않는다** — 미확정 계수도 유효 연결만 센다', async () => {
    expect(await assign()).toBe('assigned');
    const b = squash(25);
    await project({ prNumber: 25, sourceShas: [FB1], mergeSha: b });
    // #983의 관측은 불완전하다(완전성 근거 없음). 그래도 B에서는 빠지는 번호다.
    await project({ prNumber: 983, sourceShas: [F1, b], complete: false });
    await drainLinks();

    expect(await commitDoc(b)).toMatchObject({ numbers: [25], state: 'verified' });
  });

  it('fast-forward로 자기 커밋을 체인에 올린 PR은 그 커밋을 원본 커밋으로 유지한다 (`= N` 보존절)', async () => {
    expect(await assign()).toBe('assigned');
    // D를 #983이 fast-forward로 올렸다고 둔다 — squash-only에서는 생기지 않는 모양이라 정본을 직접 적는다.
    await pool.query(
      `UPDATE merge_sequence SET pull_request_number = 983 WHERE repository_id = $1 AND commit_sha = $2`,
      [REPOSITORY_ID, origin.directSha],
    );
    // 체인 커밋 문서는 체인 경로(커밋 보강)가 만든다.
    expect(await enrichCommit(enrichDeps(), repository, { commitSha: origin.directSha, firstParent: true, pullRequestNumber: 983, baseBranch: BRANCH })).toBe(true);
    await project({ prNumber: 983, sourceShas: [F1, origin.directSha] });
    await drainLinks();

    expect((await commitDoc(origin.directSha))?.numbers).toEqual([983]);
  });
});

describe('체인 소속이 바뀌면 연결을 다시 계산한다 (FR-SRCH-002 AC-7)', () => {
  it('**채번이 늦었으면** 먼저 붙은 연결이 체인에 오르는 순간 다시 계산된다 — 정상 채번 경로', async () => {
    const b = squash(25);
    // 채번 전에 두 PR이 먼저 투영됐다. 이때는 B가 체인에 있는지 아직 모른다.
    await project({ prNumber: 25, sourceShas: [FB1], mergeSha: b });
    await project({ prNumber: 983, sourceShas: [F1, b] });
    await drainLinks();
    expect((await commitDoc(b))?.numbers).toEqual([25, 983]);

    // 채번이 B를 체인에 올린다. 같은 트랜잭션이 B의 관계 투영 의도를 남긴다.
    expect(await assign()).toBe('assigned');
    await drainLinks();
    expect((await commitDoc(b))?.numbers).toEqual([25]);
  });

  it('**강제 푸시로 체인에서 빠진 커밋**은 다시 그 PR들의 원본 커밋이 된다 — 재채번 경로', async () => {
    expect(await assign()).toBe('assigned');
    const e = squash(29);
    await project({ prNumber: 29, sourceShas: [FB1], mergeSha: e });
    await project({ prNumber: 983, sourceShas: [F1, e] });
    await drainLinks();
    expect((await commitDoc(e))?.numbers).toEqual([29]);

    // 강제 푸시: E를 지우고 다른 squash를 얹는다. E는 더는 main 체인에 없다.
    await run(origin.dir, ['reset', '-q', '--hard', 'HEAD~1']);
    await squashMerge(origin.dir, 'fe2', 1, 'E2 squash (#33)', '2026-09-01T06:00:00Z');
    expect(await assign()).toBe('reassigned');
    await drainLinks();

    // #983이 싣던 E는 이제 체인 밖이므로 #983의 원본 커밋이다. #29의 병합 근거는 그대로다.
    expect((await commitDoc(e))?.numbers).toEqual([29, 983]);
  });
});

describe('기존 오염 복구 (`prsctl links plan|apply`, RB-29)', () => {
  it('**관측이 미확정이어도** 체인 규칙으로 빠지는 번호를 지우고, 덮인 역할을 되돌린다', async () => {
    expect(await assign()).toBe('assigned');
    const b = squash(25);

    /*
     * 사내에 남아 있을 모양을 그대로 심는다: 마이그레이션 036이 seed한 관계(관측 전부 `unverified`),
     * 합집합 시절의 색인 배열, PR 투영이 덮어 둔 `role: source_commit`.
     */
    const d = origin.directSha;
    await withTransaction(pool, async (client) => {
      for (const [prNumber, shas, mergeSha, complete] of [
        [983, [F1, b, d], null, false],
        [1855, [b], null, false],
        [25, [FB1], b, true],
      ] as const) {
        await prCommitLinkRepo.adoptLinkObservation(client, {
          repositoryId: REPOSITORY_ID,
          prNumber,
          observedVersion: 1_000,
          sourceShas: shas,
          mergeSha,
          commitsComplete: complete,
          pullRequestAuthoritative: true,
          commitsErrorKind: null,
          apiCommitCount: complete ? shas.length : null,
          sourceCommitsTruncated: false,
          headSha: null,
          baseSha: null,
          baseBranch: BRANCH,
          prState: mergeSha === null ? 'open' : 'merged',
          reason: null,
        });
      }
    });
    const seedPolluted = async (sha: string, numbers: readonly number[]): Promise<void> => {
      await pool.query(
        `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
         VALUES ($1, $2, 1, 1, 'done')`,
        [REPOSITORY_ID, sha],
      );
      await es.index({
        index: 'prs-commits',
        id: commitDocId(REPOSITORY_ID, sha),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: {
          document_version: 1,
          doc_id: commitDocId(REPOSITORY_ID, sha),
          repository_id: REPOSITORY_ID,
          repository: `${OWNER}/${NAME}`,
          org_id: 77,
          visibility: 'internal',
          allowed_team_ids: [],
          repository_archived: false,
          commit_sha: sha,
          role: 'source_commit',
          base_branch: BRANCH,
          enrichment_pending: false,
          indexed_at: '2026-08-19T10:00:00.000Z',
          pull_request_numbers: [...numbers],
          pr_links_generation: 1,
          pr_links_state: 'verified',
        },
      });
    };
    // B는 보고의 `ebc781d` 모양이고, D는 체인에 오른 직접 푸시다.
    await seedPolluted(b, [25, 983, 1855]);
    await seedPolluted(d, [983]);

    const plan = await planLinkRepair({ pool, es }, repository);
    // CR-116 규칙만 있었다면 #983·#1855의 관측이 미확정이라 `blocked`로 남았을 자리다.
    expect(plan).toMatchObject({ edgesChainExcluded: 3, chainExcludedCommits: 2, blocked: 0, roleMismatches: 2 });

    const result = await applyLinkRepair({ pool, es }, repository);
    expect(result.rolesRestored).toBe(2);
    await drainLinks();
    /*
     * B의 체인 행은 PR 대응이 비어 있다(이 시험의 채번이 PR 문서보다 먼저였다). 그래도 #25의 병합
     * 근거가 정본에 있으므로 머지 커밋으로 되돌린다 — 직접 푸시로 「되돌리면」 틀린 역할이 하나 는다.
     */
    expect(await commitDoc(b)).toMatchObject({ numbers: [25], role: 'merge_commit' });
    // D는 PR도 병합 근거도 없다. 연결은 `[]`(검증한 범위에서 없음)이고 역할은 직접 푸시다.
    expect(await commitDoc(d)).toMatchObject({ numbers: [], role: 'direct_push' });

    /*
     * 반복 실행은 멱등이다 — 두 번째에는 되돌릴 역할도, 체인 규칙으로 지울 번호도 없다. (F1·FB1은
     * 이 시험이 관계만 심고 문서는 만들지 않아 「정본에만 있는 커밋」으로 계속 보인다 — CR-116의
     * 기존 갈래이고 이 판정과 무관하므로 B·D로 좁혀 본다.)
     */
    const again = await planLinkRepair({ pool, es }, repository);
    expect(again).toMatchObject({ edgesChainExcluded: 0, chainExcludedCommits: 0, roleMismatches: 0 });
    expect(again.samples.map((sample) => sample.commitSha)).not.toContain(b);
    expect(again.samples.map((sample) => sample.commitSha)).not.toContain(d);
  });

  it('`--pr`로 좁힌 실행은 저장소 단위인 역할 대조를 하지 않는다', async () => {
    expect(await assign()).toBe('assigned');
    const plan = await planLinkRepair({ pool, es }, repository, { prNumbers: [983] });
    expect(plan.roleMismatches).toBeNull();
    expect((await applyLinkRepair({ pool, es }, repository, { prNumbers: [983] })).rolesRestored).toBeNull();
  });
});
