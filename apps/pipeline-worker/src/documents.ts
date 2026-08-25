/**
 * 정규화 문서 생성 (WP-008, FR-ING-005, ENT-CORE-002·ENT-CORE-003).
 *
 * **이 파일이 필드 화이트리스트다.** 문서에 들어가는 값은 전부 여기서 이름을
 * 직접 적어 만든다. 웹훅 payload든 보강 결과든 객체를 통째로 펼쳐 넣는 곳이
 * 하나도 없다 — 그래야 GHE가 새 필드를 보내기 시작한 날 소스 코드나 개인정보가
 * 조용히 색인되지 않는다 (NFR-005, THR-010). 매핑의 `dynamic: strict`는 이
 * 규율이 깨졌을 때 울리는 두 번째 방어선이지 첫 번째가 아니다.
 *
 * 순수 함수만 둔다. Elasticsearch도 PostgreSQL도 모른다 — 그래야 문서 모양을
 * 실제 클러스터 없이 시험할 수 있다.
 */

import {
  commitDocId,
  pullRequestDocId,
  type EnrichedReview,
  type IngestionEnriched,
} from '@prs/domain';
import type { RepositoryRow } from '@prs/db';
import type { UpsertRequest } from '@prs/es';

/** 커밋이 문서에서 갖는 역할 (FR-SRCH-002 AC-1~AC-3). */
export type CommitRole = 'merge_commit' | 'source_commit';

export interface ProjectionSource {
  readonly enriched: IngestionEnriched;
  /** 접근 범위 필드의 유일한 출처다. 미등록 저장소면 애초에 투영하지 않는다. */
  readonly repository: RepositoryRow;
  /**
   * 문서 버전 (FR-ING-005 AC-1).
   *
   * **웹훅 수신 시각의 밀리초 epoch다.** 보강 시각이 아니다 — 두 웹훅이 순서를
   * 바꿔 보강되어도 나중에 일어난 사실이 이겨야 하고, 그 순서는 수신 시각만 안다.
   */
  readonly documentVersion: number;
  readonly indexedAt: Date;
}

type Fields = Record<string, unknown>;

/** `undefined`인 값은 문서에 넣지 않는다. 모르는 것과 비어 있는 것은 다르다. */
function put(fields: Fields, key: string, value: unknown): void {
  if (value !== undefined) fields[key] = value;
}

function seconds(from: string | null | undefined, to: string | null | undefined): number | undefined {
  if (from === null || from === undefined || to === null || to === undefined) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  const delta = Math.round((end - start) / 1_000);
  // 음수 리드 타임은 시계 문제이지 사실이 아니다. 값을 비워 두는 편이 낫다.
  return delta < 0 ? undefined : delta;
}

/** 가장 이른 리뷰 제출 시각. 제출되지 않은 리뷰(`submitted_at: null`)는 세지 않는다. */
export function firstReviewAt(reviews: readonly EnrichedReview[]): string | undefined {
  let earliest: string | undefined;
  for (const review of reviews) {
    const submitted = review.submitted_at;
    if (submitted === null) continue;
    if (earliest === undefined || Date.parse(submitted) < Date.parse(earliest)) earliest = submitted;
  }
  return earliest;
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value !== ''))];
}

/**
 * 접근 범위 필드의 **유일한 출처** (ADR-008).
 *
 * 네 투영이 모두 이것을 부른다 — 각자 계산하면 한 색인만 팀을 놓치는 날이 오고,
 * 그때 그 색인의 `team:` 질의만 조용히 비어 온다 (WP-068 / CR-035, DEV-114).
 */
function repositoryScope(repository: RepositoryRow): Fields {
  return {
    repository_id: repository.repository_id,
    repository: `${repository.owner}/${repository.name}`,
    org_id: repository.org_id,
    visibility: repository.visibility,
    // 레지스트리가 소유한 값을 그대로 싣는다. 이벤트에는 없다 (CR-024).
    allowed_team_ids: [...repository.allowed_team_ids],

  };
}

/**
 * PR 문서 (ENT-CORE-002).
 *
 * 보강이 PR을 못 가져왔으면(`pull_request: null`) 아는 것만 담는다. 그것이
 * FR-ING-004 AC-3이 말하는 부분 문서이고, `enrichment_pending`이 그 사실을 알린다.
 */
