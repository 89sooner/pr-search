/**
 * 표기 실행자 배제 (WP-075 안전성 보강 / DEV-629).
 *
 * ## 무엇을 고치는가
 *
 * 회차 겹침은 모듈 수준 promise 체인이 막았다. 그것은 **한 프로세스 안**에서만
 * 참이고, 배포의 `replica 1`은 사람이 값을 올리는 순간 사라지는 약속이다. 값이
 * 올라가면 두 파드가 같은 행을 집어 요청과 감사가 두 벌이 된다.
 *
 * 이 락은 그 값을 올려도 **두 번째 프로세스가 쓰지 못하게** 한다. 읽기 서비스는
 * 건드리지 않는다 — 락을 얻지 못한 프로세스는 표기 회차만 건너뛰고 나머지 역할은
 * 그대로 돈다.
 *
 * ## 보장 범위를 넘겨 쓰지 않는다
 *
 * 막는 것은 **같은 정본 DB를 보는 프로세스들**뿐이다. 서로 다른 DB를 쓰는 두 배포가
 * 같은 GHE를 고치는 것은 여기서 막히지 않고, GHE가 fencing token을 검증하지 않으므로
 * 네트워크 분할에서의 exactly-once도 아니다. 락을 잃은 프로세스가 **이미 보낸**
 * 요청은 서버에 닿는다.
 *
 * 그래서 락은 혼자 일하지 않는다 — 쓰기 직전마다 **이 커넥션으로** 정본을 다시 묻고,
 * 그 질의가 실패하면(세션이 죽었다는 뜻이고, 세션이 죽으면 락도 풀렸다는 뜻이다)
 * 요청을 보내지 않는다.
 */

import {
  annotateRunnerLockKey,
  releaseAdvisorySessionLock,
  tryAdvisorySessionLock,
  type Pool,
  type PoolClient,
} from '@prs/db';

export type RunnerLockResult<T> =
  | { readonly kind: 'ran'; readonly value: T }
  /** 다른 프로세스가 실행자다. 실패가 아니라 "내 차례가 아니다"이다. */
  | { readonly kind: 'not_runner' };

/**
 * 표기 실행자 락 아래에서 `run`을 실행한다.
 *
 * `run`은 **락을 쥔 커넥션**을 받는다. 정본 확인과 상태 기록을 그 커넥션으로 하면
 * 「락을 아직 쥐고 있는가」를 따로 묻지 않아도 된다 — 질의가 성공했다는 것이 곧
 * 세션이 살아 있다는 증거이고, 세션이 살아 있으면 세션 락도 살아 있다.
 *
 * 기다리지 않는다. 기다리면 두 번째 프로세스의 스윕 루프가 첫 프로세스의 회차마다
 * 묶여 종료 신호에도 늦게 답한다.
 */
export async function withAnnotateRunnerLock<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<RunnerLockResult<T>> {
  const key = annotateRunnerLockKey();
  const client = await pool.connect();
  let locked = false;
  let releaseFailed = false;

  try {
    locked = await tryAdvisorySessionLock(client, key);
    if (!locked) return { kind: 'not_runner' };
    return { kind: 'ran', value: await run(client) };
  } finally {
    if (locked) {
      try {
        await releaseAdvisorySessionLock(client, key);
      } catch {
        // 락을 풀지 못한 커넥션을 돌려보내면 다음 사용자가 잠긴 키를 물려받는다.
        releaseFailed = true;
      }
    }
    client.release(releaseFailed);
  }
}
