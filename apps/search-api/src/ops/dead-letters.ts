/**
 * 실패 대기열 조회와 재처리 (API-ADM-003, FR-ING-007, JOB-ING-009).
 *
 * HTTP를 모르는 순수 로직이다. 라우트는 `routes.ts`가 감싼다.
 *
 * **재처리는 언제나 `prs:ingest`에서 다시 시작한다.** 어느 단계에서 실패했든
 * 마찬가지다 — `EVT-ING-002`·`EVT-ING-003`은 어디에도 보존되지 않으므로 투영
 * 단계 실패를 그 단계부터 되살릴 방법이 없다. 다시 만들 수 있는 유일한 출발점은
 * `raw_event`의 원본이고, 앞 단계를 다시 도는 비용은 멱등 규칙(FR-ING-002)이
 * 중복 문서를 만들지 않는다는 보장으로 상쇄된다.
 *
 * **`batch` 워커를 기다리지 않는다** (CR-012, DEV-024). JOB-ING-009의 워커는
 * `batch`로 지정돼 있으나 그 역할은 WP-019가 세운다. 재처리 자체는 "행을 읽어
 * 스트림에 다시 넣는" I/O 가벼운 작업이라 요청 안에서 끝내고, 진행률 이벤트와
 * 10분 타임아웃은 `batch`가 생기는 시점부터 적용한다.
 */

import { deadLetterRepo, rawEventRepo, type Pool } from '@prs/db';
import type { DeadLetterFilter, DeadLetterRow, DeadLetterStage, DeadLetterState } from '@prs/db';
import { ingestEnvelope, ingestStreamKey, TOPICS, type EventBus } from '@prs/bus';

/** 1회 재처리 상한. 요청 안에서 끝내는 이상 무제한일 수 없다. */
export const MAX_REPROCESS_BATCH = 500;

/** 이 수를 넘는 일괄 재처리는 대상 건수를 확인 문자열로 되받는다 (QA-A001-05). */
export const CONFIRMATION_REQUIRED_ABOVE = 100;

export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 50;

export interface OpsDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly log?: (entry: OpsLogEntry) => void;
}

export interface OpsLogEntry {
  readonly level: 'info' | 'error';
  readonly message: string;
  readonly correlation_id?: string;
  readonly dead_letter_id?: number;
  readonly delivery_id?: string;
  readonly reason?: string;
  readonly count?: number;
}

export interface DeadLetterListResult {
  readonly items: readonly DeadLetterRow[];
  readonly total: number;
  readonly counts_by_state: Record<DeadLetterState, number>;
}

export interface ReprocessRequest {
  readonly deadLetterIds?: readonly number[];
  readonly filter?: DeadLetterFilter;
  readonly confirmation?: string | null;
}

export interface SkippedItem {
  readonly dead_letter_id: number;
  readonly reason: 'raw_event_missing' | 'publish_failed';
}

export interface ReprocessResult {
  readonly requested: number;
  readonly reinjected: number;
  readonly skipped: readonly SkippedItem[];
}

/** 재처리 요청이 계약을 어겼다. HTTP 코드는 라우트가 붙인다. */
export class ReprocessRejected extends Error {
  constructor(
    readonly code: 'RANGE_TOO_LARGE' | 'CONFIRMATION_MISMATCH' | 'INVALID_PARAMETER',
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ReprocessRejected';
  }
}

export async function listDeadLetters(
  deps: OpsDeps,
  filter: DeadLetterFilter,
  limit: number,
  offset: number,
): Promise<DeadLetterListResult> {
  const [items, total, counts] = await Promise.all([
    deadLetterRepo.listDeadLetters(deps.pool, filter, limit, offset),
    deadLetterRepo.countDeadLetters(deps.pool, filter),
    deadLetterRepo.countsByState(deps.pool),
  ]);
  return { items, total, counts_by_state: counts };
}

/**
 * 재처리 대상을 확정한다.
 *
 * 식별자를 명시하면 그것만, 필터를 주면 **열린 상태만** 고른다. `held`가 필터로
 * 딸려 오지 않는 것이 요점이다 — 자동 재처리 대상에서 빼는 것이 `held`의 뜻이라
 * (FR-ING-007 예외 처리), 사람이 식별자로 짚을 때만 다시 흐른다.
 */
async function resolveTargets(deps: OpsDeps, request: ReprocessRequest): Promise<DeadLetterRow[]> {
  if (request.deadLetterIds !== undefined) {
    if (request.deadLetterIds.length === 0) {
      throw new ReprocessRejected('INVALID_PARAMETER', '재처리할 항목이 없다');
    }
    return deadLetterRepo.findByIds(deps.pool, request.deadLetterIds);
  }

  if (request.filter === undefined) {
    throw new ReprocessRejected('INVALID_PARAMETER', 'dead_letter_ids 또는 filter가 필요하다');
  }

  const states = request.filter.states ?? deadLetterRepo.OPEN_STATES;
  return deadLetterRepo.listDeadLetters(
    deps.pool,
    { ...request.filter, states },
    MAX_REPROCESS_BATCH + 1,
    0,
  );
}

