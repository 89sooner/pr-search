/**
 * `document_version` 조건부 스크립트 업서트 (FR-ING-005 AC-1~AC-3, 데이터 모델 5장).
 *
 * 수집 파이프라인은 순서를 보장하지 않는다. 같은 PR에 대한 두 이벤트가 순서를
 * 바꿔 도착하면 **오래된 상태가 새 상태를 덮어쓸 수 있다.** 그래서 모든 갱신이
 * 이 파일의 스크립트를 거친다 — 저장된 `document_version`보다 작은 갱신은
 * `noop`이 된다.
 *
 * 여기에 CR-011(DEV-019)이 더한 규칙이 하나 있다. **누적 필드는 버전 비교의
 * 대상이 아니다.** `commit.pull_request_numbers`는 N:M이라 커밋 하나가 두 PR에
 * 속할 수 있고, 집합 소속은 순서와 무관하게 단조 증가한다. 이것을 버전으로
 * 막으면 늦게 도착한 이벤트가 자기 소속을 아예 등록하지 못해 FR-SRCH-002
 * (SHA → PR)가 조용히 한쪽을 잃는다.
 */

import type { Client, estypes } from '@elastic/elasticsearch';
import type { EntityAlias } from './indices.js';

/**
 * Painless 조건부 업서트.
 *
 * `params.doc`  — 상태 필드. 버전이 더 클 때만 대입한다.
 * `params.union` — 누적 필드. 버전과 무관하게 항상 합집합한다.
 *
 * 둘 다 바뀐 것이 없으면 `ctx.op = 'noop'`으로 쓰기 자체를 건너뛴다. 색인
 * 부하를 줄이려는 것이 아니라, 갱신 없음이 갱신으로 보이면 안 되기 때문이다.
 */
export const CONDITIONAL_UPSERT_SCRIPT = [
  "boolean fresh = ctx._source.document_version == null",
  " || ctx._source.document_version < params.doc.document_version;",
  "boolean changed = fresh;",
  "if (fresh) { for (e in params.doc.entrySet()) { ctx._source[e.getKey()] = e.getValue(); } }",
  "for (e in params.union.entrySet()) {",
  "  def current = ctx._source[e.getKey()];",
  "  def merged = new HashSet();",
  "  if (current instanceof List) { merged.addAll(current); }",
  "  else if (current != null) { merged.add(current); }",
  "  if (merged.addAll(e.getValue())) { changed = true; }",
  "  ctx._source[e.getKey()] = new ArrayList(merged);",
  "}",
  "if (!changed) { ctx.op = 'noop'; }",
].join('\n');

/** 갱신 충돌 재시도 횟수. 같은 문서를 두 이벤트가 동시에 건드릴 때만 쓰인다. */
const RETRY_ON_CONFLICT = 3;

export interface UpsertRequest {
  readonly alias: EntityAlias;
  /** 결정론적 문서 ID. 같은 이벤트를 두 번 처리해도 문서는 하나다. */
  readonly id: string;
  /** `_routing`. ADR-003대로 저장소 범위 질의를 단일 샤드로 좁힌다. */
  readonly routing: string;
  /** 상태 필드. `document_version`이 반드시 있어야 조건부 비교가 성립한다. */
  readonly doc: Readonly<Record<string, unknown>> & { readonly document_version: number };
  /** 누적 필드. 버전과 무관하게 합집합한다. */
  readonly union?: Readonly<Record<string, readonly unknown[]>>;
  /**
   * 생성 시점에만 쓰는 필드.
   *
   * 다른 워커가 소유하는 필드(`links_pending`, `merge_seq` …)의 초깃값이 여기
   * 들어간다. `doc`에 넣으면 투영이 돌 때마다 그 워커의 결과를 되돌린다.
   */
  readonly createOnly?: Readonly<Record<string, unknown>>;
}

export type BulkItemOutcome =
  /** 색인됐거나(`created`/`updated`) 버전이 낮아 무시됐다(`noop`). 둘 다 정상이다. */
  | { readonly kind: 'ok'; readonly request: UpsertRequest; readonly result: string }
  /** 다시 보내면 될 수 있다 — 쓰기 거부(429), 샤드 미가용, 버전 충돌. */
  | { readonly kind: 'retryable'; readonly request: UpsertRequest; readonly status: number; readonly reason: string }
  /** 다시 보내도 같다 — 매핑에 없는 필드(THR-010), 파싱 실패, 스크립트 오류. */
  | { readonly kind: 'rejected'; readonly request: UpsertRequest; readonly status: number; readonly reason: string };

export interface BulkUpsertResult {
  readonly outcomes: readonly BulkItemOutcome[];
  readonly hasFailures: boolean;
}

/**
 * 다시 보내도 결과가 같은 오류들.
 *
 * `strict_dynamic_mapping_exception`이 THR-010의 방어선이다 — 매핑에 없는 필드가
 * 흘러들면 색인이 거부되고, 그 거부는 재시도가 아니라 실패 대기열로 가야 한다.
 * 재시도하면 같은 이벤트가 5번 거부되고 그동안 파티션이 막힌다.
 */
const NON_RETRYABLE_ERROR_TYPES: ReadonlySet<string> = new Set([
  'strict_dynamic_mapping_exception',
  'document_parsing_exception',
  'mapper_parsing_exception',
  'illegal_argument_exception',
  'script_exception',
  'invalid_index_name_exception',
]);

