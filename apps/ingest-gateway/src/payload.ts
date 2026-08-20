/**
 * payload 정규화와 멱등 키 산출 (FR-ING-002 AC-4).
 *
 * 이 모듈의 모든 함수는 **서명 검증을 통과한 뒤에만** 호출된다. 파싱은 미검증
 * 입력에 파서를 노출시키는 일이라 검증보다 앞설 수 없다 (보안 문서 9장).
 */

import { createHash } from 'node:crypto';

/**
 * 키 순서에 의존하지 않는 정규 직렬화.
 *
 * GHE 재전송은 보통 바이트가 같지만, 프록시를 거치며 공백이나 키 순서가 달라질
 * 수 있다. 그때도 같은 멱등 키가 나와야 중복이 중복으로 잡힌다. 배열 순서는
 * 의미가 있으므로 보존한다.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(',')}}`;
}

/** 정규화 payload의 SHA-256 16진 해시. `raw_event.payload_hash`에 그대로 들어간다. */
export function canonicalHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}

/**
 * 멱등 키.
 *
 * `X-GitHub-Delivery`가 있으면 그대로 쓴다. 없으면 정규화 해시로 대체하되
 * `sha256:` 접두를 붙여, GHE가 준 전달 식별자와 우리가 만든 대체 키를 나중에
 * 구분할 수 있게 한다 (FR-ING-002 AC-4).
 */
export function resolveDeliveryId(header: string | undefined, payloadHash: string): string {
  return header === undefined || header === '' ? `sha256:${payloadHash}` : header;
}

function readObject(payload: unknown): Record<string, unknown> | undefined {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

/** `action` 필드. 없는 이벤트 유형(`push` 등)이 많으므로 없으면 `null`이다. */
export function extractAction(payload: unknown): string | null {
  const action = readObject(payload)?.['action'];
  return typeof action === 'string' ? action : null;
}

/**
 * `repository.id`.
 *
 * 미등록 저장소나 조직 단위 이벤트(`team` 등)에는 없다. 없으면 `null`로 두고
 * 저장은 그대로 진행한다 — 원본 보관이 유형 판별보다 우선이다.
 */
export function extractRepositoryId(payload: unknown): number | null {
  const repository = readObject(readObject(payload)?.['repository']);
  const id = repository?.['id'];
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
}
