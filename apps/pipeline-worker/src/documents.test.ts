/**
 * 정규화 문서 생성 (WP-008, FR-ING-005).
 *
 * 여기서 보는 것은 **문서 모양**이다. Elasticsearch 없이 돌아야 한다 — 필드
 * 화이트리스트가 지켜지는지는 클러스터가 아니라 이 함수가 정하는 것이기 때문이다.
 */

import { describe, expect, it } from 'vitest';
import { COMMIT_MAPPING, PULL_REQUEST_MAPPING } from '@prs/es';
import type { EnrichedPullRequest, IngestionEnriched } from '@prs/domain';
import type { RepositoryRow } from '@prs/db';
import {
  buildCommitDocuments,
  buildPullRequestDocument,
  buildUpsertRequests,
  type AuthorTeamResolution,
} from './documents.js';

const REPOSITORY: RepositoryRow = {
  repository_id: 4021,
  owner: 'acme',
  name: 'payments',
  org_id: 77,
  visibility: 'internal',
  sequence_branches: ['main'],
  mirror_enabled: true,
  status: 'active',
  registered_at: new Date('2026-08-01T00:00:00.000Z'),
  allowed_team_ids: [],
  snapshot_bootstrapped_at: null,
  last_reconciled_at: null,
  last_reconcile_missing_count: null,
  annotate_enabled: true,
  annotate_blocked_at: null,
  annotate_blocked_reason: null,
};

const PR: EnrichedPullRequest = {
  number: 1234,
  title: 'feat: 결제 재시도',
  body: '지수 백오프로 재시도한다.',
  state: 'closed',
  draft: false,
  labels: ['payments', 'bug'],
  merged: true,
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-02T10:30:00.000Z',
  closed_at: '2026-08-02T10:30:00.000Z',
  merged_at: '2026-08-02T10:30:00.000Z',
  merge_commit_sha: 'A3F9C21B4E8D7F0C1A2B3C4D5E6F708192A3B4C5',
  author: 'jdoe',
  head_ref: 'feature/retry',
  head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
  base_ref: 'main',
  base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e',
};

function enriched(overrides: Partial<IngestionEnriched> = {}): IngestionEnriched {
  return {
    delivery_id: 'delivery-1',
    repository_id: 4021,
    entity_kind: 'pull_request',
    pr_number: 1234,
    pull_request: PR,
    source_commit_shas: ['dddd111122223333444455556666777788889999'],
    changed_files: [
      { filename: 'src/pay.ts', additions: 10, deletions: 2, status: 'modified' },
      { filename: 'src/retry.ts', additions: 30, deletions: 0, status: 'added' },
    ],
    reviews: [
      { id: 1, state: 'COMMENTED', reviewer: 'alice', submitted_at: '2026-08-01T12:00:00.000Z' },
      { id: 2, state: 'APPROVED', reviewer: 'bob', submitted_at: '2026-08-02T09:00:00.000Z' },
      { id: 3, state: 'PENDING', reviewer: 'carol', submitted_at: null },
    ],
    source_commits_truncated: false,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: 'corr-1',
    ...overrides,
  };
}

function source(
  event: IngestionEnriched = enriched(),
  authorTeams: AuthorTeamResolution = { kind: 'unknown' },
): Parameters<typeof buildUpsertRequests>[0] {
  return {
    enriched: event,
    repository: REPOSITORY,
    documentVersion: 1_754_042_400_000,
    indexedAt: new Date('2026-08-02T10:30:05.000Z'),
    /**
     * 기본값은 **모름**이다 (WP-069 / CR-058). 소속을 시험하지 않는 시험이
     * 조용히 팀을 갖게 되면, 필드를 싣는 조건이 무엇인지 그 시험들이 흐린다.
     */
    authorTeams,
  };
}

/** 매핑이 선언한 최상위 필드 이름. 화이트리스트 검사의 기준이다. */
function mappedFields(mapping: typeof PULL_REQUEST_MAPPING): ReadonlySet<string> {
  return new Set(Object.keys(mapping.properties ?? {}));
}

