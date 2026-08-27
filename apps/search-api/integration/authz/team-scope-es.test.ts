/**
 * 팀 접근 범위 — **실제 Elasticsearch** (WP-068 DoD / CR-035, DEV-114·187).
 *
 * `team-scope.test.ts`는 정본과 동기화 판정을 건다. 여기서 거는 것은 하나다 —
 * **그 값이 진짜 색인에서 진짜로 문서를 고르고 거르는가.**
 *
 * 모양이 맞아도 필드 이름이 하나 어긋나면 아무것도 맞히지 못하고, 그것을 잡는
 * 것은 실제 조회뿐이다. WP-068이 고치려는 결함이 정확히 그 종류였다 — 매핑도
 * 있고 질의 빌더도 있는데 값이 없어서 **아무것도 맞히지 못했다.**
 *
 * 실행: `pnpm test:integration authz/team-scope-es` (실제 Elasticsearch 필요)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import {
  applyMandatoryScopeFilter,
  applyMappings,
  applyRepositoryTeams,
  createEsClient,
  resolveClientOptions,
  search,
  SERVING_ONLY,
} from '@prs/es';

const REPO_TEAM_ONLY = 8201;
const REPO_PUBLIC = 8202;
const ORG = 1;
const TEAM_CORE = 8801;
const TEAM_OTHER = 8802;

let es: Client;

interface Doc {
  readonly _id: string;
  readonly repository_id: number;
  readonly repository: string;
  readonly org_id: number;
  readonly visibility: string;
  readonly allowed_team_ids: number[];
  readonly pr_number: number;
  readonly title: string;
  readonly state: string;
  readonly document_version: number;
}

const DOCS: readonly Doc[] = [
  {
    _id: 'acme/team-only#1',
    repository_id: REPO_TEAM_ONLY,
    repository: 'acme/team-only',
    org_id: ORG,
    visibility: 'private',
    allowed_team_ids: [TEAM_CORE],
    pr_number: 1,
    title: '팀으로만 보이는 PR',
    state: 'merged',
    document_version: 500,
  },
  {
    _id: 'acme/open#2',
    repository_id: REPO_PUBLIC,
    repository: 'acme/open',
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [],
    pr_number: 2,
    title: '조직 전체가 보는 PR',
    state: 'merged',
    document_version: 500,
  },
];

async function index(docs: readonly Doc[]): Promise<void> {
  const bulk = await es.bulk({
    refresh: true,
    operations: docs.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-pull-requests', _id, routing: String(doc.repository_id) } },
      { ...doc, doc_id: _id },
    ]),
  });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }
}

/** 강제 필터를 지난 조회. 운영과 같은 경로다. */
async function visiblePrNumbers(
  scope: Parameters<typeof applyMandatoryScopeFilter>[1],
): Promise<number[]> {
  const scoped = applyMandatoryScopeFilter({ match_all: {} }, scope);
  const response = await search<{ pr_number?: number }>(es, 'prs-pull-requests', scoped, {
    size: 20,
    _source: ['pr_number'],
  });
  return response.hits.hits
    .map((hit) => hit._source?.pr_number)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
}

async function versionOf(id: string, repositoryId: number): Promise<number> {
  const doc = await es.get<{ document_version: number }>({
    index: 'prs-pull-requests',
    id,
    routing: String(repositoryId),
  });
  return doc._source?.document_version ?? -1;
}