/** 명시적으로 재시도 가능한 오류. 나머지는 상태 코드로 가른다. */
const RETRYABLE_ERROR_TYPES: ReadonlySet<string> = new Set([
  'es_rejected_execution_exception',
  'circuit_breaking_exception',
  'cluster_block_exception',
  'unavailable_shards_exception',
  'version_conflict_engine_exception',
  'node_not_connected_exception',
  'no_shard_available_action_exception',
  'process_cluster_event_timeout_exception',
]);

interface FailureShape {
  readonly type?: string;
  readonly reason?: string | null;
}

/**
 * 실패 하나를 분류한다.
 *
 * **오류 메시지를 정규식으로 읽지 않는다.** ES가 준 `error.type`과 상태 코드만
 * 본다 — 메시지 문구는 버전마다 바뀌고, 바뀐 날 재시도 불가가 재시도 가능으로
 * 조용히 넘어간다.
 */
export function classifyFailure(status: number, error: FailureShape | undefined): 'retryable' | 'rejected' {
  const type = error?.type;
  if (type !== undefined) {
    if (NON_RETRYABLE_ERROR_TYPES.has(type)) return 'rejected';
    if (RETRYABLE_ERROR_TYPES.has(type)) return 'retryable';
  }
  if (status === 429) return 'retryable';
  if (status >= 500) return 'retryable';
  return 'rejected';
}

function failureReason(status: number, error: FailureShape | undefined): string {
  const type = error?.type ?? 'unknown';
  const reason = error?.reason ?? '';
  return reason === '' ? `${String(status)} ${type}` : `${String(status)} ${type}: ${reason}`;
}

/** 생성 시점 본문. 스크립트는 생성 때 돌지 않으므로 여기에 전량이 들어가야 한다. */
function initialDocument(request: UpsertRequest): Record<string, unknown> {
  return { ...request.doc, ...toArrays(request.union), ...request.createOnly };
}

function toArrays(union: UpsertRequest['union']): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(union ?? {})) out[key] = [...value];
  return out;
}

function scriptBody(request: UpsertRequest): Record<string, unknown> {
  return {
    script: {
      lang: 'painless',
      source: CONDITIONAL_UPSERT_SCRIPT,
      params: { doc: request.doc, union: toArrays(request.union) },
    },
    upsert: initialDocument(request),
  };
}

/**
 * 여러 인덱스의 갱신을 **벌크 요청 1건**으로 보낸다 (FR-ING-005 AC-2).
 *
 * 한 이벤트가 PR 문서 1건과 커밋 문서 N건을 만든다. 그것을 N+1번의 왕복으로
 * 보내면 수집 지연(NFR-002)이 문서 수에 비례해 늘어난다.
 */
export async function bulkUpsert(
  client: Client,
  requests: readonly UpsertRequest[],
): Promise<BulkUpsertResult> {
  if (requests.length === 0) return { outcomes: [], hasFailures: false };

  const operations: unknown[] = [];
  for (const request of requests) {
    operations.push({
      update: {
        _index: request.alias,
        _id: request.id,
        routing: request.routing,
        retry_on_conflict: RETRY_ON_CONFLICT,
      },
    });
    operations.push(scriptBody(request));
  }

  const response = await client.bulk({ operations: operations as NonNullable<estypes.BulkRequest['operations']> });
  const items = response.items;

  const outcomes: BulkItemOutcome[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (request === undefined) continue;
    const item = items[index]?.update;
    if (item === undefined) {
      // 응답 항목 수가 요청과 다르다. ES 계약 위반이라 추측하지 않고 재시도한다.
      outcomes.push({ kind: 'retryable', request, status: 0, reason: '벌크 응답에 대응 항목이 없다' });
      continue;
    }
    const status = item.status ?? 0;
    if (item.error === undefined && status < 300) {
      outcomes.push({ kind: 'ok', request, result: item.result ?? 'unknown' });
      continue;
    }
    outcomes.push({
      kind: classifyFailure(status, item.error),
      request,
      status,
      reason: failureReason(status, item.error),
    });
  }

  return { outcomes, hasFailures: outcomes.some((outcome) => outcome.kind !== 'ok') };
}

/**
 * 항목 하나만 다시 보낸다 (FR-ING-005 AC-3의 "개별 재시도").
 *
 * 벌크 전체를 다시 보내면 이미 성공한 항목까지 되돌아간다. 멱등이라 결과는
 * 같지만, 실패한 항목이 무엇인지가 지표에서 사라진다.
 */
export async function upsertOne(client: Client, request: UpsertRequest): Promise<BulkItemOutcome> {
  try {
    const response = await client.update({
      index: request.alias,
      id: request.id,
      routing: request.routing,
      retry_on_conflict: RETRY_ON_CONFLICT,
      ...scriptBody(request),
    } as estypes.UpdateRequest);
    return { kind: 'ok', request, result: String(response.result) };
  } catch (error) {
    const shape = error as { statusCode?: number; body?: { error?: FailureShape } };
    const status = shape.statusCode ?? 0;
    const detail = shape.body?.error;
    return { kind: classifyFailure(status, detail), request, status, reason: failureReason(status, detail) };
  }
}
