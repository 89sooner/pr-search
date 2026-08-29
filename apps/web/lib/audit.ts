/**
 * A-004 감사 로그의 순수 계층 (WP-039 / FR-AUTH-004, CR-054).
 *
 * ## 여기서 판정을 만들지 않는다
 *
 * 서버가 이미 `security_officer`를 강제하고(AC-5) 커서 실패를 두 코드로
 * 가른다. 화면이 그 판정을 흉내 내면 두 판정이 갈라지고, 갈라진 쪽이 느슨하면
 * 그것이 곧 우회 경로다. 여기서 하는 것은 **URL 상태를 요청으로 옮기고 받은
 * 것을 왜곡 없이 그리는 것**뿐이다.
 *
 * ## `null`을 지어내지 않는다
 *
 * `target`·`query`는 의미상 없을 때 `null`로 온다 (AC-2). 화면은 그것을
 * `N/A`나 빈 문자열로 채우지 않고 **비어 있음을 그대로 보인다** — 채우면
 * "대상이 없는 액션"과 "대상을 기록하지 못한 액션"이 같은 모양이 된다.
 */

/*
 * **진입점이 아니라 서브패스를 가져온다** (CR-018, DEV-068의 규율).
 *
 * `@prs/domain`의 진입점은 시퀀스·관계·릴리스 로직 전부를 재수출한다.
 * 클라이언트 번들이 필요한 것은 액션 이름 목록 하나뿐이고, 진입점을 쓰면
 * 그 나머지가 함께 실린다. `nav.ts`가 `@prs/authz/roles`를 쓰는 것과 같다.
 */
import { SELECTABLE_AUDIT_ACTIONS } from '@prs/domain/audit';

/**
 * 프록시 경로.
 *
 * **`/api/v1`이 아니다.** `app/api/[...path]/route.ts`가 세그먼트를 받아
 * `<upstream>/api/v1/<segments>`로 만든다.
 */
export const AUDIT_API = '/api/admin/audit-records';

/** URL이 싣는 것. API와 같은 이름을 쓴다 — 사이에 매핑을 하나 더 만들지 않는다. */
export const AUDIT_PARAM = {
  userId: 'user_id',
  action: 'action',
  target: 'target',
  from: 'from',
  to: 'to',
  resultCode: 'result_code',
} as const;

export interface AuditFilterState {
  readonly userId: string;
  readonly action: string;
  readonly target: string;
  readonly from: string;
  readonly to: string;
  readonly resultCode: string;
}

export const EMPTY_FILTER: AuditFilterState = {
  userId: '',
  action: '',
  target: '',
  from: '',
  to: '',
  resultCode: '',
};

/**
 * 화면이 제시하는 `action` 후보.
 *
 * **활성 + legacy이며 미활성은 넣지 않는다** (`@prs/domain`). 아직 하나도
 * 기록되지 않은 액션을 후보에 두면 언제나 0건이고, 사용자는 "없다"와 "아직
 * 만들지 않았다"를 구분할 수 없다.
 *
 * 목록이 자유 입력을 막지 않는다 — 정본 표에 없는 과거 값도 조회할 수 있어야
 * 한다 (AC-7).
 */
export const ACTION_OPTIONS: readonly string[] = SELECTABLE_AUDIT_ACTIONS;

/** URL 검색 문자열에서 필터를 읽는다. 없는 값은 빈 문자열이다. */
export function readAuditFilter(params: URLSearchParams): AuditFilterState {
  return {
    userId: params.get(AUDIT_PARAM.userId) ?? '',
    action: params.get(AUDIT_PARAM.action) ?? '',
    target: params.get(AUDIT_PARAM.target) ?? '',
    from: params.get(AUDIT_PARAM.from) ?? '',
    to: params.get(AUDIT_PARAM.to) ?? '',
    resultCode: params.get(AUDIT_PARAM.resultCode) ?? '',
  };
}

/**
 * 필터를 URL 검색 문자열로 옮긴다.
 *
 * **빈 값은 키를 만들지 않는다.** `?action=`을 남기면 서버가 그것을 "빈
 * 문자열과 정확히 일치"로 읽어 400을 내며, 그 실패는 사용자가 만든 것이
 * 아니다.
 */
