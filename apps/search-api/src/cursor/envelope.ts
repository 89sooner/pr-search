/**
 * 커서 봉투 — 서명·인코딩만 (WP-032 / ADR-010 Amendment, CR-043 DEV-271).
 *
 * ## 여기 없는 것
 *
 * **순회의 뜻이 없다.** W-001은 Elasticsearch PIT + `search_after`를 순회하고
 * W-004는 PostgreSQL `merge_sequence`의 구간 멤버십을 순회한다 — 정본이 다르고
 * 무엇이 "다음"인지도 다르다 (API 계약 「구간 커서와 패싯」). 그 둘을 하나의
 * 일반 커서 상태로 합치면, W-004의 멤버십을 Elasticsearch가 소유하게 만드는
 * "최적화"가 언젠가 들어온다 — ADR-007을 깨는 바로 그 변경이다.
 *
 * 공유하는 것은 **봉인 방식**뿐이다: base64url JSON + HMAC-SHA256, 상수 시간
 * 비교, 그리고 두 실패를 가르는 오류 타입.
 *
 * ## 왜 새 crypto 추상을 만들지 않는가
 *
 * 이 저장소의 기존 서명 자리 — `ingest-gateway`의 웹훅 HMAC, `@prs/authz`의
 * 세션·PKCE — 는 각자의 목적에 묶여 있다. 커서가 그것을 재사용하면 한쪽의 키
 * 회전이 다른 쪽을 끊는다. 그래서 **전용 키**를 쓰되, 범용 서명 프레임워크를
 * 새로 만들지도 않는다 (CR-043).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 이 커서를 쓸 수 없다 — 디코딩 실패, 서명 불일치, 모르는 스키마 버전, 만료,
 * PIT 부재, 정렬 키 값 형식 오류.
 *
 * `CursorQueryMismatchError`와 **다른 사실**을 말한다. 둘 다 사용자를 첫
 * 페이지로 되돌리지만 같은 기술 원인인 척하지 않는다.
 */
export class CursorInvalidError extends Error {
  constructor(reason: string) {
    super(`커서를 사용할 수 없다: ${reason}`);
    this.name = 'CursorInvalidError';
  }
}

/** 커서 자체는 유효한데 현재 조건과 지문이 다르다. "조건이 바뀌었다"이다. */
export class CursorQueryMismatchError extends Error {
  constructor(reason: string) {
    super(`커서가 현재 조회 조건과 맞지 않는다: ${reason}`);
    this.name = 'CursorQueryMismatchError';
  }
}

/**
 * 서명 키의 최소 길이.
 *
 * 짧은 키는 서명이 있다는 사실만 남기고 그 뜻을 없앤다. 배포가 값을 넣기만
 * 하고 넘어가는 것을 막으려면 경계가 코드에 있어야 한다.
 */
export const MIN_CURSOR_KEY_LENGTH = 32;

export interface CursorSigner {
  sign(payload: string): string;
  /** @throws {CursorInvalidError} 서명이 다르면. */
  assertValid(payload: string, signature: string): void;
}

export function createCursorSigner(key: string): CursorSigner {
  if (key.length < MIN_CURSOR_KEY_LENGTH) {
    throw new Error(
      `커서 서명 키가 너무 짧다 (${String(key.length)}자, 최소 ${String(MIN_CURSOR_KEY_LENGTH)}자)`,
    );
  }

  return {
    sign(payload) {
      return createHmac('sha256', key).update(payload).digest('base64url');
    },
    assertValid(payload, signature) {
      const expected = Buffer.from(createHmac('sha256', key).update(payload).digest('base64url'));
      const actual = Buffer.from(signature);
      // 길이가 다르면 `timingSafeEqual`이 던진다. 먼저 본다 — 던지는 것도 신호다.
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new CursorInvalidError('서명이 일치하지 않는다');
      }
    },
  };
}

/**
 * 개발·시험용 임시 키.
 *
 * **프로세스 수명 동안만 유효하다.** 재기동하면 이전 커서가 전부
 * `CURSOR_INVALID`가 되는데, 그것이 계약이 정한 답이므로 화면은 첫 페이지로
 * 되돌아간다 — 서명 없는 커서를 발급하는 것과 다르다.
 *
 * 운영에서는 부르지 않는다. `resolveSearchApiConfig`가 막는다.
 */
export function ephemeralCursorKey(): string {
  return randomBytes(32).toString('base64url');
}

const SEPARATOR = '.';

/** 봉투 = `<base64url(JSON)>.<base64url(HMAC)>`. */
export function encodeEnvelope(payload: unknown, signer: CursorSigner): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}${SEPARATOR}${signer.sign(body)}`;
}

/**
 * 봉투를 연다 — **서명을 먼저 검증하고 그 뒤에 JSON을 읽는다.**
 *
 * 순서가 중요하다. 파싱을 먼저 하면 서명되지 않은 바이트를 JSON 파서에 먹이는
 * 셈이고, 그 뒤에 서명이 틀렸음을 알아도 이미 남의 입력을 해석한 뒤다.
 *
 * @throws {CursorInvalidError} 형식·서명·JSON 어디가 틀려도.
 */
export function decodeEnvelope(cursor: string, signer: CursorSigner): unknown {
  const separator = cursor.indexOf(SEPARATOR);
  if (separator <= 0 || separator === cursor.length - 1) {
    throw new CursorInvalidError('봉투 형식이 아니다');
  }

  const body = cursor.slice(0, separator);
  signer.assertValid(body, cursor.slice(separator + 1));

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new CursorInvalidError('본문을 읽을 수 없다');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CursorInvalidError('본문이 객체가 아니다');
  }
  return parsed;
}

/** 만료 검사. 두 커서 계열이 같은 규칙을 쓴다. */
export function assertNotExpired(expiresAtMs: unknown, nowMs: number): void {
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    throw new CursorInvalidError('만료 시각이 없다');
  }
  if (expiresAtMs <= nowMs) throw new CursorInvalidError('만료되었다');
}

/** 커서 수명. 페이징 한 세션을 덮되 무한히 살지 않는다. PIT keep-alive와 같은 크기다. */
export const CURSOR_TTL_MS = 5 * 60 * 1000;
