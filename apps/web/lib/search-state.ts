/**
 * W-001의 화면 상태 판정 (WP-016 / 상태 매트릭스 W-001).
 *
 * **순수 함수다.** 상태 매트릭스가 정의한 13종을 응답과 입력만 보고 정한다 —
 * React 없이 전부 시험할 수 있어야 한다. 상태 판정을 컴포넌트 안에 두면
 * "이 조합에서 무엇이 보이는가"를 DOM을 통해서만 확인할 수 있고, 그러면
 * 판정 자체를 걸 수 없다. `lib/nav.ts`·`lib/proxy.ts`와 같은 이유다.
 *
 * ## 왜 상태를 하나로 모으는가
 *
 * 화면이 `if (loading) … else if (error) … else if (items.length === 0) …`로
 * 흩어지면 조합이 늘 때마다 분기가 곱해지고, 매트릭스에 있는 상태 하나가
 * 조용히 도달 불가능해진다. 여기서 **하나의 태그로 좁힌 뒤** 렌더링은 그
 * 태그만 보고 그린다.
 */

import type { QueryParseError } from '@prs/query';
import { MIN_SHA_PREFIX_LENGTH } from '@prs/query';

/** 상태 매트릭스 W-001이 정의한 상태. 이름을 그대로 쓴다. */
export type SearchScreenState =
  | { readonly kind: 'empty_no_query' }
  | { readonly kind: 'error_prefix_too_short'; readonly input: string }
  | { readonly kind: 'error_query_syntax'; readonly error: QueryParseError }
  | { readonly kind: 'loading_initial' }
  | { readonly kind: 'ambiguous'; readonly truncated: boolean }
  | { readonly kind: 'ready' }
  | { readonly kind: 'empty_no_result' }
  | { readonly kind: 'error_search_timeout' }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'auth_expired'; readonly loginPath: string }
  | { readonly kind: 'offline' }
  | {
      readonly kind: 'error_other';
      readonly code: string;
      readonly message: string;
      /** 사용자가 운영자에게 전달할 값. 없으면 문의가 성립하지 않는다 (C-005). */
      readonly correlationId: string | null;
    };

/**
 * 7자 미만 hex인가 — **서버를 부르기 전에** 판정한다 (FR-SRCH-004 AC-2).
 *
 * QA-W001-04가 "서버 호출 없이 즉시 거부"를 요구하므로 이 판정은 네트워크
 * 앞에 있어야 한다. `@prs/query`의 판별기와 같은 하한을 쓴다 — 두 곳에
 * 숫자를 적으면 갈라진다 (ADR-001).
 */
const HEX_ONLY = /^[0-9a-fA-F]+$/;

export function isTooShortShaPrefix(raw: string): boolean {
  const value = raw.trim();
  if (value === '') return false;
  if (!HEX_ONLY.test(value)) return false;
  return value.length < MIN_SHA_PREFIX_LENGTH;
}

/** 서버가 준 오류의 최소 모양. 화면은 코드로 분기하고 문구를 재해석하지 않는다. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
  readonly correlation_id?: string;
}

export interface SearchStateInput {
  /** 사용자가 친 원문. 파싱 전이다. */
  readonly rawQuery: string;
  /** 클라이언트 파서의 결과. 오류면 서버를 부르지 않는다 (ADR-001). */
  readonly parseError: QueryParseError | null;
  /** 조회가 진행 중인가. */
  readonly loading: boolean;
  /** 네트워크 자체가 실패했나 (`fetch` 거부). */
  readonly networkFailed: boolean;
  /** 서버 오류 본문. 성공이면 `null`. */
  readonly errorBody: ApiErrorBody | null;
  /** HTTP 상태. 응답이 없었으면 `null`. */
  readonly status: number | null;
  /** 목록 건수. 조회 전이면 `null`. */
  readonly itemCount: number | null;
  /** 해석 후보 수. 해석을 하지 않았으면 `null`. */
  readonly candidateCount: number | null;
  /** 해석 후보가 절삭되었나 (FR-SRCH-004 AC-3). */
  readonly candidatesTruncated: boolean;
  readonly loginPath: string;
}

