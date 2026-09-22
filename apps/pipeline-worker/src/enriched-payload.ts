/**
 * `EVT-ING-002` payload 검증 (WP-008).
 *
 * 이 이벤트는 우리가 만든다. 그래서 모양이 다르면 남의 API가 바뀐 것이 아니라
 * **우리 계약이 깨진 것**이고, 조용히 넘기면 안 된다. 그렇다고 `as IngestionEnriched`로
 * 믿어 버리면 깨진 계약이 `undefined`가 되어 문서 필드에 그대로 들어간다.
 *
 * 규칙은 둘이다. 필수 스칼라가 다르면 이벤트 전체를 거절한다. 배열 원소 하나가
 * 이상하면 그 원소만 버린다 — 리뷰 한 건 때문에 PR 문서를 통째로 잃을 이유는 없다.
 */

import type { PullRequestSummary } from '@prs/github';
import type {
  EnrichedChangedFile,
  EnrichedPullRequest,
  EnrichedReview,
  EnrichmentError,
  IngestionEnriched,
} from '@prs/domain';

export type EnrichedParse =
  | { readonly kind: 'ok'; readonly enriched: IngestionEnriched }
  | { readonly kind: 'invalid'; readonly reason: string };

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

function parsePullRequest(value: unknown): EnrichedPullRequest | null {
  const pr = asRecord(value);
  if (pr === undefined) return null;
  const number = asPositiveInteger(pr['number']);
  const headRef = asString(pr['head_ref']);
  const headSha = asString(pr['head_sha']);
  const baseRef = asString(pr['base_ref']);
  const baseSha = asString(pr['base_sha']);
  if (
    number === undefined ||
    headRef === undefined ||
    headSha === undefined ||
    baseRef === undefined ||
    baseSha === undefined
  ) {
    return null;
  }
  return {
    number,
    title: asString(pr['title']) ?? '',
    body: asNullableString(pr['body']),
    state: asString(pr['state']) ?? 'unknown',
    draft: pr['draft'] === true,
    labels: asStringArray(pr['labels']),
    merged: pr['merged'] === true,
    created_at: asNullableString(pr['created_at']),
    updated_at: asNullableString(pr['updated_at']),
    closed_at: asNullableString(pr['closed_at']),
    merged_at: asNullableString(pr['merged_at']),
    merge_commit_sha: asNullableString(pr['merge_commit_sha']),
    author: asNullableString(pr['author']),
    head_ref: headRef,
    head_sha: headSha,
    base_ref: baseRef,
    base_sha: baseSha,
    // 0은 사실이므로 `?? null`이 아니라 타입 검사로 가른다 (CR-116).
    commits_count:
      typeof pr['commits_count'] === 'number' && Number.isSafeInteger(pr['commits_count']) && pr['commits_count'] >= 0
        ? pr['commits_count']
        : null,
  };
}

function parseChangedFiles(value: unknown): readonly EnrichedChangedFile[] {
  if (!Array.isArray(value)) return [];
  const files: EnrichedChangedFile[] = [];
  for (const entry of value) {
    const file = asRecord(entry);
    const filename = asString(file?.['filename']);
    if (file === undefined || filename === undefined) continue;
    files.push({
      filename,
      additions: asFiniteNumber(file['additions']),
      deletions: asFiniteNumber(file['deletions']),
      status: asString(file['status']) ?? 'unknown',
    });
  }
  return files;
}

function parseReviews(value: unknown): readonly EnrichedReview[] {
  if (!Array.isArray(value)) return [];
  const reviews: EnrichedReview[] = [];
  for (const entry of value) {
    const review = asRecord(entry);
    const id = asPositiveInteger(review?.['id']);
    if (review === undefined || id === undefined) continue;
    reviews.push({
      id,
      state: asString(review['state']) ?? 'unknown',
      reviewer: asNullableString(review['reviewer']),
      submitted_at: asNullableString(review['submitted_at']),
    });
  }
  return reviews;
}

