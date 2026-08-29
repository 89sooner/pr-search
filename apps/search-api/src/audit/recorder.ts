/**
 * 감사 기록의 공용 경계 (WP-039 / FR-AUTH-004 AC-6, CR-054 DEV-406).
 *
 * ## 왜 하나인가
 *
 * `WP-039` 착수 전 감사에서 **호출부 넷 중 하나만 실패가 격리돼 있었다.**
 * `raw_event.view_payload`는 `try`/`catch`와 카운터를 갖고 있었고
 * `repository.*`·`sequence_integrity.*`는 `await`가 그대로 요청을 실패시켰다.
 * 각자 구현하면 **빠뜨린 자리가 리뷰에서 눈에 띄지 않는다** — 감사는 성공
 * 경로에서 아무 흔적도 남기지 않으므로, 격리를 빠뜨린 호출부는 DB가 건강한
 * 동안 정상으로 보인다.
 *
 * ## AC-6이 요구하는 것과 요구하지 않는 것
 *
 * **요구하는 것**: 감사 쓰기가 주 동작의 트랜잭션 밖에 있고, 그 실패가 주
 * 동작의 결과를 바꾸지 않는다. 200은 200으로, 403은 403으로 나간다.
 *
 * **요구하지 않는 것**: 관측되지 않는 Promise, 프로세스 종료 시 유실되는
 * fire-and-forget, 새 큐나 브로커. **기다리는 것은 지연이고 전파하는 것은
 * 결합이며, 금지되는 것은 후자다.** 그래서 이 함수는 `await`하되 절대 던지지
 * 않는다 — 감사가 늦으면 응답이 늦을 뿐이고, 감사가 실패하면 지표만 오른다.
 *
 * ## 지표 라벨
 *
 * `action` 하나다. 정본 표의 액션은 유한하므로 카디널리티가 닫힌다.
 * `user_id`·`target`·`query`는 넣지 않는다 — 무한에 가깝고, **감사가 담은
 * 값을 지표로 다시 내보내면 지표 엔드포인트가 두 번째 유출 경로가 된다**
 * (관측성 3.3).
 */

import { auditRepo, type Pool, type PoolClient } from '@prs/db';
import type { AuditAction } from '@prs/domain';
import { Counter } from '../metrics.js';

/**
 * 감사 기록 적재 실패 건수 (`RB-18`, 5분 지속 시 P2).
 *
 * **모듈 수준이다.** 요청마다 만들면 스크레이프가 언제나 0을 본다. 0이 아니면
 * 조회는 되는데 그 조회가 남지 않고 있다는 뜻이다.
 */
export const auditFailedTotal = new Counter(
  'audit_record_failed_total',
  '감사 기록 적재 실패 건수. 5분 지속되면 P2 경보(RB-18)',
);

export interface AuditEntry {
  readonly userId: string;
  readonly action: AuditAction;
  /**
   * 행위가 가리킨 대상 **하나**의 식별자.
   *
   * 의미상 대상이 없으면 `null`이다 (`search.execute`·`audit.view`). `N/A`나
   * 빈 문자열을 지어내지 않는다 — "없다"와 "빈 값으로 기록됐다"가 같은 모양이
   * 되면 감사가 사실을 말하지 못한다 (FR-AUTH-004 AC-2).
   */
  readonly target?: string | null;
  /**
   * 그 행위가 적용한 조건.
   *
   * **적용된 조건 전부를 담는다** (PR #67 리뷰 P2). 일부만 담으면 그 기록으로
   * 무엇을 했는지 재구성할 수 없고, AC-2가 요구하는 것이 바로 재구성 가능한
   * 질의 문자열이다. **응답 본문은 절대 담지 않는다** (보안 7.1).
   */
  readonly query?: string | null;
  readonly resultCode: string;
  readonly correlationId: string;
}

/**
 * 로그 엔트리 모양.
 *
 * 운영 라우트의 `OpsLogEntry`가 받을 수 있는 필드만 쓴다 — 공용 경계가
 * 호출부보다 넓은 것을 요구하면 각 호출부가 자기 로거를 감싸야 하고, 그
 * 래핑이 곧 이 경계가 없애려던 복제다. `action`은 `message`에 담는다.
 */
export interface AuditLogEntry {
  readonly level: 'error';
  readonly message: string;
  readonly correlation_id?: string;
  readonly reason?: string;
}

export type AuditLog = (entry: AuditLogEntry) => void;

type Queryable = Pool | PoolClient;

/**
 * 감사 한 건을 최선 노력으로 남긴다. **절대 던지지 않는다.**
 *
 * @returns 기록에 성공했으면 `true`. 호출부는 이 값을 보고 응답을 바꾸지
 * 않는다 — 시험이 격리를 확인하는 데 쓴다.
 */
export async function recordAuditBestEffort(
  db: Queryable,
  entry: AuditEntry,
  log?: AuditLog,
): Promise<boolean> {
  try {
    await auditRepo.recordAudit(db, {
      userId: entry.userId,
      action: entry.action,
      target: entry.target ?? null,
      query: entry.query ?? null,
      resultCode: entry.resultCode,
      correlationId: entry.correlationId,
    });
    return true;
  } catch (error) {
    auditFailedTotal.inc({ action: entry.action });
    log?.({
      level: 'error',
      message: `감사 기록에 실패했다 (${entry.action}) — 주 동작은 계속 처리된다`,
      correlation_id: entry.correlationId,
      reason: String(error).slice(0, 300),
    });
    return false;
  }
}
