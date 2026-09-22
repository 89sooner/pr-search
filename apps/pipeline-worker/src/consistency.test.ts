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

/**
 * 레지스트리 행. **접근 범위 필드를 실제와 같게 채운다** (CR-037, DEV-193).
 *
 * `repository.allowed_team_ids`는 마이그레이션 011에서 `NOT NULL DEFAULT '{}'`이며
 * `status`도 `NOT NULL`이다. 대역이 그것을 비워 두면 지문이 무엇을 근거로 만드는지
 * 시험이 보지 못한다 — 대역이 실제보다 관대하면 그만큼이 사각지대다.
 */
const REPOSITORY = {
  repository_id: 1,
  owner: 'acme',
  name: 'payments',
  org_id: 9,
  visibility: 'private',
  allowed_team_ids: [7, 3],
  status: 'active',
  // 부트스트랩이 끝난 저장소다. 실제 열은 `Date | null`이며 절대 `undefined`가
  // 아니다 — 비워 두면 부트스트랩 관문이 시험되지 않는다 (CR-037, DEV-195).
  snapshot_bootstrapped_at: new Date('2026-08-20T00:00:00Z'),
  last_reconciled_at: null,
  last_reconcile_missing_count: null,
  annotate_enabled: true,
  annotate_blocked_at: null,
  annotate_blocked_reason: null, tag_enabled: true, tag_blocked_at: null, tag_blocked_reason: null,
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
    // 투영이 문서에 싣는 접근 범위 (`repositoryScope()`). 지문의 일부다.
    org_id: 9,
    visibility: 'private',
    allowed_team_ids: [3, 7],
    repository_archived: false,
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

/**
 * 접근 통제 필드의 drift (CR-037, DEV-193).
 *
 * ID·개수·제목·상태가 **전부 같아도** 접근 범위 재료가 어긋나면 불일치다.
 * 이것은 검색 데이터 drift가 아니라 authorization material drift이며, 그냥 두면
 * 잘못된 조직에 결과가 노출되거나 정당한 결과가 감춰진 채 감시가 통과시킨다.
 */
describe('접근 통제 필드는 지문의 일부다 (CR-037, DEV-193)', () => {
  const same = { pgNumbers: [1, 2], esNumbers: [1, 2] } as const;

  async function kindsFor(esOverrides: Readonly<Record<number, Record<string, unknown>>>): Promise<readonly string[]> {
    const h = harness({ ...same, esOverrides });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    return reports.map((report) => report.kind);
  }

  it('org_id만 달라도 content 불일치다', async () => {
    expect(await kindsFor({ 1: { org_id: 99 } })).toContain('content');
  });

  it('visibility만 달라도 content 불일치다', async () => {
    expect(await kindsFor({ 1: { visibility: 'public' } })).toContain('content');
  });

  it('allowed_team_ids만 달라도 content 불일치다 — PG [1] vs ES [1,2]', async () => {
    /*
     * 색인이 정본보다 **넓은** 팀 목록을 들고 있는 상태다. 회수가 색인에
     * 반영되지 않은 모습 그대로이며, 이것을 `consistent`로 적으면 유출이 감시를
     * 통과한다.
     */
    const narrow = {
      ...REPOSITORY,
      allowed_team_ids: [1],
    } as unknown as typeof REPOSITORY;
    const h = harness({ ...same, esOverrides: { 1: { allowed_team_ids: [1, 2] } } });
    const reports = await checkRepositoryConsistency(h.deps, narrow);
    expect(reports.map((report) => report.kind)).toContain('content');
  });

  it('repository_archived만 달라도 content 불일치다', async () => {
    expect(await kindsFor({ 2: { repository_archived: true } })).toContain('content');
  });

  it('팀 목록의 순서만 다른 것은 불일치가 아니다', async () => {
    expect(await kindsFor({ 1: { allowed_team_ids: [7, 3] } })).not.toContain('content');
  });

  it('보고에는 식별자만 남는다 — 원문 제목·본문을 싣지 않는다', async () => {
    const h = harness({ ...same, esOverrides: { 1: { org_id: 99 } } });
    const reports = await checkRepositoryConsistency(h.deps, REPOSITORY);
    const serialized = JSON.stringify(reports);
    expect(serialized).not.toContain('PR 1');
    expect(serialized).not.toContain('backend');
  });

  it('정본의 접근 범위는 레지스트리가 준다 — 스냅숏의 옛 사본이 아니다', async () => {
    /*
     * 스냅숏 문서(`doc()`)는 투영 당시의 `allowed_team_ids: [3, 7]`을 담고 있다.
     * 그 뒤 팀이 회수되어 레지스트리는 [3]만 안다. 색인도 옛 [3, 7]이다.
     * 스냅숏을 기대값으로 삼으면 **양쪽이 옛 값으로 일치**해 유출이 정상으로
     * 보고된다 — 레지스트리를 읽어야 어긋남이 드러난다.
     */
    const revoked = { ...REPOSITORY, allowed_team_ids: [3] } as unknown as typeof REPOSITORY;
    const h = harness(same);
    const reports = await checkRepositoryConsistency(h.deps, revoked);
    expect(reports.map((report) => report.kind)).toContain('content');
  });
});

/**
 * 부트스트랩 이전 상태와 색인 손상을 가른다 (CR-037, DEV-195).
 */
describe('정본 부트스트랩이 끝나지 않았으면 손상이라고 말하지 않는다 (CR-037, DEV-195)', () => {
  const pending = {
    ...(REPOSITORY as unknown as Record<string, unknown>),
    snapshot_bootstrapped_at: null,
  } as unknown as typeof REPOSITORY;

  it('스냅숏이 비어 있어도 extra_in_es로 보고하지 않는다', async () => {
    const h = harness({ pgNumbers: [], pgTotal: 0, esNumbers: [1, 2, 3] });
    const reports = await checkRepositoryConsistency(h.deps, pending);
    const kinds = reports.map((report) => report.kind);
    expect(kinds).toEqual(['snapshot_bootstrap_pending']);
    expect(kinds).not.toContain('extra_in_es');
    expect(kinds).not.toContain('count');
  });

  it('보고에 양쪽 개수를 실어 진행 상황을 볼 수 있게 한다', async () => {
    const h = harness({ pgNumbers: [1], pgTotal: 1, esNumbers: [1, 2, 3], esTotal: 3 });
    const [report] = await checkRepositoryConsistency(h.deps, pending);
    expect(report?.postgresCount).toBe(1);
    expect(report?.elasticsearchCount).toBe(3);
    expect(report?.sampleIdentifiers).toEqual([]);
  });

  it('재투영을 예약하지 않는다 — 기대값 자체가 아직 완성되지 않았다', async () => {
    const h = harness({ pgNumbers: [1], pgTotal: 1, esNumbers: [] });
    await checkRepositoryConsistency(h.deps, pending);
    expect(h.reprojected).toEqual([]);
  });

  it('부트스트랩이 끝난 저장소는 평소대로 대조한다', async () => {
    const h = harness({ pgNumbers: [1], pgTotal: 1, esNumbers: [1, 2, 3], esTotal: 3 });
    const kinds = (await checkRepositoryConsistency(h.deps, REPOSITORY)).map((report) => report.kind);
    expect(kinds).toContain('count');
    expect(kinds).toContain('extra_in_es');
    expect(kinds).not.toContain('snapshot_bootstrap_pending');
  });

  it('여전히 자동 삭제는 하지 않는다', async () => {
    const h = harness({ pgNumbers: [], pgTotal: 0, esNumbers: [1, 2, 3] });
    await checkRepositoryConsistency(h.deps, pending);
    expect(h.deletes).toEqual([]);
  });
});
