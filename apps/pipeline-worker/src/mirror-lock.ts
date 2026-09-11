/**
 * 미러 fetch 직렬화 (WP-074 / CR-079, ADR-023 C1, DEV-576).
 *
 * ## 왜 필요한가
 *
 * `MirrorSync.sync`에는 프로세스 간 동기화가 없다. sequence의 선행 fetch, mirror
 * 스윕, release 갱신이 **같은 디렉터리에 동시에 fetch**할 수 있고, git은 그때
 * `index.lock`·`packed-refs.lock` 경합으로 한쪽을 실패시킨다. 그 실패가 채번 경로에
 * 떨어지면 "fetch 실패 → 채번 보류"가 되어 실시간성이 깨진다.
 *
 * 그래서 **모든 `sync` 호출자**가 이 wrapper를 지난다. 하위 라이브러리 `@prs/github`에
 * DB 의존을 넣지 않고 워커 계층에서 감싼다 (상세 설계 4.1의 2).
 *
 * ## 세션 락이다
 *
 * fetch는 네트워크 시간만큼 걸리므로 트랜잭션 범위 락으로 감싸면 그동안 트랜잭션과
 * 스냅숏이 열려 있다. 세션 락은 트랜잭션과 수명이 분리된다. **풀지 못한 커넥션은
 * 풀에 돌려보내지 않고 폐기한다** — 세션 락은 커넥션에 남아 다음 사용자를 영원히
 * 막는다 (`acquireAdvisorySessionLock`의 규율).
 *
 * ## 채번은 기다리지 않고, 스윕은 잠깐 기다린다
 *
 * 채번 경로는 `try`로 즉시 답을 받아 `defer`한다 — 기다리면 워커 슬롯이 묶인다.
 * 6시간 스윕과 release 갱신은 fetch 하나가 끝나기를 기다려도 잃는 것이 없으므로
 * `lock_timeout` 안에서 기다린다.
 */

import {
  acquireAdvisorySessionLock,
  mirrorSyncLockKey,
  releaseAdvisorySessionLock,
  tryAdvisorySessionLock,
  type Pool,
} from '@prs/db';

/** 다른 호출자가 같은 저장소의 미러를 fetch 중이다. 실패가 아니라 "나중에 다시"다. */
export class MirrorLockBusyError extends Error {
  readonly repositoryId: number;

  constructor(repositoryId: number) {
    super(`미러 fetch 락을 다른 호출자가 쥐고 있다: ${String(repositoryId)}`);
    this.name = 'MirrorLockBusyError';
    this.repositoryId = repositoryId;
  }
}

export interface MirrorLockOptions {
  /** `true`면 `timeoutMs`까지 기다린다. 기본은 즉시 답이다. */
  readonly wait?: boolean;
  readonly timeoutMs?: number;
}

/** 스윕·release가 기다리는 상한. fetch 한 번보다 길고 잡 타임아웃(15분)보다 짧다. */
export const MIRROR_LOCK_WAIT_MS = 60_000;

/**
 * 저장소 하나의 미러 락 아래에서 `run`을 실행한다.
 *
 * 락 순서는 **미러 → 시퀀스 트랜잭션**이다. `run` 안에서 시퀀스 공간 트랜잭션 락을
 * 잡는 것은 허용되며(채번이 그렇게 한다), 반대로 시퀀스 트랜잭션 안에서 이 함수를
 * 부르지 않는다.
 *
 * @throws {MirrorLockBusyError} 락을 얻지 못하면. `run`은 실행되지 않는다.
 */
export async function withMirrorLock<T>(
  pool: Pool,
  repositoryId: number,
  run: () => Promise<T>,
  options: MirrorLockOptions = {},
): Promise<T> {
  const key = mirrorSyncLockKey(repositoryId);
  const client = await pool.connect();
  let locked = false;
  let releaseFailed = false;

  try {
    locked =
      options.wait === true
        ? await acquireAdvisorySessionLock(client, key, options.timeoutMs ?? MIRROR_LOCK_WAIT_MS)
        : await tryAdvisorySessionLock(client, key);
    if (!locked) throw new MirrorLockBusyError(repositoryId);
    return await run();
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