function parseErrors(value: unknown): readonly EnrichmentError[] {
  if (!Array.isArray(value)) return [];
  const errors: EnrichmentError[] = [];
  for (const entry of value) {
    const error = asRecord(entry);
    const component = asString(error?.['component']);
    if (
      error === undefined ||
      (component !== 'pull_request' && component !== 'commits' && component !== 'files' && component !== 'reviews')
    ) {
      continue;
    }
    errors.push({
      component,
      kind: asString(error['kind']) ?? 'unknown',
      message: asString(error['message']) ?? '',
    });
  }
  return errors;
}

export function parseEnriched(payload: unknown): EnrichedParse {
  const root = asRecord(payload);
  if (root === undefined) return { kind: 'invalid', reason: 'payload가 객체가 아니다' };

  const deliveryId = asString(root['delivery_id']);
  if (deliveryId === undefined) return { kind: 'invalid', reason: 'delivery_id가 없다' };

  const repositoryId = asPositiveInteger(root['repository_id']);
  if (repositoryId === undefined) return { kind: 'invalid', reason: 'repository_id가 없다' };

  if (root['entity_kind'] !== 'pull_request') {
    return { kind: 'invalid', reason: `알 수 없는 entity_kind: ${String(root['entity_kind'])}` };
  }

  const prNumber = asPositiveInteger(root['pr_number']);
  if (prNumber === undefined) return { kind: 'invalid', reason: 'pr_number가 없다' };

  return {
    kind: 'ok',
    enriched: {
      delivery_id: deliveryId,
      repository_id: repositoryId,
      entity_kind: 'pull_request',
      pr_number: prNumber,
      pull_request: parsePullRequest(root['pull_request']),
      source_commit_shas: asStringArray(root['source_commit_shas']),
      changed_files: parseChangedFiles(root['changed_files']),
      reviews: parseReviews(root['reviews']),
      source_commits_truncated: root['source_commits_truncated'] === true,
      /*
       * **없으면 거짓이다** (CR-116). 이 필드를 싣지 않던 배포가 남긴 이벤트가
       * 늦게 도착하면 그 관측에는 완전성 근거가 없고, 근거 없는 관측에 삭제
       * 권한을 주지 않는다. 추가는 그대로 된다.
       */
      source_commits_complete: root['source_commits_complete'] === true,
      files_truncated: root['files_truncated'] === true,
      enrichment_pending: root['enrichment_pending'] === true,
      enrichment_errors: parseErrors(root['enrichment_errors']),
      correlation_id: asString(root['correlation_id']) ?? '',
    },
  };
}

/**
 * GHE API의 PR 응답 → `EnrichedPullRequest` (WP-007 / WP-019).
 *
 * **실시간과 백필이 같은 매핑을 쓴다** (CR-022). 두 경로가 각자 필드를 옮기면
 * 언젠가 어긋나고, 그때 **백필로 들어온 PR만 어떤 필드가 비는** 상태가 된다 —
 * 검색 결과에서 그것은 "그런 PR은 없다"로 읽힌다.
 */
export function toEnrichedPullRequest(fresh: PullRequestSummary): EnrichedPullRequest {
  return {
    number: fresh.number,
    title: fresh.title,
    body: fresh.body,
    state: fresh.state,
    draft: fresh.draft,
    labels: fresh.labels.map((label) => label.name),
    merged: fresh.merged,
    created_at: fresh.created_at,
    updated_at: fresh.updated_at,
    closed_at: fresh.closed_at,
    merged_at: fresh.merged_at,
    merge_commit_sha: fresh.merge_commit_sha,
    author: fresh.user?.login ?? null,
    head_ref: fresh.head.ref,
    head_sha: fresh.head.sha,
    base_ref: fresh.base.ref,
    base_sha: fresh.base.sha,
    // 원격이 주지 않으면 `null`이다 (CR-116). 목록 길이로 대신 채우지 않는다 —
    // 그러면 대조가 언제나 성립해 완전성 판정이 무의미해진다.
    commits_count: typeof fresh.commits === 'number' && Number.isSafeInteger(fresh.commits) && fresh.commits >= 0 ? fresh.commits : null,
  };
}
