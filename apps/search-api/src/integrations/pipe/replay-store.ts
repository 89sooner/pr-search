/**
 * assertion 재생 방지 (CR-112 / 공통 계약 5.2, PSI-A10·A11).
 *
 * ## 순서가 곧 방어다
 *
 * 크기 제한 → 서명·claim 검증 → **여기서 원자 소비**. 서명 전에 `jti`를 저장하면 키 없는
 * 공격자가 임의 `jti`로 저장소를 채울 수 있다. 이 함수를 부르는 자리는 검증을 통과한 뒤뿐이다.
 *
 * ## 분산·원자
 *
 * `SET key 1 EX ttl NX` 한 명령이다. 두 복제본이 같은 `jti`를 동시에 소비하면 Redis가 하나만
 * `OK`를 준다 — 프로세스 안의 `Set`으로 막았다고 하지 않는다.
 *
 * ## 장애는 거절이다
 *
 * Redis가 답하지 않으면 **503**이다 (fail closed). 기존 접근 범위 캐시는 Redis가 죽어도
 * PostgreSQL로 내려가지만(`scope.ts`), 재생 방지는 대신할 계층이 없다. 둘을 혼동하지 않는다.
 */

import { createHash } from 'node:crypto';
import { CLOCK_SKEW_SECONDS, type VerifiedAssertion } from './assertion.js';
import { PsiError } from './errors.js';

export const REPLAY_KEY_PREFIX = 'prs:pipe:jti:';

/** 재생 방지가 쓰는 Redis 명령 하나. 세션 저장소 포트와 섞지 않는다. */
export interface ReplayRedis {
  /** `SET key value EX seconds NX`. 새로 썼으면 `true`, 이미 있었으면 `false`. */
  setIfAbsent(key: string, seconds: number): Promise<boolean>;
}

/** 키는 해시로 접는다 — `jti` 원문을 Redis 키 이름(모니터링·덤프에 보이는 자리)에 두지 않는다. */
export function replayKey(assertion: Pick<VerifiedAssertion, 'issuer' | 'clientId' | 'purpose' | 'jti'>): string {
  const digest = createHash('sha256')
    .update([assertion.issuer, assertion.clientId, assertion.purpose, assertion.jti].join('\n'), 'utf8')
    .digest('hex');
  return `${REPLAY_KEY_PREFIX}${digest}`;
}

/**
 * `jti`를 한 번 소비한다.
 *
 * 보관 기간은 남은 assertion 유효 시간 + 허용 오차까지다 — 그 뒤에는 `exp` 검사가 같은
 * assertion을 거절하므로 기억할 이유가 없다.
 *
 * @throws {PsiError} `ASSERTION_REPLAYED` — 이미 쓴 `jti`.
 * @throws {PsiError} `AUTH_STORE_UNAVAILABLE` — 저장소가 답하지 않는다.
 */
export async function consumeAssertion(
  redis: ReplayRedis,
  assertion: VerifiedAssertion,
  nowMs: number,
): Promise<void> {
  const seconds = Math.max(1, assertion.expiresAt + CLOCK_SKEW_SECONDS - Math.floor(nowMs / 1000));
  let fresh: boolean;
  try {
    fresh = await redis.setIfAbsent(replayKey(assertion), seconds);
  } catch {
    throw new PsiError('AUTH_STORE_UNAVAILABLE', 'replay_store_unavailable');
  }
  if (!fresh) throw new PsiError('ASSERTION_REPLAYED', 'jti_reused');
}