export async function reprocessDeadLetters(
  deps: OpsDeps,
  request: ReprocessRequest,
  correlationId: string,
): Promise<ReprocessResult> {
  const log = deps.log ?? ((): void => undefined);
  const targets = await resolveTargets(deps, request);

  if (targets.length > MAX_REPROCESS_BATCH) {
    throw new ReprocessRejected(
      'RANGE_TOO_LARGE',
      `1회 재처리 상한을 넘었다: ${String(targets.length)}건 (상한 ${String(MAX_REPROCESS_BATCH)})`,
      { limit: MAX_REPROCESS_BATCH, matched: targets.length },
    );
  }

  // 확인은 "몇 건인지 알고 누르는가"를 묻는 것이라, 대상이 확정된 뒤에 본다.
  // 필터로 고른 경우 요청 시점에는 건수를 모르기 때문이다.
  if (targets.length > CONFIRMATION_REQUIRED_ABOVE) {
    const expected = String(targets.length);
    if (request.confirmation !== expected) {
      throw new ReprocessRejected(
        'CONFIRMATION_MISMATCH',
        `${expected}건을 재처리하려면 확인 문자열로 대상 건수를 정확히 보내야 한다`,
        { required_confirmation: expected },
      );
    }
  }

  const rows = await Promise.all(
    targets.map(async (target) => ({
      target,
      raw: await rawEventRepo.findRawEventByDeliveryId(deps.pool, target.delivery_id),
    })),
  );

  const skipped: SkippedItem[] = [];
  const injectable: { target: DeadLetterRow; raw: NonNullable<(typeof rows)[number]['raw']> }[] = [];
  for (const row of rows) {
    if (row.raw === undefined) {
      // 보존 기간(3년)을 넘겼거나 파티션이 드롭됐다. 되살릴 원본이 없다.
      skipped.push({ dead_letter_id: row.target.dead_letter_id, reason: 'raw_event_missing' });
      continue;
    }
    injectable.push({ target: row.target, raw: row.raw });
  }

  // **표시가 먼저다.** 뒤에 오는 실패가 "재처리 실패"로 세어지려면 그 시점에
  // 행이 `reprocessing`이어야 한다 (DEV-022). 발행부터 하면 그사이의 실패가
  // 새 실패로 잘못 집계돼 `held`에 영영 닿지 못한다.
  await deadLetterRepo.markReprocessing(
    deps.pool,
    injectable.map((item) => item.target.dead_letter_id),
  );

  let reinjected = 0;
  for (const item of injectable) {
    try {
      await deps.bus.publish(TOPICS.ingest, ingestStreamKey(item.raw), ingestEnvelope(item.raw));
      reinjected += 1;
      log({
        level: 'info',
        message: '실패 이벤트를 재투입했다',
        correlation_id: correlationId,
        dead_letter_id: item.target.dead_letter_id,
        delivery_id: item.target.delivery_id,
      });
    } catch (error) {
      // 발행하지 못했으니 `reprocessing`은 사실이 아니다. 되돌려 놓지 않으면
      // 그 행이 아무도 다시 넣지 않은 채 진행 중으로 남는다.
      await revertToPending(deps, item.target.dead_letter_id);
      skipped.push({ dead_letter_id: item.target.dead_letter_id, reason: 'publish_failed' });
      log({
        level: 'error',
        message: '재투입 발행에 실패했다',
        correlation_id: correlationId,
        dead_letter_id: item.target.dead_letter_id,
        delivery_id: item.target.delivery_id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  return { requested: targets.length, reinjected, skipped };
}

async function revertToPending(deps: OpsDeps, deadLetterId: number): Promise<void> {
  try {
    await deadLetterRepo.revertReprocessing(deps.pool, deadLetterId);
  } catch {
    // 되돌리기까지 실패하면 그 행은 `reprocessing`으로 남는다. 목록에 그대로
    // 보이고 다시 재처리할 수 있으므로 여기서 요청 전체를 실패시키지 않는다.
  }
}

const STAGES: readonly DeadLetterStage[] = ['enrich', 'project', 'sequence', 'link'];
const STATES: readonly DeadLetterState[] = ['pending', 'reprocessing', 'held', 'resolved'];

export function parseStage(value: unknown): DeadLetterStage | undefined {
  if (value === undefined) return undefined;
  const stage = STAGES.find((candidate) => candidate === value);
  if (stage === undefined) {
    throw new ReprocessRejected('INVALID_PARAMETER', `알 수 없는 단계다: ${String(value)}`);
  }
  return stage;
}

export function parseState(value: unknown): DeadLetterState | undefined {
  if (value === undefined) return undefined;
  const state = STATES.find((candidate) => candidate === value);
  if (state === undefined) {
    throw new ReprocessRejected('INVALID_PARAMETER', `알 수 없는 상태다: ${String(value)}`);
  }
  return state;
}

/** 목록 기본값은 `resolved`를 뺀 전부다. 끝난 것이 화면을 채우면 안 된다. */
export const DEFAULT_LIST_STATES: readonly DeadLetterState[] = ['pending', 'reprocessing', 'held'];

export function parseIds(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ReprocessRejected('INVALID_PARAMETER', 'dead_letter_ids는 배열이어야 한다');
  }
  return value.map((entry) => {
    // 문자열로 온 식별자도 받는다. JSON에는 숫자로 나가지만(DEV-027) 클라이언트가
    // 큰 정수를 문자열로 다루는 것은 흔한 선택이다.
    const parsed = typeof entry === 'string' ? Number(entry) : entry;
    if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new ReprocessRejected('INVALID_PARAMETER', `식별자가 정수가 아니다: ${String(entry)}`);
    }
    return parsed;
  });
}

export function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
    throw new ReprocessRejected('INVALID_PARAMETER', `limit은 1..${String(MAX_LIST_LIMIT)}이다`);
  }
  return parsed;
}

export function parseOffset(value: unknown): number {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ReprocessRejected('INVALID_PARAMETER', 'offset은 0 이상의 정수다');
  }
  return parsed;
}

export function parseRepositoryId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ReprocessRejected('INVALID_PARAMETER', `repository_id가 정수가 아니다: ${String(value)}`);
  }
  return parsed;
}
