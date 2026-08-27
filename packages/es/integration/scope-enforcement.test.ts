/**
 * 필수 접근 범위 필터가 실제 Elasticsearch에서 성립한다 (WP-012 DoD 4·5·7).
 *
 * 단위 테스트는 `applyMandatoryScopeFilter`가 만드는 **질의 모양**을 확인한다.
 * 여기서는 그 질의를 진짜 인덱스에 던져 **결과 집합**을 확인한다 — 모양이
 * 맞아도 매핑이나 필드 이름이 어긋나면 필터가 아무것도 거르지 못하기 때문이다.
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMandatoryScopeFilter, type AccessScope } from '../src/scoped-query.js';
import { search } from '../src/search.js';
import { applyMappings, switchAliasesForTests } from '../src/bootstrap.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const ALIAS = 'prs-pull-requests';

/** 세 저장소, 세 조직·팀·가시성 조합. 사용자는 이 중 일부만 볼 수 있다. */
const DOCUMENTS = [
  { id: 'visible-explicit', repository_id: 101, org_id: 1, visibility: 'internal', allowed_team_ids: [10] },
  { id: 'visible-team', repository_id: 102, org_id: 1, visibility: 'private', allowed_team_ids: [10] },
  { id: 'hidden-other-repo', repository_id: 900, org_id: 1, visibility: 'private', allowed_team_ids: [99] },
  { id: 'hidden-other-org', repository_id: 901, org_id: 2, visibility: 'internal', allowed_team_ids: [10] },
] as const;

const EXPLICIT: AccessScope = { kind: 'explicit', repositoryIds: [101, 102] };
const ORG_TEAM: AccessScope = {
  kind: 'org_team',
  orgIds: [1],
  teamIds: [10],
  // 조직 구성원이 팀 소속 없이도 보는 가시성 (보안 문서 5.2).
  visibilities: ['internal'],
};

async function idsMatching(scope: AccessScope, query: Record<string, unknown> = { match_all: {} }) {
  const response = await search<{ repository_id: number }>(
    es,
    ALIAS,
    applyMandatoryScopeFilter(query, scope),
    { size: 50 },
  );
  return response.hits.hits.map((hit) => hit._id).sort();
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

  await es.deleteByQuery({ index: ALIAS, query: { match_all: {} }, refresh: true, conflicts: 'proceed' });

  const bulk = await es.bulk({
    refresh: true,
    operations: DOCUMENTS.flatMap((doc) => [
      { index: { _index: ALIAS, _id: doc.id } },
      {
        repository_id: doc.repository_id,
        org_id: doc.org_id,
        visibility: doc.visibility,
        allowed_team_ids: [...doc.allowed_team_ids],
        repository: `acme/repo-${String(doc.repository_id)}`,
        pr_number: 1,
        title: '결제 재시도',
        state: 'closed',
        document_version: 1,
      },
    ]),
  });

  // `dynamic: strict` 거부는 200 응답 안에 숨는다. 조용히 빈 인덱스로 테스트가
  // 도는 것을 막는다 — 그러면 필터가 아무것도 거르지 않아도 전부 통과한다.
  if (bulk.errors) {
    const reasons = bulk.items
      .map((item) => item.index?.error?.reason)
      .filter((reason): reason is string => reason !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }
}, 120_000);

afterAll(async () => {
  await es?.deleteByQuery({ index: ALIAS, query: { match_all: {} }, refresh: true, conflicts: 'proceed' });
  await es?.close();
});

describe('DoD 4: 접근 범위 밖 문서가 목록에 없다', () => {
  it('explicit 범위는 그 저장소의 문서만 준다', async () => {
    expect(await idsMatching(EXPLICIT)).toEqual(['visible-explicit', 'visible-team']);
  });

  it('사용자 질의가 무엇이든 범위 밖 문서가 새지 않는다', async () => {
    // 범위 밖 저장소를 콕 집어 물어도 결과가 없다 — 필터가 `must`보다 강하다.
    expect(await idsMatching(EXPLICIT, { term: { repository_id: 900 } })).toEqual([]);
    expect(await idsMatching(EXPLICIT, { match_all: {} })).not.toContain('hidden-other-repo');
  });

  it('`should`로 범위를 넓히려 해도 소용없다', async () => {
    // 클라이언트가 보낸 질의는 `must` 안에 갇힌다 (FR-AUTH-002 AC-2).
    const widened = {
      bool: { should: [{ term: { repository_id: 900 } }, { term: { repository_id: 101 } }], minimum_should_match: 1 },
    };
    expect(await idsMatching(EXPLICIT, widened)).toEqual(['visible-explicit']);
  });
});

