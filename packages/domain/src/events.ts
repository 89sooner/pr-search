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
  /** EVT-AUTH-001 */
  permissionInvalidated: 'permission.invalidated',
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
 * `raw_event` 행에서 `EVT-ING-001`을 만드는 데 필요한 만큼.
 *
 * `@prs/db`의 `RawEventRow`가 구조적으로 이것을 만족한다. 여기서 그 타입을
 * 직접 import하지 않는 이유는 `@prs/domain`이 워크스페이스 의존을 갖지 않기
 * 때문이다 — 재발행이 필요한 곳이 아웃박스 재적재(워커)와 실패 대기열
 * 재처리(ops) 둘로 늘어나면서, 둘 다 볼 수 있는 자리는 여기뿐이 됐다.
 */
export interface RawEventSource {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository_id: number | null;
  readonly correlation_id: string;
  readonly received_at: Date;
}

/** 원본 행을 `EVT-ING-001` payload로 되돌린다. 재발행 경로가 공유한다. */
export function toIngestionEvent(row: RawEventSource): IngestionEventReceived {
  return {
    delivery_id: row.delivery_id,
    event_type: row.event_type,
    action: row.action,
    repository_id: row.repository_id,
    correlation_id: row.correlation_id,
    occurred_at: row.received_at.toISOString(),
  };
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

/**
 * 보강된 PR 요약. 웹훅 payload만으로도 채울 수 있는 범위다 (FR-ING-004 AC-3).
 *
 * 필드 집합은 **PR 문서 매핑(ENT-CORE-002)이 선언한 PR 고유 필드 전부**다
 * (CR-011, DEV-018). 투영이 이 이벤트만 보고 문서를 만들 수 있어야 하고,
 * `created_at` 없이는 `lead_time_seconds`·`first_review_wait_seconds`를
 * 계산할 수 없다.
 */
export interface EnrichedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly draft: boolean;
  /** 라벨 이름만. 색·설명은 매핑에 없다. */
  readonly labels: readonly string[];
  readonly merged: boolean;
  /** 투영의 리드 타임 기준점. 웹훅에도 PR API에도 있다. */
  readonly created_at: string | null;
  readonly updated_at: string | null;
  readonly closed_at: string | null;
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

/** EVT-ING-003이 가리킬 수 있는 엔티티. 릴리스 문서는 WP-024가 더한다. */
export type ProjectedEntityKind = 'pull_request' | 'commit';

/**
 * EVT-ING-003 `ingestion.projected`.
 *
 * 관계 워커(JOB-REL-001~005)가 이것을 받아 간선을 판다. 문서 본문을 싣지 않는
 * 이유: 관계 파생은 색인된 문서를 다시 읽어야 하고, 그때 읽는 것이 정본이다.
 */
export interface IngestionProjected {
  readonly repository_id: number;
  readonly entity_kind: ProjectedEntityKind;
  /** 색인된 문서 ID. `pullRequestDocId`/`commitDocId`가 만든 값이다. */
  readonly entity_id: string;
  readonly document_version: number;
  readonly correlation_id: string;
}

/**
 * PR 문서 ID (WP-008).
 *
 * 저장소를 접두로 두는 이유는 두 가지다. PR 번호는 저장소 안에서만 유일하고,
 * 같은 접두가 `_routing`과 짝을 이뤄 한 저장소의 문서가 한 샤드에 모인다.
 */
export function pullRequestDocId(repositoryId: number, prNumber: number): string {
  return `${String(repositoryId)}:${String(prNumber)}`;
}

/**
 * 커밋 문서 ID (WP-008).
 *
 * SHA는 **소문자 40자 그대로** 쓴다. 축약하지 않는다 — 축약 SHA는 검색 입력이지
 * 문서 정체성이 아니다 (ADR-012). 대소문자를 섞어 보내는 곳이 있어 여기서 한 번
 * 낮춘다. 그러지 않으면 같은 커밋이 문서 둘이 된다.
 */
export function commitDocId(repositoryId: number, commitSha: string): string {
  return `${String(repositoryId)}:${commitSha.toLowerCase()}`;
}
