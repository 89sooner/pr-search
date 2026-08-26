/**
 * API-REL-006 관계 조회 — **실제 Elasticsearch** (WP-031 DoD / CR-042).
 *
 * 여기서 거는 것은 넷이다.
 *
 * 1. **THR-034 대적 매트릭스** — 간선이 보이는 것과 대상의 내용이 보이는 것은
 *    다른 판정이다 (DEV-253)
 * 2. **저장소를 건너뛰는 역방향** — 간선은 source 저장소에 살기 때문에 대상
 *    저장소로 라우팅하면 구조적으로 놓친다 (DEV-250)
 * 3. **응답 상한** — 워커의 전량 스크롤을 사용자 요청에 쓰지 않는다 (DEV-252)
 * 4. **대상 조인이 N+1이 아니다** — 왕복 수를 직접 센다 (결과로는 증명되지 않는다)
 *
 * 실행: `pnpm test:integration relations/relations` (실제 Elasticsearch 필요)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { applyMappings, createEsClient, resolveClientOptions, type AccessScope } from '@prs/es';
import { getRelations } from '../../src/relations/service.js';

const ORG = 1;
const REPO_A = 9101;
const REPO_B = 9102;
const REPO_C = 9103;
const SLUG_A = 'acme/alpha-wp031';
const SLUG_B = 'acme/bravo-wp031';
const SLUG_C = 'acme/charlie-wp031';
const REPOS = [REPO_A, REPO_B, REPO_C];

/** 상한 시험용 fixture 크기. `limit=100`에서 `truncated`가 서야 한다. */
const BULK_INCOMING = 101;

let es: Client;

function scopeOf(...repositoryIds: readonly number[]): AccessScope {
  return { kind: 'explicit', repositoryIds: [...repositoryIds] };
}

interface PrDoc {
  readonly repositoryId: number;
  readonly repository: string;
  readonly prNumber: number;
  readonly title: string;
  readonly author: string;
}

interface LinkDoc {
  readonly linkId: string;
  readonly repositoryId: number;
  readonly linkType: string;
  readonly fromType: 'pull_request' | 'commit';
  readonly fromId: string;
  readonly toType?: 'pull_request' | 'commit';
  readonly toId?: string;
  readonly toRepositoryId?: number;
  readonly confidence: string;
  readonly evidence: string;
  readonly resolved: boolean;
  readonly detached?: boolean;
  readonly referenceKey?: string;
}

function prId(repositoryId: number, prNumber: number): string {
  return `${String(repositoryId)}:${String(prNumber)}`;
}

async function indexPullRequests(docs: readonly PrDoc[]): Promise<void> {
  const operations = docs.flatMap((doc) => {
    const id = prId(doc.repositoryId, doc.prNumber);
    return [
      { index: { _index: 'prs-pull-requests', _id: id, routing: String(doc.repositoryId) } },
      {
        doc_id: id,
        repository_id: doc.repositoryId,
        repository: doc.repository,
        org_id: ORG,
        visibility: 'internal',
        allowed_team_ids: [],
        pr_number: doc.prNumber,
        title: doc.title,
        author: doc.author,
        state: 'merged',
        document_version: 1,
      },
    ];
  });
  const bulk = await es.bulk({ refresh: true, operations });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`PR fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }
}

async function indexLinks(docs: readonly LinkDoc[]): Promise<void> {
  const operations = docs.flatMap((doc) => {
    const source: Record<string, unknown> = {
      link_id: doc.linkId,
      doc_id: doc.linkId,
      repository_id: doc.repositoryId,
      org_id: ORG,
      visibility: 'internal',
      allowed_team_ids: [],
      from_type: doc.fromType,
      from_id: doc.fromId,
      link_type: doc.linkType,
      confidence: doc.confidence,
      evidence: doc.evidence,
      resolved: doc.resolved,
      created_at: '2026-08-01T00:00:00Z',
    };
    if (doc.toType !== undefined) source['to_type'] = doc.toType;
    if (doc.toId !== undefined) source['to_id'] = doc.toId;
    if (doc.toRepositoryId !== undefined) source['to_repository_id'] = doc.toRepositoryId;
    if (doc.detached !== undefined) source['detached'] = doc.detached;
    if (doc.referenceKey !== undefined) source['reference_key'] = doc.referenceKey;
    return [
      { index: { _index: 'prs-links', _id: doc.linkId, routing: String(doc.repositoryId) } },
      source,
    ];
  });
  const bulk = await es.bulk({ refresh: true, operations });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`link fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }
}

/** 내 저장소 범위의 문서만 지운다 — 공유 색인의 다른 파일 데이터를 건드리지 않는다. */
async function clearFixtures(): Promise<void> {
  for (const index of ['prs-links', 'prs-pull-requests', 'prs-commits']) {
    // `delete_by_query`는 **검색으로** 대상을 찾는다. 앞에 refresh가 필요하다.
    await es.indices.refresh({ index });
    await es.deleteByQuery({
      index,
      refresh: true,
      conflicts: 'proceed',
      query: { terms: { repository_id: REPOS } },
    });
  }
}

