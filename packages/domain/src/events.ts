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
  /** EVT-ING-005 (CR-039, DEV-215) */
  commitMetadataReady: 'commit.metadata_ready',
  /** EVT-SEQ-001 */
  sequenceAssigned: 'sequence.assigned',
  /** EVT-SEQ-002 */
  sequenceReassigned: 'sequence.reassigned',
  /** EVT-SEQ-004 (WP-074 / CR-077 · CR-079) */
  mergeNumberAssigned: 'mnumber.assigned',
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
  /**
   * 원격이 말한 커밋 수 (CR-116 / DEV-744).
   *
   * 모르면 `null`이다. `source_commit_shas`의 길이와 **다른 사실**이며, 둘을
   * 대조해야만 원본 커밋 목록이 완전한지 알 수 있다.
   */
  readonly commits_count: number | null;
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
  /**
   * `source_commit_shas`가 **그 PR의 전부인가** (CR-116 / FR-ING-004 AC-6).
   *
   * `source_commits_truncated`의 반대말이 아니다. 절삭은 *우리 상한*에 걸린
   * 것이고 이 값은 **읽은 목록이 원격의 전부임을 증명했는가**를 말한다. 셋이
   * 모두 성립할 때만 참이다 — 커밋 조회가 성공했고, 우리 상한에 걸리지 않았고,
   * 읽은 수가 원격이 말한 수와 같다.
   *
   * **거짓일 때 관계를 삭제하지 않는다** (CR-116). 목록에 없다는 사실이 곧
   * 소속이 아니라는 뜻이 되려면 그 목록이 전부여야 하기 때문이다. 거짓이면
   * 추가만 하고, 제거는 다음 완전한 관측까지 미룬다.
   */
  readonly source_commits_complete: boolean;
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

/**
 * EVT-ING-005 `commit.metadata_ready` (WP-029 / CR-039, DEV-215).
 *
 * **왜 필요한가.** `EVT-ING-003`은 `project` 워커가 색인한 문서마다 낸다. 그런데
 * 직접 푸시 커밋 문서는 `project`가 만들지 않는다 — 커밋 보강(JOB-MIR-002)이
 * 만든다(DEV-206). 그 경로가 아무 이벤트도 내지 않으면 그 커밋 메시지에 적힌
 * 참조는 **영원히 간선이 되지 않는다.**
 *
 * **bounded 식별자만 싣는다.** 커밋 메시지·변경 경로를 다시 버스에 실으면
 * `EVT-ING-002`가 피하려던 크기 문제를 커밋 축에서 되풀이하게 된다. 소비자는
 * `commit_snapshot`에서 읽는다 — 그것이 정본이고, 늦게 재전달된 이벤트도 **현재**
 * 정본을 보게 되어 순서 역전이 옛 본문을 되살리지 않는다.
 *
 * **`prs:projected`로 나간다.** 그 토픽을 커밋 보강 자신이 `link:commit-enrich`
 * 그룹으로 읽고 있으므로 **자기 이벤트를 되받는다** — 소비자는 `event_name`으로
 * 가르고, 보강은 이 이벤트를 받아 이것을 다시 내지 않는다 (DEV-216).
 */
export interface CommitMetadataReady {
  readonly repository_id: number;
  /** 소문자 40자. */
  readonly commit_sha: string;
  /** 색인된 커밋 문서 ID. `commitDocId`가 만든 값이다. */
  readonly entity_id: string;
  /** 어느 경로가 메타데이터를 읽었는지. 미러가 정답지다 (ADR-005). */
  readonly metadata_source: 'mirror' | 'api';
  readonly correlation_id: string;
}

/**
 * EVT-REL-001 `release.refresh_requested` (WP-024 / CR-028, DEV-144).
 *
 * **태그 이름·SHA를 싣지 않는다.** 정본은 미러의 refs/tags 스냅숏이고, 이
 * 이벤트는 "이 저장소의 태그가 바뀌었으니 다시 봐라"라는 신호일 뿐이다.
 * payload의 태그를 신뢰하면 이벤트 순서 역전이 스냅숏을 되돌린다.
 */
export interface ReleaseRefreshRequested {
  readonly repository_id: number;
  readonly correlation_id: string;
}

/**
 * 채번 요청 (WP-021 / CR-025, DEV-116).
 *
 * `prs:sequence`가 나르는 것. 잡 카탈로그는 JOB-SEQ-001의 트리거를 "push
 * 이벤트"라 적지만 그 이벤트를 이 스트림에 싣는 코드가 없었다 — 게이트웨이가
 * push를 보고 이것을 낸다.
 *
 * **`head_sha`는 참고값이다.** 채번은 이 값을 믿지 않고 그래프에서 head를
 * 다시 읽는다. 웹훅이 밀려 도착했으면 이 값은 이미 옛 head이고, 그것으로
 * 채번하면 그 사이 커밋이 통째로 빠진다.
 */
export interface SequenceRequested {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly head_sha: string;
  readonly correlation_id: string;
}

/**
 * EVT-SEQ-001 `sequence.assigned`.
 *
 * `from_seq`는 **채번 전** 마지막 서수, `to_seq`는 채번 후 마지막 서수다.
 * 둘이 같으면 새 커밋이 없었다는 뜻이며, 그것도 정상 결과이므로 이벤트를 낸다
 * — 내지 않으면 "채번이 돌긴 했나"를 소비자가 알 수 없다.
 */
export interface SequenceAssigned {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly from_seq: number;
  readonly to_seq: number;
  readonly head_sha: string;
}

/**
 * EVT-SEQ-002 `sequence.reassigned` (WP-022, FR-SEQ-005).
 *
 * `diverged_at_seq`는 **첫 무효 서수**다 — 그 앞까지는 새 에폭에서도 값이
 * 같고, 그 서수부터 이전 에폭 인용이 다른 커밋을 가리킬 수 있다.
 * `affected_count`는 무효가 된 이전 에폭 행 수다. 알림 소비자(REL-005)가
 * "몇 건이 무효가 됐는가"를 이 값으로 말한다.
 */
export interface SequenceReassigned {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly old_epoch: number;
  readonly new_epoch: number;
  readonly diverged_at_seq: number;
  readonly affected_count: number;
}

/**
 * EVT-SEQ-004 `mnumber.assigned` (WP-074 / CR-077 · CR-079, ADR-023).
 *
 * `from_mnumber`..`to_mnumber`는 양끝 포함이고 `pull_request_numbers`는 그 번호
 * 순서(오름차순)로 최대 1000건이다. **payload는 힌트다** — 소비자는 현재 에폭과
 * 정본을 다시 읽어야 하며, 늦게 도착한 이전 에폭 이벤트가 현재 번호를 덮지
 * 않는다. 이벤트 ID는 `announce` work 키로 결정론 생성한다.
 */
export interface MergeNumberAssigned {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly from_mnumber: number;
  readonly to_mnumber: number;
  readonly pull_request_numbers: readonly number[];
}