export function buildPullRequestDocument(source: ProjectionSource): UpsertRequest {
  const { enriched, repository } = source;
  const pr = enriched.pull_request;
  const files = enriched.changed_files;
  const reviewedAt = firstReviewAt(enriched.reviews);

  const doc: Fields = {
    document_version: source.documentVersion,
    ...repositoryScope(repository),
    pr_number: enriched.pr_number,

    source_commit_shas: enriched.source_commit_shas.map((sha) => sha.toLowerCase()),
    source_commits_truncated: enriched.source_commits_truncated,

    // 절삭됐다면 이 수는 "가져온 만큼"이다. `files_truncated`가 그 사실을 말한다.
    changed_files_count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changed_paths: files.map((file) => file.filename),
    files_truncated: enriched.files_truncated,

    reviewers: uniqueStrings(enriched.reviews.map((review) => review.reviewer)),
    approved_by: uniqueStrings(
      enriched.reviews
        .filter((review) => review.state.toUpperCase() === 'APPROVED')
        .map((review) => review.reviewer),
    ),

    enrichment_pending: enriched.enrichment_pending,
    repository_archived: repository.status === 'archived',
    last_delivery_id: enriched.delivery_id,
    indexed_at: source.indexedAt.toISOString(),
  };

  put(doc, 'first_review_at', reviewedAt);

  if (pr !== null) {
    put(doc, 'title', pr.title);
    put(doc, 'body', pr.body);
    put(doc, 'state', pr.state);
    put(doc, 'draft', pr.draft);
    put(doc, 'labels', [...pr.labels]);
    put(doc, 'author', pr.author);
    put(doc, 'base_branch', pr.base_ref);
    put(doc, 'head_branch', pr.head_ref);
    put(doc, 'base_sha', pr.base_sha);
    put(doc, 'head_sha', pr.head_sha);
    put(doc, 'merge_commit_sha', pr.merge_commit_sha);
    put(doc, 'created_at', pr.created_at);
    put(doc, 'updated_at', pr.updated_at);
    put(doc, 'merged_at', pr.merged_at);
    put(doc, 'closed_at', pr.closed_at);
    put(doc, 'lead_time_seconds', seconds(pr.created_at, pr.merged_at));
    put(doc, 'first_review_wait_seconds', seconds(pr.created_at, reviewedAt));
  }

  return {
    alias: 'prs-pull-requests',
    id: pullRequestDocId(repository.repository_id, enriched.pr_number),
    routing: String(repository.repository_id),
    doc: doc as Fields & { document_version: number },
    createOnly: {
      // 관계 파생은 WP-029의 일이다. 투영은 "아직"이라고만 적고 값은 건드리지
      // 않는다 — `doc`에 넣으면 투영이 돌 때마다 WP-029의 결과를 되돌린다.
      links_pending: true,
      link_summary: {
        has_revert: false,
        is_reverted: false,
        has_cherry_pick: false,
        has_stack: false,
        reference_count: 0,
      },
    },
  };
}

/**
 * 커밋 문서 (ENT-CORE-003).
 *
 * EVT-ING-002는 커밋 SHA만 나른다 — 메시지·작성자·부모는 없다. 그래도 문서를
 * 만드는 이유는 **SHA → PR 해석**이 이 제품의 핵심이기 때문이다 (FR-SRCH-002).
 * 나머지 필드는 미러 기반 WP가 채우며, 조건부 업서트가 키 단위로 대입하므로
 * 여기서 비워 둔 필드는 나중에 채워져도 지워지지 않는다.
 */
export function buildCommitDocuments(source: ProjectionSource): readonly UpsertRequest[] {
  const { enriched, repository } = source;
  const pr = enriched.pull_request;

  // SHA 하나에 문서 하나다. 머지 커밋이 원본 목록에도 있으면 머지 커밋이 이긴다.
  const roles = new Map<string, CommitRole>();
  for (const sha of enriched.source_commit_shas) {
    const normalized = sha.toLowerCase();
    if (normalized !== '') roles.set(normalized, 'source_commit');
  }
  const mergeSha = pr?.merged === true ? pr.merge_commit_sha : null;
  if (mergeSha !== null && mergeSha !== undefined && mergeSha !== '') {
    roles.set(mergeSha.toLowerCase(), 'merge_commit');
  }

  const requests: UpsertRequest[] = [];
  for (const [sha, role] of roles) {
    const doc: Fields = {
      document_version: source.documentVersion,
      ...repositoryScope(repository),
      commit_sha: sha,
      role,
      enrichment_pending: enriched.enrichment_pending,
      // PR 문서와 같은 값이다. 커밋 문서는 FR-SRCH-002(SHA → PR)의 결과로
      // 직접 나가므로, 표식이 없으면 해제된 저장소가 살아 있는 것처럼 보인다
      // (CR-013, DEV-028).
      repository_archived: repository.status === 'archived',
      last_delivery_id: enriched.delivery_id,
      indexed_at: source.indexedAt.toISOString(),
    };
    put(doc, 'base_branch', pr?.base_ref);

    requests.push({
      alias: 'prs-commits',
      id: commitDocId(repository.repository_id, sha),
      routing: String(repository.repository_id),
      doc: doc as Fields & { document_version: number },
      // 커밋 하나가 여러 PR에 속할 수 있다 (데이터 모델 5장의 N:M). 대입하면
      // 나중 이벤트가 앞 PR 번호를 지운다 (CR-011, DEV-019).
      union: { pull_request_numbers: [enriched.pr_number] },
      createOnly: {
        link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false },
      },
    });
  }
  return requests;
}

/** 한 이벤트가 만드는 문서 전부. 벌크 1건으로 나간다 (FR-ING-005 AC-2). */
export function buildUpsertRequests(source: ProjectionSource): readonly UpsertRequest[] {
  return [buildPullRequestDocument(source), ...buildCommitDocuments(source)];
}
