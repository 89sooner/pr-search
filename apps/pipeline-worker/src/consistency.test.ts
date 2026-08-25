/**
 * PG↔ES 정합성 감시 (JOB-ING-008 / WP-028, ADR-004, CR-033).
 *
 * 핵심 주장: **ES에만 있는 잉여 문서를 자동 삭제하지 않는다** (DEV-174).
 * 지우는 변이는 여기서 죽는다.
 */

import { describe, expect, it } from 'vitest';
import {
  CONSISTENCY_INTERVAL_MS,
  CONSISTENCY_SAMPLE_SIZE,
  checkRepositoryConsistency,
  fingerprint,
} from './consistency.js';
import type { ConsistencyDeps } from './consistency.js';

const REPOSITORY = {
  repository_id: 1,
  owner: 'acme',
  name: 'payments',
} as unknown as Parameters<typeof checkRepositoryConsistency>[1];

/** 정본·색인 문서. 기본 내용은 같고, 시험이 필요할 때만 어긋뜨린다. */
function doc(prNumber: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository_id: 1,
    pr_number: prNumber,
    title: `PR ${String(prNumber)}`,
    state: 'open',
    draft: false,
    author: 'kim',
    base_branch: 'main',
    head_branch: 'feat/x',
    merge_commit_sha: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    merged_at: null,
    closed_at: null,
    labels: ['backend'],
    document_version: 100,
    ...overrides,
  };
}

