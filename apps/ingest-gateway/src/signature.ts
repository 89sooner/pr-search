/**
 * 웹훅 HMAC-SHA256 서명 검증 (FR-ING-001 AC-1, 보안 문서 9장).
 *
 * 두 가지를 지킨다.
 *   1. 계산 대상은 **원문 바이트**다. 파싱·재직렬화한 본문으로 계산하면 GHE가
 *      보낸 바이트와 달라져 정상 요청이 401이 된다.
 *   2. 비교는 상수 시간이다. 문자열 `===`는 첫 불일치에서 끊기므로 서명을
 *      한 바이트씩 맞춰 보는 공격에 시간 정보를 흘린다.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * 길이가 달라도 예외를 던지지 않는 상수 시간 비교.
 *
 * `timingSafeEqual`은 길이가 다르면 던지므로 길이 검사를 먼저 하되, 던지지
 * 않는 경로에서도 같은 비용을 치르도록 자기 자신과 한 번 비교하고 나간다.
 *
 * 타이밍 회귀를 테스트로 잡으려고 내보낸다 — 서명 길이(71자)에서는 HMAC 계산
 * 비용이 비교 비용을 덮어 버려서 `verifyWebhookSignature` 밖에서는 조기 종료
 * 비교로 되돌아가도 드러나지 않는다.
 */
export function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');

  if (expectedBytes.length !== actualBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }

  return timingSafeEqual(expectedBytes, actualBytes);
}

/** 원문 바이트에 대한 `sha256=<hex>` 서명 문자열. */
export function computeSignature(rawBody: Buffer, secret: string): string {
  return `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * 서명을 검증한다. 시크릿 하나라도 맞으면 통과다 (회전 무중단, 보안 문서 6장).
 *
 * 일치한 뒤에도 남은 시크릿을 계속 계산한다. 먼저 끊으면 "몇 번째 시크릿이
 * 맞았는가"가 응답 시간에 드러난다.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  secrets: readonly string[],
): boolean {
  if (header === undefined || header === '') return false;
  if (secrets.length === 0) return false;

  let matched = false;
  for (const secret of secrets) {
    if (constantTimeEquals(computeSignature(rawBody, secret), header)) {
      matched = true;
    }
  }
  return matched;
}
