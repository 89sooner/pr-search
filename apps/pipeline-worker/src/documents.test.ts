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
import { buildCommitDocuments, buildPullRequestDocument, buildUpsertRequests } from './documents.js';

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

function source(event: IngestionEnriched = enriched()): Parameters<typeof buildUpsertRequests>[0] {
  return {
    enriched: event,
    repository: REPOSITORY,
    documentVersion: 1_754_042_400_000,
    indexedAt: new Date('2026-08-02T10:30:05.000Z'),
  };
}

/** 매핑이 선언한 최상위 필드 이름. 화이트리스트 검사의 기준이다. */
function mappedFields(mapping: typeof PULL_REQUEST_MAPPING): ReadonlySet<string> {
  return new Set(Object.keys(mapping.properties ?? {}));
}

describe('PR 문서 (ENT-CORE-002)', () => {
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