describe('PR 문서 (ENT-CORE-002)', () => {
  /**
   * **병합은 파생 상태다** (CR-101 / DEV-718). GitHub은 병합된 PR도 `state: closed`로 주고 `merged`·
   * `merged_at`이 따로 말한다. 문서 계약·`is:merged`·화면 배지·M 번호 조회는 전부 `merged`를 전제하므로
   * 투영이 파생해야 한다. 이 픽스처(closed + merged)는 원래부터 현실적이었지만 산출 `state`를 아무도
   * 단언하지 않아 pilot.12까지 병합된 PR이 `closed`로 색인됐다.
   */
  it('**closed + merged는 `merged`로 색인된다** — 병합 시각만 있어도 같다', () => {
    expect(buildPullRequestDocument(source()).doc['state']).toBe('merged');
    const byMergedAtOnly = enriched({ pull_request: { ...PR, merged: false } });
    expect(buildPullRequestDocument(source(byMergedAtOnly)).doc['state']).toBe('merged');
  });

  it('병합 신호가 없으면 GitHub이 준 값 그대로다 — open·closed', () => {
    const open = enriched({ pull_request: { ...PR, state: 'open', merged: false, merged_at: null, closed_at: null } });
    expect(buildPullRequestDocument(source(open)).doc['state']).toBe('open');
    const closedUnmerged = enriched({ pull_request: { ...PR, state: 'closed', merged: false, merged_at: null } });
    expect(buildPullRequestDocument(source(closedUnmerged)).doc['state']).toBe('closed');
  });

  it('결정론적 ID와 저장소 라우팅을 쓴다', () => {
    const request = buildPullRequestDocument(source());
    expect(request.alias).toBe('prs-pull-requests');
    expect(request.id).toBe('4021:1234');
    expect(request.routing).toBe('4021');
  });

  it('매핑에 없는 필드를 만들지 않는다 (THR-010, 필드 화이트리스트)', () => {
    const request = buildPullRequestDocument(source());
    const allowed = mappedFields(PULL_REQUEST_MAPPING);
    const written = [...Object.keys(request.doc), ...Object.keys(request.createOnly ?? {})];
    expect(written.filter((field) => !allowed.has(field))).toEqual([]);
  });

  it('사전 계산 필드를 채운다', () => {
    const doc = buildPullRequestDocument(source()).doc;
    // 2026-08-01T09:00 → 2026-08-02T10:30 = 25시간 30분
    expect(doc['lead_time_seconds']).toBe(91_800);
    // 2026-08-01T09:00 → 2026-08-01T12:00 = 3시간
    expect(doc['first_review_wait_seconds']).toBe(10_800);
    expect(doc['first_review_at']).toBe('2026-08-01T12:00:00.000Z');
    expect(doc['changed_files_count']).toBe(2);
    expect(doc['additions']).toBe(40);
    expect(doc['deletions']).toBe(2);
    expect(doc['changed_paths']).toEqual(['src/pay.ts', 'src/retry.ts']);
  });

  it('리뷰어와 승인자를 구분한다', () => {
    const doc = buildPullRequestDocument(source()).doc;
    expect(doc['reviewers']).toEqual(['alice', 'bob', 'carol']);
    expect(doc['approved_by']).toEqual(['bob']);
  });

  it('접근 범위 필드를 저장소 등록에서 가져온다 (ADR-008)', () => {
    const doc = buildPullRequestDocument(source()).doc;
    expect(doc['repository_id']).toBe(4021);
    expect(doc['repository']).toBe('acme/payments');
    expect(doc['org_id']).toBe(77);
    expect(doc['visibility']).toBe('internal');
  });

  it('보강이 PR을 못 가져왔으면 아는 것만 담는다 (FR-ING-004 AC-3)', () => {
    const doc = buildPullRequestDocument(
      source(enriched({ pull_request: null, enrichment_pending: true })),
    ).doc;
    expect(doc['pr_number']).toBe(1234);
    expect(doc['enrichment_pending']).toBe(true);
    // 모르는 것은 비워 두지 않고 아예 넣지 않는다.
    expect(doc).not.toHaveProperty('title');
    expect(doc).not.toHaveProperty('lead_time_seconds');
    expect(doc['changed_files_count']).toBe(2);
  });

  it('머지되지 않은 PR에는 리드 타임이 없다', () => {
    const open: EnrichedPullRequest = { ...PR, merged: false, merged_at: null };
    const doc = buildPullRequestDocument(source(enriched({ pull_request: open }))).doc;
    expect(doc).not.toHaveProperty('lead_time_seconds');
  });

  it('음수 리드 타임은 사실이 아니라 시계 문제이므로 비운다', () => {
    const skewed: EnrichedPullRequest = { ...PR, merged_at: '2026-07-31T00:00:00.000Z' };
    const doc = buildPullRequestDocument(source(enriched({ pull_request: skewed }))).doc;
    expect(doc).not.toHaveProperty('lead_time_seconds');
  });

  it('다른 워커가 소유한 필드는 생성 시점에만 둔다 (CR-011)', () => {
    const request = buildPullRequestDocument(source());
    // 투영이 돌 때마다 WP-029의 결과를 되돌리면 안 된다.
    expect(request.doc).not.toHaveProperty('links_pending');
    expect(request.doc).not.toHaveProperty('link_summary');
    expect(request.createOnly?.['links_pending']).toBe(true);
    // 시퀀스 필드는 초깃값조차 두지 않는다 — 0은 틀린 순번이다.
    expect(request.createOnly).not.toHaveProperty('merge_seq');
  });

  it('**M 번호 필드는 투영이 아예 싣지 않는다** (WP-074 / 상세 설계 8절)', () => {
    const request = buildPullRequestDocument(source());
    /*
     * `merge_seq`와 같은 규율이다. `doc`에 `merge_number: null`을 실으면 투영이
     * 돌 때마다 채번이 쓴 번호가 지워지고, 화면은 확정된 번호가 대기로 돌아가는
     * 것을 본다. `createOnly`에 두는 것도 안 된다 — 부재가 곧 "아직 없다"이고
     * 명시적 `null`은 "확인했는데 없다"라서 뜻이 다르다.
     */
    for (const field of ['merge_number', 'merge_number_epoch', 'merge_number_state', 'merge_number_reason']) {
      expect(request.doc, field).not.toHaveProperty(field);
      expect(request.createOnly ?? {}, field).not.toHaveProperty(field);
      expect(request.remove ?? [], field).not.toContain(field);
    }
  });

  it('보관된 저장소를 표시한다 (FR-ING-009 AC-3)', () => {
    const archived: RepositoryRow = { ...REPOSITORY, status: 'archived' };
    const doc = buildPullRequestDocument({ ...source(), repository: archived }).doc;
    expect(doc['repository_archived']).toBe(true);
  });

  it('마지막 반영 이벤트와 반영 시각을 남긴다 (AC-4)', () => {
    const doc = buildPullRequestDocument(source()).doc;
    expect(doc['last_delivery_id']).toBe('delivery-1');
    expect(doc['indexed_at']).toBe('2026-08-02T10:30:05.000Z');
    expect(doc['document_version']).toBe(1_754_042_400_000);
  });
});

