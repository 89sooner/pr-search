/**
 * Operations Plane 라우트 (API-GH-001·002·003·005·007·010·011, CR-086 / WP-077).
 *
 * 전부 **세션 인증** 뒤에 있다 — 관리자 토큰 우회는 없다(`security_officer`·`operator`
 * 역할은 세션에만 있다). 경로는 `/api/v1/gh/…`이며 `web`의 프록시가 `/api/gh/…`로 연다.
 *
 * | 경로 | 계약 | 비고 |
 * | --- | --- | --- |
 * | `GET /gh/capabilities` | API-GH-001 | 전 command와 실행 차원. 숨기지 않는다 |
 * | `GET /gh/contexts/repositories` | API-GH-003 | 등록·활성 ∩ 접근 범위 |
 * | `GET/POST/DELETE /gh/identity` | API-GH-007 | 상태·인가 시작·철회 |
 * | `POST /gh/identity/callback` | API-GH-007 (CR-086 추가) | 콜백의 code·state를 받아 연결을 만든다 |
 * | `POST /gh/executions/preview` | API-GH-002 (CR-086 추가) | 실행과 같은 준비 단계. 큐에 넣지 않는다 |
 * | `POST /gh/executions` | API-GH-002 | `Idempotency-Key` 헤더 필수 |
 * | `GET /gh/executions` | API-GH-010 | 본인 이력. `all=true`는 `security_officer`만 |
 * | `GET /gh/executions/{id}` | API-GH-010 (CR-086 추가) | 상세 |
 * | `GET /gh/executions/{id}/stream` | API-GH-005 | SSE. 상태 변화와 종료를 흘린다 |
 * | `POST /gh/executions/{id}/cancel` | API-GH-011 | 소유자 또는 `operator` |
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_HTTP_STATUS, type ErrorResponse } from '@prs/contracts';
import { ghExecutionRepo } from '@prs/db';
import { GH_PINNED_VERSION, isTerminalExecutionState } from '@prs/gh-cli';
import type { AuthContext } from '../auth/context.js';
import { hasRole } from '@prs/authz';
import { authenticateSession, requireAnyRole, type SessionPrincipal } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { commandDetail, registryStatus } from './registry.js';
import {
  GhRejected,
  findVisibleExecution,
  listVisibleExecutions,
  listVisibleRepositories,
  parseIdempotencyKey,
  parseInvocationBody,
  prepare,
  requestExecution,
  toExecutionView,
  toPreview,
  type ExecutionDeps,
} from './executions.js';
import { IdentityError, completeAuthorization, disconnect, readStatus, startAuthorization } from './identity.js';

export const GH_CAPABILITIES_PATH = '/api/v1/gh/capabilities';
export const GH_CONTEXT_REPOSITORIES_PATH = '/api/v1/gh/contexts/repositories';
export const GH_IDENTITY_PATH = '/api/v1/gh/identity';
export const GH_IDENTITY_CALLBACK_PATH = '/api/v1/gh/identity/callback';
export const GH_EXECUTIONS_PATH = '/api/v1/gh/executions';
export const GH_EXECUTION_PREVIEW_PATH = '/api/v1/gh/executions/preview';
/** API-GH-013 — 레지스트리 상태 (A-006). `operator`·`security_officer`. */
export const GH_REGISTRY_PATH = '/api/v1/gh/registry';
/** API-GH-014 — command 분류 상세 (A-006). 같은 역할. */
export const GH_REGISTRY_COMMAND_PATH = '/api/v1/gh/registry/commands/:id';
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,79}$/;

export interface GhRouteOptions extends ExecutionDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
  /** SSE 폴링 간격. 시험이 줄인다. */
  readonly streamPollMs?: number;
}

function fail(reply: FastifyReply, code: ErrorResponse['error']['code'], message: string, correlationId: string, detail?: Readonly<Record<string, unknown>>): FastifyReply {
  const body: ErrorResponse = detail === undefined
    ? { error: { code, message }, correlation_id: correlationId }
    : { error: { code, message, detail }, correlation_id: correlationId };
  return reply.status(ERROR_HTTP_STATUS[code]).send(body);
}

