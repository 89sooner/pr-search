/**
 * 저장소 개요의 화면 판정 (W-009 / WP-034, CR-050).
 *
 * **순수 모듈이다.** 무엇을 어떤 문구로 그릴지는 판정이고, 그것을 렌더링 코드와
 * 섞으면 시험이 DOM을 거쳐야만 확인할 수 있게 된다 (`lib/saved-search.ts`·
 * `lib/nav.ts`가 같은 이유로 갈라져 있다).
 *
 * ## 세 값을 구분한다
 *
 * `null`(아직 그런 기록이 없다) · `0`(확인했고 영이다) · `unavailable`(조회에
 * 실패해 모른다)은 **서로 다른 사실**이다. `unavailable`을 0으로 그리면
 * 사용자는 "수집이 안 됐다"는 틀린 진단을 받고, 그 오독을 막는 것이 이 화면의
 * 목적이다.
 *
 * ## 이 화면은 아무것도 실행하지 않는다
 *
 * 등록·해제·백필·재채번은 A-002·A-003의 몫이고 `operator` 전용이다. 여기서는
 * 상태를 읽고 등록 검토 요청만 남긴다.
 */

export type RegistrationState = 'active' | 'archived';
export type SequenceState = 'ok' | 'stale' | 'reassigning' | 'unknown';

export interface DocumentCountsView {
  readonly pull_requests: number;
  readonly commits: number;
  readonly total: number;
}

export interface BackfillView {
  readonly state: string;
  readonly job_id: string;
  readonly progress: Record<string, unknown>;
}

export interface SequenceSpaceView {
  readonly base_branch: string;
  readonly last_sequence: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_state: SequenceState;
  readonly last_assigned_at: string | null;
}

export interface ReconciliationView {
  readonly last_completed_at: string | null;
  readonly missing_count: number | null;
}

export interface RepositoryOverview {
  readonly repository_id: number;
  readonly repository: string;
  readonly registration_state: RegistrationState;
  readonly registered_at: string;
  readonly last_ingested_at: string | null;
  readonly document_counts: DocumentCountsView | null;
  readonly backfill: BackfillView | null;
  readonly sequence_spaces: readonly SequenceSpaceView[];
  readonly reconciliation: ReconciliationView;
  readonly unavailable: readonly string[];
}

/** 상태 매트릭스 W-009. */
export type OverviewScreenState =
  | 'loading_initial'
  | 'loading_more'
  | 'ready'
  | 'empty_no_repository'
  | 'error_cursor'
  | 'error_load';

export interface ScreenStateInput {
  readonly loading: boolean;
  /** 이어 보기 중인가. 첫 조회와 다르다 — 기존 카드를 유지해야 한다. */
  readonly resumed: boolean;
  readonly items: readonly RepositoryOverview[] | null;
  readonly cursorFailed: boolean;
  readonly loadFailed: boolean;
}

export function resolveOverviewState(input: ScreenStateInput): OverviewScreenState {
  if (input.cursorFailed) return 'error_cursor';
  if (input.loadFailed) return 'error_load';
  if (input.loading) return input.resumed ? 'loading_more' : 'loading_initial';
  if (input.items === null) return 'loading_initial';
  return input.items.length === 0 ? 'empty_no_repository' : 'ready';
}

/**
 * 빈 목록 문구.
 *
 * **"GitHub에 접근 가능한 저장소가 없다"로 말하지 않는다** (FR-ING-009 AC-10).
 * 이 화면은 미등록 저장소의 목록을 알지 못한다 — PR Search에 등록된 것 중
 * 볼 수 있는 것이 없다는 사실만 말할 수 있다.
 */
export const EMPTY_NO_REPOSITORY_MESSAGE =
  'PR Search에서 표시할 수 있는 등록 저장소가 없습니다. 찾는 저장소가 있다면 등록 검토를 요청할 수 있습니다.';

/** 한 항목이 조회에 실패했는가. */
export function isAxisUnavailable(item: RepositoryOverview, axis: string): boolean {
  return item.unavailable.includes(axis);
}

export type ValueKind = 'unavailable' | 'absent' | 'present';

