/**
 * 구조화 오류.
 *
 * 호출 측이 "재시도해도 되는가"를 문자열 매칭이 아니라 필드로 판단할 수 있어야
 * 한다 (비동기 문서 5.2 재시도 대상 판정).
 */

import { safeMessage } from './redact.js';

export type GitHubErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'secondary_rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'client';

export class GitHubApiError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number | undefined;
  /** 재시도 가능 여부. 비동기 문서 5.2의 분류를 그대로 따른다. */
  readonly retryable: boolean;
  /** 이 시각 이후에 재시도한다. rate limit 계열에서만 채워진다. */
  readonly retryAt: Date | undefined;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean; retryAt?: Date } = {},
  ) {
    // 메시지는 언제나 가려진 상태로만 저장한다.
    super(safeMessage(message));
    this.name = 'GitHubApiError';
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[kind];
    this.retryAt = options.retryAt;
  }
}

const DEFAULT_RETRYABLE: Readonly<Record<GitHubErrorKind, boolean>> = {
  auth: false,
  not_found: false,
  rate_limited: true,
  secondary_rate_limited: true,
  server: true,
  network: true,
  timeout: true,
  client: false,
};

export function classifyStatus(status: number): GitHubErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'secondary_rate_limited';
  if (status >= 500) return 'server';
  return 'client';
}
