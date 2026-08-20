/**
 * 결정적 이벤트 식별자.
 *
 * 같은 입력을 다시 처리하면 같은 `event_id`가 나와야 한다. 재시도·아웃박스
 * 재적재·실패 대기열 재처리는 모두 같은 이벤트를 다시 만들어 내는데, 그때마다
 * 무작위 ID를 붙이면 로그와 감사 기록에서 "같은 것의 재시도"와 "새로 생긴
 * 것"을 구분할 수 없다. 소비자의 멱등 기준은 여전히 payload의 `delivery_id`지만
 * (EVT-ING-001 Ordering/Dedupe), 추적은 ID가 안정적이어야 가능하다.
 *
 * 형식은 UUIDv8(RFC 9562)이다 — 해시로 만든 사용자 정의 UUID를 담으라고 있는
 * 판이다. SHA-256을 쓰면서 v5(SHA-1 기반)라고 표기하지 않는다.
 */

import { createHash } from 'node:crypto';

/** 구성 요소 경계. 값 안에 나타날 수 없는 문자라야 이어 붙여도 모호해지지 않는다. */
const SEPARATOR = '\u001f';

/**
 * 이름과 구성 요소로부터 UUIDv8을 만든다.
 *
 * @param name 이벤트 이름. 다른 이벤트가 같은 구성 요소를 써도 겹치지 않게 한다.
 * @param parts 이 이벤트를 유일하게 정하는 값들.
 */
export function deterministicEventId(name: string, ...parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update([name, ...parts].join(SEPARATOR), 'utf8')
    .digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  // 버전 8, 변이 RFC 9562(10xx).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
