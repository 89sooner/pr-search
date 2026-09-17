/**
 * 집계 API 라우트 (WP-037 / API-STAT-001~004, CR-053).
 *
 * ## 네 경로가 같은 순서를 밟는다
 *
 *   세션 → 파라미터 → 접근 범위(한 번) → 질의 준비 → 집계 → 응답
 *
 * `prepareAnalyticsQuery`가 가운데 셋을 맡으므로 여기 남는 것은 **HTTP로
 * 옮기는 일뿐**이다. 네 라우트가 같은 판정을 각자 옮기면 하나만 고쳐지는 날이
 * 온다 — `runAnalytics`가 그 공통을 갖는다.
 *
 * ## 목록과 지연을 나눈다
 *
 * 집계는 검색과 별도 엔드포인트다 (FR-STAT-006 AC-4). 같은 요청에 얹으면
 * 집계 하나가 예산을 넘길 때 목록까지 못 쓰게 된다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { QUERY_KEYS } from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { AccessScopeUnavailableError, PartialSearchError, type NameResolution } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { mergeNumberDisabledFailure, toMergeNumberRangeFailure, toPrNumberRangeFailure, toSequenceFailure } from '../search/routes.js';
import {
  buildDistributionsAggs,
  buildGroupsAggs,
  buildPercentilesAggs,
  buildTimeSeriesAggs,
  toDistributionsOutcome,
  toGroupsOutcome,
  toPercentilesOutcome,
  toTimeSeriesOutcome,
} from './aggregations.js';
import { AggregationTimedOutError, executeAggregation } from './execute.js';
import { prepareAnalyticsQuery, type PrepareOutcome } from './prepare.js';
import {
  ANALYTICS_BUDGET_MS,
  DEFAULT_PERCENTILES,
  DEFAULT_RANGE_DAYS,
  DEFAULT_TIMEZONE,
  GROUP_KEYS,
  MAX_BUCKETS,
  MAX_GROUPS,
  METRIC_KEYS,
  isDimension,
  isGroupKey,
  isInterval,
  isMetricKey,
  isPercentileField,
  type GroupKey,
  type Interval,
  type MetricKey,
} from './types.js';

export const ANALYTICS_BASE = '/api/v1/analytics';

export interface AnalyticsRouteOptions {
  readonly es: Client;
  readonly pool: Pool;
  readonly auth: AuthContext;
  readonly loginPath: string;
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<NameResolution>;
  /**
   * 숫자 그룹 키를 사용자가 읽고 질의에 쓰는 값으로 (PR #76 리뷰 P1).
   *
   * `resolveNames`의 **역방향**이다. 집계는 `org_id`·`author_team_ids`로 묶는데
   * 질의는 이름·slug를 받으므로, 그 숫자를 그대로 근거 질의에 넣으면 눌러도
   * 0건이 나온다.
   */
  readonly resolveGroupDisplay: (input: {
    readonly orgIds: readonly number[];
    readonly teamIds: readonly number[];
  }) => Promise<{ readonly orgs: ReadonlyMap<number, string>; readonly teams: ReadonlyMap<number, string> }>;
  /** M 번호 기능 켜짐 여부 (CR-106). `/search`와 같은 배포 설정을 그대로 받는다. */
  readonly mergeNumberEnabled?: boolean;
}

/**
 * 버킷 키를 표시값으로 옮길 표를 만든다.
 *
 * **숫자 키를 쓰는 두 그룹에만 필요하다.** 나머지는 문서에 있는 값이 곧
 * 사용자가 쓰는 값이라 해석할 것이 없다.
 */
async function displayFor(
  groupBy: GroupKey | null,
  keys: readonly string[],
  options: AnalyticsRouteOptions,
): Promise<ReadonlyMap<string, string> | undefined> {
  if (groupBy !== 'org' && groupBy !== 'team') return undefined;
  const ids = keys.map(Number).filter((one) => Number.isFinite(one));
  if (ids.length === 0) return undefined;

  const resolved = await options.resolveGroupDisplay(
    groupBy === 'org' ? { orgIds: ids, teamIds: [] } : { orgIds: [], teamIds: ids },
  );
  const source = groupBy === 'org' ? resolved.orgs : resolved.teams;
  return new Map([...source].map(([id, name]) => [String(id), name]));
}

