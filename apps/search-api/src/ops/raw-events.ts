/**
 * API-ADM-008 원본 아카이브 조회 (FR-ING-010, CR-052).
 *
 * ## 역할 제한은 접근 범위 필터를 대체하지 않는다 (AC-6, THR-044)
 *
 * AC-5가 정하는 것은 이 경로를 **부를 자격**이고, 무엇이 보이는지는 `ADR-008`의
 * 필수 접근 범위 필터가 정한다. 원본 payload는 엔티티 문서보다 넓은 사실을
 * 담으므로 여기에 예외를 두면 **접근 통제가 가장 민감한 자리에서만 풀린다.**
 *
 * 그래서 세션 인증만 받는다. 이름 붙은 관리 토큰(CR-013)은 사용자가 아니라
 * 접근 범위를 산출할 대상이 없고, 범위 없는 조회는 AC-6을 만족시킬 수 없다.
 * 토큰만 구성된 배포에서는 이 경로를 **등록하지 않는다** — 등록해 두고 매번
 * 403을 내는 것보다 없는 편이 낫다.
 *
 * ## `payload`는 기본으로 싣지 않는다
 *
 * 아카이브는 5억 건 규모(NFR-003)이고 payload는 건당 평균 8KB인 임의 JSON이다.
 * 목록 응답의 기본값으로 두면 조사자가 원본을 보려던 것이 아닐 때도 내주게 되고
 * **그 노출은 되돌릴 수 없다.** `include_payload=true`는 명시적 열람 의사다.
 */

import { createHash } from 'node:crypto';
import type { estypes } from '@elastic/elasticsearch';
import type { Client } from '@elastic/elasticsearch';
import { ARCHIVE_ALIAS, applyArchiveScopeFilter, archiveAvailable, search } from '@prs/es';
import { AdminRejected } from './errors.js';
import {
  decodeEnvelope,
  encodeEnvelope,
  assertNotExpired,
  CURSOR_TTL_MS,
  type CursorSigner,
} from '../cursor/envelope.js';

export const DEFAULT_RAW_EVENT_LIMIT = 25;
export const MAX_RAW_EVENT_LIMIT = 100;

export interface RawEventFilter {
  readonly deliveryId?: string;
  readonly repository?: string;
  readonly eventType?: string;
  readonly action?: string;
  readonly receivedFrom?: string;
  readonly receivedTo?: string;
  readonly includePayload: boolean;
  readonly limit: number;
  readonly cursor?: string;
}

export interface RawEventItem {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository: string | null;
  readonly repository_id: number | null;
  readonly received_at: string;
  readonly correlation_id: string;
  readonly payload?: unknown;
}

export interface RawEventsResponse {
  readonly items: readonly RawEventItem[];
  readonly next_cursor: string | null;
  /**
   * 아카이브 인덱스가 실제로 있는지.
   *
   * `false`는 오류가 아니다. 아직 이벤트가 없거나 ILM이 전 구간을 지운 상태이며,
   * **레인 B의 부재가 운영 콘솔을 막으면 두 레인의 독립(AC-3)이 조회 쪽에서
   * 깨진다.**
   */
  readonly index_available: boolean;
}

export interface RawEventsDeps {
  readonly es: Client;
  readonly cursorSigner: CursorSigner;
  readonly now?: () => number;
}

interface CursorPayload {
  readonly f: string;
  readonly a: readonly unknown[];
  readonly e: number;
}

/** 정렬은 수신 시각 내림차순이고 전달 식별자가 타이브레이커다. */
const SORT: estypes.Sort = [{ received_at: 'desc' }, { delivery_id: 'asc' }];

export function parseRawEventLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_RAW_EVENT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_RAW_EVENT_LIMIT) {
    throw new AdminRejected('INVALID_PARAMETER', `limit은 1..${MAX_RAW_EVENT_LIMIT} 정수다`, {
      field: 'limit',
    });
  }
  return value;
}

