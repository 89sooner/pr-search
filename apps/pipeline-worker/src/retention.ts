/**
 * JOB-AUD-001 파티션 수명 (WP-039 / FR-ING-003 AC-5, NFR-006, CR-054).
 *
 * ## 만들고 나서 지운다
 *
 * 순서가 중요하다. 드롭을 먼저 하면 그 회차가 실패했을 때 다가올 파티션도 없는
 * 채로 끝나고, 다음 INSERT가 전부 거부된다. **생성은 언제나 안전하고 드롭은
 * 되돌릴 수 없으므로** 안전한 쪽을 먼저 한다.
 *
 * 생성이 이 잡의 몫이 된 것은 `WP-039` 착수 전 감사가 찾은 공백이다
 * (DEV-417) — `ensureMonthlyPartitions`는 부트스트랩에서만 호출되고 정기
 * 잡이 어디에도 없었다. 기본이 3개월치이므로 **배포 후 세 달이면 `raw_event`와
 * `audit_record`의 INSERT가 전부 거부된다.** 드롭할 권한이 있는 잡이 생성도
 * 하는 것이 파티션 수명을 한 자리에 두는 답이다.
 *
 * ## 관리 연결을 쓴다
 *
 * `prs_app`에는 `DROP` 권한이 없다 — 그것이 감사 불변성의 마지막 방어선이다
 * (FR-AUTH-004 AC-3, 마이그레이션 005). 이 잡만 `ADMIN_DATABASE_URL`로 접속해
 * `SET ROLE prs_admin`을 건다. 설정이 없으면 **이 잡만 서지 않고** 나머지 배치
 * 역할은 정상 동작한다.
 *
 * ## 감사는 살아 있는 파티션에 남긴다
 *
 * 드롭한 사실을 `retention.purge`로 기록하는데, **그 기록은 현재 파티션에
 * 들어간다.** 지울 파티션에 먼저 쓴 뒤 함께 지우면 기록이 사라진다. 생성이
 * 앞에 오므로 현재 파티션은 이 시점에 반드시 있다 — 순서가 그것도 보장한다.
 */

import { auditRepo, runPartitionRetention, type Pool, type RetentionResult } from '@prs/db';
import { AUDIT_RETENTION_PRINCIPAL } from '@prs/domain';
import { randomUUID } from 'node:crypto';

/** 일 1회. 인프라 9.6이 03:00 KST를 정하지만 주기만 코드가 안다. */
export const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

export interface RetentionDeps {
  /** 관리 권한 연결. `SET ROLE prs_admin`이 걸려 있다. */
  readonly admin: Pool;
  /**
   * 감사 기록을 쓸 연결.
   *
   * **관리 연결과 다르다.** 감사 INSERT는 `prs_app`의 권한으로 충분하고,
   * 관리 롤로 쓰면 그 연결이 하는 일이 둘이 되어 최소 권한의 뜻이 흐려진다.
   */
  readonly pool: Pool;
  readonly log?: (entry: Record<string, unknown>) => void;
}

/**
 * 한 회차를 돈다.
 *
 * **부분 실패를 조용히 넘기지 않는다.** 파티션 하나의 드롭이 실패해도 나머지를
 * 계속 지우되 그 실패를 로그로 드러낸다 — 조용한 부분 성공은 "보존 정책이 돌고
 * 있다"는 거짓 신호를 만든다.
 */
export async function runRetentionSweep(
  deps: RetentionDeps,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const correlationId = randomUUID();
  const result = await runPartitionRetention(deps.admin, now);

  for (const partition of result.dropped) {
    /*
     * **실제로 지운 파티션만 기록한다** (FR-ING-003 AC-5). 지울 것이 없는
     * 회차마다 뜻 없는 `retention.purge`를 쌓지 않는다 — 감사에서 신호가
     * 묻힌다.
     *
     * `query`는 `null`이다: 이 행위에는 적용한 조건이 없다 (AC-2).
     */
    try {
      await auditRepo.recordAudit(deps.pool, {
        userId: AUDIT_RETENTION_PRINCIPAL,
        action: 'retention.purge',
        target: partition.name,
        query: null,
        resultCode: 'dropped',
        correlationId,
      });
    } catch (error) {
      /*
       * **이미 성공한 드롭을 되돌린 척하지 않는다.** 파티션은 사라졌고 그것이
       * 사실이다. 감사 기록이 실패한 것은 별개의 사실이며 그대로 남긴다 —
       * `FR-AUTH-004` AC-6이 정한 것과 같은 방향이다.
       */
      deps.log?.({
        level: 'error',
        job: 'JOB-AUD-001',
        message: 'retention.purge 감사 기록에 실패했다 — 파티션은 이미 드롭됐다',
        partition: partition.name,
        correlation_id: correlationId,
        reason: String(error).slice(0, 300),
      });
    }
  }

  deps.log?.({
    level: result.failed.length === 0 ? 'info' : 'error',
    job: 'JOB-AUD-001',
    message: '파티션 수명 회차를 마쳤다',
    created: result.created.length,
    dropped: result.dropped.length,
    failed: result.failed.length,
    correlation_id: correlationId,
  });

  return result;
}

export interface RetentionRunner {
  stop(): Promise<void>;
}

/**
 * 정기 실행. 깨울 수 있는 sleep을 쓴다 (`startRetentionSweeper` 선례).
 *
 * **기동 직후 한 번 돈다.** 다가올 파티션이 없는 채로 하루를 기다리면 그 사이의
 * INSERT가 전부 거부될 수 있다 — 첫 회차를 미룰 이유가 없다.
 */
export function startRetentionRunner(
  deps: RetentionDeps,
  intervalMs = RETENTION_SWEEP_MS,
): RetentionRunner {
  let stopped = false;
  let wake: (() => void) | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        await runRetentionSweep(deps);
      } catch (error) {
        deps.log?.({
          level: 'error',
          job: 'JOB-AUD-001',
          message: '파티션 수명 회차가 실패했다',
          reason: String(error).slice(0, 300),
        });
      }
      if (stopped) break;
      await sleep(intervalMs);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