function harness(options: {
  readonly pgNumbers: readonly number[];
  readonly pgTotal?: number;
  readonly esNumbers: readonly number[];
  readonly esTotal?: number;
  /** PR 번호별 색인 문서 덮어쓰기. 내용 불일치를 만들 때 쓴다. */
  readonly esOverrides?: Readonly<Record<number, Record<string, unknown>>>;
}): { readonly deps: ConsistencyDeps; readonly deletes: string[]; readonly reprojected: number[][] } {
  const deletes: string[] = [];
  const reprojected: number[][] = [];

  const pool = {
    query: (text: string) => {
      const sql = String(text);
      if (/\bDELETE\b/i.test(sql)) deletes.push(sql);
      if (/count\(\*\)/i.test(sql)) {
        return Promise.resolve({ rows: [{ count: String(options.pgTotal ?? options.pgNumbers.length) }] });
      }
      if (/FROM pull_request_snapshot/i.test(sql)) {
        return Promise.resolve({
          rows: options.pgNumbers.map((n) => ({
            repository_id: '1',
            pr_number: n,
            document_version: '100',
            source: 'webhook',
            document: doc(n),
          })),
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as ConsistencyDeps['pool'];

  const es = {
    search: () =>
      Promise.resolve({
        hits: {
          total: { value: options.esTotal ?? options.esNumbers.length, relation: 'eq' },
          hits: options.esNumbers.map((n) => ({ _source: doc(n, options.esOverrides?.[n] ?? {}) })),
        },
      }),
  } as unknown as ConsistencyDeps['es'];

  const metrics = {
    projectionConsistencyMismatch: { inc: (): void => undefined },
  } as unknown as ConsistencyDeps['metrics'];

  return {
    deps: {
      pool,
      es,
      metrics,
      now: () => new Date('2026-08-25T00:00:00Z'),
      requestReprojection: (_id, numbers) => {
        reprojected.push([...numbers]);
        return Promise.resolve();
      },
    },
    deletes,
    reprojected,
  };
}

describe('두 층을 가른다', () => {
  it('둘이 같으면 보고가 없다', async () => {
    const h = harness({ pgNumbers: [3, 2, 1], esNumbers: [3, 2, 1] });
    expect(await checkRepositoryConsistency(h.deps, REPOSITORY)).toEqual([]);
  });

  it('개수가 다르면 count 불일치다', async () => {
    const h = harness({ pgNumbers: [1], pgTotal: 10, esNumbers: [1], esTotal: 7 });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    const count = reports.find((report) => report.kind === 'count');
    expect(count?.postgresCount).toBe(10);
    expect(count?.elasticsearchCount).toBe(7);
  });

  it('정본에 있고 색인에 없으면 missing_in_es다', async () => {
    const h = harness({ pgNumbers: [3, 2, 1], esNumbers: [3, 1] });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    const missing = reports.find((report) => report.kind === 'missing_in_es');
    expect(missing?.sampleIdentifiers).toEqual(['2']);
  });

  it('**되돌릴 수 있는 방향만 재투영을 예약한다** — 멱등한 경로다', async () => {
    const h = harness({ pgNumbers: [3, 2, 1], esNumbers: [3, 1] });
    await checkRepositoryConsistency(h.deps, REPOSITORY);
    expect(h.reprojected).toEqual([[2]]);
  });
});

describe('**ES 잉여는 지우지 않는다** (CR-033, DEV-174)', () => {
  it('extra_in_es로 보고만 한다', async () => {
    const h = harness({ pgNumbers: [1], esNumbers: [1, 99] });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    const extra = reports.find((report) => report.kind === 'extra_in_es');
    expect(extra?.sampleIdentifiers).toEqual(['99']);
  });

  it('삭제 질의가 한 건도 돌지 않는다', async () => {
    const h = harness({ pgNumbers: [1], esNumbers: [1, 99] });
    await checkRepositoryConsistency(h.deps, REPOSITORY);
    expect(h.deletes).toEqual([]);
  });

  it('잉여는 재투영 대상도 아니다 — 되돌릴 방향이 아니다', async () => {
    const h = harness({ pgNumbers: [1], esNumbers: [1, 99] });
    await checkRepositoryConsistency(h.deps, REPOSITORY);
    expect(h.reprojected).toEqual([]);
  });
});

describe('보고에 민감 정보를 넣지 않는다 (NFR-005)', () => {
  it('식별자와 개수만 남는다', async () => {
    const h = harness({ pgNumbers: [3, 2, 1], esNumbers: [3, 1] });
    const [report] = await checkRepositoryConsistency(h.deps, REPOSITORY);
    expect(Object.keys(report ?? {}).sort()).toEqual([
      'elasticsearchCount',
      'index',
      'kind',
      'observedAt',
      'postgresCount',
      'repository',
      'sampleIdentifiers',
    ]);
  });
});

describe('상수', () => {
  it('6시간 주기·표본 1000 (CR-033, DEV-174)', () => {
    expect(CONSISTENCY_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(CONSISTENCY_SAMPLE_SIZE).toBe(1000);
  });
});

describe('**내용 대조가 실제 내용을 본다** (CR-034, DEV-181)', () => {
  it('개수도 ID도 같은데 제목이 다르면 content 불일치다', async () => {
    const h = harness({ pgNumbers: [42], esNumbers: [42], esOverrides: { 42: { title: 'B' } } });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    // 식별자 대조만 했다면 여기서 아무것도 나오지 않는다.
    expect(reports.map((report) => report.kind)).toEqual(['content']);
    expect(reports[0]?.sampleIdentifiers).toEqual(['42']);
  });

  it('상태가 다르면 잡는다', async () => {
    const h = harness({ pgNumbers: [42], esNumbers: [42], esOverrides: { 42: { state: 'merged' } } });
    expect((await checkRepositoryConsistency(h.deps, REPOSITORY)).map((r) => r.kind)).toEqual(['content']);
  });

  it('대상 브랜치가 다르면 잡는다', async () => {
    const h = harness({ pgNumbers: [42], esNumbers: [42], esOverrides: { 42: { base_branch: 'release/1' } } });
    expect((await checkRepositoryConsistency(h.deps, REPOSITORY)).map((r) => r.kind)).toEqual(['content']);
  });

  it('머지 메타데이터가 다르면 잡는다', async () => {
    const h = harness({
      pgNumbers: [42],
      esNumbers: [42],
      esOverrides: { 42: { merge_commit_sha: 'a'.repeat(40) } },
    });
    expect((await checkRepositoryConsistency(h.deps, REPOSITORY)).map((r) => r.kind)).toEqual(['content']);
  });

  it('**라벨 순서는 불일치가 아니다** — 순서가 의미 없는 모음은 정렬해 본다', async () => {
    const h = harness({
      pgNumbers: [42],
      esNumbers: [42],
      esOverrides: { 42: { labels: ['backend'] } },
    });
    expect(await checkRepositoryConsistency(h.deps, REPOSITORY)).toEqual([]);
  });

  it('**보고에 원문을 남기지 않는다** — 식별자와 개수뿐이다 (NFR-005)', async () => {
    const h = harness({ pgNumbers: [42], esNumbers: [42], esOverrides: { 42: { title: '비밀 제목' } } });
    const [report] = await checkRepositoryConsistency(h.deps, REPOSITORY);
    expect(JSON.stringify(report)).not.toContain('비밀 제목');
  });
});

describe('지문', () => {
  it('같은 내용이면 같다 — 키 순서에 기대지 않는다', () => {
    expect(fingerprint({ pr_number: 1, title: 'a' })).toBe(fingerprint({ title: 'a', pr_number: 1 }));
  });

  it('본문은 대조에 넣지 않는다 — 달라도 불일치가 아니다', () => {
    expect(fingerprint(doc(1, { body: 'x' }))).toBe(fingerprint(doc(1, { body: 'y' })));
  });
});