/**
 * `include_payload` 판정.
 *
 * 빈 값과 알 수 없는 값을 `false`로 접지 않는다 — 형식 오류를 기본값으로 접는
 * 것이 DEV-363이 남긴 실패다. 여기서는 접어도 노출이 늘지 않지만, 같은 자리에서
 * 같은 판정을 두 가지로 하면 규칙이 갈라진다.
 */
export function parseIncludePayload(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new AdminRejected('INVALID_PARAMETER', 'include_payload는 true 또는 false다', {
    field: 'include_payload',
  });
}

export function parseReceivedAt(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    throw new AdminRejected('INVALID_PARAMETER', `${field}는 ISO 8601 시각이다`, { field });
  }
  return raw;
}

/**
 * 질의 조건과 노출 범위를 봉인하는 지문.
 *
 * `include_payload`가 들어가는 것은 **같은 순회 안에서 노출 범위가 조용히 바뀌지
 * 않게** 하기 위해서다. 도중에 켜면 지문이 달라져 커서가 거절된다.
 *
 * ## 접근 범위는 해시로 접어 넣는다 (PR #69 리뷰)
 *
 * **봉투는 서명될 뿐 암호화되지 않는다** — base64 한 번이면 안이 읽힌다. 첫 판은
 * `repositoryIds` 배열을 그대로 담았고, 그 커서가 감사 기록에 남으면 **감사를 읽는
 * 사람이 요청자의 접근 범위 전부를 복원한다.** 질의가 저장소 하나를 지목해도 그렇다.
 *
 * 지문은 "같은 범위가 늘 같은 값"이면 충분하고 그 안을 되읽을 필요가 없다 —
 * `repositories/cursor.ts`가 같은 이유로 같은 판단을 이미 내렸다.
 */
export function computeRawEventFingerprint(
  filter: RawEventFilter,
  repositoryIds: readonly number[],
): string {
  const material = [
    filter.deliveryId ?? '',
    filter.repository ?? '',
    filter.eventType ?? '',
    filter.action ?? '',
    filter.receivedFrom ?? '',
    filter.receivedTo ?? '',
    String(filter.includePayload),
    [...repositoryIds].sort((a, b) => a - b).join(','),
  ];
  return createHash('sha256').update(material.join('|'), 'utf8').digest('base64url');
}

function readString(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new AdminRejected('INVALID_PARAMETER', `${field}는 문자열이다`, { field });
  }
  return raw;
}

/**
 * 질의 문자열을 조회 조건으로 옮긴다.
 *
 * **라우트가 아니라 여기서 판정한다.** 파싱이 라우트에 흩어지면 조건 하나를
 * 빠뜨린 자리가 조용히 넓게 답한다 — 접근 범위와 달리 이쪽 실패는 fail-open이다.
 */
export function parseRawEventFilter(query: Readonly<Record<string, unknown>>): RawEventFilter {
  const deliveryId = readString(query['delivery_id'], 'delivery_id');
  const repository = readString(query['repository'], 'repository');
  const eventType = readString(query['event_type'], 'event_type');
  const action = readString(query['action'], 'action');
  const receivedFrom = parseReceivedAt(query['received_from'], 'received_from');
  const receivedTo = parseReceivedAt(query['received_to'], 'received_to');
  const cursor = readString(query['cursor'], 'cursor');

  return {
    ...(deliveryId === undefined ? {} : { deliveryId }),
    ...(repository === undefined ? {} : { repository }),
    ...(eventType === undefined ? {} : { eventType }),
    ...(action === undefined ? {} : { action }),
    ...(receivedFrom === undefined ? {} : { receivedFrom }),
    ...(receivedTo === undefined ? {} : { receivedTo }),
    ...(cursor === undefined ? {} : { cursor }),
    includePayload: parseIncludePayload(query['include_payload']),
    limit: parseRawEventLimit(query['limit']),
  };
}

