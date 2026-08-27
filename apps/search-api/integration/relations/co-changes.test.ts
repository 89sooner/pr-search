/**
 * API-REL-003 동시 변경 — **실제 Elasticsearch** (WP-031 DoD / CR-042, FR-REL-007).
 *
 * 여기서 거는 것은 셋이다.
 *
 * 1. **정확한 자카드** — 후보를 먼저 자른 뒤 계산하면 진짜 상위가 잘린 밖에 남는다.
 *    그 상황을 픽스처로 **실제로 만들어** 건다 (DEV-255)
 * 2. **자격 상태 셋** — 계산 불가와 결과 0건은 다른 사실이다 (DEV-254)
 * 3. **겹치는 경로의 결정론적 순서** (DEV-256)
 *
 * 실행: `pnpm test:integration relations/co-changes` (실제 Elasticsearch 필요)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions, type AccessScope } from '@prs/es';
import { getCoChanges } from '../../src/relations/co-changes.js';

const ORG = 1;
const REPO = 9111;
const OTHER_REPO = 9112;
const SLUG = 'acme/cochange-wp031';
const OTHER_SLUG = 'acme/cochange-other';
const REPOS = [REPO, OTHER_REPO];

/** 기준 PR의 머지 시각. 창은 여기서 ±90일이다. */
const ANCHOR_MERGED_AT = '2026-06-01T00:00:00.000Z';

/** 앱단 pre-limit 함정을 재현하려고 만드는 미끼 후보 수. */
const DECOY_COUNT = 30;

let es: Client;

const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: REPOS };

interface PrFixture {
  readonly repositoryId?: number;
  readonly repository?: string;
  readonly prNumber: number;
  readonly title?: string;
  readonly author?: string;
  readonly mergedAt?: string | null;
  readonly paths: readonly string[];
  readonly changedFilesCount?: number;
  readonly enrichmentPending?: boolean;
}

function shift(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

const DAY = 86_400_000;

async function indexPrs(docs: readonly PrFixture[]): Promise<void> {
  const operations = docs.flatMap((doc) => {
    const repositoryId = doc.repositoryId ?? REPO;
    const id = `${String(repositoryId)}:${String(doc.prNumber)}`;
    const source: Record<string, unknown> = {
      doc_id: id,
      repository_id: repositoryId,
      repository: doc.repository ?? SLUG,
      org_id: ORG,
      visibility: 'internal',
      allowed_team_ids: [],
      pr_number: doc.prNumber,
      title: doc.title ?? `PR ${String(doc.prNumber)}`,
      author: doc.author ?? 'kim',
      state: 'merged',
      changed_paths: [...doc.paths],
      changed_files_count: doc.changedFilesCount ?? doc.paths.length,
      document_version: 1,
    };
    if (doc.mergedAt !== null) source['merged_at'] = doc.mergedAt ?? ANCHOR_MERGED_AT;
    if (doc.enrichmentPending !== undefined) source['enrichment_pending'] = doc.enrichmentPending;
    return [
      { index: { _index: 'prs-pull-requests', _id: id, routing: String(repositoryId) } },
      source,
    ];
  });
  const bulk = await es.bulk({ refresh: true, operations });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }
}

async function clearFixtures(): Promise<void> {
  await es.indices.refresh({ index: 'prs-pull-requests' });
  await es.deleteByQuery({
    index: 'prs-pull-requests',
    refresh: true,
    conflicts: 'proceed',
    query: { terms: { repository_id: REPOS } },
  });
}

/** 기준 PR의 경로 넷. 자카드 분모가 손으로 계산 가능한 크기여야 한다. */
const SOURCE_PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];