beforeAll(async () => {
  es = createEsClient(resolveClientOptions(process.env));
  await applyMappings(es);
  await clearFixtures();

  await indexPullRequests([
    { repositoryId: REPO_A, repository: SLUG_A, prNumber: 10, title: '결제 재시도', author: 'kim' },
    { repositoryId: REPO_A, repository: SLUG_A, prNumber: 11, title: 'Revert "결제 재시도"', author: 'park' },
    { repositoryId: REPO_A, repository: SLUG_A, prNumber: 12, title: '스택 하위', author: 'lee' },
    { repositoryId: REPO_A, repository: SLUG_A, prNumber: 13, title: '스택 상위', author: 'lee' },
    { repositoryId: REPO_A, repository: SLUG_A, prNumber: 19, title: '상한 fixture source', author: 'bulk' },

    { repositoryId: REPO_B, repository: SLUG_B, prNumber: 20, title: '브라보 대상', author: 'choi' },
    { repositoryId: REPO_C, repository: SLUG_C, prNumber: 30, title: '찰리 주체', author: 'jung' },
  ]);

  const bulkLinks: LinkDoc[] = [];
  for (let i = 0; i < BULK_INCOMING; i += 1) {
    bulkLinks.push({
      linkId: `bulk-${String(i).padStart(4, '0')}`,
      repositoryId: REPO_A,
      linkType: 'references',
      fromType: 'pull_request',
      // 상한 fixture는 **전용 source**를 쓴다. A#10을 쓰면 다른 시험의
      // "A#10의 참조" 질의에 101건이 섞여 들어와 대상 간선을 밀어낸다.
      fromId: prId(REPO_A, 19),
      toType: 'pull_request',
      toId: prId(REPO_A, 13),

      toRepositoryId: REPO_A,
      confidence: 'heuristic',
      evidence: `대량 근거 ${String(i)}`,
      resolved: true,
      referenceKey: `pr:13#${String(i)}`,
    });
  }

  await indexLinks([
    // ── 저장소를 건너뛰는 참조. **간선은 source 저장소에 산다.**
    {
      linkId: 'x-a-to-b',
      repositoryId: REPO_A,
      linkType: 'references',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 10),
      toType: 'pull_request',
      toId: prId(REPO_B, 20),
      toRepositoryId: REPO_B,
      confidence: 'derived',
      evidence: `Refs: ${SLUG_B}#20`,
      resolved: true,
      referenceKey: `x:${SLUG_B}:pr:20`,
    },
    {
      linkId: 'x-c-to-b',
      repositoryId: REPO_C,
      linkType: 'references',
      fromType: 'pull_request',
      fromId: prId(REPO_C, 30),
      toType: 'pull_request',
      toId: prId(REPO_B, 20),
      toRepositoryId: REPO_B,
      confidence: 'derived',
      evidence: `Refs: ${SLUG_B}#20`,
      resolved: true,
      referenceKey: `x:${SLUG_B}:pr:20`,
    },
    // ── 미해결 참조. 대상 식별자가 없다.
    {
      linkId: 'unresolved-ref',
      repositoryId: REPO_A,
      linkType: 'references',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 12),
      confidence: 'heuristic',
      evidence: 'Refs: abc1234',
      resolved: false,
      referenceKey: 'commit-prefix:abc1234',
    },
    // ── 되돌림. 트레일러는 `exact`.
    {
      linkId: 'revert-exact',
      repositoryId: REPO_A,
      linkType: 'reverts',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 11),
      toType: 'pull_request',
      toId: prId(REPO_A, 10),
      toRepositoryId: REPO_A,
      confidence: 'exact',
      evidence: 'This reverts commit aaaa',
      resolved: true,
    },
    // ── 다중 후보: 같은 근거에서 나온 `heuristic` 둘 (DEV-261).
    {
      linkId: 'revert-cand-1',
      repositoryId: REPO_A,
      linkType: 'reverts',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 11),
      toType: 'pull_request',
      toId: prId(REPO_A, 12),
      toRepositoryId: REPO_A,
      confidence: 'heuristic',
      evidence: 'Revert "같은 제목"',
      resolved: true,
    },
    {
      linkId: 'revert-cand-2',
      repositoryId: REPO_A,
      linkType: 'reverts',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 11),
      toType: 'pull_request',
      toId: prId(REPO_A, 13),
      toRepositoryId: REPO_A,
      confidence: 'heuristic',
      evidence: 'Revert "같은 제목"',
      resolved: true,
    },
    // ── 해제된 스택 (FR-REL-006 AC-3).
    {
      linkId: 'stack-detached',
      repositoryId: REPO_A,
      linkType: 'stacks_on',
      fromType: 'pull_request',
      fromId: prId(REPO_A, 12),
      toType: 'pull_request',
      toId: prId(REPO_A, 13),
      toRepositoryId: REPO_A,
      confidence: 'derived',
      evidence: 'base=feature/upper',
      resolved: true,
      detached: true,
    },
    ...bulkLinks,
  ]);
}, 60_000);