describe('CR-053: 집계가 읽을 값은 색인 시점에 계산한다', () => {
  it('`changed_lines`가 `additions + deletions`다 (DEV-386)', () => {
    // 조회 시점에 더하면 `script`가 필요하고 NFR-001이 그것을 금지한다.
    const doc = buildPullRequestDocument(source()).doc as Record<string, unknown>;
    const additions = doc['additions'] as number;
    const deletions = doc['deletions'] as number;
    expect(doc['changed_lines']).toBe(additions + deletions);
  });

  it('매핑에 `changed_lines`가 있다', () => {
    expect(mappedFields(PULL_REQUEST_MAPPING)).toContain('changed_lines');
  });

  it('**작성자 본인 리뷰는 첫 리뷰가 아니다** (FR-STAT-004 AC-3, DEV-387)', () => {
    /*
     * 자기 PR에 스스로 남긴 코멘트를 첫 리뷰로 세면 대기 시간이 실제보다
     * 짧아진다. 그 값은 색인 시점에 저장되므로 **API도 화면도 고칠 수 없다.**
     */
    const withSelfReview = enriched({
      reviews: [
        { id: 9, state: 'COMMENTED', reviewer: PR.author, submitted_at: '2026-08-01T09:30:00.000Z' },
        { id: 1, state: 'COMMENTED', reviewer: 'alice', submitted_at: '2026-08-01T12:00:00.000Z' },
      ],
    });
    const doc = buildPullRequestDocument(source(withSelfReview)).doc as Record<string, unknown>;

    // 첫 리뷰는 alice의 12:00이며 09:30이 아니다.
    expect(doc['first_review_at']).toBe('2026-08-01T12:00:00.000Z');
    // 09:00 생성 → 12:00 = 세 시간.
    expect(doc['first_review_wait_seconds']).toBe(3 * 3600);
  });

  it('작성자 리뷰뿐이면 첫 리뷰가 없다', () => {
    const onlySelf = enriched({
      reviews: [
        { id: 9, state: 'COMMENTED', reviewer: PR.author, submitted_at: '2026-08-01T09:30:00.000Z' },
      ],
    });
    const doc = buildPullRequestDocument(source(onlySelf)).doc as Record<string, unknown>;
    expect(doc['first_review_at']).toBeUndefined();
    expect(doc['first_review_wait_seconds']).toBeUndefined();
  });

  it('리뷰어를 모르면 거르지 않는다 — 없는 값을 지어내지 않는다', () => {
    const unknownReviewer = enriched({
      reviews: [{ id: 9, state: 'COMMENTED', reviewer: null, submitted_at: '2026-08-01T09:30:00.000Z' }],
    });
    const doc = buildPullRequestDocument(source(unknownReviewer)).doc as Record<string, unknown>;
    expect(doc['first_review_at']).toBe('2026-08-01T09:30:00.000Z');
  });
});

