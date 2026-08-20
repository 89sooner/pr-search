/**
 * 이벤트 카탈로그의 이름과 payload 모양 (비동기 문서 4장).
 *
 * 전송 수단을 모르는 순수 타입이라 `@prs/domain`에 둔다. 게이트웨이(발행)와
 * 아웃박스 재적재 잡(재발행)이 같은 정의를 써야 소비자가 둘을 구분하지 않고
 * 처리할 수 있다.
 */

export const EVENT_NAMES = {
  /** EVT-ING-001 */
  ingestionEventReceived: 'ingestion.event_received',
  /** EVT-ING-002 */
  ingestionEnriched: 'ingestion.enriched',
  /** EVT-ING-003 */
  ingestionProjected: 'ingestion.projected',
  /** EVT-ING-004 */
  ingestionFailed: 'ingestion.failed',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** EVT-ING-001 `ingestion.event_received`. */
export interface IngestionEventReceived {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository_id: number | null;
  readonly correlation_id: string;
  readonly occurred_at: string;
}

/**
 * 수집 레인의 파티션 키 (비동기 문서 2장: `prs:ingest` → `repository_id`).
 *
 * 저장소를 알 수 없는 이벤트(조직 단위 `team` 등)는 전달 식별자를 쓴다. 그런
 * 이벤트에는 저장소별 순서라는 개념 자체가 없으므로 아무 파티션에 흩어져도
 * 되지만, 재전송이 같은 파티션에 떨어져야 중복 처리가 한 소비자에서 걸린다.
 */
export function ingestPartitionKey(repositoryId: number | null, deliveryId: string): string {
  return repositoryId === null ? deliveryId : String(repositoryId);
}

/**
 * EVT-ING-002 `ingestion.enriched` (CR-010, DEV-013).
 *
 * **self-contained bounded 이벤트다.** 투영(WP-008)이 GitHub API를 다시 부르지
 * 않고 문서를 만들 수 있도록 필요한 것을 실어 보낸다. 그러지 않으면 보강이
 * 아껴 둔 rate limit을 투영이 다시 쓰게 되어 FR-ING-004의 설계가 무의미해진다.
 *
 * **싣지 않는 것**: 원본 웹훅 전량, patch/diff 본문, 소스 코드, 토큰,
 * Authorization 정보. 크기는 커밋 250건·파일 3000건 상한이 묶는다.
 */

/** 보강된 PR 요약. 웹훅 payload만으로도 채울 수 있는 범위다 (FR-ING-004 AC-3). */
export interface EnrichedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly merged: boolean;
  readonly merged_at: string | null;
  readonly merge_commit_sha: string | null;
  readonly author: string | null;
  readonly head_ref: string;
  readonly head_sha: string;
  readonly base_ref: string;
  readonly base_sha: string;
}

/** 변경 파일 한 건. 경로와 라인 수만 싣는다 — patch 본문은 싣지 않는다. */
export interface EnrichedChangedFile {
  readonly filename: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: string;
}

/** 리뷰 한 건 (FR-ING-004 AC-1: 리뷰어와 리뷰 상태). */
export interface EnrichedReview {
  readonly id: number;
  readonly state: string;
  readonly reviewer: string | null;
  readonly submitted_at: string | null;
}

/** 어느 구성 요소가 왜 비었는지. 메시지는 이미 가려진 상태로만 들어온다. */
export interface EnrichmentError {
  readonly component: EnrichmentComponent;
  readonly kind: string;
  readonly message: string;
}

export type EnrichmentComponent = 'pull_request' | 'commits' | 'files' | 'reviews';

/** EVT-ING-002 `ingestion.enriched`. */
export interface IngestionEnriched {
  readonly delivery_id: string;
  readonly repository_id: number;
  readonly entity_kind: 'pull_request';
  readonly pr_number: number;
  /** 보강도 웹훅 payload도 PR을 주지 못했으면 `null`이다. */
  readonly pull_request: EnrichedPullRequest | null;
  readonly source_commit_shas: readonly string[];
  readonly changed_files: readonly EnrichedChangedFile[];
  readonly reviews: readonly EnrichedReview[];
  /** 커밋이 상한을 넘어 절삭됐다 (FR-SRCH-003 AC-4). */
  readonly source_commits_truncated: boolean;
  /** 파일이 상한을 넘어 절삭됐다 (FR-ING-004 AC-4). */
  readonly files_truncated: boolean;
  /** 부분 결과다. 투영은 이 표식을 문서에 그대로 옮긴다 (FR-ING-004 AC-3). */
  readonly enrichment_pending: boolean;
  readonly enrichment_errors: readonly EnrichmentError[];
  readonly correlation_id: string;
}