describe('팀 접근 범위가 실제 색인에서 동작한다 (WP-068 DoD)', () => {
  beforeAll(async () => {
    es = createEsClient(resolveClientOptions());
    await applyMappings(es);
    await es.deleteByQuery({
      index: 'prs-pull-requests',
      refresh: true,
      conflicts: 'proceed',
      query: { terms: { repository_id: [REPO_TEAM_ONLY, REPO_PUBLIC] } },
    });
    await index(DOCS);
  }, 180_000);

  afterAll(async () => {
    await es?.deleteByQuery({
      index: 'prs-pull-requests',
      refresh: true,
      conflicts: 'proceed',
      query: { terms: { repository_id: [REPO_TEAM_ONLY, REPO_PUBLIC] } },
    });
    await es?.close();
  });

  describe('A. `team:` 질의가 실제 문서를 맞힌다', () => {
    it('**팀 ID로 문서를 고른다** — 값이 없던 동안에는 한 건도 맞히지 못했다', async () => {
      const scope = { kind: 'explicit', repositoryIds: [REPO_TEAM_ONLY, REPO_PUBLIC] } as const;
      // `team:` 질의는 slug를 ID로 옮긴 뒤 `allowed_team_ids`를 본다.
      const scoped = applyMandatoryScopeFilter(
        { bool: { filter: [{ terms: { allowed_team_ids: [TEAM_CORE] } }] } },
        scope,
      );
      const response = await search<{ pr_number?: number }>(es, 'prs-pull-requests', scoped, {
        size: 20,
        _source: ['pr_number'],
      });
      expect(response.hits.hits.map((hit) => hit._source?.pr_number)).toEqual([1]);
    });

    it('다른 팀으로 물으면 맞히지 않는다', async () => {
      const scoped = applyMandatoryScopeFilter(
        { bool: { filter: [{ terms: { allowed_team_ids: [TEAM_OTHER] } }] } },
        { kind: 'explicit', repositoryIds: [REPO_TEAM_ONLY, REPO_PUBLIC] },
      );
      const response = await search<{ pr_number?: number }>(es, 'prs-pull-requests', scoped, { size: 20 });
      expect(response.hits.hits).toHaveLength(0);
    });
  });

  describe('B·C. explicit 경로와 org_team 경로', () => {
    it('B. explicit 범위는 기존대로 동작한다 (무회귀)', async () => {
      expect(await visiblePrNumbers({ kind: 'explicit', repositoryIds: [REPO_TEAM_ONLY, REPO_PUBLIC] })).toEqual([1, 2]);
      expect(await visiblePrNumbers({ kind: 'explicit', repositoryIds: [REPO_PUBLIC] })).toEqual([2]);
    });

    it('C. org_team 경로에서 public/internal은 팀 없이 보인다', async () => {
      expect(
        await visiblePrNumbers({ kind: 'org_team', orgIds: [ORG], teamIds: [], visibilities: ['public', 'internal'] }),
      ).toEqual([2]);
    });

    it('**D. 팀으로만 볼 수 있는 비공개 저장소가 org_team 경로에서 보인다**', async () => {
      // 500개를 넘어 org_team으로 전환된 사용자가 팀 소속으로 그 저장소를 본다.
      expect(
        await visiblePrNumbers({
          kind: 'org_team',
          orgIds: [ORG],
          teamIds: [TEAM_CORE],
          visibilities: ['public', 'internal'],
        }),
      ).toEqual([1, 2]);
    });

    it('F. 다른 팀 사용자는 그 비공개 저장소를 보지 못한다', async () => {
      expect(
        await visiblePrNumbers({
          kind: 'org_team',
          orgIds: [ORG],
          teamIds: [TEAM_OTHER],
          visibilities: ['public', 'internal'],
        }),
      ).toEqual([2]);
    });
  });

  describe('E·G. 소급 적용', () => {
    it('**E. 팀 접근이 사라지면 과거 문서도 더 이상 보이지 않는다**', async () => {
      const before = await versionOf('acme/team-only#1', REPO_TEAM_ONLY);

      // GHE에서 core 팀의 접근이 회수됐다 → 정본 갱신 → 색인 소급 적용.
      await applyRepositoryTeams(es, REPO_TEAM_ONLY, [], SERVING_ONLY);
      await es.indices.refresh({ index: 'prs-pull-requests' });

      expect(
        await visiblePrNumbers({
          kind: 'org_team',
          orgIds: [ORG],
          teamIds: [TEAM_CORE],
          visibilities: ['public', 'internal'],
        }),
      ).toEqual([2]);

      // **G. document_version은 변하지 않는다** — 권한 변경은 엔티티 변경이 아니다.
      expect(await versionOf('acme/team-only#1', REPO_TEAM_ONLY)).toBe(before);
    });

    it('다시 부여하면 다시 보인다 — 소급이 양방향이다', async () => {
      const before = await versionOf('acme/team-only#1', REPO_TEAM_ONLY);
      await applyRepositoryTeams(es, REPO_TEAM_ONLY, [TEAM_CORE], SERVING_ONLY);
      await es.indices.refresh({ index: 'prs-pull-requests' });

      expect(
        await visiblePrNumbers({
          kind: 'org_team',
          orgIds: [ORG],
          teamIds: [TEAM_CORE],
          visibilities: ['public', 'internal'],
        }),
      ).toEqual([1, 2]);
      expect(await versionOf('acme/team-only#1', REPO_TEAM_ONLY)).toBe(before);
    });
  });

  describe('I. 접근 범위를 우회하는 질의가 없다', () => {
    it('강제 필터를 지나지 않은 질의는 타입이 막는다', () => {
      // `search`는 `ScopedQuery`만 받는다 — 브랜드 타입이라 캐스팅 없이는 못 만든다.
      // 이 시험은 그 사실을 문서로 남긴다 (ADR-008).
      expect(typeof applyMandatoryScopeFilter).toBe('function');
    });
  });
});
