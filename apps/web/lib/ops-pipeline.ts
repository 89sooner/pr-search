/**
 * A-001 수집 파이프라인 콘솔의 화면 판정 (WP-040 / FR-ADMIN-001, CR-055).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다.
 *
 * ## 권한 판정이 화면 뒤에 있지 않다
 *
 * `security_officer`이면서 `operator`가 아닌 사용자는 `A-001-ARCHIVE`만 본다
 * (`archive_only`, CR-052 DEV-375). **그 사용자를 위해 `operator` 전용 조회를
 * 보내고 403을 숨기지 않는다** — 역할을 먼저 판정해 요청 자체를 보내지 않는다.
 * 403을 받아 숨기는 방식은 권한 판정을 화면 뒤로 미루는 일이고, 그러면 감사
 * 로그에 거절된 조회가 사용자 수만큼 쌓인다.
 */

/** `@prs/authz`의 역할 이름. 서브패스로 가져오지 않고 문자열로 받는다. */
export type OpsRole = string;

export type PipelineAccess = 'full' | 'archive_only' | 'none';

/**
 * 이 역할이 A-001에서 무엇을 보는가.
 *
 * `operator`가 둘 다 가진 경우 `full`이다 — 넓은 쪽이 이긴다.
 */
export function pipelineAccess(roles: readonly OpsRole[]): PipelineAccess {
  if (roles.includes('operator')) return 'full';
  if (roles.includes('security_officer')) return 'archive_only';
  return 'none';
}

/** `operator` 전용 데이터를 요청해도 되는가. `archive_only`에서는 보내지 않는다. */
export function mayFetchOperatorData(access: PipelineAccess): boolean {
  return access === 'full';
}

/** `API-ADM-006`이 내는 파이프라인 상태. */
export interface PipelineStatusView {
  readonly generated_at: string;
  readonly intake_per_minute?: number;
  readonly queue_depth?: Record<string, number>;
  readonly ingestion_lag_seconds?: Record<string, number>;
  readonly stage_latency_seconds?: Record<string, number | string>;
  readonly dead_letter?: Record<string, number>;
  readonly enrichment_pending?: number;
  readonly sequence_space_state?: Record<string, number>;
  readonly slowest_repositories?: readonly Record<string, unknown>[];
  readonly slowest_repositories_out_of_scope?: number;
  readonly unavailable?: readonly string[];
}

/**
 * 이 항목을 읽지 못했는가 (FR-ADMIN-001 예외 처리).
 *
 * **한 항목의 실패가 다른 항목을 비우지 않는다.** `unavailable` 배열에 이름이
 * 있거나 값이 `"unavailable"` 문자열이면 그 자리만 미확인으로 그린다.
 */
export function isUnavailable(status: PipelineStatusView, field: string): boolean {
  if ((status.unavailable ?? []).includes(field)) return true;
  const value = (status as unknown as Record<string, unknown>)[field];
  return value === 'unavailable';
}

/**
 * 느린 저장소 목록이 비었는데 범위 밖 건수가 있는가 (CR-024, DEV-051).
 *
 * 이 사실을 화면에 적어야 조회자가 **"느린 저장소가 없다"와 "내가 볼 수 없다"를
 * 구분**한다. 건수만 있고 식별자는 없다.
 */
export function hasHiddenSlowRepositories(status: PipelineStatusView): boolean {
  return (status.slowest_repositories ?? []).length === 0 && (status.slowest_repositories_out_of_scope ?? 0) > 0;
}

/**
 * 자동 갱신 간격 (FR-ADMIN-001 AC-2 / QA-A001-09).
 *
 * 30초다. 데이터 신선도가 요청 시점이므로 캐시하지 않는다.
 */
export const POLL_INTERVAL_MS = 30_000;

/**
 * 지금 자동 갱신을 해도 되는가.
 *
 * **조작 중이면 보류한다** — 표를 다루는 중에 내용이 갈리면 운영자가 방금 본
 * 행을 잃는다. **백그라운드 탭에서도 보류한다** — 보이지 않는 화면을 위해
 * 30초마다 세 곳을 부르는 것은 낭비이고, 탭 수만큼 곱해진다.
 *
 * 복귀 시에는 호출부가 한 번 갱신한 뒤 정상 주기로 잇는다. **타이머를 겹쳐
 * 쌓지 않는다** — 겹치면 탭을 오갈수록 호출이 는다.
 */
export function shouldPoll(input: { readonly interacting: boolean; readonly visible: boolean }): boolean {
  return !input.interacting && input.visible;
}

/** 아카이브 섹션의 상태 (CR-052, DEV-372). */
export type ArchiveState = 'ready' | 'archive_unavailable' | 'archive_scope_empty';

/**
 * 아카이브 조회 결과를 상태로 옮긴다.
 *
 * **"인덱스가 없다"와 "내 범위에서 0건이다"는 다른 사실이다.** 전자는 아카이브
 * 레인이 서지 않았다는 뜻이고 후자는 정상이다. 하나로 합치면 운영자가 배포
 * 문제를 조회 조건 문제로 읽는다.
 */
export function archiveState(input: {
  readonly indexMissing: boolean;
  readonly itemCount: number;
}): ArchiveState {
  if (input.indexMissing) return 'archive_unavailable';
  if (input.itemCount === 0) return 'archive_scope_empty';
  return 'ready';
}