/**
 * 값 하나의 성격을 판정한다.
 *
 * 순서가 중요하다 — **조회 실패가 먼저다.** 실패했는데 값이 `null`이라고
 * "기록 없음"으로 그리면 없는 사실을 주장하게 된다.
 */
export function valueKind(
  item: RepositoryOverview,
  axis: string,
  value: unknown,
): ValueKind {
  if (isAxisUnavailable(item, axis)) return 'unavailable';
  if (value === null || value === undefined) return 'absent';
  return 'present';
}

export const REGISTRATION_LABEL: Readonly<Record<RegistrationState, string>> = {
  active: '수집 중',
  archived: '수집 해제됨',
};

/**
 * 해제 상태의 설명.
 *
 * 해제는 신규 수집 중단이고 **기존 문서는 남는다**(FR-ING-009 AC-3). 그 사실을
 * 함께 말하지 않으면 사용자는 "자료가 사라졌다"로 읽는다.
 */
export const ARCHIVED_NOTE = '새 이벤트를 수집하지 않습니다. 이미 수집된 자료는 그대로 검색됩니다.';

export const SEQUENCE_LABEL: Readonly<Record<SequenceState, string>> = {
  ok: '정상',
  stale: '갱신 지연',
  reassigning: '재채번 중',
  unknown: '아직 채번된 적 없음',
};

/**
 * 시퀀스 값을 그릴 수 있는가.
 *
 * `stale`·`reassigning`에서도 **마지막 확정 서수를 숨기지 않는다** — 경고와
 * 함께 값을 보여 주지 않으면 사용자에게 남는 정보가 없다. `unknown`은 값 자체가
 * 없는 상태이고, 그것을 `0`으로 그리면 "0번까지 채번됐다"는 거짓이 된다.
 */
export function hasSequenceValue(space: SequenceSpaceView): boolean {
  return space.sequence_state !== 'unknown' && space.last_sequence !== null;
}

export interface BackfillProgressView {
  readonly processed: number;
  readonly total: number;
  readonly ratio: number;
}

/** 진행 중으로 볼 상태. 계약이 `job.state`를 그대로 쓰므로 여기서 해석만 한다. */
const ACTIVE_JOB_STATES: ReadonlySet<string> = new Set(['queued', 'running']);

export function isBackfillActive(backfill: BackfillView | null): boolean {
  return backfill !== null && ACTIVE_JOB_STATES.has(backfill.state);
}

/**
 * 진행률.
 *
 * 총량을 모르면 비율도 없다 — 0으로 두면 "아직 시작도 안 했다"로 읽힌다.
 */
export function backfillProgress(backfill: BackfillView | null): BackfillProgressView | null {
  if (backfill === null) return null;
  const processed = backfill.progress['processed'];
  const total = backfill.progress['total'];
  if (typeof processed !== 'number' || typeof total !== 'number' || total <= 0) return null;
  return { processed, total, ratio: Math.min(1, processed / total) };
}

export const BACKFILL_STATE_LABEL: Readonly<Record<string, string>> = {
  queued: '대기 중',
  running: '진행 중',
  succeeded: '완료',
  failed: '실패',
  cancelled: '취소됨',
  paused: '일시 중지',
};

export function backfillLabel(backfill: BackfillView | null): string {
  if (backfill === null) return '요청된 적 없음';
  return BACKFILL_STATE_LABEL[backfill.state] ?? backfill.state;
}

/**
 * 조정 스캔 문구.
 *
 * 셋을 가른다 — 조회 실패, 완료 기록 없음, 확인된 건수. `missing_count: 0`은
 * "확인했고 누락이 없다"이며 "기록이 없다"와 다르다.
 */
export function reconciliationSummary(item: RepositoryOverview): string {
  if (isAxisUnavailable(item, 'reconciliation')) return '확인하지 못했습니다';
  const { last_completed_at: at, missing_count: missing } = item.reconciliation;
  if (at === null || missing === null) return '완료된 조정 스캔 기록이 없습니다';
  return missing === 0 ? '누락 없음' : `누락 ${String(missing)}건`;
}

/** 이 화면이 저장소 하나를 다시 조회할 때 쓰는 질의. */
export function retryQuery(repository: string): string {
  return `repository=${encodeURIComponent(repository)}`;
}
