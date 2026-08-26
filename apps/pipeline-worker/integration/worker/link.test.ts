/**
 * JOB-REL-001 참조 간선 파생 · JOB-REL-005 미해결 참조 해결 (WP-029 / CR-039).
 *
 * **실제 PostgreSQL · 실제 Elasticsearch를 쓴다.** 이 WP가 증명해야 할 것 대부분이
 * 그 둘의 동작 그 자체다:
 *
 * - "같은 간선을 갱신한다"(AC-3)는 **문서 ID가** 판정한다 — 함수 반환값이 아니다
 * - "본문에서 사라진 참조가 지워진다"는 **색인에 남은 문서 수가** 근거다
 * - "접근 통제 material 없이 간선이 만들어지지 않는다"는 **문서 본문이** 답한다
 * - "축약 SHA가 모호하면 해결하지 않는다"는 **접두 질의 결과가** 정한다
 *
 * 검증: `pnpm run test:integration worker/link`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MAX_RETRIES } from '@prs/bus';
import { EVENT_NAMES, commitDocId, pullRequestDocId } from '@prs/domain';
import {
  commitSnapshotRepo,
  prSnapshotRepo,
  repositoryRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { applyMappings, createEsClient, resolveClientOptions } from '@prs/es';
import {
  deriveReferenceLinks,
  handleLinkEvent,
  handleSourceReady,
  type LinkDeps,
} from '../../src/link.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4701;
const OTHER_ID = 4702;
const OWNER = 'acme';
const NAME = 'link-wp029';
const OTHER_NAME = 'link-wp029-other';
const HOST = 'ghe.acme.example';
const TEAM = 7101;

let pool: Pool;
let es: Client;
let repository: RepositoryRow;
let other: RepositoryRow;

function deps(overrides: Partial<LinkDeps> = {}): LinkDeps {
  return {
    pool,
    es,
    bus: { publish: () => Promise.resolve() } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    gheHost: `https://${HOST}`,
    log: () => undefined,
    // 시험은 색인 가시성을 기다리지 않는다. 운영은 기본값(끔)이다.
    refresh: true,
    ...overrides,
  };
}

/** PR 정본을 남긴다. **파생의 입력은 이것이지 색인 문서가 아니다** (ADR-004). */
async function seedPullRequestSnapshot(
  prNumber: number,
  fields: { readonly title?: string; readonly body?: string; readonly version?: number },
  repositoryId = REPOSITORY_ID,
): Promise<void> {
  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId,
    prNumber,
    documentVersion: fields.version ?? 1,
    source: 'webhook',
    document: {
      pr_number: prNumber,
      title: fields.title ?? '',
      body: fields.body ?? '',
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  });
}