/**
 * 상태 하나로 좁힌다.
 *
 * **순서가 곧 우선순위다.** 위에 있는 것이 이긴다:
 *   1. 아직 아무것도 안 물었다 → 빈 질의
 *   2. 클라이언트가 이미 거절했다 → 서버를 부르지 않는다
 *   3. 조회 중
 *   4. 실패 (인증 > 권한 > 마감 > 그 외)
 *   5. 성공 (모호 > 결과 있음 > 0건)
 *
 * 실패를 성공보다 먼저 보는 이유는, 부분 응답이 있어도 **오류를 감추면 안
 * 되기 때문**이다. 0건과 "볼 수 있는 저장소가 없다"는 사용자가 할 일이
 * 전혀 다르다.
 */
export function resolveScreenState(input: SearchStateInput): SearchScreenState {
  const trimmed = input.rawQuery.trim();

  // 1. 질의가 없다. 조회한 적도 없다.
  if (trimmed === '') return { kind: 'empty_no_query' };

  // 2. 클라이언트 판정. 서버를 부르기 전에 끝난다 (QA-W001-04, QA-W001-07).
  if (isTooShortShaPrefix(trimmed)) return { kind: 'error_prefix_too_short', input: trimmed };
  if (input.parseError !== null) return { kind: 'error_query_syntax', error: input.parseError };

  // 3. 조회 중. 아래의 오류·결과는 **직전 조회의 것**이므로 로딩이 이긴다.
  if (input.loading) return { kind: 'loading_initial' };

  // 4. 실패.
  if (input.networkFailed) return { kind: 'offline' };

  if (input.errorBody !== null) {
    const code = input.errorBody.error.code;

    // 재인증이 필요한 것이 가장 먼저다 — 다른 안내를 해도 사용자가 할 수 없다.
    if (code === 'UNAUTHENTICATED' || input.status === 401) {
      const detail = input.errorBody.error.detail;
      const path = typeof detail?.['login_path'] === 'string' ? detail['login_path'] : input.loginPath;
      return { kind: 'auth_expired', loginPath: path };
    }

    // 접근 범위를 못 구했다. 빈 목록이 아니라 명시적 실패다 (FR-AUTH-002 AC-3).
    if (code === 'PERMISSION_UNAVAILABLE' || code === 'NO_ACCESSIBLE_REPOSITORY') {
      return { kind: 'no_permission' };
    }

    // ES 마감 초과 (백엔드 8장: 3초 → 504).
    if (code === 'SEARCH_TIMEOUT' || input.status === 504) return { kind: 'error_search_timeout' };

    /*
     * 서버가 문법 오류를 냈다.
     *
     * 클라이언트 파서가 통과시킨 것을 서버가 거절했다는 뜻이다. 같은 파서를
     * 쓰므로(ADR-001) 정상적으로는 일어나지 않지만, 버전이 어긋나면 생긴다 —
     * 그때 화면이 조용히 "결과 없음"을 그리면 원인을 알 수 없다.
     */
    return {
      kind: 'error_other',
      code,
      message: input.errorBody.error.message,
      correlationId: input.errorBody.correlation_id ?? null,
    };
  }

  // 5. 성공. 해석 후보가 2건 이상이면 자동 이동하지 않는다 (FR-SRCH-001 AC-5).
  if (input.candidateCount !== null && input.candidateCount >= 2) {
    return { kind: 'ambiguous', truncated: input.candidatesTruncated };
  }

  if (input.itemCount === null) return { kind: 'loading_initial' };
  if (input.itemCount > 0) return { kind: 'ready' };
  return { kind: 'empty_no_result' };
}