afterAll(async () => {
  await clearFixtures();
  await es.close();
});

const deps = (): { readonly es: Client } => ({ es });

describe('THR-034 — 간선이 보이는 것과 대상 내용이 보이는 것은 다른 판정이다 (DEV-253)', () => {
  it('**양쪽 접근 가능** — 대상의 제목·이동 링크가 함께 온다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 10 },
        linkType: 'references',
        direction: 'outgoing',
        limit: 5,
      },
      scopeOf(REPO_A, REPO_B),
      deps(),
    );

    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const cross = items.find((item) => item['link_id'] === 'x-a-to-b');
    expect(cross).toBeDefined();
    expect(cross?.['content_available']).toBe(true);
    const endpoint = cross?.['endpoint'] as Record<string, unknown>;
    expect(endpoint['title']).toBe('브라보 대상');
    expect(endpoint['url']).toBe(`/pr/${SLUG_B}/20`);
  });

  it('**대상 접근 불가** — 간선·근거는 남고 제목·작성자·링크가 없다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 10 },
        linkType: 'references',
        direction: 'outgoing',
        limit: 5,
      },
      // A만 볼 수 있다. 간선은 A에 살므로 보이지만 대상 B는 볼 수 없다.
      scopeOf(REPO_A),
      deps(),
    );

    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const cross = items.find((item) => item['link_id'] === 'x-a-to-b');
    expect(cross, '간선 자체는 보여야 한다 — 근거를 소유한 저장소가 A다').toBeDefined();
    expect(cross?.['content_available']).toBe(false);
    expect(cross?.['evidence']).toBe(`Refs: ${SLUG_B}#20`);

    const endpoint = cross?.['endpoint'] as Record<string, unknown>;
    expect(endpoint).not.toHaveProperty('title');
    expect(endpoint).not.toHaveProperty('author');
    expect(endpoint).not.toHaveProperty('url');
    // 원 표현은 남는다 — 사용자가 무엇을 참조했는지는 A의 본문에 적힌 사실이다.
    expect(endpoint['reference_expression']).toBe(`${SLUG_B}#20`);
  });

  it('**저장소를 건너뛰는 역방향** — caller 범위 안의 source만 나온다 (DEV-250)', async () => {
    const result = await getRelations(
      {
        repository: SLUG_B,
        anchor: { kind: 'pull_request', prNumber: 20 },
        linkType: 'references',
        direction: 'incoming',
        limit: 20,
      },
      // B는 볼 수 있고 A도 볼 수 있다. C는 볼 수 없다.
      scopeOf(REPO_B, REPO_A),
      deps(),
    );

    const ids = ((result?.body['items'] ?? []) as readonly Record<string, unknown>[]).map(
      (item) => item['link_id'],
    );
    expect(ids, 'A→B는 대상 저장소로 라우팅하면 절대 찾을 수 없다').toContain('x-a-to-b');
    expect(ids, 'C는 범위 밖이므로 C→B는 나오면 안 된다').not.toContain('x-c-to-b');
  });

  it('**앵커가 범위 밖이면 `null`** — 존재 여부를 알리지 않는다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 10 },
        linkType: 'references',
        direction: 'outgoing',
      },
      scopeOf(REPO_B),
      deps(),
    );
    expect(result).toBeNull();
  });

  it('org_team 범위에서도 같은 판정이다 — 명시 목록에만 걸려 있지 않다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 10 },
        linkType: 'references',
        direction: 'outgoing',
        limit: 5,
      },
      { kind: 'org_team', orgIds: [ORG], teamIds: [], visibilities: ['internal'] },
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const cross = items.find((item) => item['link_id'] === 'x-a-to-b');
    // 조직 전체가 보이는 범위이므로 대상 내용도 보인다.
    expect(cross?.['content_available']).toBe(true);
  });
});

describe('응답 상한 (DEV-252)', () => {
  it('`limit`을 넘으면 `truncated: true`이고 항목은 정확히 `limit`개다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 13 },
        linkType: 'references',
        direction: 'incoming',
        limit: 100,
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly unknown[];
    expect(items).toHaveLength(100);
    expect(result?.body['truncated']).toBe(true);
  });

  it('상한을 넘겨 요청해도 100으로 깎는다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 13 },
        linkType: 'references',
        direction: 'incoming',
        limit: 5_000,
      },
      scopeOf(REPO_A),
      deps(),
    );
    expect((result?.body['items'] as readonly unknown[]).length).toBe(100);
  });
});