describe('커밋 문서 (ENT-CORE-003)', () => {
  it('원본 커밋과 머지 커밋을 각각 만든다', () => {
    const requests = buildCommitDocuments(source());
    expect(requests).toHaveLength(2);
    const roles = requests.map((request) => request.doc['role']);
    expect(roles).toContain('source_commit');
    expect(roles).toContain('merge_commit');
  });

  it('SHA를 소문자로 정규화한다 (ADR-012)', () => {
    const merge = buildCommitDocuments(source()).find(
      (request) => request.doc['role'] === 'merge_commit',
    );
    expect(merge?.id).toBe('4021:a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5');
    expect(merge?.doc['commit_sha']).toBe('a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5');
  });

  it('PR 번호를 누적 필드로 싣는다 (CR-011, DEV-019)', () => {
    for (const request of buildCommitDocuments(source())) {
      expect(request.union?.['pull_request_numbers']).toEqual([1234]);
      // 대입하면 다른 PR의 번호를 지운다. 상태 필드에 있으면 안 된다.
      expect(request.doc).not.toHaveProperty('pull_request_numbers');
    }
  });

  it('매핑에 없는 필드를 만들지 않는다', () => {
    const allowed = mappedFields(COMMIT_MAPPING);
    for (const request of buildCommitDocuments(source())) {
      const written = [
        ...Object.keys(request.doc),
        ...Object.keys(request.union ?? {}),
        ...Object.keys(request.createOnly ?? {}),
      ];
      expect(written.filter((field) => !allowed.has(field))).toEqual([]);
    }
  });

  it('머지 커밋이 원본 목록에도 있으면 문서는 하나이고 역할은 머지 커밋이다', () => {
    const requests = buildCommitDocuments(
      source(enriched({ source_commit_shas: [PR.merge_commit_sha ?? ''] })),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.doc['role']).toBe('merge_commit');
  });

  it('머지되지 않은 PR은 머지 커밋 문서를 만들지 않는다', () => {
    const open: EnrichedPullRequest = { ...PR, merged: false };
    const requests = buildCommitDocuments(source(enriched({ pull_request: open })));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.doc['role']).toBe('source_commit');
  });

  it('커밋 메시지·작성자를 지어내지 않는다', () => {
    for (const request of buildCommitDocuments(source())) {
      // EVT-ING-002는 SHA만 나른다. 없는 것을 빈 문자열로 채우면 나중에 미러가
      // 채울 때 "이미 있다"로 보인다.
      expect(request.doc).not.toHaveProperty('message');
      expect(request.doc).not.toHaveProperty('author');
      expect(request.doc).not.toHaveProperty('parent_shas');
    }
  });
});