function buildArchiveQuery(filter: RawEventFilter): estypes.QueryDslQueryContainer {
  // `delivery_id`가 있으면 나머지 조건은 무시한다 (AC-4의 대조 경로).
  if (filter.deliveryId !== undefined) {
    return { term: { delivery_id: filter.deliveryId } };
  }

  const must: estypes.QueryDslQueryContainer[] = [];
  if (filter.repository !== undefined) must.push({ term: { repository: filter.repository } });
  if (filter.eventType !== undefined) must.push({ term: { event_type: filter.eventType } });
  if (filter.action !== undefined) must.push({ term: { action: filter.action } });
  if (filter.receivedFrom !== undefined || filter.receivedTo !== undefined) {
    must.push({
      range: {
        received_at: {
          ...(filter.receivedFrom === undefined ? {} : { gte: filter.receivedFrom }),
          ...(filter.receivedTo === undefined ? {} : { lte: filter.receivedTo }),
        },
      },
    });
  }

  return must.length === 0 ? { match_all: {} } : { bool: { must } };
}

function toItem(hit: estypes.SearchHit<Record<string, unknown>>, includePayload: boolean): RawEventItem {
  const source = hit._source ?? {};
  const base: RawEventItem = {
    delivery_id: String(source['delivery_id'] ?? ''),
    event_type: String(source['event_type'] ?? ''),
    action: (source['action'] as string | null | undefined) ?? null,
    repository: (source['repository'] as string | null | undefined) ?? null,
    repository_id: (source['repository_id'] as number | null | undefined) ?? null,
    received_at: String(source['received_at'] ?? ''),
    correlation_id: String(source['correlation_id'] ?? ''),
  };
  return includePayload ? { ...base, payload: source['payload'] } : base;
}

export async function listRawEvents(
  deps: RawEventsDeps,
  filter: RawEventFilter,
  repositoryIds: readonly number[],
): Promise<RawEventsResponse> {
  const nowMs = (deps.now ?? Date.now)();

  if (!(await archiveAvailable(deps.es))) {
    return { items: [], next_cursor: null, index_available: false };
  }

  const fingerprint = computeRawEventFingerprint(filter, repositoryIds);
  const searchAfter = filter.cursor === undefined
    ? undefined
    : decodeRawEventCursor(filter.cursor, fingerprint, deps.cursorSigner, nowMs);

  // 접근 범위는 여기서 결합한다. 조건이 무엇이든 이 필터를 지난다 (AC-6).
  const scoped = applyArchiveScopeFilter(buildArchiveQuery(filter), repositoryIds);

  const response = await search<Record<string, unknown>>(deps.es, ARCHIVE_ALIAS, scoped, {
    size: filter.limit,
    sort: SORT,
    ...(searchAfter === undefined ? {} : { search_after: [...searchAfter] }),
  });

  const hits = response.hits.hits;
  const items = hits.map((hit) => toItem(hit, filter.includePayload));
  const last = hits.at(-1);
  const nextCursor =
    hits.length < filter.limit || last?.sort === undefined
      ? null
      : encodeRawEventCursor(last.sort, fingerprint, deps.cursorSigner, nowMs);

  return { items, next_cursor: nextCursor, index_available: true };
}

export function encodeRawEventCursor(
  sort: readonly unknown[],
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: CursorPayload = { f: fingerprint, a: [...sort], e: nowMs + CURSOR_TTL_MS };
  return encodeEnvelope(payload, signer);
}

export function decodeRawEventCursor(
  cursor: string,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): readonly unknown[] {
  let decoded: unknown;
  try {
    decoded = decodeEnvelope(cursor, signer);
  } catch {
    throw new AdminRejected('CURSOR_INVALID', '커서를 해석할 수 없다', { field: 'cursor' });
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw new AdminRejected('CURSOR_INVALID', '커서를 해석할 수 없다', { field: 'cursor' });
  }
  const payload = decoded as Partial<CursorPayload>;
  assertNotExpired(payload.e, nowMs);

  if (payload.f !== fingerprint) {
    throw new AdminRejected('CURSOR_QUERY_MISMATCH', '조회 조건이 커서와 다르다', {
      field: 'cursor',
    });
  }
  if (!Array.isArray(payload.a)) {
    throw new AdminRejected('CURSOR_INVALID', '커서를 해석할 수 없다', { field: 'cursor' });
  }
  return payload.a;
}