describe('대상 조인이 N+1이 아니다 (DEV-253)', () => {
  it('관계 100건에 대해 Elasticsearch 왕복이 상수다', async () => {
    const original = es.search.bind(es);
    let calls = 0;
    // 클래스 인스턴스를 스프레드하지 않는다 — 프로토타입 메서드가 사라진다 (risks 18).
    (es as unknown as { search: unknown }).search = (...args: unknown[]): unknown => {
      calls += 1;
      return (original as (...a: unknown[]) => unknown)(...args);
    };

    try {
      await getRelations(
        {
          repository: SLUG_A,
          anchor: { kind: 'pull_request', prNumber: 13 },
          linkType: 'references',
          direction: 'incoming',
          limit: 100,
        },
        scopeOf(REPO_A),
        deps(),
      );
    } finally {
      (es as unknown as { search: unknown }).search = original;
    }

    // 앵커 1 + 간선 1 + 대상 종류별 2(PR·커밋) = 4. 항목 수에 비례하지 않는다.
    expect(calls, `왕복이 ${String(calls)}회다 — 항목 수에 비례하면 N+1이다`).toBeLessThanOrEqual(4);
  });
});

describe('항목 축 상태', () => {
  it('**해제된 스택을 지우지도 숨기지도 않는다** (FR-REL-006 AC-3)', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 12 },
        linkType: 'stacks_on',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['detached']).toBe(true);
  });

  it('`detached`가 없는 유형에는 키를 두지 않는다 — `false`는 다른 주장이다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 11 },
        linkType: 'reverts',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    for (const item of items) expect(item).not.toHaveProperty('detached');
  });

  it('**같은 근거의 `heuristic` 후보 둘을 다중 후보로 표시한다** (DEV-261)', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 11 },
        linkType: 'reverts',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const byId = new Map(items.map((item) => [item['link_id'] as string, item]));
    expect(byId.get('revert-cand-1')?.['ambiguous']).toBe(true);
    expect(byId.get('revert-cand-2')?.['ambiguous']).toBe(true);
    // 근거가 다른 `exact` 간선은 후보 다중성과 무관하다.
    expect(byId.get('revert-exact')?.['ambiguous']).toBe(false);
  });

  it('**저장된 신뢰도를 그대로 보고한다** (FR-REL-003 AC-2, QA-W002-12)', async () => {
    /*
     * 변이 M5(언제나 `exact`)가 살아남아 드러난 구멍이다. 순서와 다중 후보
     * 판정은 **원본 간선의** 신뢰도를 쓰므로, 응답에 실리는 값이 틀려도 그
     * 둘은 그대로였다. 화면의 배지와 근거 표시가 이 값에 걸려 있다.
     */
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 11 },
        linkType: 'reverts',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const byId = new Map(items.map((item) => [item['link_id'] as string, item['confidence']]));
    expect(byId.get('revert-exact')).toBe('exact');
    expect(byId.get('revert-cand-1')).toBe('heuristic');
    expect(byId.get('revert-cand-2')).toBe('heuristic');
  });

  it('참조 간선의 `derived`도 그대로 보고한다', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 10 },
        linkType: 'references',
        direction: 'outgoing',
        limit: 5,
      },
      scopeOf(REPO_A, REPO_B),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    expect(items.find((item) => item['link_id'] === 'x-a-to-b')?.['confidence']).toBe('derived');
  });

  it('신뢰도 순서가 결정론적이다 — `exact`가 앞, 동률은 `link_id`', async () => {

    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 11 },
        linkType: 'reverts',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const ids = ((result?.body['items'] ?? []) as readonly Record<string, unknown>[]).map(
      (item) => item['link_id'],
    );
    expect(ids).toEqual(['revert-exact', 'revert-cand-1', 'revert-cand-2']);
  });

  it('미해결 참조는 대상 식별자가 없고 원 표현만 남는다 (FR-REL-003 AC-3)', async () => {
    const result = await getRelations(
      {
        repository: SLUG_A,
        anchor: { kind: 'pull_request', prNumber: 12 },
        linkType: 'references',
        direction: 'outgoing',
      },
      scopeOf(REPO_A),
      deps(),
    );
    const items = (result?.body['items'] ?? []) as readonly Record<string, unknown>[];
    const unresolved = items.find((item) => item['link_id'] === 'unresolved-ref');
    expect(unresolved?.['resolved']).toBe(false);
    expect(unresolved?.['content_available']).toBe(false);
    const endpoint = unresolved?.['endpoint'] as Record<string, unknown>;
    expect(endpoint).not.toHaveProperty('url');
    expect(endpoint['reference_expression']).toBe('abc1234');
  });
});