beforeAll(async () => {
  es = createEsClient(resolveClientOptions(process.env));
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);
  await clearFixtures();

  const decoys: PrFixture[] = [];
  for (let i = 0; i < DECOY_COUNT; i += 1) {
    decoys.push({
      // **미끼는 번호가 작고 최근에 머지됐다.** `pr_number` 오름차순이나
      // `merged_at` 내림차순으로 후보를 먼저 자르면 이것들이 창을 채운다.
      prNumber: 200 + i,
      mergedAt: shift(ANCHOR_MERGED_AT, DAY),
      paths: ['src/a.ts', `src/noise-${String(i)}.ts`, `src/noise-b-${String(i)}.ts`],
    });
  }

  await indexPrs([
    { prNumber: 100, paths: SOURCE_PATHS, mergedAt: ANCHOR_MERGED_AT, title: '기준 PR' },

    /*
     * **진짜 상위 후보.** 번호가 가장 크고(오름차순이면 맨 뒤) 창의 가장 이른
     * 쪽에 있다(내림차순이면 맨 뒤). 어떤 비-점수 정렬로 잘라도 미끼 30건에
     * 밀려 창 밖으로 나간다 — 그래도 자카드 1위여야 한다.
     */
    {
      prNumber: 999,
      title: '진짜 상위',
      mergedAt: shift(ANCHOR_MERGED_AT, -89 * DAY),
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    },
    // 두 번째: ∩=2, ∪=4 → 0.5
    { prNumber: 101, title: '절반', mergedAt: ANCHOR_MERGED_AT, paths: ['src/a.ts', 'src/b.ts'] },

    // ── 자격 미달 후보들 (전부 결과에서 빠져야 한다)
    {
      prNumber: 300,
      title: '창 밖 (90일 + 1초)',
      mergedAt: shift(ANCHOR_MERGED_AT, -(90 * DAY + 1_000)),
      paths: SOURCE_PATHS,
    },
    {
      prNumber: 301,
      title: '변경 파일 201개',
      mergedAt: ANCHOR_MERGED_AT,
      paths: SOURCE_PATHS,
      changedFilesCount: 201,
    },
    {
      prNumber: 302,
      title: '보강 미완료',
      mergedAt: ANCHOR_MERGED_AT,
      paths: SOURCE_PATHS,
      enrichmentPending: true,
    },
    {
      prNumber: 303,
      title: '다른 저장소',
      repositoryId: OTHER_REPO,
      repository: OTHER_SLUG,
      mergedAt: ANCHOR_MERGED_AT,
      paths: SOURCE_PATHS,
    },
    { prNumber: 304, title: '겹침 없음', mergedAt: ANCHOR_MERGED_AT, paths: ['docs/x.md'] },

    // ── 자격 미달 **기준** PR들
    { prNumber: 400, title: '미머지 기준', mergedAt: null, paths: SOURCE_PATHS },
    {
      prNumber: 401,
      title: '보강 미완료 기준',
      mergedAt: ANCHOR_MERGED_AT,
      paths: SOURCE_PATHS,
      enrichmentPending: true,
    },
    {
      prNumber: 402,
      title: '200개 초과 기준',
      mergedAt: ANCHOR_MERGED_AT,
      paths: SOURCE_PATHS,
      changedFilesCount: 201,
    },
    /*
     * 겹치는 경로 정렬 확인용: 사전순이 아닌 순서로 넣는다.
     *
     * **다섯째 경로가 있는 이유**는 #999와 자카드 동점(1.0)이 되지 않게 하려는
     * 것이다. 동점이면 `pr_number` 오름차순 규칙이 이겨 #500이 1위가 되고,
     * 그러면 이 파일의 "진짜 상위" 시험이 정렬 규칙 때문에 실패한다 — 규칙이
     * 옳은데 픽스처가 두 사실을 한 자리에서 물은 것이다.
     */
    {
      prNumber: 500,
      title: '겹침 정렬',
      mergedAt: ANCHOR_MERGED_AT,
      paths: ['src/d.ts', 'src/a.ts', 'src/c.ts', 'src/b.ts', 'src/z-extra.ts'],
    },

    /*
     * **겹치는 경로 상한 10을 실제로 넘기는 짝.**
     *
     * 앞의 픽스처는 경로가 넷뿐이라 `slice(0, 10)`을 지워도 결과가 같다 —
     * 등가 변이가 아니라 **시험 구멍**이다. 상한을 넘는 짝을 따로 만든다.
     */
    {
      prNumber: 600,
      title: '경로 15개 기준',
      mergedAt: ANCHOR_MERGED_AT,
      paths: Array.from({ length: 15 }, (_, i) => `src/wide/${String(i).padStart(2, '0')}.ts`),
    },
    {
      prNumber: 601,
      title: '경로 15개 후보',
      mergedAt: ANCHOR_MERGED_AT,
      paths: Array.from({ length: 15 }, (_, i) => `src/wide/${String(i).padStart(2, '0')}.ts`),
    },
    ...decoys,
  ]);

}, 60_000);

afterAll(async () => {
  await clearFixtures();
  await es.close();
});

const deps = (): { readonly es: Client } => ({ es });

async function run(prNumber: number): Promise<Record<string, unknown> | null> {
  return getCoChanges({ repository: SLUG, prNumber }, SCOPE, deps());
}

