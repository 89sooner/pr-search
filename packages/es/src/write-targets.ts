/**
 * 논리 쓰기의 대상 해석 (WP-035 / CR-045, DEV-295·296·308).
 *
 * ## 왜 함수마다 "지금 재색인 중인가"를 묻지 않는가
 *
 * 계약이 "재색인 중 신규 이벤트 이중 쓰기"라고만 적으면 구현은 투영 하나만
 * 고치고 끝난다. 그리고 함수마다 상태를 물으면 **새 쓰기 경로가 그 물음을
 * 잊는다** — 잊은 만큼 새 인덱스가 조용히 뒤처지고, 그 사실은 전환 뒤에야
 * 드러난다. 그래서 대상 집합을 **한 seam이 정하고** 원시체는 그것을 인자로
 * 받기만 한다.
 *
 * ## `@prs/es`가 `@prs/db`를 의존하지 않는다
 *
 * 대상을 정하려면 PostgreSQL의 재색인 잡 상태를 읽어야 한다. 그 해석은
 * **애플리케이션 계층**이 하고(`@prs/db`의 `withReindexWrite`), 여기는 결과만
 * 받는다. 의존 방향이 뒤집히면 색인 패키지가 데이터베이스를 끌고 다닌다.
 *
 * `shadows`를 `Record<string, string>`으로 둔 것도 같은 이유다 — `@prs/db`가
 * 만든 값이 `EntityAlias` 타입을 몰라도 **구조적으로 그대로 대입**된다.
 */

/** shadow 인덱스 쓰기 실패 하나. 서비스 인덱스 결과와 섞지 않는다. */
export interface ShadowWriteFailure {
  /** 안정 별칭. */
  readonly alias: string;
  /** 실패한 구체 인덱스 이름. */
  readonly index: string;
  /** `bulk` · `update` · `update_by_query` · `delete_by_query`. */
  readonly operation: string;
  readonly reason: string;
}

/**
 * shadow에서 **부분 갱신의 대상 문서가 아직 없었던** 간선 하나 (CR-121 / FR-ING-008 AC-11).
 *
 * 실패도 성공도 아니다 — 회수할 일이다. 그 간선의 소유 source가 재구축에서 아직 처리되지
 * 않았거나, 처리된 뒤에 부분 갱신이 도착했다. 여기서 문서를 만들지 않는다(근거·권한 필드가
 * 없다). 울타리를 쥔 쪽이 재색인 잡의 대기열에 남기고, 잡이 소유 source를 정본에서 다시
 * 파생해 회수한다.
 */
export interface ShadowPendingWork {
  readonly alias: string;
  readonly index: string;
  /** 소유 source의 저장소 — 간선의 routing이다. */
  readonly repositoryId: number;
  readonly sourceKind: 'pull_request' | 'commit';
  /** PR 번호(10진 문자열) 또는 소문자 40자 SHA. */
  readonly sourceId: string;
  readonly linkId: string;
}

/**
 * 이 논리 쓰기가 닿을 대상.
 *
 * 서비스 대상은 **언제나 안정 별칭 이름**이다 (FR-ING-008 AC-1). 구체 이름을
 * 미리 해석해 두면 그 사이에 전환이 일어났을 때 옛 인덱스에 쓰게 된다 —
 * 별칭에 쓰면 그런 창이 아예 없다.
 */
export interface WriteTargets {
  /** 별칭 → shadow 구체 인덱스. 평시에는 비어 있다. */
  readonly shadows: Readonly<Record<string, string>>;
  /**
   * shadow 실패를 여기에 모은다.
   *
   * **던지지 않는다** — shadow 실패가 서비스 인덱스 쓰기를 끊으면 안 된다
   * (불변식 6). 그러나 잊어서도 안 된다(불변식 7): 울타리를 쥔 쪽이 이 기록을
   * 보고 잡을 `failed`로 만들어 전환을 막는다.
   */
  readonly recordShadowFailure?: (failure: ShadowWriteFailure) => void;
  /** shadow 미처리를 여기에 모은다 (CR-121). 없으면 미처리는 실패로 올라간다. */
  readonly recordShadowPending?: (pending: ShadowPendingWork) => void;
}

/** 재색인이 없을 때의 대상. 시험과 부트스트랩이 쓴다. */
export const SERVING_ONLY: WriteTargets = { shadows: {} };

/** 이 별칭의 shadow 인덱스. 없으면 `undefined`. */
export function shadowIndexOf(targets: WriteTargets, alias: string): string | undefined {
  return targets.shadows[alias];
}

/** 실제로 쓸 인덱스들. 첫 원소가 서비스 대상(별칭)이다. */
export function writeIndicesOf(targets: WriteTargets, alias: string): readonly string[] {
  const shadow = targets.shadows[alias];
  return shadow === undefined ? [alias] : [alias, shadow];
}

/** shadow 실패를 기록한다. 기록자가 없으면 조용히 버리지 않고 아무 일도 하지 않는다. */
export function reportShadowFailure(targets: WriteTargets, failure: ShadowWriteFailure): void {
  targets.recordShadowFailure?.(failure);
}

/**
 * shadow 미처리를 기록한다. **기록자가 없으면 실패로 올린다** — 누가 회수할지 모르는 미처리는
 * 조용히 사라지고, 그러면 새 인덱스에 간선이 빠진 채 전환된다 (fail closed).
 */
export function reportShadowPending(targets: WriteTargets, pending: ShadowPendingWork): void {
  if (targets.recordShadowPending === undefined) {
    reportShadowFailure(targets, {
      alias: pending.alias,
      index: pending.index,
      operation: 'bulk',
      reason: `document_missing_exception (미처리를 받을 기록자가 없다: ${pending.linkId})`,
    });
    return;
  }
  targets.recordShadowPending(pending);
}

/**
 * 서비스 대상에 쓰고, shadow가 있으면 같은 연산을 한 번 더 보낸다.
 *
 * 서비스 쪽 예외는 **그대로 던진다** — 기존 재시도·오류 처리가 재색인 때문에
 * 달라지지 않는다. shadow 쪽 예외는 잡아서 기록만 한다.
 */
export async function dualWrite<T>(
  targets: WriteTargets,
  alias: string,
  operation: string,
  run: (index: string) => Promise<T>,
): Promise<T> {
  const served = await run(alias);
  const shadow = targets.shadows[alias];
  if (shadow === undefined) return served;

  try {
    await run(shadow);
  } catch (error) {
    reportShadowFailure(targets, { alias, index: shadow, operation, reason: String(error) });
  }
  return served;
}