function fail(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
  return reply.status(status).send(body);
}

function invalid(
  reply: FastifyReply,
  correlationId: string,
  field: string,
  message: string,
  detail: Readonly<Record<string, unknown>> = {},
): FastifyReply {
  return fail(reply, 400, {
    error: { code: 'INVALID_PARAMETER', message, detail: { field, ...detail } },
    correlation_id: correlationId,
  });
}

/** 요청 본문에서 문자열 하나. 없으면 빈 문자열이다 — 질의는 비어 있어도 성립한다. */
function readString(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  return typeof raw === 'string' ? raw : '';
}

/**
 * 본문의 `seq_epoch`을 `readEpochParam`이 읽는 모양으로 옮긴다.
 *
 * **JSON 본문에서는 숫자가 자연스럽고** API 계약도 숫자로 예시한다. 그런데
 * `readEpochParam`은 쿼리 문자열을 전제로 **문자열만** 받는다 — 파라미터가
 * 배열이 되거나 빈 값으로 오는 경우를 `absent`로 접지 않으려는 방어이며
 * (DEV-363), 그 계약을 넓히면 그 방어가 함께 약해진다. 그래서 여기서 옮긴다.
 *
 * `undefined`·`null`은 그대로 넘긴다 — 그것만이 진짜 `absent`다.
 */
function readEpoch(body: Record<string, unknown>): unknown {
  const raw = body['seq_epoch'];
  return typeof raw === 'number' ? String(raw) : raw;
}

/**
 * 집계 실패를 HTTP로 옮긴다.
 *
 * **부분 샤드 실패는 503이다.** 일부 샤드가 답하지 못한 수를 200으로 내보내면
 * 조사자가 "적게 나온 수"를 사실로 읽는다 (`assertNoShardFailures`).
 */