describe('한 이벤트가 만드는 문서 전부', () => {
  it('PR 1건 + 커밋 N건이 함께 나온다 (AC-2가 벌크 1건으로 보낼 대상)', () => {
    const requests = buildUpsertRequests(source());
    expect(requests).toHaveLength(3);
    expect(requests[0]?.alias).toBe('prs-pull-requests');
    expect(requests.slice(1).every((request) => request.alias === 'prs-commits')).toBe(true);
    expect(new Set(requests.map((request) => request.id)).size).toBe(3);
  });

  it('모든 문서가 같은 버전과 같은 라우팅을 쓴다', () => {
    for (const request of buildUpsertRequests(source())) {
      expect(request.doc.document_version).toBe(1_754_042_400_000);
      expect(request.routing).toBe('4021');
    }
  });
});

describe('**변경 규모를 모르면 값을 쓰지 않는다** (CR-056, DEV-450)', () => {
  /*
   * 빈 파일 목록을 세어 0을 쓰면 그 값이 사실의 진술이 되고, `FR-STAT-005`
   * AC-5가 가르라고 한 모름과 0이 같은 구간에 들어간다. 집계의 `unknown`은
   * 이 필드들의 **부재**를 세므로 판정 재료가 한 곳에만 있다.
   */
  const SIZE_FIELDS = ['changed_files_count', 'additions', 'deletions', 'changed_lines'] as const;

  const filesFailed = { component: 'files', kind: 'http_500', message: 'boom' } as const;

  /*
   * **규모 몫만 본다** (WP-069 / CR-058).
   *
   * `remove`는 이제 두 판정이 함께 쓴다 — 변경 규모 넷과 작성자 팀 하나. 이 절의
   * 시험은 규모를 보는 것이므로 그 몫만 걸러 낸다. 전체를 그대로 단언하면 다른
   * 판정이 바뀔 때마다 상관없는 시험이 깨지고, 그 소음이 **진짜 회귀를 가린다.**
   */
  const sizeRemovals = (request: { readonly remove?: readonly string[] }): readonly string[] =>
    (request.remove ?? []).filter((field) => (SIZE_FIELDS as readonly string[]).includes(field));

  it('**파일 보강이 실패하면 넷 다 없다** — 빈 목록이 0을 뜻하지 않는다', () => {
    const doc = buildPullRequestDocument(
      source(
        enriched({
          pull_request: null,
          changed_files: [],
          enrichment_pending: true,
          enrichment_errors: [filesFailed],
        }),
      ),
    ).doc;
    for (const field of SIZE_FIELDS) {
      expect(doc, `${field}가 남아 있다`).not.toHaveProperty(field);
    }
  });

  it('**옛 값을 실제로 지운다** — 싣지 않는 것만으로는 남는다 (PR #95 리뷰 P1)', () => {
    /*
     * 조건부 업서트는 `params.doc`에 실린 키만 대입한다. 이미 색인된 수가
     * 그대로 남으면 그 PR은 계속 숫자 구간에 머문다.
     */
    const request = buildPullRequestDocument(
      source(
        enriched({
          pull_request: null,
          changed_files: [],
          enrichment_pending: true,
          enrichment_errors: [filesFailed],
        }),
      ),
    );
    expect(sizeRemovals(request)).toEqual([...SIZE_FIELDS]);
  });

  it('**파일 보강이 성공했으면 다른 실패는 규모를 건드리지 않는다** (PR #95 리뷰 P2)', () => {
    // `enrichment_pending`은 네 구성 요소 중 하나만 실패해도 참이다. 리뷰 조회가
    // 실패했다고 실제로 받은 파일 목록을 버리면 아는 것을 잃는다.
    const request = buildPullRequestDocument(
      source(
        enriched({
          pull_request: null,
          enrichment_pending: true,
          enrichment_errors: [{ component: 'reviews', kind: 'http_500', message: 'boom' }],
        }),
      ),
    );
    expect(request.doc['changed_files_count']).toBe(2);
    expect(request.doc['changed_lines']).toBe(42);
    expect(sizeRemovals(request)).toEqual([]);
  });

  it('**파일이 비었어도 그 조회가 성공했으면 0은 사실이다**', () => {
    const request = buildPullRequestDocument(
      source(enriched({ changed_files: [], enrichment_pending: true, enrichment_errors: [
        { component: 'commits', kind: 'http_500', message: 'boom' },
      ] })),
    );
    expect(request.doc['changed_files_count']).toBe(0);
    expect(sizeRemovals(request)).toEqual([]);
  });

  it('**보강이 끝난 0은 그대로 쓴다** — 하나도 바꾸지 않은 PR은 실재한다', () => {
    const doc = buildPullRequestDocument(source(enriched({ changed_files: [] }))).doc;
    expect(doc['changed_files_count']).toBe(0);
    expect(doc['changed_lines']).toBe(0);
  });
});

