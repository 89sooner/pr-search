/**
 * 상세 화면의 공통 상태 판정 (WP-018 / 상태 매트릭스 "공통 규칙").
 *
 * ## 왜 공통인가
 *
 * 상태 매트릭스가 W-002·W-003 양쪽에서 `not_found`/`no_permission`/
 * `auth_expired`/`offline`을 **"공통"**이라고 적는다. WP-017이 W-002를 위해
 * 세운 판정을 W-003이 그대로 쓴다 — 복제하면 한쪽만 고쳐지고, 그 한쪽이
 * **404를 403처럼 다루는 쪽**이면 존재 여부가 샌다.
 *
 * 화면별로 다른 것(어떤 섹션을 그리는가)은 각자의 모듈이 판정한다. 여기 있는
 * 것은 **"무엇을 받았는가"**뿐이다.
 */

/** 두 상세 화면이 공유하는 상태. 각 화면의 DoD가 요구하는 것만 둔다. */
export type DetailScreenState =
  | { readonly kind: 'loading_initial' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'auth_expired'; readonly loginPath: string }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error_other'; readonly code: string; readonly message: string; readonly correlationId: string | null };

export interface DetailStateInput {
  readonly loading: boolean;
  readonly networkFailed: boolean;
  readonly errorBody: {
    readonly error: { readonly code: string; readonly message: string; readonly detail?: Readonly<Record<string, unknown>> };
    readonly correlation_id?: string;
  } | null;
  readonly status: number | null;
  /**
   * 응답 본문. **내용은 보지 않고 있고 없고만 본다** — 무엇이 실렸는지는
   * 화면별 모듈의 일이라 여기서 타입을 좁히지 않는다.
   */
  readonly detail: unknown;
  readonly loginPath: string;
}

/**
 * 상태 하나로 좁힌다.
 *
 * **404는 "없다"가 아니라 "없거나 못 본다"이다** (THR-004, FR-AUTH-002 AC-4).
 * 접근 범위 밖 엔티티도 404로 오므로 화면은 존재 여부를 드러내지 않는다 —
 * 403을 내면 "있긴 있다"가 새어 나간다.
 */
export function resolveDetailScreenState(input: DetailStateInput): DetailScreenState {
  if (input.loading) return { kind: 'loading_initial' };
  if (input.networkFailed) return { kind: 'offline' };

  if (input.errorBody !== null) {
    const code = input.errorBody.error.code;

    if (code === 'UNAUTHENTICATED' || input.status === 401) {
      const detail = input.errorBody.error.detail;
      const path = typeof detail?.['login_path'] === 'string' ? detail['login_path'] : input.loginPath;
      return { kind: 'auth_expired', loginPath: path };
    }
    if (input.status === 404 || code === 'NOT_FOUND') return { kind: 'not_found' };
    if (code === 'PERMISSION_UNAVAILABLE' || code === 'NO_ACCESSIBLE_REPOSITORY') {
      return { kind: 'no_permission' };
    }
    return {
      kind: 'error_other',
      code,
      message: input.errorBody.error.message,
      correlationId: input.errorBody.correlation_id ?? null,
    };
  }

  if (input.detail === null || input.detail === undefined) return { kind: 'loading_initial' };
  return { kind: 'ready' };
}
