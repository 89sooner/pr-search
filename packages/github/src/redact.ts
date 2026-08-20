/**
 * 비밀 값 가림 (THR-009, NFR-010).
 *
 * **오류 객체를 그대로 문자열로 만들면 Authorization 헤더가 찍힌다.** fetch
 * 계열 오류와 응답 본문에는 요청 정보가 섞여 들어오기 쉬우므로, 로그나 오류
 * 메시지로 나가는 모든 문자열은 이 함수를 거친다.
 *
 * 가리는 대상은 형태로 판별한다 — 값을 등록해 두고 그것만 지우는 방식은
 * 등록되지 않은 토큰(방금 발급받은 것)을 놓친다.
 */

export const REDACTED = '<redacted>';

/** 캡처 그룹이 없는 패턴. 매치 전체를 가린다. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // GitHub 토큰 계열: ghs_(설치), ghp_(개인), gho_, ghu_, ghr_
  /\bgh[spour]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // JWT (App 인증에 쓰는 것). 세 부분 base64url.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // PEM 개인 키 블록
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * `authorization: Bearer <값>` 형태. 앞부분은 남기고 값만 가린다.
 *
 * 남기는 이유는 "인증 헤더가 있었다"는 사실 자체가 조사에 쓸모 있기 때문이다.
 */
const AUTH_HEADER = /((?:authorization|proxy-authorization)"?\s*[:=]\s*"?)(bearer|token|basic)\s+[^\s"',}]+/gi;

export function redact(value: string): string {
  let out = value.replace(AUTH_HEADER, (_match, prefix: string, scheme: string) => `${prefix}${scheme} ${REDACTED}`);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** 어떤 값이든 안전한 문자열로 만든다. 오류를 직접 `String()` 하지 않는다. */
export function safeMessage(error: unknown): string {
  if (error instanceof Error) return redact(error.message);
  if (typeof error === 'string') return redact(error);
  try {
    return redact(JSON.stringify(error) ?? 'unknown');
  } catch {
    return 'unserializable error';
  }
}