describe('**작성자 소속 팀** (WP-069 / CR-058, FR-STAT-006 · FR-SRCH-005)', () => {
  const AUTHOR_FIELD = 'author_team_ids';

  it('아는 소속은 그대로 싣는다', () => {
    const doc = buildPullRequestDocument(source(enriched(), { kind: 'known', teamIds: [101] })).doc;
    expect(doc[AUTHOR_FIELD]).toEqual([101]);
  });

  it('여러 팀을 실으며 중복을 접고 오름차순으로 고정한다 — 같은 소속이 늘 같은 배열이어야 `noop`이 성립한다', () => {
    const doc = buildPullRequestDocument(
      source(enriched(), { kind: 'known', teamIds: [303, 101, 303, 202] }),
    ).doc;
    expect(doc[AUTHOR_FIELD]).toEqual([101, 202, 303]);
  });

  it('**조회에 성공했고 팀이 0개면 빈 배열이 사실의 진술이다** — 부재가 아니다', () => {
    const request = buildPullRequestDocument(source(enriched(), { kind: 'known', teamIds: [] }));
    expect(request.doc[AUTHOR_FIELD]).toEqual([]);
    expect(request.remove ?? []).not.toContain(AUTHOR_FIELD);
  });

  it('**모르면 필드를 쓰지 않고 옛 값을 지운다** — 부재로 판정하는 필드는 부재를 만들 수 있어야 한다 (DEV-484)', () => {
    const request = buildPullRequestDocument(source(enriched(), { kind: 'unknown' }));
    expect(Object.keys(request.doc)).not.toContain(AUTHOR_FIELD);
    expect(request.remove ?? []).toContain(AUTHOR_FIELD);
  });

  it('**작성자를 모르면 소속도 모름이다** — 호출부가 앎을 넘겨도 문서가 거짓을 말하지 않는다 (DEV-487)', () => {
    const request = buildPullRequestDocument(
      source(enriched({ pull_request: null }), { kind: 'known', teamIds: [101] }),
    );
    expect(Object.keys(request.doc)).not.toContain('author');
    expect(Object.keys(request.doc)).not.toContain(AUTHOR_FIELD);
    expect(request.remove ?? []).toContain(AUTHOR_FIELD);
  });

  it('**`allowed_team_ids`와 다른 값이다** — 하나로 합치면 접근 권한을 성과로 읽게 된다 (DEV-382)', () => {
    const doc = buildPullRequestDocument(source(enriched(), { kind: 'known', teamIds: [101] })).doc;
    expect(doc[AUTHOR_FIELD]).toEqual([101]);
    expect(doc['allowed_team_ids']).not.toEqual([101]);
  });

  it('매핑이 이 필드를 이미 선언하고 있다 — 새 인덱스 버전이 필요 없는 이유다', () => {
    expect(mappedFields(PULL_REQUEST_MAPPING)).toContain(AUTHOR_FIELD);
  });

  it('두 판정이 같은 `remove`를 함께 쓴다 — 규모 넷과 작성자 팀 하나', () => {
    const request = buildPullRequestDocument(
      source(
        enriched({
          pull_request: null,
          changed_files: [],
          enrichment_pending: true,
          enrichment_errors: [{ component: 'files', kind: 'http_500', message: 'boom' }],
        }),
        { kind: 'unknown' },
      ),
    );
    expect(request.remove).toEqual([
      'changed_files_count',
      'additions',
      'deletions',
      'changed_lines',
      AUTHOR_FIELD,
    ]);
  });
});