/** 색인된 PR 문서. 해결 대상이 "색인되었는가"의 판정 근거다 (AC-3). */
async function indexPullRequest(prNumber: number, repositoryId = REPOSITORY_ID): Promise<void> {
  await es.index({
    index: 'prs-pull-requests',
    id: pullRequestDocId(repositoryId, prNumber),
    routing: String(repositoryId),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: repositoryId,
      repository: `${OWNER}/${repositoryId === REPOSITORY_ID ? NAME : OTHER_NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      pr_number: prNumber,
      links_pending: true,
      link_summary: {
        has_revert: false,
        is_reverted: false,
        has_cherry_pick: false,
        has_stack: false,
        reference_count: 0,
      },
    },
  });
}

async function indexCommit(sha: string, repositoryId = REPOSITORY_ID): Promise<void> {
  await es.index({
    index: 'prs-commits',
    id: commitDocId(repositoryId, sha),
    routing: String(repositoryId),
    refresh: true,
    document: {
      document_version: 1,
      repository_id: repositoryId,
      repository: `${OWNER}/${repositoryId === REPOSITORY_ID ? NAME : OTHER_NAME}`,
      org_id: 1,
      visibility: 'private',
      allowed_team_ids: [TEAM],
      commit_sha: sha,
      role: 'direct_push',
    },
  });
}

/**
 * `bulk`만 실패시키고 나머지는 그대로 위임한다.
 *
 * 스프레드로 만들면 프로토타입 메서드가 사라진다 — 이 저장소가 이미 한 번
 * 밟은 함정이다. 필요한 것만 명시적으로 위임한다.
 */
function withBulkFailure(inner: Client): Client {
  return {
    bulk: () =>
      Promise.resolve({ items: [{ index: { _id: 'x', status: 500, error: { type: 'internal' } } }] }),
    msearch: (params: unknown) => inner.msearch(params as never),
    search: (params: unknown) => inner.search(params as never),
    update: (params: unknown) => inner.update(params as never),
    deleteByQuery: (params: unknown) => inner.deleteByQuery(params as never),
    indices: inner.indices,
  } as unknown as Client;
}

/** **내 저장소의 간선만** 센다. 공유 `prs_test`·공유 ES에서 전역 질의는 오답이다. */
async function linksOf(fromId: string): Promise<readonly Record<string, unknown>[]> {
  await es.indices.refresh({ index: 'prs-links' });
  const response = await es.search<Record<string, unknown>>({
    index: 'prs-links',
    size: 200,
    query: {
      bool: {
        filter: [
          { term: { repository_id: REPOSITORY_ID } },
          { term: { link_type: 'references' } },
          { term: { from_id: fromId } },
        ],
      },
    },
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

const FULL_A = `${'ab'.repeat(19)}01`;
const FULL_B = `${'ab'.repeat(19)}02`;

describe('참조 간선 파생과 해결 (WP-029 / CR-039)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
    // 인덱스를 지우지 않는다 — 다른 파일의 데이터를 밟는다. 매핑만 제자리 갱신한다.
    await applyMappings(es);
  }, 180_000);

  afterAll(async () => {
    await es?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    for (const id of [REPOSITORY_ID, OTHER_ID]) {
      await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [id]);
      await pool.query('DELETE FROM repository WHERE repository_id = $1', [id]);
    }
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'private',
      sequence_branches: ['main'],
      mirror_enabled: false,
      status: 'active',
    });
    await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM]);
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;

    /*
     * 내 저장소 범위의 문서만 지운다. 다른 파일의 행을 건드리지 않는다 (§60).
     *
     * **엔티티 문서도 지운다.** 앞선 케이스가 색인한 커밋이 남아 있으면
     * "아직 색인되지 않았다"를 전제한 케이스가 조용히 해결된 상태로 시작한다 —
     * 파일 하나로 돌리면 통과하고 케이스 순서를 바꾸면 깨지는 시험이 된다.
     *
     * `delete_by_query`는 **검색으로** 대상을 찾으므로 앞에서 refresh 한다.
     * `refresh: true` 옵션은 지운 *뒤에* 새로 고치는 것이라 이 문제를 풀지 않는다.
     */
    for (const index of ['prs-links', 'prs-pull-requests', 'prs-commits']) {
      await es.indices.refresh({ index });
      await es.deleteByQuery({
        index,
        refresh: true,
        conflicts: 'proceed',
        query: { terms: { repository_id: [REPOSITORY_ID, OTHER_ID] } },
      });
    }
  });

  async function registerOther(): Promise<void> {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: OTHER_ID,
      owner: OWNER,
      name: OTHER_NAME,
      org_id: 1,
      visibility: 'private',
      sequence_branches: ['main'],
      mirror_enabled: false,
      status: 'active',
    });
    await repositoryRepo.setAllowedTeams(pool, OTHER_ID, [TEAM]);
    other = (await repositoryRepo.findRepositoryById(pool, OTHER_ID))!;
    expect(other).toBeDefined();
  }

  /* --------------------------------------------------------------------- */

  describe('파생의 정본은 PostgreSQL이다 (ADR-004)', () => {
    it('색인 문서가 아니라 스냅숏의 본문에서 참조를 뽑는다', async () => {
      await indexPullRequest(1);
      // 색인 문서에는 참조가 없다. 정본에만 있다.
      await seedPullRequestSnapshot(1, { title: 'fix', body: 'Refs: #10' });

      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.references).toBe(1);
      expect(outcome.complete).toBe(true);
      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links).toHaveLength(1);
      expect(links[0]?.['reference_key']).toBe('pr:10');
      expect(links[0]?.['confidence']).toBe('derived');
    });

    it('정본이 아직 없으면 아무것도 확정하지 않는다 — 간선도 참조 수도 건드리지 않는다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).toHaveLength(1);
      expect((( await prDoc(1))['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);

      // 정본을 지운 뒤 다시 파생해도 기존 간선이 살아 있어야 한다.
      await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.complete).toBe(false);
      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).toHaveLength(1);
      /*
       * **세지 못한 회차가 참조 수를 덮어쓰지 않는다.** 어떤 값을 쓰든 그것은
       * 거짓말이다 — 화면은 그 수를 "이 문서의 참조는 N건"으로 읽는다.
       */
      expect((( await prDoc(1))['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);
    });

    it('커밋은 `commit_snapshot.message`가 정본이다', async () => {
      await commitSnapshotRepo.upsertCommitSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        commitSha: FULL_A,
        parentShas: [],
        message: 'hotfix\n\nRefs: #42',
        author: 'dev',
        committer: 'dev',
        authoredAt: new Date('2026-08-01T00:00:00Z'),
        committedAt: new Date('2026-08-01T00:00:00Z'),
        changedPaths: [],
        changedPathsTruncated: false,
        patchId: null,
        patchIdUnavailable: 'no_mirror',
        metadataSource: 'api',
      });
      await indexCommit(FULL_A);

      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'commit',
        id: FULL_A,
      });

      expect(outcome.references).toBe(1);
      const links = await linksOf(commitDocId(REPOSITORY_ID, FULL_A));
      expect(links[0]?.['reference_key']).toBe('pr:42');
      expect(links[0]?.['from_type']).toBe('commit');
    });
  });

  /* --------------------------------------------------------------------- */

  describe('source가 바뀌면 간선도 바뀐다 (DEV-220)', () => {
    it('V1 → V2 → V3: 사라진 참조가 실제로 지워진다', async () => {
      await indexPullRequest(1);
      const source = { kind: 'pull_request', id: '1' } as const;
      const fromId = pullRequestDocId(REPOSITORY_ID, 1);

      // V1
      await seedPullRequestSnapshot(1, { body: 'Refs: #10', version: 1 });
      await deriveReferenceLinks(deps(), repository, source);
      expect((await linksOf(fromId)).map((l) => l['reference_key'])).toEqual(['pr:10']);

      // V2 — 대상이 바뀐다.
      await seedPullRequestSnapshot(1, { body: 'Refs: #20', version: 2 });
      await deriveReferenceLinks(deps(), repository, source);
      expect((await linksOf(fromId)).map((l) => l['reference_key'])).toEqual(['pr:20']);

      // V3 — 참조가 사라진다.
      await seedPullRequestSnapshot(1, { body: 'no references here', version: 3 });
      const outcome = await deriveReferenceLinks(deps(), repository, source);

      expect(await linksOf(fromId)).toHaveLength(0);
      expect(outcome.references).toBe(0);
      expect(outcome.complete).toBe(true);
      const doc = await prDoc(1);
      expect((doc['link_summary'] as Record<string, unknown>)['reference_count']).toBe(0);
      expect(doc['links_pending']).toBe(false);
    });

    it('**다른 source의 간선은 건드리지 않는다**', async () => {
      await indexPullRequest(1);
      await indexPullRequest(2);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      await seedPullRequestSnapshot(2, { body: 'Refs: #10' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '2' });

      await seedPullRequestSnapshot(1, { body: 'gone', version: 2 });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).toHaveLength(0);
      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 2))).toHaveLength(1);
    });

    it('**추출이 실패한 회차는 기존 간선을 지우지 않는다** (DEV-220)', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).toHaveLength(1);
      expect((( await prDoc(1))['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);

      /*
       * 간선 쓰기를 실패시킨다 — 완전한 파생이 아니므로 제거가 돌면 안 된다.
       *
       * **클래스 인스턴스를 스프레드하지 않는다.** `{ ...es, bulk }`로 만든 대역은
       * 프로토타입 메서드가 전부 `undefined`가 되고, 그 사실이 `msearch`를 부르는
       * 엉뚱한 자리에서 터진다 (commit-enrich 시험이 같은 함정을 밟았다).
       */
      const broken = deps({ es: withBulkFailure(es) });
      await seedPullRequestSnapshot(1, { body: 'Refs: #20', version: 2 });
      const outcome = await deriveReferenceLinks(broken, repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.complete).toBe(false);
      // 옛 간선이 그대로 살아 있다. 부분 결과를 완전한 결과로 확정하지 않았다.
      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).map((l) => l['reference_key'])).toEqual([
        'pr:10',
      ]);
      const doc = await prDoc(1);
      expect(doc['links_pending']).toBe(true);
      // 세지 못했으므로 참조 수는 그대로다 — 실패 회차가 숫자를 지어내지 않는다.
      expect((doc['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);
    });
  });

  /* --------------------------------------------------------------------- */

  describe('이벤트 순서가 역전돼도 현재 정본으로 수렴한다', () => {
    it('V2 이벤트를 먼저, V1 이벤트를 나중에 줘도 최종 간선은 현재 정본의 것이다', async () => {
      await indexPullRequest(1);
      const projected = (version: number) => ({
        event_id: `e${String(version)}`,
        event_name: EVENT_NAMES.ingestionProjected,
        correlation_id: 'c',
        occurred_at: '2026-08-01T00:00:00.000Z',
        partition_key: String(REPOSITORY_ID),
        partition: 0,
        delivery_count: 1,
        message_id: `m${String(version)}`,
        payload: {
          repository_id: REPOSITORY_ID,
          entity_kind: 'pull_request',
          entity_id: pullRequestDocId(REPOSITORY_ID, 1),
          document_version: version,
          correlation_id: 'c',
        },
      });

      // 정본은 이미 V2다. 두 이벤트 모두 "이 문서를 다시 보라"일 뿐이다.
      await seedPullRequestSnapshot(1, { body: 'Refs: #20', version: 2 });

      expect(await handleLinkEvent(deps(), projected(2))).toEqual({ kind: 'ack' });
      expect(await handleLinkEvent(deps(), projected(1))).toEqual({ kind: 'ack' });

      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links.map((l) => l['reference_key'])).toEqual(['pr:20']);
      // #10이 되살아나면 실패다.
      expect(links.map((l) => l['reference_key'])).not.toContain('pr:10');
    });
  });

  /* --------------------------------------------------------------------- */

  describe('미해결 → 해결 (FR-REL-003 AC-3)', () => {
    it('**같은 `link_id`로 갱신된다** — 문서가 둘이 되지 않는다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #999' });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      const before = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(before).toHaveLength(1);
      expect(before[0]?.['resolved']).toBe(false);
      expect(before[0]).not.toHaveProperty('to_id');
      const linkId = before[0]?.['_id'];

      // 대상이 색인된다 → 해결.
      await indexPullRequest(999);
      await seedPullRequestSnapshot(999, { body: '' });
      await handleSourceReady(deps(), repository, { kind: 'pull_request', id: '999' });

      const after = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(after).toHaveLength(1);
      expect(after[0]?.['_id']).toBe(linkId);
      expect(after[0]?.['resolved']).toBe(true);
      expect(after[0]?.['to_id']).toBe(pullRequestDocId(REPOSITORY_ID, 999));
      expect(after[0]?.['to_repository_id']).toBe(REPOSITORY_ID);
    });

    it('해결돼도 `reference_count`는 그대로다 — 미해결도 실제 참조다 (§37)', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #999' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const pending = await prDoc(1);
      expect((pending['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);
      // 미해결이 있다는 이유로 pending이 되지 않는다.
      expect(pending['links_pending']).toBe(false);

      await indexPullRequest(999);
      await seedPullRequestSnapshot(999, { body: '' });
      await handleSourceReady(deps(), repository, { kind: 'pull_request', id: '999' });

      expect((( await prDoc(1))['link_summary'] as Record<string, unknown>)['reference_count']).toBe(1);
    });

    it('재파생이 이미 해결된 간선을 미해결로 되돌리지 않는다', async () => {
      await indexPullRequest(1);
      await indexPullRequest(999);
      await seedPullRequestSnapshot(1, { body: 'Refs: #999' });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['resolved']).toBe(true);

      // 본문이 같은 채로 다시 파생 — 해결 상태가 유지돼야 한다.
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['resolved']).toBe(true);
    });
  });

  /* --------------------------------------------------------------------- */

  describe('축약 SHA 해결 (ADR-012)', () => {
    const prefix = FULL_A.slice(0, 9);

    it('유일하면 해결하고 `link_id`는 그대로다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: `caused by ${prefix}` });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      const before = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(before[0]?.['resolved']).toBe(false);
      const linkId = before[0]?.['_id'];

      await indexCommit(FULL_A);
      await handleSourceReady(deps(), repository, { kind: 'commit', id: FULL_A });

      const after = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(after[0]?.['_id']).toBe(linkId);
      expect(after[0]?.['resolved']).toBe(true);
      expect(after[0]?.['to_id']).toBe(commitDocId(REPOSITORY_ID, FULL_A));
    });

    it('일치가 없으면 미해결로 남는다 — 오류가 아니다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'caused by 9999999' });
      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.complete).toBe(true);
      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['resolved']).toBe(false);
    });

    it('**모호하면 해결하지 않는다** — 첫 결과를 임의로 고르지 않는다', async () => {
      // 두 커밋이 같은 접두를 갖는다.
      await indexCommit(FULL_A);
      await indexCommit(FULL_B);
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: `caused by ${prefix}` });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links).toHaveLength(1);
      expect(links[0]?.['resolved']).toBe(false);
      expect(links[0]).not.toHaveProperty('to_id');
    });

    it('**해결 경로도 모호해지면 해결하지 않는다** — 대상이 나타났다고 바로 잇지 않는다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: `caused by ${prefix}` });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['resolved']).toBe(false);

      // A와 B가 함께 색인된 뒤 A가 ready 신호를 낸다 — 그 사이 모호해졌다.
      await indexCommit(FULL_A);
      await indexCommit(FULL_B);
      await handleSourceReady(deps(), repository, { kind: 'commit', id: FULL_A });

      expect((await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['resolved']).toBe(false);
    });
  });

  /* --------------------------------------------------------------------- */

  describe('저장소를 건너뛰는 참조 (THR-034)', () => {
    it('등록·색인된 저장소면 `to_repository_id`를 채운다', async () => {
      await registerOther();
      await indexPullRequest(20, OTHER_ID);
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: `Refs: ${OWNER}/${OTHER_NAME}#20` });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links[0]?.['reference_key']).toBe(`x:${OWNER}/${OTHER_NAME}:pr:20`);
      expect(links[0]?.['resolved']).toBe(true);
      expect(links[0]?.['to_repository_id']).toBe(OTHER_ID);
    });

    it('**간선의 접근 범위는 source의 것이다** — 대상 저장소의 것이 아니다', async () => {
      await registerOther();
      await repositoryRepo.setAllowedTeams(pool, OTHER_ID, [9999]);
      await indexPullRequest(20, OTHER_ID);
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: `Refs: ${OWNER}/${OTHER_NAME}#20` });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links[0]?.['repository_id']).toBe(REPOSITORY_ID);
      expect(links[0]?.['allowed_team_ids']).toEqual([TEAM]);
      // 대상 저장소의 팀이 새어 들어오면 실패다.
      expect(links[0]?.['allowed_team_ids']).not.toContain(9999);
    });

    it('등록되지 않은 저장소는 미해결로 남는다 — 외부 조회로 확장하지 않는다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: someone/unregistered#20' });

      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.complete).toBe(true);
      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links[0]?.['reference_key']).toBe('x:someone/unregistered:pr:20');
      expect(links[0]?.['resolved']).toBe(false);
    });
  });

  /* --------------------------------------------------------------------- */

  describe('접근 통제 (THR-035)', () => {
    it('간선 문서가 생성 시점에 접근 통제 material 넷을 모두 갖는다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const link = (await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]!;
      expect(link['repository_id']).toBe(REPOSITORY_ID);
      expect(link['org_id']).toBe(1);
      expect(link['visibility']).toBe('private');
      expect(link['allowed_team_ids']).toEqual([TEAM]);
    });

    it('WP-030 소유 필드를 선점하지 않는다 (DEV-223)', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const link = (await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]!;
      expect(link).not.toHaveProperty('detached');
    });
  });

  /* --------------------------------------------------------------------- */

  describe('link_summary는 leaf 단위로 갱신한다 (DEV-222)', () => {
    it('**WP-030이 써 둔 네 값이 살아남는다**', async () => {
      await indexPullRequest(1);
      // WP-030이 이미 판정을 써 둔 상태를 만든다.
      await es.update({
        index: 'prs-pull-requests',
        id: pullRequestDocId(REPOSITORY_ID, 1),
        routing: String(REPOSITORY_ID),
        refresh: true,
        doc: {
          link_summary: {
            has_revert: true,
            is_reverted: true,
            has_cherry_pick: true,
            has_stack: true,
            reference_count: 0,
          },
        },
      });

      await seedPullRequestSnapshot(1, { body: 'Refs: #10 and #11' });
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      const summary = (await prDoc(1))['link_summary'] as Record<string, unknown>;
      expect(summary['reference_count']).toBe(2);
      expect(summary['has_revert']).toBe(true);
      expect(summary['is_reverted']).toBe(true);
      expect(summary['has_cherry_pick']).toBe(true);
      expect(summary['has_stack']).toBe(true);
    });
  });

  /* --------------------------------------------------------------------- */

  describe('재시도 예산은 핸들러가 집행한다 (DEV-228)', () => {
    /*
     * 어댑터는 `retry`를 받으면 백오프만 늘리고 **횟수 상한을 보지 않는다.**
     * 핸들러가 세지 않으면 영구 실패가 무한 재시도되며 그 파티션의 뒤 이벤트를
     * 영영 막는다 — `release.ts`가 실제로 그 상태였다.
     */
    const failing = (): LinkDeps =>
      deps({
        es: {
          msearch: () => Promise.reject(new Error('es down')),
          search: () => Promise.reject(new Error('es down')),
          bulk: () => Promise.reject(new Error('es down')),
          update: () => Promise.reject(new Error('es down')),
          deleteByQuery: () => Promise.reject(new Error('es down')),
          indices: { refresh: () => Promise.reject(new Error('es down')) },
        } as unknown as Client,
      });

    const event = (deliveryCount: number) => ({
      event_id: 'e',
      event_name: EVENT_NAMES.ingestionProjected,
      correlation_id: 'c',
      occurred_at: '2026-08-01T00:00:00.000Z',
      partition_key: String(REPOSITORY_ID),
      partition: 0,
      delivery_count: deliveryCount,
      message_id: 'm',
      payload: {
        repository_id: REPOSITORY_ID,
        entity_kind: 'pull_request',
        entity_id: pullRequestDocId(REPOSITORY_ID, 1),
        document_version: 1,
        correlation_id: 'c',
      },
    });

    it('예산 안에서는 다시 시도한다', async () => {
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      expect(await handleLinkEvent(failing(), event(MAX_RETRIES - 1))).toEqual({
        kind: 'retry',
        reason: 'link_derivation_failed',
      });
    });

    it('**소진하면 종료 처분으로 파티션을 푼다**', async () => {
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });
      expect(await handleLinkEvent(failing(), event(MAX_RETRIES))).toEqual({
        kind: 'dead_letter',
        reason: 'link_derivation_failed',
      });
      expect(await handleLinkEvent(failing(), event(MAX_RETRIES + 9))).toEqual({
        kind: 'dead_letter',
        reason: 'link_derivation_failed',
      });
    });
  });

  describe('간선의 `created_at`은 정본 시각이다', () => {
    it('**재파생해도 값이 바뀌지 않는다** — `now()`면 같은 입력이 다른 문서를 만든다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { body: 'Refs: #10' });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      const first = (await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['created_at'];

      await new Promise((resolve) => setTimeout(resolve, 20));
      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });
      const second = (await linksOf(pullRequestDocId(REPOSITORY_ID, 1)))[0]?.['created_at'];

      expect(first).toBe('2026-08-01T00:00:00.000Z');
      expect(second).toBe(first);
    });
  });

  describe('중복 제거와 상한 (AC-5)', () => {
    it('본문과 트레일러의 같은 참조는 간선 하나, derived가 이긴다', async () => {
      await indexPullRequest(1);
      await seedPullRequestSnapshot(1, { title: 'mentions #10', body: 'Refs: #10' });

      const outcome = await deriveReferenceLinks(deps(), repository, {
        kind: 'pull_request',
        id: '1',
      });

      expect(outcome.references).toBe(1);
      const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 1));
      expect(links).toHaveLength(1);
      expect(links[0]?.['confidence']).toBe('derived');
    });

    it('고유 참조 100건 상한이 색인에서도 지켜진다', async () => {
      await indexPullRequest(1);
      const body = Array.from({ length: 150 }, (_, index) => `#${String(index + 1)}`).join(' ');
      await seedPullRequestSnapshot(1, { body });

      await deriveReferenceLinks(deps(), repository, { kind: 'pull_request', id: '1' });

      expect(await linksOf(pullRequestDocId(REPOSITORY_ID, 1))).toHaveLength(100);
      expect((( await prDoc(1))['link_summary'] as Record<string, unknown>)['reference_count']).toBe(100);
    });
  });
});
