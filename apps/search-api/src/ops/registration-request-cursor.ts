/**
 * 등록 검토 요청 대기열 커서 (WP-040 / API-ADM-009, CR-055).
 *
 * ## 왜 또 하나인가
 *
 * 순회의 뜻이 자원마다 다르다. 이것은 `repository_registration_request`의
 * **PostgreSQL 키셋**이며 Elasticsearch 문서를 훑지 않는다 — PIT도
 * `search_after`도 여기에 뜻이 없다. 공유하는 것은 봉인 방식
 * (`cursor/envelope.ts`)과 두 오류 코드뿐이다 (`API-ADM-005` 선례).
 *
 * ## 왜 접근 범위가 지문에 없는가
 *
 * 이 목록은 **아직 등록되지 않은 저장소**에 대한 요청이다. 저장소 권한이 답을
 * 바꾸지 않으므로 지문에 넣으면 무관한 권한 변경이 처리 중이던 순회를 끊는다.
 * `API-ADM-005`가 같은 이유로 넣지 않는다.
 *
 * ## 왜 두 키를 함께 봉인하는가
 *
 * `created_at` 하나로 자르면 같은 밀리초에 들어온 요청 무리를 페이지 경계가
 * 가를 때 **행이 빠지거나 겹친다.** 정렬 키를 그대로 담는다.
 *
 * ## 왜 `status`로 정렬하지 않는가
 *
 * 목록의 기본 필터가 `status`이므로 "처리할 것을 먼저 본다"는 목적은 필터가
 * 달성한다. 정렬 키에 상태를 넣으면 **상태가 바뀌는 순간 그 행이 커서 순회
 * 안에서 움직인다** — 운영자가 한 건을 처리하는 동안 다음 페이지의 내용이
 * 어긋난다.
 */

import { createHash } from 'node:crypto';
import type { registrationRequestRepo } from '@prs/db';
import {
  CURSOR_TTL_MS,
  CursorInvalidError,
  CursorQueryMismatchError,
  assertNotExpired,
  decodeEnvelope,
  encodeEnvelope,
  type CursorSigner,
} from '../cursor/envelope.js';

export const REGISTRATION_REQUEST_CURSOR_VERSION = 1;

interface RequestCursorPayload {
  readonly v: number;
  /** 키셋: `created_at` (ISO). */
  readonly t: string;
  /** 키셋: `request_id`. */
  readonly i: number;
  /** 필터 지문. */
  readonly q: string;
  readonly x: number;
}

export type RequestFilterInput = registrationRequestRepo.RegistrationRequestFilter;
export type RequestCursorPosition = registrationRequestRepo.RegistrationRequestPosition;

/** 값이 없는 필터가 차지하는 자리. 빈 문자열과 구분된다. */
const ABSENT = ' ';

/**
 * 필터 지문.
 *
 * **네 필터가 모두 들어간다.** 하나라도 빠지면 그 조건을 바꾼 뒤 옛 커서를
 * 이어 쓸 수 있고, 그때 나오는 목록은 어느 조건에도 속하지 않는 섞인 결과다.
 *
 * 값이 없는 필터는 `ABSENT`로 자리를 채운다 — 빈 문자열을 쓰면
 * `{status: ''}`과 `{status: undefined}`가 같은 지문이 되는데 그 둘은 다른
 * 질의다. 구분자도 `ABSENT`를 쓴다: `|`를 쓰면 값에 `|`가 들어갔을 때 다음
 * 칸으로 새어 서로 다른 필터가 같은 지문을 갖는다.
 */
export function computeRequestFingerprint(filter: RequestFilterInput): string {
  const material = [
    filter.status ?? ABSENT,
    filter.owner ?? ABSENT,
    filter.name ?? ABSENT,
    filter.requestedBy ?? ABSENT,
  ].join(ABSENT);
  return createHash('sha256').update(material, 'utf8').digest('base64url').slice(0, 22);
}

export function encodeRequestCursor(
  position: RequestCursorPosition,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: RequestCursorPayload = {
    v: REGISTRATION_REQUEST_CURSOR_VERSION,
    t: position.createdAt.toISOString(),
    i: position.requestId,
    q: fingerprint,
    x: nowMs + CURSOR_TTL_MS,
  };
  return encodeEnvelope(payload, signer);
}

/**
 * 커서를 연다.
 *
 * 검사 순서가 곧 오류의 뜻이다 — 형식·서명·버전·만료·키셋 형태는
 * `CURSOR_INVALID`, **지문은 `CURSOR_QUERY_MISMATCH`**. 둘을 섞으면 클라이언트가
 * "조건이 바뀌었으니 첫 페이지로"라는 정해진 처리를 하지 못한다.
 *
 * @throws {CursorInvalidError}
 * @throws {CursorQueryMismatchError}
 */
export function decodeRequestCursor(
  raw: string,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): RequestCursorPosition {
  const payload = decodeEnvelope(raw, signer) as Partial<RequestCursorPayload>;

  if (payload.v !== REGISTRATION_REQUEST_CURSOR_VERSION) {
    throw new CursorInvalidError(`모르는 커서 버전: ${String(payload.v)}`);
  }
  assertNotExpired(payload.x, nowMs);

  if (typeof payload.t !== 'string' || payload.t === '') {
    throw new CursorInvalidError('키셋 시각이 없다');
  }
  const createdAt = new Date(payload.t);
  if (Number.isNaN(createdAt.getTime())) {
    throw new CursorInvalidError('키셋 시각을 읽을 수 없다');
  }
  if (typeof payload.i !== 'number' || !Number.isSafeInteger(payload.i) || payload.i <= 0) {
    throw new CursorInvalidError('키셋 식별자가 없다');
  }

  if (payload.q !== fingerprint) {
    throw new CursorQueryMismatchError('조회 조건이 커서 발급 시점과 다르다');
  }

  return { createdAt, requestId: payload.i };
}