function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,18}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function registerGhRoutes(app: FastifyInstance, options: GhRouteOptions): void {
  const { auth, loginPath } = options;
  const deps: ExecutionDeps = options;

  const session = async (request: FastifyRequest, reply: FastifyReply, correlationId: string): Promise<SessionPrincipal | null> => {
    try {
      return await authenticateSession(request, auth.sessions);
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) {
        await sendAuthError(reply, shape);
        return null;
      }
      throw error;
    }
  };

  const rejected = (reply: FastifyReply, error: unknown, correlationId: string): FastifyReply | null => {
    if (error instanceof GhRejected) return fail(reply, error.code, error.message, correlationId, error.detail);
    if (error instanceof IdentityError) {
      if (error.code === 'misconfigured') return fail(reply, 'INTERNAL_ERROR', 'Operations App이 구성되지 않았다', correlationId);
      return fail(reply, 'GH_IDENTITY_REQUIRED', error.message, correlationId, { reason: error.code });
    }
    return null;
  };

  // API-GH-001 — manifest 전체. 미지원·미구현도 사유와 함께 (FR-GH-001 AC-6).
  app.get(GH_CAPABILITIES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const manifest = deps.manifest;
    return reply.send({
      gh_version: GH_PINNED_VERSION,
      manifest_version: manifest.manifestVersion,
      manifest_hash: manifest.hash,
      generated_at: manifest.generatedAt,
      coverage: manifest.coverage,
      capabilities: manifest.capabilities.map((capability) => {
        // 결과의 뜻은 분류의 결과 계약이 정본이다 — 실행 정의에는 구현한 adapter만 있다 (CR-089).
        const contract = manifest.commands.find((command) => command.id === capability.id)?.classification?.result ?? null;
        return {
          id: capability.id,
          path: capability.path,
          title: capability.title,
          risk: capability.risk,
          support: capability.support,
          execution: capability.execution,
          interaction: capability.interaction,
          required_permissions: capability.requiredPermissions,
          options: capability.options,
          constraints: capability.constraints,
          result_adapter: capability.resultAdapter,
          result_contract:
            contract === null
              ? null
              : { kind: contract.kind, sensitivity: contract.sensitivity, composability: contract.composability, bindable: contract.bindable, resource_kind: contract.resourceKind },
          timeout_ms: capability.timeoutMs,
        };
      }),
      commands: manifest.commands
        .filter((command) => !command.group)
        .map((command) => ({
          id: command.id,
          path: command.path,
          summary: command.summary,
          section: command.section,
          alias_of: command.aliasOf,
          support: command.support,
          execution: command.execution,
          execution_reason: command.executionReason,
          risk: command.risk,
          help_status: command.helpStatus,
          // 분류 요약 (CR-088). 전부는 API-GH-014가 낸다 — 이 목록은 W-010이 매번 읽으므로 가볍게 둔다.
          interaction: command.classification?.interaction ?? null,
          side_effect: command.classification?.sideEffect ?? null,
          host_support: command.classification?.hostSupport ?? null,
          // 결과 계약 요약 하나 (CR-089). port·간선은 API-GH-014만 낸다.
          composability: command.classification?.result?.composability ?? null,
        })),
      correlation_id: correlationId,
    });
  });

  /*
   * A-006 레지스트리 조회 (API-GH-013·014, CR-088). `operator` 또는 `security_officer`만 — 운영 화면이며
   * 검증 기록에는 실행기 호스트명·바이너리 경로가 있다. **검사를 돌리지 않는다** — 저장된 기록을 읽는다.
   * 역할 판정은 세션 위에서 `requireAnyRole`로 한다(CR-052의 규율 — 둘 중 하나를 빠뜨리면 조용히 좁게 답한다).
   */
  const registryAccess = async (request: FastifyRequest, reply: FastifyReply, correlationId: string): Promise<SessionPrincipal | null> => {
    const principal = await session(request, reply, correlationId);
    if (principal === null) return null;
    try {
      requireAnyRole(principal, ['operator', 'security_officer']);
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) {
        await sendAuthError(reply, shape);
        return null;
      }
      throw error;
    }
    return principal;
  };

  app.get(GH_REGISTRY_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await registryAccess(request, reply, correlationId);
    if (principal === null) return reply;
    const body = await registryStatus(deps.pool, deps.manifest);
    return reply.send({ ...body, correlation_id: correlationId });
  });

  app.get(GH_REGISTRY_COMMAND_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await registryAccess(request, reply, correlationId);
    if (principal === null) return reply;
    const id = (request.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !CAPABILITY_ID_PATTERN.test(id)) return fail(reply, 'INVALID_PARAMETER', 'capability id 형식이 아니다', correlationId);
    const detail = commandDetail(deps.manifest, id);
    if (detail === null) return fail(reply, 'GH_CAPABILITY_UNKNOWN', `manifest에 없는 capability: ${id}`, correlationId);
    return reply.send({ ...detail, correlation_id: correlationId });
  });

  // API-GH-003 — 고를 수 있는 저장소.
  app.get(GH_CONTEXT_REPOSITORIES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    try {
      const scope = await deps.scopes.resolveCached(principal.userId);
      const items = await listVisibleRepositories(deps.pool, scope);
      return reply.send({
        host: deps.config.host,
        items: items.map((item) => ({ repository_id: item.repositoryId, repository: item.slug, visibility: item.visibility })),
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) return sendAuthError(reply, shape);
      throw error;
    }
  });

  // API-GH-007 — 연결 상태.
  app.get(GH_IDENTITY_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const status = await readStatus(deps.identity, principal.userId);
    const connection = status.connection;
    return reply.send({
      status: status.status,
      host: deps.config.host,
      github_login: connection?.github_login ?? null,
      github_user_id: connection?.github_user_id ?? null,
      connected_at: connection?.connected_at.toISOString() ?? null,
      expires_at: connection?.expires_at?.toISOString() ?? null,
      revoked_at: connection?.revoked_at?.toISOString() ?? null,
      scopes: connection?.scopes ?? [],
      correlation_id: correlationId,
    });
  });

  // API-GH-007 — 인가 시작. 브라우저가 authorize_url로 간다.
  app.post(GH_IDENTITY_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const returnTo = typeof body['return_to'] === 'string' ? body['return_to'] : undefined;
    try {
      const started = await startAuthorization(deps.identity, principal.userId, returnTo, correlationId);
      return reply.status(201).send({ authorize_url: started.authorizeUrl, state: started.state, correlation_id: correlationId });
    } catch (error) {
      const shaped = rejected(reply, error, correlationId);
      if (shaped !== null) return shaped;
      throw error;
    }
  });

  // API-GH-007 (CR-086) — 콜백. `web`의 라우트가 code·state를 본문으로 넘긴다.
  app.post(GH_IDENTITY_CALLBACK_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = body['code'];
    const state = body['state'];
    if (typeof code !== 'string' || code === '' || typeof state !== 'string' || state === '') {
      return fail(reply, 'INVALID_PARAMETER', 'code와 state가 필요하다', correlationId);
    }
    try {
      const outcome = await completeAuthorization(deps.identity, principal.userId, code, state);
      return reply.send({
        status: 'connected',
        github_login: outcome.connection.github_login,
        return_to: outcome.returnTo,
        correlation_id: correlationId,
      });
    } catch (error) {
      if (error instanceof IdentityError) {
        // 어느 단계에서 실패했는지 자세히 말하지 않는다 (CR-083의 규율). 로그에는 남긴다.
        deps.log?.({ level: 'warn', message: 'Operations App 인가 콜백 실패', correlation_id: correlationId, reason: error.code });
        return fail(reply, 'GH_IDENTITY_REQUIRED', 'GitHub 계정 연결에 실패했다', correlationId, { reason: error.code });
      }
      throw error;
    }
  });

  // API-GH-007 — 철회.
  app.delete(GH_IDENTITY_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const revoked = await disconnect(deps.identity, principal.userId, 'user_disconnect');
    return reply.send({ status: revoked === null ? 'not_connected' : 'revoked', correlation_id: correlationId });
  });

  // API-GH-002 (CR-086) — 미리보기. 실행과 같은 준비 단계를 지나되 큐에 넣지 않는다.
  app.post(GH_EXECUTION_PREVIEW_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    try {
      const invocation = parseInvocationBody(request.body);
      const prepared = await prepare(deps, principal, invocation);
      return reply.send({ ...toPreview(deps, prepared), correlation_id: correlationId });
    } catch (error) {
      const shaped = rejected(reply, error, correlationId);
      if (shaped !== null) return shaped;
      throw error;
    }
  });

  // API-GH-002 — 실행 요청.
  app.post(GH_EXECUTIONS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const key = parseIdempotencyKey(request.headers['idempotency-key'] ?? body['idempotency_key']);
      const invocation = parseInvocationBody(request.body);
      const row = await requestExecution(deps, principal, invocation, key, correlationId);
      return reply.status(202).send({ ...toExecutionView(row), correlation_id: correlationId });
    } catch (error) {
      const shaped = rejected(reply, error, correlationId);
      if (shaped !== null) return shaped;
      throw error;
    }
  });

  // API-GH-010 — 이력.
  app.get(GH_EXECUTIONS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limitRaw = query['limit'];
    const limit = typeof limitRaw === 'string' && /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : ghExecutionRepo.EXECUTION_LIST_DEFAULT_LIMIT;
    if (limit < 1 || limit > ghExecutionRepo.EXECUTION_LIST_MAX_LIMIT) return fail(reply, 'INVALID_PARAMETER', `limit은 1..${String(ghExecutionRepo.EXECUTION_LIST_MAX_LIMIT)}이다`, correlationId, { field: 'limit' });
    const beforeId = query['before'] === undefined ? undefined : parseId(query['before']);
    if (beforeId === null) return fail(reply, 'INVALID_PARAMETER', 'before가 실행 ID가 아니다', correlationId, { field: 'before' });
    const all = query['all'] === 'true';
    if (all && !hasRole(principal.roles, 'security_officer')) {
      return fail(reply, 'FORBIDDEN_ROLE', "'security_officer' 역할이 필요하다", correlationId, { required_role: 'security_officer' });
    }
    const rows = await listVisibleExecutions(deps, principal, { all, limit, ...(beforeId === undefined ? {} : { beforeId }) });
    return reply.send({ items: rows.map(toExecutionView), next_before: rows.length === limit ? (rows[rows.length - 1]?.execution_id ?? null) : null, correlation_id: correlationId });
  });

  // API-GH-010 (CR-086) — 상세.
  app.get(`${GH_EXECUTIONS_PATH}/:id`, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const id = parseId((request.params as { id?: string }).id);
    if (id === null) return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);
    const row = await findVisibleExecution(deps, principal, id);
    if (row === null) return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);
    return reply.send({ ...toExecutionView(row), correlation_id: correlationId });
  });

  // API-GH-005 — SSE. 상태가 바뀔 때 `state` 이벤트, 종료면 `done`. 접속이 끊겨도 실행은 계속된다.
  app.get(`${GH_EXECUTIONS_PATH}/:id/stream`, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const id = parseId((request.params as { id?: string }).id);
    if (id === null) return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);
    const first = await findVisibleExecution(deps, principal, id);
    if (first === null) return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-correlation-id': correlationId,
    });
    const write = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let lastState = '';
    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });
    const pollMs = options.streamPollMs ?? 1_000;
    try {
      // 상한: 실행 시간 상한 + 여유. 그 뒤에도 안 끝났으면 클라이언트가 다시 붙는다.
      const deadline = Date.now() + 5 * 60 * 1000;
      let row = first;
      while (!closed && Date.now() < deadline) {
        if (row.state !== lastState) {
          lastState = row.state;
          write('state', toExecutionView(row));
        }
        if (isTerminalExecutionState(row.state)) {
          write('done', { execution_id: row.execution_id, state: row.state });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        const next = await ghExecutionRepo.findById(deps.pool, id);
        if (next === null) break;
        row = next;
      }
    } finally {
      if (!closed) reply.raw.end();
    }
    return reply;
  });

  // API-GH-011 — 취소. 소유자 또는 operator.
  app.post(`${GH_EXECUTIONS_PATH}/:id/cancel`, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await session(request, reply, correlationId);
    if (principal === null) return reply;
    const id = parseId((request.params as { id?: string }).id);
    if (id === null) return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);
    const row = await ghExecutionRepo.findById(deps.pool, id);
    if (row === null || (row.user_id !== principal.userId && !hasRole(principal.roles, 'operator') && !hasRole(principal.roles, 'security_officer'))) {
      return fail(reply, 'NOT_FOUND', '실행을 찾을 수 없다', correlationId);
    }
    const updated = await ghExecutionRepo.requestCancel(deps.pool, id, principal.userId);
    // 이미 끝났으면 그대로 답한다 — 취소는 멱등이다.
    return reply.status(202).send({ ...toExecutionView(updated ?? row), correlation_id: correlationId });
  });
}