export function writeAuditFilter(filter: AuditFilterState): URLSearchParams {
  const params = new URLSearchParams();
  const put = (key: string, value: string): void => {
    if (value !== '') params.set(key, value);
  };
  put(AUDIT_PARAM.userId, filter.userId);
  put(AUDIT_PARAM.action, filter.action);
  put(AUDIT_PARAM.target, filter.target);
  put(AUDIT_PARAM.from, filter.from);
  put(AUDIT_PARAM.to, filter.to);
  put(AUDIT_PARAM.resultCode, filter.resultCode);
  return params;
}

/** 조회 URL. 커서가 있으면 함께 싣는다. */
export function buildAuditRequestUrl(filter: AuditFilterState, cursor: string | null): string {
  const params = writeAuditFilter(filter);
  if (cursor !== null && cursor !== '') params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? AUDIT_API : `${AUDIT_API}?${search}`;
}

export interface AuditRecordView {
  readonly userId: string;
  readonly action: string;
  /** 의미상 없으면 `null`. 화면이 그것을 그대로 보인다 (AC-2). */
  readonly target: string | null;
  readonly query: string | null;
  readonly occurredAt: string;
  readonly resultCode: string;
  readonly correlationId: string;
}

export interface AuditPageView {
  readonly items: readonly AuditRecordView[];
  readonly nextCursor: string | null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `null`과 부재를 같게 읽는다 — 둘 다 "그 값이 없다"이다. */
function readNullable(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * 응답을 화면이 쓰는 모양으로 옮긴다.
 *
 * 서버가 더 보내도 무시한다. **모르는 필드를 그리지 않는 것**이 계약이 넓어질
 * 때 화면이 조용히 틀리지 않는 길이다.
 */
export function toAuditPage(body: unknown): AuditPageView {
  if (typeof body !== 'object' || body === null) return { items: [], nextCursor: null };
  const record = body as Record<string, unknown>;
  const rawItems = Array.isArray(record['items']) ? record['items'] : [];

  const items = rawItems.map((raw): AuditRecordView => {
    const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      userId: readString(row['user_id']),
      action: readString(row['action']),
      target: readNullable(row['target']),
      query: readNullable(row['query']),
      occurredAt: readString(row['occurred_at']),
      resultCode: readString(row['result_code']),
      correlationId: readString(row['correlation_id']),
    };
  });

  return { items, nextCursor: readNullable(record['next_cursor']) };
}

/** 커서 실패의 두 갈래. 사용자에게 다른 문구를 보인다. */
export type AuditCursorFailure = 'CURSOR_INVALID' | 'CURSOR_QUERY_MISMATCH';

export function readCursorFailure(body: unknown): AuditCursorFailure | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as Record<string, unknown>)['code'];
  return code === 'CURSOR_INVALID' || code === 'CURSOR_QUERY_MISMATCH' ? code : null;
}

/**
 * 화면 상태.
 *
 * `no_permission`을 `error`와 가르는 이유는 복구 경로가 다르기 때문이다 —
 * 전자는 역할이 없다는 사실이고 재시도가 답이 아니다.
 */
export type AuditViewState =
  | 'loading_initial'
  | 'loading_more'
  | 'ready'
  | 'empty_no_result'
  | 'no_permission'
  | 'cursor_invalid'
  | 'error';

export interface AuditStateInput {
  readonly items: readonly AuditRecordView[] | null;
  readonly loading: boolean;
  readonly status: number | null;
  readonly cursorFailure: AuditCursorFailure | null;
}

/**
 * 무엇을 그릴지 하나로 좁힌다.
 *
 * 판정 순서가 곧 우선순위다 — **권한 없음이 먼저다.** 403을 받고도 목록이
 * 비었다는 이유로 `empty_no_result`를 그리면 화면이 "조건에 맞는 기록이
 * 없습니다"라 말하는데, 사실은 볼 자격이 없는 것이다.
 */
export function resolveAuditState(input: AuditStateInput): AuditViewState {
  if (input.status === 403 || input.status === 401) return 'no_permission';
  if (input.cursorFailure !== null) return 'cursor_invalid';
  if (input.loading) return input.items === null ? 'loading_initial' : 'loading_more';
  if (input.status !== null && input.status >= 400) return 'error';
  if (input.items === null) return 'loading_initial';
  return input.items.length === 0 ? 'empty_no_result' : 'ready';
}
