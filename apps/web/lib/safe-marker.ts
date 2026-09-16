import { serviceMessage } from './service-message';

/**
 * W-004 안전 구간 표식의 화면 판정 (WP-041 / FR-SEQ-006, C-031).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다 — `lib/range.ts`와
 * `lib/ops-pipeline.ts`가 같은 규율을 따른다.
 *
 * ## 화면의 판정은 보안 경계가 아니다
 *
 * `canWrite`는 **누를 수 있는가를 사용자에게 미리 말해 주기 위한 것**이며,
 * 서버는 같은 판정을 독립적으로 한다 (`API-SEQ-004` 검사 2). 직접 보낸
 * `PUT`도 403으로 거절된다. 그래서 이 모듈이 느슨해져도 데이터가 열리지
 * 않고, 반대로 이 모듈이 엄격해도 서버 판정을 대신하지는 못한다.
 */

/** `@prs/authz`의 역할 이름. `lib/ops-pipeline.ts`와 같이 문자열로 받는다. */
export type MarkerRole = string;

/** 표식 쓰기에 필요한 역할 (FR-SEQ-006 AC-3, OD-008). */
export const MARKER_WRITE_ROLE = 'release_manager';

/**
 * 이 사용자가 표식을 등록할 수 있는가.
 *
 * **인증이 구성되지 않은 배포에서는 역할을 알 수 없다** — 빈 목록을 "자격
 * 없음"으로 읽으면 개발 배포에서 이 기능만 통째로 사라진다. 쓰기는 여전히
 * 프록시와 서버가 막으므로 이 완화가 무엇도 열지 않는다 (`pipelineAccess`와
 * 같은 판단).
 */
export function mayWriteMarker(roles: readonly MarkerRole[], authEnabled = true): boolean {
  if (!authEnabled) return true;
  return roles.includes(MARKER_WRITE_ROLE);
}

/** `API-SEQ-004`가 내는 표식 하나. */
export interface MarkerView {
  readonly merge_seq: number;
  readonly seq_epoch: number;
  readonly note: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly epoch_stale: boolean;
}

export interface MarkerResponse {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly marker?: MarkerView | null;
  readonly outcome?: string;
  readonly replaced_merge_seq?: number | null;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id?: string;
}

/**
 * 카드가 그리는 상태 (상태 매트릭스 W-004, 컴포넌트 명세 C-031).
 *
 * `marker_epoch_stale`과 `marker_absent`는 **둘 다 카드를 보인다** — 앞엣것은
 * 무효라는 사실이 답이고 뒤엣것은 "이 공간에 표식이 없다"가 답이다. 어느
 * 쪽도 카드를 감추지 않는다.
 */
export type MarkerCardState =
  | 'ready'
  | 'marker_absent'
  | 'marker_epoch_stale'
  | 'marker_target_unresolved'
  | 'no_permission';

/**
 * 카드의 표시 상태.
 *
 * **표식의 상태가 등록 가능 여부보다 앞선다** — 무효한 표식을 가진 사용자가
 * 자격이 없더라도 그 무효를 봐야 하기 때문이다. 등록이 막히는 것은 버튼의
 * 성질이고 카드 전체의 성질이 아니다.
 */
export function markerCardState(marker: MarkerView | null): MarkerCardState {
  if (marker === null) return 'marker_absent';
  return marker.epoch_stale ? 'marker_epoch_stale' : 'ready';
}

/** 등록 액션이 막힌 이유. 막히지 않았으면 `null`. */
export function markerBlockedReason(canWrite: boolean, targetSeq: number | null): string | null {
  if (!canWrite) return `Creating a safe marker requires the ${MARKER_WRITE_ROLE} role`;
  if (targetSeq === null) return 'Resolve the end anchor first to mark its ordinal';
  return null;
}

/** 등록 요청의 결과 (화면이 갈라 보는 갈래). */
export type MarkerSubmitOutcome =
  | { readonly kind: 'created'; readonly marker: MarkerView; readonly replaced: number | null }
  | { readonly kind: 'unchanged'; readonly marker: MarkerView }
  /**
   * 그 사이 다른 사람이 옮겼다 (`SAFE_MARKER_CONFLICT`).
   *
   * **자동으로 다시 보내지 않는다.** 표식을 뒤로 옮기는 것 자체가 정당한
   * 동작이므로, 재시도는 남의 판정을 말없이 덮는 일이 된다 (DEV-464).
   */
  | { readonly kind: 'conflict'; readonly currentSeq: number | null }
  /** 요청이 딛고 선 에폭이 낡았다. 사용자가 다시 조회해야 한다. */
  | { readonly kind: 'epoch_stale'; readonly currentEpoch: number | null }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * `PUT` 응답을 화면의 갈래로 옮긴다.
 *
 * **오류 코드로 분기하고 상태 코드로 분기하지 않는다** — 409 하나에 서로
 * 다른 두 사실(에폭이 낡았다 / 표식이 옮겨졌다)이 실리며, 사용자가 해야
 * 할 일이 다르다.
 */
export function judgeMarkerSubmit(status: number, body: MarkerResponse): MarkerSubmitOutcome {
  if (status === 200 && body.marker != null) {
    return body.outcome === 'unchanged'
      ? { kind: 'unchanged', marker: body.marker }
      : { kind: 'created', marker: body.marker, replaced: body.replaced_merge_seq ?? null };
  }

  const code = body.error?.code ?? 'INTERNAL_ERROR';
  const detail = body.error?.detail ?? {};

  if (code === 'SAFE_MARKER_CONFLICT') {
    return { kind: 'conflict', currentSeq: numberOrNull(detail['current_marker_seq']) };
  }
  if (code === 'SEQUENCE_EPOCH_STALE') {
    return { kind: 'epoch_stale', currentEpoch: numberOrNull(detail['current_seq_epoch']) };
  }
  return { kind: 'error', code, message: serviceMessage(body.error?.message, 'Could not create the marker.', code) };
}

/** 메모 상한 (FR-SEQ-006 AC-2). 서버의 `CHECK`와 같은 값이다. */
export const MARKER_NOTE_LIMIT = 500;

/** 표식 조회 URL. 공간은 질의 파라미터로 지목한다 — 경로에 넣지 않는다. */
export function markerRequestUrl(repository: string, baseBranch: string): string {
  const params = new URLSearchParams({ repository, base_branch: baseBranch });
  return `/api/safe-markers?${params.toString()}`;
}