describe('정확한 자카드 (DEV-255)', () => {
  it('**미끼 30건에 밀리지 않고 진짜 상위가 1위다** — 앱단 pre-limit이면 실패한다', async () => {
    const body = await run(100);
    const items = (body?.['items'] ?? []) as readonly Record<string, unknown>[];
    expect(body?.['available']).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(
      items[0]?.['pr_number'],
      '후보를 먼저 자르고 계산하면 #999는 창 밖에 남는다',
    ).toBe(999);
  });

  it('자카드 값이 손으로 계산한 것과 같다', async () => {
    const body = await run(100);
    const items = (body?.['items'] ?? []) as readonly Record<string, unknown>[];
    const byNumber = new Map(items.map((item) => [item['pr_number'] as number, item]));
    // #999: ∩=4, ∪=4 → 1
    expect(byNumber.get(999)?.['similarity']).toBeCloseTo(1, 4);
    // #101: ∩=2, ∪=4 → 0.5
    expect(byNumber.get(101)?.['similarity']).toBeCloseTo(0.5, 4);
    // 미끼: ∩=1, ∪=6 → 0.1667
    expect(byNumber.get(200)?.['similarity']).toBeCloseTo(1 / 6, 4);
  });

  it('동률은 `pr_number` 오름차순으로 깬다 — 같은 정본이 같은 순서를 낸다', async () => {
    // #500(4/5 = 0.8)과 미끼(1/6)는 값이 다르다. 동률 규칙은 미끼끼리 확인한다.
    const body = await run(100);
    const items = (body?.['items'] ?? []) as readonly Record<string, unknown>[];
    const decoys = items
      .filter((item) => (item['similarity'] as number) < 0.2)
      .map((item) => item['pr_number'] as number);
    expect(decoys).toEqual([...decoys].sort((a, b) => a - b));
  });

  it('상위 20건으로 자른다 (AC-3)', async () => {

    const body = await run(100);
    expect(((body?.['items'] ?? []) as readonly unknown[]).length).toBe(20);
  });
});

describe('후보 자격 (AC-2·AC-4)', () => {
  it('창 밖(90일 + 1초)·200개 초과·보강 미완료·다른 저장소·자기 자신을 뺀다', async () => {
    const body = await run(100);
    const numbers = ((body?.['items'] ?? []) as readonly Record<string, unknown>[]).map(
      (item) => item['pr_number'],
    );
    expect(numbers).not.toContain(300);
    expect(numbers).not.toContain(301);
    expect(numbers).not.toContain(302);
    expect(numbers).not.toContain(303);
    expect(numbers).not.toContain(304);
    expect(numbers).not.toContain(100);
  });
});

describe('기준 PR 자격 — 계산 불가는 오류가 아니다 (DEV-254)', () => {
  it('미머지는 `not_merged`다 — `created_at`으로 창을 지어내지 않는다', async () => {
    const body = await run(400);
    expect(body?.['available']).toBe(false);
    expect(body?.['reason']).toBe('not_merged');
    expect(body?.['items']).toEqual([]);
  });

  it('보강 미완료는 `enrichment_pending`이다', async () => {
    const body = await run(401);
    expect(body?.['available']).toBe(false);
    expect(body?.['reason']).toBe('enrichment_pending');
  });

  it('200개 초과는 `too_many_changed_files`다 — 판정은 `changed_files_count`다', async () => {
    const body = await run(402);
    expect(body?.['available']).toBe(false);
    expect(body?.['reason']).toBe('too_many_changed_files');
  });

  it('**`available: true` + 0건은 다른 사실이다** — 물었고 없는 것이다', async () => {
    const body = await run(304);
    expect(body?.['available']).toBe(true);
    expect(body?.['items']).toEqual([]);
    expect(body).not.toHaveProperty('reason');
  });

  it('없거나 접근 범위 밖이면 `null`이다', async () => {
    expect(await getCoChanges({ repository: SLUG, prNumber: 100 }, { kind: 'explicit', repositoryIds: [OTHER_REPO] }, deps())).toBeNull();
    expect(await run(88_888)).toBeNull();
  });
});

describe('겹치는 경로 (AC-5, DEV-256)', () => {
  it('사전순 오름차순 상위 10이다 — 같은 정본이 같은 응답을 낸다', async () => {
    const body = await run(500);
    const items = (body?.['items'] ?? []) as readonly Record<string, unknown>[];
    const anchorMatch = items.find((item) => item['pr_number'] === 999);
    expect(anchorMatch?.['overlapping_paths']).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
    ]);
  });

  it('**상한이 10이다** — 겹침이 15개인 짝에서 실제로 잘린다 (AC-5)', async () => {
    const body = await run(600);
    const items = (body?.['items'] ?? []) as readonly Record<string, unknown>[];
    const wide = items.find((item) => item['pr_number'] === 601);
    const paths = wide?.['overlapping_paths'] as readonly string[];
    expect(paths).toHaveLength(10);
    // 사전순 앞 10개다 — 아무 10개가 아니다.
    expect(paths).toEqual([
      'src/wide/00.ts',
      'src/wide/01.ts',
      'src/wide/02.ts',
      'src/wide/03.ts',
      'src/wide/04.ts',
      'src/wide/05.ts',
      'src/wide/06.ts',
      'src/wide/07.ts',
      'src/wide/08.ts',
      'src/wide/09.ts',
    ]);
  });

});