function toFailure(error: unknown, correlationId: string): { status: number; body: ErrorResponse } | null {
  if (error instanceof AccessScopeUnavailableError) {
    // 볼 수 있는 저장소가 하나도 없다. 0건이 아니라 명시적 실패다 (`/search`와 같다).
    return {
      status: 503,
      body: {
        error: { code: 'PERMISSION_UNAVAILABLE', message: '접근 권한을 확인할 수 없어 집계를 거부한다' },
        correlation_id: correlationId,
      },
    };
  }
  if (error instanceof PartialSearchError) {
    return {
      status: 504,
      body: {
        error: {
          code: 'AGGREGATION_TIMEOUT',
          message: '집계가 부분 결과만 얻어 조회를 거부한다',
          detail: { failed_shards: error.failedShards, total_shards: error.totalShards },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (error instanceof AggregationTimedOutError) {
    /*
     * **200에 붙어 온 `timed_out`도 부분 결과다** (PR #76 리뷰 P1).
     * 샤드 실패가 아니므로 위 갈래가 잡지 못한다.
     */
    return {
      status: 504,
      body: {
        error: {
          code: 'AGGREGATION_TIMEOUT',
          message: '집계가 예산을 넘겨 부분 결과만 얻었다. 기간을 줄이거나 조건을 좁히세요.',
          detail: { budget_ms: ANALYTICS_BUDGET_MS },
        },
        correlation_id: correlationId,
      },
    };
  }
  return null;
}

/** 준비 판정을 HTTP로 옮긴다. `null`이면 계속 진행한다. */
function toPrepareFailure(
  outcome: PrepareOutcome,
  correlationId: string,
): { status: number; body: ErrorResponse } | null {
  if (outcome.kind === 'parse_error') {
    return {
      status: 400,
      body: {
        error: {
          code: outcome.error.code,
          message: outcome.error.message,
          detail: { ...outcome.error.detail, supported_keys: [...QUERY_KEYS] },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'population_empty') {
    /*
     * **0건으로 답하지 않는다** (CR-053, FR-STAT-001 AC-6).
     *
     * 집계 대상은 Pull Request이므로 `kind:commit`은 "결과가 없다"가 아니라
     * 물음 자체가 이 API의 것이 아니다. 조용한 0건은 이 저장소가 거듭 고쳐 온
     * 실패이며(DEV-364) 여기서 되풀이하지 않는다.
     */
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: '집계 대상은 Pull Request입니다. kind: 조건이 PR을 남기지 않습니다.',
          detail: { field: 'query', reason: 'analytics_population_empty' },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'sequence') return toSequenceFailure(outcome.outcome, correlationId);
  /*
   * `pr_number:`·`mnum:` (CR-106). `/search`와 문구·사유 코드를 그대로 공유한다 —
   * 세 API가 같은 파서를 쓰므로 같은 조건에 같은 답을 줘야 한다.
   */
  if (outcome.kind === 'merge_number_disabled') return mergeNumberDisabledFailure(correlationId);
  if (outcome.kind === 'pr_number_binding') return toPrNumberRangeFailure(outcome.binding, correlationId);
  if (outcome.kind === 'merge_number_range') return toMergeNumberRangeFailure(outcome.outcome, correlationId);
  return null;
}

interface Handled {
  readonly correlationId: string;
  readonly prepared: Extract<PrepareOutcome, { kind: 'ready' }>;
}

/**
 * 네 라우트의 공통 앞단.
 *
 * @returns 응답을 이미 보냈으면 `null`. 그렇지 않으면 집계에 쓸 재료다.
 */
async function runCommon(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AnalyticsRouteOptions,
  correlationId: string,
  /**
   * 질의를 덮어쓴다. 시계열이 요청 구간을 **모집단에** 반영할 때 쓴다.
   *
   * `extended_bounds`는 빈 버킷을 더할 뿐 범위 밖 문서를 빼지 않는다 —
   * 그것에 기대면 `applied_range`가 말하는 구간과 `total`이 세는 구간이
   * 어긋난다 (PR #76 리뷰 P1).
   */
  queryOverride?: string,
): Promise<Handled | null> {
  let userId: string;
  try {
    userId = (await authenticateSession(request, options.auth.sessions)).userId;
  } catch (error) {
    const shape = toAuthError(error, { correlationId, loginPath: options.loginPath });
    if (shape !== null) {
      sendAuthError(reply, shape);
      return null;
    }
    throw error;
  }

  const body = (request.body ?? {}) as Record<string, unknown>;

  /*
   * **접근 범위를 한 번만 산출한다** (CR-043, DEV-272). 같은 요청에서 두 번
   * 부르면 그 사이에 회수가 끼어들어 두 값이 어긋날 수 있다.
   */
  const scope = toAccessScope(await options.auth.scopes.resolveCached(userId));

  const prepared = await prepareAnalyticsQuery(
    {
      rawQuery: queryOverride ?? readString(body, 'query'),
      rawEpoch: readEpoch(body),
      scope,
      mergeNumberEnabled: options.mergeNumberEnabled ?? false,
    },
    { pool: options.pool, resolveNames: options.resolveNames },
  );

  const failure = toPrepareFailure(prepared, correlationId);
  if (failure !== null) {
    fail(reply, failure.status, failure.body);
    return null;
  }
  if (prepared.kind !== 'ready') {
    // `sequence`가 `stale`이면 위에서 `null`을 받는다 — 집계를 계산하지 않고
    // 그 사실만 답한다 (FR-STAT-006 AC-6).
    const outcome = prepared.kind === 'sequence' ? prepared.outcome : null;
    if (outcome !== null && outcome.kind === 'stale') {
      reply.send({
        query: readString(body, 'query'),
        sequence_context: outcome.context,
        requested_seq_epoch: outcome.requested,
        epoch_stale: true,
        correlation_id: correlationId,
      });
      return null;
    }
    fail(reply, 500, {
      error: { code: 'INTERNAL_ERROR', message: '집계 준비가 예상하지 못한 상태로 끝났습니다.' },
      correlation_id: correlationId,
    });
    return null;
  }

  return { correlationId, prepared };
}

/**
 * 시계열 버킷 수를 **조회 전에** 센다 (FR-STAT-002 AC-3).
 *
 * 집계를 돌린 뒤 세면 늦다 — Elasticsearch가 자기 `search.max_buckets`로 먼저
 * 거절하고, 그 오류는 우리 사유 코드를 달고 오지 않는다. 실제로 그렇게 만들었을
 * 때 통합 시험이 `error.code`가 비어 있는 400을 받았다. **400이 될 요청으로
 * 검색 클러스터를 부르지 않는다**는 규율이 여기에도 적용된다.
 *
 * `month`는 30일로 어림한다. 경계에서 며칠이 어긋날 수 있으나 상한이 400개이므로
 * 그 차이가 판정을 뒤집으려면 열 달 넘게 요청해야 하고, 그때는 어느 쪽으로 세도
 * 상한을 넘는다.
 */
const INTERVAL_MS: Readonly<Record<Interval, number>> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 30 * 86_400_000,
};

function bucketCount(from: string, to: string, interval: Interval): number {
  const span = Date.parse(to) - Date.parse(from);
  return Math.floor(span / INTERVAL_MS[interval]) + 1;
}

function readGroupBy(body: Record<string, unknown>): GroupKey | null | 'invalid' {
  const raw = body['group_by'];
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw);
  return isGroupKey(value) ? value : 'invalid';
}

export function registerAnalyticsRoutes(app: FastifyInstance, options: AnalyticsRouteOptions): void {
  // -------------------------------------------------------------------------
  // API-STAT-001 그룹 집계
  // -------------------------------------------------------------------------
  app.post(`${ANALYTICS_BASE}/groups`, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    const groupBy = readGroupBy(body);
    if (groupBy === 'invalid' || groupBy === null) {
      return invalid(reply, correlationId, 'group_by', '지원하지 않는 그룹 키입니다.', {
        supported_keys: [...GROUP_KEYS],
      });
    }

    const rawMetrics = Array.isArray(body['metrics']) ? (body['metrics'] as unknown[]) : ['count'];
    const metrics: MetricKey[] = [];
    for (const one of rawMetrics) {
      const value = String(one);
      if (!isMetricKey(value)) {
        return invalid(reply, correlationId, 'metrics', `지원하지 않는 지표입니다: '${value}'`, {
          supported_keys: [...METRIC_KEYS],
        });
      }
      metrics.push(value);
    }

    const size = typeof body['size'] === 'number' ? body['size'] : MAX_GROUPS;
    if (!Number.isInteger(size) || size < 1) {
      return invalid(reply, correlationId, 'size', 'size는 1 이상의 정수여야 합니다.');
    }

    const handled = await runCommon(request, reply, options, correlationId);
    if (handled === null) return reply;

    try {
      const outcome = await executeAggregation(options.es, {
        target: handled.prepared.target,
        scoped: handled.prepared.scoped,
        aggs: buildGroupsAggs(groupBy, metrics, size),
      });
      const rawKeys = (
        (outcome.aggregations['groups'] as { buckets?: readonly { key?: unknown }[] } | undefined)
          ?.buckets ?? []
      ).map((one) => String(one.key));
      const display = await displayFor(groupBy, rawKeys, options);

      const groups = toGroupsOutcome(outcome.aggregations, {
        ast: handled.prepared.ast,
        groupBy,
        metrics,
        ...(display === undefined ? {} : { display }),
      });

      return reply.send({
        query: readString(body, 'query'),
        group_by: groupBy,
        total: outcome.total,
        groups: groups.groups,
        truncated: groups.truncated,
        approximate: outcome.approximate,
        ...(outcome.sampleProbability === undefined
          ? {}
          : { sample_probability: outcome.sampleProbability }),
        unresolved: handled.prepared.unresolved,
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toFailure(error, correlationId);
      if (shape !== null) return fail(reply, shape.status, shape.body);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // API-STAT-002 시계열
  // -------------------------------------------------------------------------
  app.post(`${ANALYTICS_BASE}/time-series`, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    const rawInterval = body['interval'] === undefined ? 'day' : String(body['interval']);
    if (!isInterval(rawInterval)) {
      return invalid(reply, correlationId, 'interval', `지원하지 않는 간격입니다: '${rawInterval}'`);
    }
    const interval: Interval = rawInterval;

    const groupBy = readGroupBy(body);
    if (groupBy === 'invalid') {
      return invalid(reply, correlationId, 'group_by', '지원하지 않는 그룹 키입니다.', {
        supported_keys: [...GROUP_KEYS],
      });
    }

    /*
     * 기간 미지정 시 최근 30일이며 **응답에 적용 구간을 명시한다**
     * (FR-STAT-002 예외/실패 처리). 기본값을 말하지 않으면 사용자가 자기가
     * 묻지 않은 구간의 답을 자기 구간의 답으로 읽는다.
     */
    const now = Date.now();
    const to = typeof body['to'] === 'string' ? body['to'] : new Date(now).toISOString();
    const from =
      typeof body['from'] === 'string'
        ? body['from']
        : new Date(now - DEFAULT_RANGE_DAYS * 86_400_000).toISOString();
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return invalid(reply, correlationId, 'from', '기간은 ISO 8601 시각이어야 합니다.');
    }
    if (Date.parse(from) > Date.parse(to)) {
      return invalid(reply, correlationId, 'from', '기간이 뒤집혔습니다.');
    }

    const timezone = typeof body['timezone'] === 'string' ? body['timezone'] : DEFAULT_TIMEZONE;

    /*
     * **요청 구간을 모집단에 넣는다** (PR #76 리뷰 P1).
     *
     * 질의 문자열에 `merged:` 범위를 더해 파서를 그대로 지나게 한다 — 별도
     * 경로를 만들면 `total`이 세는 것과 버킷이 담는 것이 달라진다. 사용자가
     * 이미 `merged:`를 줬으면 두 범위가 AND로 결합해 교집합이 되며, 그것이
     * "이 구간 안에서"라는 요청의 뜻과 같다.
     */
    const rangeQuery = `${readString(body, 'query')} merged:${from}..${to}`.trim();

    const buckets = bucketCount(from, to, interval);
    if (buckets > MAX_BUCKETS) {
      return fail(reply, 400, {
        error: {
          code: 'TOO_MANY_BUCKETS',
          message: `버킷이 ${String(MAX_BUCKETS)}개를 넘습니다. 간격을 넓히거나 기간을 줄이세요.`,
          detail: { field: 'interval', bucket_count: buckets, max: MAX_BUCKETS },
        },
        correlation_id: correlationId,
      });
    }

    const handled = await runCommon(request, reply, options, correlationId, rangeQuery);
    if (handled === null) return reply;

    try {
      const outcome = await executeAggregation(options.es, {
        target: handled.prepared.target,
        scoped: handled.prepared.scoped,
        aggs: buildTimeSeriesAggs({ interval, timezone, from, to, groupBy }),
      });
      const series = toTimeSeriesOutcome(outcome.aggregations, groupBy);

      return reply.send({
        interval,
        timezone,
        applied_range: { from, to },
        total: outcome.total,
        buckets: series.buckets,
        series: series.series,
        truncated: series.truncated,
        approximate: outcome.approximate,
        ...(outcome.sampleProbability === undefined
          ? {}
          : { sample_probability: outcome.sampleProbability }),
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toFailure(error, correlationId);
      if (shape !== null) return fail(reply, shape.status, shape.body);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // API-STAT-003 백분위
  // -------------------------------------------------------------------------
  app.post(`${ANALYTICS_BASE}/percentiles`, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    const field = body['field'] === undefined ? 'lead_time_seconds' : String(body['field']);
    if (!isPercentileField(field)) {
      return invalid(reply, correlationId, 'field', `지원하지 않는 필드입니다: '${field}'`);
    }

    const percentiles = Array.isArray(body['percentiles'])
      ? (body['percentiles'] as unknown[]).map(Number)
      : [...DEFAULT_PERCENTILES];
    if (percentiles.some((one) => !Number.isFinite(one) || one <= 0 || one >= 100)) {
      return invalid(reply, correlationId, 'percentiles', '백분위는 0과 100 사이의 수여야 합니다.');
    }

    const groupBy = readGroupBy(body);
    if (groupBy === 'invalid') {
      return invalid(reply, correlationId, 'group_by', '지원하지 않는 그룹 키입니다.', {
        supported_keys: [...GROUP_KEYS],
      });
    }

    /*
     * **리드타임은 머지된 PR로 한정한다** (FR-STAT-003 AC-2, PR #76 리뷰 P1).
     *
     * 모집단을 좁히지 않으면 열린 PR이 `total`에 들어가고, 그 문서에는
     * `lead_time_seconds`가 없으므로 **제외 건수로 세어져 `no_review`로
     * 잘못 분류된다** — 리뷰가 없어서가 아니라 아직 머지되지 않은 것이다.
     *
     * `first_review_wait_seconds`는 머지 여부와 무관하다 (FR-STAT-004).
     */
    const populationQuery =
      field === 'lead_time_seconds'
        ? `${readString(body, 'query')} is:merged`.trim()
        : undefined;

    const handled = await runCommon(request, reply, options, correlationId, populationQuery);
    if (handled === null) return reply;

    try {
      const outcome = await executeAggregation(options.es, {
        target: handled.prepared.target,
        scoped: handled.prepared.scoped,
        aggs: buildPercentilesAggs({ field, percentiles, groupBy }),
      });
      const result = toPercentilesOutcome(outcome.aggregations, {
        percentiles,
        groupBy,
        total: outcome.total.value,
        field,
      });

      /*
       * **`low_sample`이면 백분위 대신 원값을 낸다** (FR-STAT-003 예외/실패 처리,
       * PR #76 리뷰 P2). 둘을 함께 실으면 화면이 흔들리는 백분위를 그릴 여지가
       * 남는다 — 계약의 낱말이 "대신"이다.
       */
      const shape = (row: (typeof result.groups)[number] | typeof result.overall) => ({
        ...(row.low_sample ? { raw_values: row.raw_values ?? [] } : row.values),
        sample_size: row.sample_size,
        low_sample: row.low_sample,
      });

      return reply.send({
        field,
        unit: 'seconds',
        ...shape(result.overall),
        overall: result.overall.low_sample ? undefined : result.overall.values,
        groups: result.groups.map((row) => ({ key: row.key, ...shape(row) })),
        excluded_count: result.excludedCount,
        excluded_reasons: result.excludedReasons,
        total: outcome.total,
        approximate: outcome.approximate,
        ...(outcome.sampleProbability === undefined
          ? {}
          : { sample_probability: outcome.sampleProbability }),
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toFailure(error, correlationId);
      if (shape !== null) return fail(reply, shape.status, shape.body);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // API-STAT-004 분포
  // -------------------------------------------------------------------------
  app.post(`${ANALYTICS_BASE}/distributions`, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    const dimension = body['dimension'] === undefined ? 'changed_files' : String(body['dimension']);
    if (!isDimension(dimension)) {
      return invalid(reply, correlationId, 'dimension', `지원하지 않는 축입니다: '${dimension}'`);
    }

    const handled = await runCommon(request, reply, options, correlationId);
    if (handled === null) return reply;

    try {
      const outcome = await executeAggregation(options.es, {
        target: handled.prepared.target,
        scoped: handled.prepared.scoped,
        aggs: buildDistributionsAggs(dimension),
      });
      const buckets = toDistributionsOutcome(outcome.aggregations, {
        ast: handled.prepared.ast,
        dimension,
        total: outcome.total.value,
      });

      return reply.send({
        dimension,
        total: outcome.total,
        buckets,
        approximate: outcome.approximate,
        ...(outcome.sampleProbability === undefined
          ? {}
          : { sample_probability: outcome.sampleProbability }),
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toFailure(error, correlationId);
      if (shape !== null) return fail(reply, shape.status, shape.body);
      throw error;
    }
  });
}