describe('DoD 4: 집계 건수에도 범위가 걸린다 (FR-AUTH-002 AC-5)', () => {
  it('저장소별 집계에 범위 밖 저장소가 나타나지 않는다', async () => {
    const response = await search<unknown>(es, ALIAS, applyMandatoryScopeFilter({ match_all: {} }, EXPLICIT), {
      size: 0,
      aggs: { by_repository: { terms: { field: 'repository_id', size: 20 } } },
    });

    const buckets = (
      response.aggregations?.['by_repository'] as { buckets: { key: number; doc_count: number }[] } | undefined
    )?.buckets;

    expect(buckets?.map((bucket) => bucket.key).sort()).toEqual([101, 102]);
  });

  it('총 건수가 범위 안 문서 수와 같다', async () => {
    const response = await search<unknown>(es, ALIAS, applyMandatoryScopeFilter({ match_all: {} }, EXPLICIT), {
      size: 0,
      track_total_hits: true,
    });

    expect((response.hits.total as { value: number }).value).toBe(2);
  });
});

describe('DoD 5: 범위 밖 문서를 직접 ID로 조회하면 없다', () => {
  it('ID를 알아도 결과가 0건이다 — 존재 여부가 드러나지 않는다', async () => {
    // API 계층은 이 0건을 404로 옮긴다 (FR-AUTH-002 AC-4). 403이면 존재가 샌다.
    expect(await idsMatching(EXPLICIT, { ids: { values: ['hidden-other-repo'] } })).toEqual([]);
    // 범위 안 문서는 같은 방법으로 찾힌다 — 필터가 전부를 막는 것이 아니다.
    expect(await idsMatching(EXPLICIT, { ids: { values: ['visible-explicit'] } })).toEqual(['visible-explicit']);
  });
});

describe('DoD 7: 두 모드의 결과 집합이 같다 (AC-6)', () => {
  it('explicit과 org_team이 같은 문서를 준다', async () => {
    // 500개를 넘어 모드가 바뀌는 순간 사용자가 보는 것이 달라지면 안 된다.
    expect(await idsMatching(ORG_TEAM)).toEqual(await idsMatching(EXPLICIT));
  });

  it('org_team이 explicit보다 넓지 않다 — 다른 조직이 새지 않는다', async () => {
    expect(await idsMatching(ORG_TEAM)).not.toContain('hidden-other-org');
  });

  it('org_team이 explicit보다 좁지 않다 — 팀 문서가 사라지지 않는다', async () => {
    // `visible-team`은 private이라 가시성으로는 안 잡히고 팀 조건으로만 잡힌다.
    expect(await idsMatching(ORG_TEAM)).toContain('visible-team');
  });

  it('조직이 같아도 팀·가시성이 모두 어긋나면 보이지 않는다', async () => {
    expect(await idsMatching(ORG_TEAM)).not.toContain('hidden-other-repo');
  });
});

describe('기본 거부', () => {
  it('빈 범위로는 질의를 만들 수 없다 (AC-3)', () => {
    // 빈 목록으로 조회하면 0건이 나오는데, 그것은 "권한이 없다"와
    // "결과가 없다"를 구분하지 못하게 만든다.
    expect(() => applyMandatoryScopeFilter({ match_all: {} }, { kind: 'explicit', repositoryIds: [] })).toThrow(
      /접근 범위를 확인할 수 없다/,
    );
    expect(() =>
      applyMandatoryScopeFilter({ match_all: {} }, { kind: 'org_team', orgIds: [], teamIds: [], visibilities: [] }),
    ).toThrow(/접근 범위를 확인할 수 없다/);
  });
});
