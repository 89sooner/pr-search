/**
 * PIPE 연동 private 경로 (CR-112 / API-INT-001~014, 공통 계약 3.2·6장).
 *
 * ## 요청 한 건의 순서
 *
 * 1. `onRequest` — 서버 correlation ID를 만들고, **실제 TLS 상태**로 client를 정하고, 쿠키를 거절하고,
 *    client·인증서의 긴급 회수를 본다. 여기서 떨어지면 라우팅 결과(404 포함)를 알려 주지 않는다.
 * 2. `preHandler`(grant 경로만) — Bearer grant를 해시로 찾아 발급 자격·회수·binding·만료를 판정한다.
 * 3. handler — query·경로 파라미터를 엄격하게 해석한 뒤 **기존 조회 실행 함수**를 그대로 부른다.
 *    주체와 접근 범위(사용자 범위 ∩ client 허용 목록)만 연동 값이다.
 * 4. `onSend` — 모든 응답에 `Cache-Control: private, no-store`. `Set-Cookie`를 지운다.
 * 5. `onResponse` — 행위 주체를 이벤트로 남긴다 (조회 감사는 기존 기록기가 이미 남겼다).
 *
 * 일반 앱(`buildServer`)에는 이 파일의 어떤 경로도 등록되지 않는다. 일반 `/api/v1/*`는 grant를 읽지
 * 않는다 — 두 자격은 서로를 대신하지 못한다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ScopeUnavailableError, type AccessScopeResolver } from '@prs/authz';
import { AccessScopeUnavailableError } from '@prs/es';
import { authRepo, pipeIntegrationRepo, type GrantLookupRow, type IntegrationEventType, type Pool } from '@prs/db';
import { executeSearch, type SearchExecution } from '../../search/routes.js';
import {
  executeCommitDetail,
  executePullRequestDetail,
  executeResolve,
  type ResolveExecution,
} from '../../resolve/routes.js';
import { executeRepositories, type RepositoriesExecution } from '../../repositories/routes.js';
import { executeSource, type SourceExecution, type SourceOperation } from '../../source/routes.js';
import { executeMergeNumberResolve, type MergeNumberResolveExecution } from '../../sequence/routes.js';
import type { ReadInvocation } from '../../auth/read-invocation.js';
import { verifyAssertion } from './assertion.js';
import { integrationRequestTotal, recordIntegrationEvent, safeTarget, upstreamCorrelationId } from './audit.js';
import type { PipeClientPolicy } from './config.js';
import { PROTOCOL_VERSION, PsiError, psiErrorBody, type PsiErrorCode } from './errors.js';
import { evaluateGrant, grantExpiry, grantTokenDigest, mintGrantToken, readBearerGrant } from './grant-store.js';
import { resolveCanonicalIdentity, type GheUserDirectory } from './identity-binding.js';
import {
  BASE_CAPABILITIES,
  INTEGRATION_OPERATIONS,
  INTEGRATION_PREFIX,
  MERGE_NUMBER_CAPABILITY,
  operationById,
  type IntegrationOperation,
} from './operations.js';
import { parseStrictQuery, strictPlainParam, strictRepositoryParam } from './query.js';
import { integrationInvocation, resolveEffectiveScope } from './read-context.js';
import { consumeAssertion, type ReplayRedis } from './replay-store.js';
import { authenticateTransport, type VerifiedTransport } from './transport-auth.js';

export interface IntegrationExecutions {
  readonly search: SearchExecution;
  readonly resolve: ResolveExecution;
  readonly repositories: RepositoriesExecution;
  readonly source: SourceExecution;
  readonly mergeNumbers: MergeNumberResolveExecution;
}

export interface IntegrationRouteDeps {
  readonly clients: readonly PipeClientPolicy[];
  readonly gheHost: string;
  readonly pool: Pool;
  readonly replay: ReplayRedis;
  readonly directory: GheUserDirectory;
  readonly scopes: Pick<AccessScopeResolver, 'resolveCached'>;
  readonly executions: IntegrationExecutions;
  readonly now?: () => number;
  readonly log?: (entry: { readonly level: string; readonly message: string; readonly correlation_id?: string }) => void;
}

/** 요청 한 건의 서버 내부 상태. 네트워크 입력으로 만들지 않는다. */
interface RequestState {
  readonly correlationId: string;
  readonly upstreamCorrelationId: string | null;
  readonly operation: IntegrationOperation | null;
  transport: VerifiedTransport | null;
  grant: GrantLookupRow | null;
  /** 연동 고유 거절이면 참 — 인증·자격 단계에서 떨어졌다. */
  rejected: boolean;
  /** 거절 사유 코드. 이벤트에만 남기고 응답에 싣지 않는다. */
  reason: string | null;
  resultCode: string | null;
  target: string | null;
  /** 발급·문맥 회수가 정한 신원 (grant가 아직 없을 때의 이벤트용). */
  subjectRef: { issuer: string; subject: string; authContextId: string } | null;
  issuedGrant: { grantId: string; prsUserId: string; bindingVersion: number } | null;
  /** 개별 회수가 이번에 바꾼 grant (이벤트용). 응답에는 싣지 않는다. */
  revokedGrantId: string | null;
}

const STATE = new WeakMap<FastifyRequest, RequestState>();

function operationOf(request: FastifyRequest): IntegrationOperation | null {
  const url = request.routeOptions.url;
  if (url === undefined) return null;
  return (
    INTEGRATION_OPERATIONS.find(
      (operation) => `${INTEGRATION_PREFIX}${operation.path}` === url && operation.method === request.method,
    ) ?? null
  );
}

function stateOf(request: FastifyRequest): RequestState {
  const state = STATE.get(request);
  if (state === undefined) throw new Error('연동 요청 상태가 없다 — onRequest를 지나지 않은 요청이다');
  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{ "assertion": "<JWS>" }` 정확히 그 모양만 받는다. */
function assertionFromBody(body: unknown): string {
  if (!isRecord(body)) throw new PsiError('INVALID_REQUEST', 'body_not_object');
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'assertion' || typeof body['assertion'] !== 'string') {
    throw new PsiError('INVALID_REQUEST', 'body_shape');
  }
  return body['assertion'];
}

/** 응답의 결과 코드 — 이벤트·지표용. 원본 오류 본문이면 그 코드를 쓴다. */
function resultCodeOf(status: number, payload: unknown): string {
  if (status < 400) return 'ok';
  if (typeof payload === 'string' && payload.length <= 65_536) {
    try {
      const parsed = JSON.parse(payload) as { error?: { code?: unknown } };
      const code = parsed.error?.code;
      if (typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code)) return code;
    } catch {
      // 원본이 JSON이 아닌 오류를 냈다 — 상태 코드만 남긴다.
    }
  }
  return `HTTP_${String(status)}`;
}

function eventTypeOf(state: RequestState, status: number): IntegrationEventType {
  const id = state.operation?.id ?? null;
  if (id === 'auth.exchange') return status === 200 ? 'grant.issue' : 'grant.reject';
  if (id === 'auth.revoke') return status === 200 ? 'grant.revoke' : 'grant.reject';
  if (id === 'auth.revoke_context') return status === 200 ? 'context.revoke' : 'context.reject';
  if (id === 'context') return status === 200 ? 'context.view' : 'read.reject';
  if (id === null || state.rejected) return 'read.reject';
  return 'read';
}

/** 오류를 연동 봉투로. 알 수 없는 오류의 메시지는 응답에도 로그에도 싣지 않는다. */
function toPsiError(error: unknown): PsiError {
  if (error instanceof PsiError) return error;
  if (error instanceof ScopeUnavailableError || error instanceof AccessScopeUnavailableError) {
    return new PsiError('PERMISSION_UNAVAILABLE', 'scope_unavailable');
  }
  const fields = isRecord(error) ? error : {};
  const code = typeof fields['code'] === 'string' ? fields['code'] : '';
  const statusCode = typeof fields['statusCode'] === 'number' ? fields['statusCode'] : 0;
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new PsiError('PAYLOAD_TOO_LARGE', 'body_too_large');
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return new PsiError('UNSUPPORTED_MEDIA_TYPE', 'media_type');
  if (statusCode >= 400 && statusCode < 500) return new PsiError('INVALID_REQUEST', code === '' ? 'client_error' : code.toLowerCase().slice(0, 48));
  return new PsiError('INTERNAL_ERROR', 'unexpected');
}

/** 연동 고유 거절(인증·자격)인가. 원본 조회의 오류와 이벤트 종류를 가른다. */
const REJECTION_CODES: ReadonlySet<PsiErrorCode> = new Set<PsiErrorCode>([
  'CLIENT_AUTH_FAILED',
  'ASSERTION_INVALID',
  'ASSERTION_REPLAYED',
  'IDENTITY_BINDING_REQUIRED',
  'IDENTITY_BINDING_CONFLICT',
  'IDENTITY_DISABLED',
  'GRANT_EXPIRED',
  'GRANT_INVALID',
  'GRANT_REVOKED',
  'CONTEXT_REVOKED',
  'GRANT_BINDING_MISMATCH',
  'CLIENT_DISABLED',
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'NOT_FOUND',
  'OPERATION_NOT_ALLOWED',
]);

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: IntegrationRouteDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  const capabilities = [
    ...BASE_CAPABILITIES,
    ...(deps.executions.mergeNumbers.mergeNumberEnabled ? [MERGE_NUMBER_CAPABILITY] : []),
  ];
  const readOperations = INTEGRATION_OPERATIONS.filter(
    (operation) =>
      operation.id.startsWith('read.') &&
      // M 번호가 꺼진 배포에서는 경로가 있어도 원본처럼 404(`feature_disabled`)뿐이다 — 능력 목록과 같이 뺀다 (D-07).
      (operation.id !== 'read.merge_numbers.resolve' || deps.executions.mergeNumbers.mergeNumberEnabled),
  ).map((operation) => operation.id);

  // ------------------------------------------------------------ 1. 전송 인증
  app.addHook('onRequest', async (request) => {
    const state: RequestState = {
      correlationId: randomUUID(),
      upstreamCorrelationId: upstreamCorrelationId(request.headers['x-correlation-id']),
      operation: operationOf(request),
      transport: null,
      grant: null,
      rejected: false,
      reason: null,
      resultCode: null,
      target: null,
      subjectRef: null,
      issuedGrant: null,
      revokedGrantId: null,
    };
    STATE.set(request, state);

    state.transport = authenticateTransport(request.raw.socket, deps.clients);
    // 브라우저 쿠키는 이 경로의 자격이 아니다. BFF가 실수로 넘기면 조용히 무시하지 않고 거절한다.
    if (request.headers.cookie !== undefined) throw new PsiError('INVALID_REQUEST', 'cookie_not_accepted');
    if (state.transport.client.status !== 'active') throw new PsiError('CLIENT_DISABLED', 'client_disabled_in_config');

    let revoked: boolean;
    try {
      revoked = await pipeIntegrationRepo.isCredentialRevoked(deps.pool, {
        clientId: state.transport.client.clientId,
        kid: null,
        certificateSha256: state.transport.certificateSha256,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'revocation_store_unavailable');
    }
    if (revoked) throw new PsiError('CLIENT_DISABLED', 'credential_revoked');
  });

  // ------------------------------------------------------------ 4·5. 응답 머리글과 기록
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.removeHeader('set-cookie');
    const state = STATE.get(request);
    if (state !== undefined) {
      reply.header('x-correlation-id', state.correlationId);
      state.resultCode ??= resultCodeOf(reply.statusCode, payload);
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const state = STATE.get(request);
    if (state === undefined) return;
    const resultCode = state.resultCode ?? `HTTP_${String(reply.statusCode)}`;
    integrationRequestTotal.inc({ operation: state.operation?.id ?? 'unknown', outcome: resultCode });
    const grant = state.grant;
    await recordIntegrationEvent(
      deps.pool,
      {
        eventType: eventTypeOf(state, reply.statusCode),
        resultCode,
        httpStatus: reply.statusCode,
        clientId: state.transport?.client.clientId ?? null,
        issuer: grant?.issuer ?? state.subjectRef?.issuer ?? null,
        subject: grant?.subject ?? state.subjectRef?.subject ?? null,
        authContextId: grant?.auth_context_id ?? state.subjectRef?.authContextId ?? null,
        prsUserId: grant?.prs_user_id ?? state.issuedGrant?.prsUserId ?? null,
        grantId: grant?.grant_id ?? state.issuedGrant?.grantId ?? state.revokedGrantId,
        operation: state.operation?.id ?? null,
        target: state.target,
        bindingVersion: grant?.binding_version ?? state.issuedGrant?.bindingVersion ?? null,
        clientPolicyVersion: state.transport?.client.policyVersion ?? null,
        correlationId: state.correlationId,
        upstreamCorrelationId: state.upstreamCorrelationId,
        detail: state.reason === null ? {} : { reason: state.reason },
      },
      deps.log,
    );
  });

  app.setErrorHandler(async (error, request, reply) => {
    const state = STATE.get(request);
    const psi = toPsiError(error);
    if (psi.code === 'INTERNAL_ERROR') {
      // 원인 메시지에는 GHE 응답·SQL 조각이 섞일 수 있다. 이름만 남긴다.
      deps.log?.({
        level: 'error',
        message: `PIPE 연동 요청 처리 중 예기치 못한 오류 (${error instanceof Error ? error.name : typeof error})`,
        ...(state === undefined ? {} : { correlation_id: state.correlationId }),
      });
    }
    if (state !== undefined) {
      state.reason = psi.reason;
      state.resultCode = psi.code;
      state.rejected = REJECTION_CODES.has(psi.code);
    }
    return reply.status(psi.status).send(psiErrorBody(psi.code, state?.correlationId ?? randomUUID()));
  });

  app.setNotFoundHandler(async (request, reply) => {
    const state = STATE.get(request);
    if (state !== undefined) {
      state.reason = 'route_not_registered';
      state.resultCode = 'NOT_FOUND';
      state.rejected = true;
    }
    return reply.status(404).send(psiErrorBody('NOT_FOUND', state?.correlationId ?? randomUUID()));
  });

  // ------------------------------------------------------------ 2. grant 검사
  const grantGuard = async (request: FastifyRequest): Promise<void> => {
    const state = stateOf(request);
    const transport = state.transport;
    if (transport === null) throw new PsiError('CLIENT_AUTH_FAILED', 'transport_missing');
    const token = readBearerGrant(request.headers.authorization);
    if (token === null) throw new PsiError('GRANT_INVALID', 'bearer_missing_or_malformed');
    let row: GrantLookupRow | null;
    try {
      row = await pipeIntegrationRepo.lookupGrant(deps.pool, grantTokenDigest(token));
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'grant_store_unavailable');
    }
    const decision = evaluateGrant(row, { transport, nowMs: now() });
    // 거절이어도 식별 가능한 grant는 이벤트에 남긴다 — 다른 client의 grant는 남기지 않는다.
    if (decision.grant !== null && decision.grant.client_id === transport.client.clientId) state.grant = decision.grant;
    if (!decision.ok) throw new PsiError(decision.code, decision.reason);
    state.grant = decision.grant;
  };

  const invocationFor = (request: FastifyRequest): ReadInvocation => {
    const state = stateOf(request);
    if (state.grant === null || state.transport === null) throw new Error('grant 검사를 지나지 않은 조회다');
    return integrationInvocation(
      { correlationId: state.correlationId, prsUserId: state.grant.prs_user_id, client: state.transport.client },
      { scopes: deps.scopes, pool: deps.pool },
    );
  };

  // ------------------------------------------------------------ API-INT-001 발급
  app.post(`${INTEGRATION_PREFIX}/auth/exchange`, async (request, reply) => {
    const state = stateOf(request);
    const transport = state.transport;
    if (transport === null) throw new PsiError('CLIENT_AUTH_FAILED', 'transport_missing');
    // 발급 요청에는 사용자 Authorization을 싣지 않는다 (계약 6.1). 쿠키는 onRequest가 이미 거절했다.
    if (request.headers.authorization !== undefined) throw new PsiError('INVALID_REQUEST', 'authorization_not_accepted');
    const nowMs = now();

    // 크기(bodyLimit) → 모양 → 서명·claim → 키 회수 → 재생 소비 → 문맥 → binding → 정책 → 권한 → 저장.
    const assertion = await verifyAssertion(assertionFromBody(request.body), {
      client: transport.client,
      purpose: 'grant',
      nowMs,
    });
    state.subjectRef = { issuer: assertion.issuer, subject: assertion.subject, authContextId: assertion.authContextId };

    let keyRevoked: boolean;
    try {
      keyRevoked = await pipeIntegrationRepo.isCredentialRevoked(deps.pool, {
        clientId: transport.client.clientId,
        kid: assertion.kid,
        certificateSha256: transport.certificateSha256,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'revocation_store_unavailable');
    }
    if (keyRevoked) throw new PsiError('CLIENT_DISABLED', 'signing_key_revoked');

    await consumeAssertion(deps.replay, assertion, nowMs);

    let context: Awaited<ReturnType<typeof pipeIntegrationRepo.findAuthContext>>;
    try {
      context = await pipeIntegrationRepo.findAuthContext(deps.pool, {
        issuer: assertion.issuer,
        subject: assertion.subject,
        authContextId: assertion.authContextId,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'context_store_unavailable');
    }
    if (context !== null && context.revoked_at !== null) throw new PsiError('CONTEXT_REVOKED', 'context_revoked');

    const identity = await resolveCanonicalIdentity(
      { pool: deps.pool, directory: deps.directory, gheHost: deps.gheHost },
      assertion,
    );

    /*
     * 권한 context를 한 번 조회한다. 실패(`ScopeUnavailableError`)는 503이고, **0개 저장소는 실패가
     * 아니다** — grant는 발급되고 조회가 기존 규칙대로 답한다. 결과를 grant에 복사하지 않는다.
     */
    await resolveEffectiveScope({ scopes: deps.scopes, pool: deps.pool }, identity.user.user_id, transport.client);

    const expiresAtMs = grantExpiry({
      nowMs,
      authExpiresAtSeconds: assertion.authExpiresAt,
      certificateNotAfterMs: transport.certificateNotAfterMs,
    });
    if (expiresAtMs === null) throw new PsiError('ASSERTION_INVALID', 'grant_lifetime_too_short');

    const { token, digest } = mintGrantToken();
    const grantId = randomUUID();
    let outcome: Awaited<ReturnType<typeof pipeIntegrationRepo.issueGrant>>;
    try {
      outcome = await pipeIntegrationRepo.issueGrant(deps.pool, {
        grantId,
        tokenSha256: digest,
        clientId: transport.client.clientId,
        issuer: assertion.issuer,
        subject: assertion.subject,
        authContextId: assertion.authContextId,
        bindingId: identity.binding.binding_id,
        bindingVersion: identity.binding.binding_version,
        prsUserId: identity.user.user_id,
        issuedKid: assertion.kid,
        certificateSha256: transport.certificateSha256,
        profile: transport.client.profile,
        clientPolicyVersion: transport.client.policyVersion,
        issuedAt: new Date(nowMs),
        expiresAt: new Date(expiresAtMs),
        authExpiresAt: new Date(assertion.authExpiresAt * 1000),
        correlationId: state.correlationId,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'grant_store_unavailable');
    }
    if (outcome.outcome === 'context_revoked') throw new PsiError('CONTEXT_REVOKED', 'context_revoked_during_exchange');
    if (outcome.outcome === 'binding_changed') {
      if (outcome.status === 'disabled') throw new PsiError('IDENTITY_DISABLED', 'binding_disabled_during_exchange');
      if (outcome.status === null) throw new PsiError('IDENTITY_BINDING_REQUIRED', 'binding_removed_during_exchange');
      throw new PsiError('IDENTITY_BINDING_CONFLICT', 'binding_changed_during_exchange');
    }

    state.issuedGrant = {
      grantId,
      prsUserId: identity.user.user_id,
      bindingVersion: identity.binding.binding_version,
    };
    return reply.status(200).send({
      protocol_version: PROTOCOL_VERSION,
      token_type: 'Bearer',
      access_token: token,
      grant_id: grantId,
      expires_in: Math.floor((expiresAtMs - nowMs) / 1000),
      expires_at: isoSeconds(expiresAtMs),
      auth_context_id: assertion.authContextId,
      binding_version: identity.binding.binding_version,
      identity: { ghe_login: identity.user.login },
      capabilities,
      correlation_id: state.correlationId,
    });
  });

  // ------------------------------------------------------------ API-INT-002 grant 회수
  app.post(`${INTEGRATION_PREFIX}/auth/revoke`, async (request, reply) => {
    const state = stateOf(request);
    const transport = state.transport;
    if (transport === null) throw new PsiError('CLIENT_AUTH_FAILED', 'transport_missing');
    if (request.body !== undefined && !(isRecord(request.body) && Object.keys(request.body).length === 0)) {
      throw new PsiError('INVALID_REQUEST', 'body_must_be_empty');
    }
    if (request.headers.authorization === undefined) throw new PsiError('INVALID_REQUEST', 'authorization_missing');

    // 토큰 형식이 틀렸든, 그런 grant가 없든, 남의 것이든, 이미 회수됐든 **같은 응답**이다 — 토큰의 존재를
    // 알려 주지 않는다. `Authorization` 헤더 자체가 없는 것은 BFF의 요청 오류라 바로 위에서 400이다.
    const token = readBearerGrant(request.headers.authorization);
    if (token !== null) {
      try {
        // 이벤트에는 회수한 grant ID만 남긴다 — 사용자·버전은 grant 행이 이미 갖고 있다.
        state.revokedGrantId = await pipeIntegrationRepo.revokeGrantByToken(deps.pool, {
          tokenSha256: grantTokenDigest(token),
          clientId: transport.client.clientId,
          now: new Date(now()),
        });
      } catch {
        throw new PsiError('AUTH_STORE_UNAVAILABLE', 'grant_store_unavailable');
      }
    }
    return reply.status(200).send({ protocol_version: PROTOCOL_VERSION, revoked: true, correlation_id: state.correlationId });
  });

  // ------------------------------------------------------------ API-INT-003 로그인 문맥 회수
  app.post(`${INTEGRATION_PREFIX}/auth/revoke-context`, async (request, reply) => {
    const state = stateOf(request);
    const transport = state.transport;
    if (transport === null) throw new PsiError('CLIENT_AUTH_FAILED', 'transport_missing');
    if (request.headers.authorization !== undefined) throw new PsiError('INVALID_REQUEST', 'authorization_not_accepted');
    const nowMs = now();
    const assertion = await verifyAssertion(assertionFromBody(request.body), {
      client: transport.client,
      purpose: 'revoke_context',
      nowMs,
    });
    state.subjectRef = { issuer: assertion.issuer, subject: assertion.subject, authContextId: assertion.authContextId };

    let keyRevoked: boolean;
    try {
      keyRevoked = await pipeIntegrationRepo.isCredentialRevoked(deps.pool, {
        clientId: transport.client.clientId,
        kid: assertion.kid,
        certificateSha256: transport.certificateSha256,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'revocation_store_unavailable');
    }
    if (keyRevoked) throw new PsiError('CLIENT_DISABLED', 'signing_key_revoked');
    await consumeAssertion(deps.replay, assertion, nowMs);

    let revoked: Awaited<ReturnType<typeof pipeIntegrationRepo.revokeAuthContext>>;
    try {
      revoked = await pipeIntegrationRepo.revokeAuthContext(deps.pool, {
        issuer: assertion.issuer,
        subject: assertion.subject,
        authContextId: assertion.authContextId,
        clientId: transport.client.clientId,
        now: new Date(nowMs),
        authExpiresAt: new Date(assertion.authExpiresAt * 1000),
        correlationId: state.correlationId,
      });
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'context_store_unavailable');
    }
    return reply.status(200).send({
      protocol_version: PROTOCOL_VERSION,
      auth_context_id: assertion.authContextId,
      revoked: true,
      revoked_at: isoSeconds(revoked.revokedAt.getTime()),
      correlation_id: state.correlationId,
    });
  });

  // ------------------------------------------------------------ API-INT-004 검색 사용자 문맥
  app.get(`${INTEGRATION_PREFIX}/context`, { preHandler: grantGuard }, async (request, reply) => {
    const state = stateOf(request);
    const grant = state.grant;
    if (grant === null) throw new PsiError('GRANT_INVALID', 'grant_missing');
    parseStrictQuery(request.raw.url ?? '', []);
    let user: Awaited<ReturnType<typeof authRepo.findUserById>>;
    try {
      user = await authRepo.findUserById(deps.pool, grant.prs_user_id);
    } catch {
      throw new PsiError('AUTH_STORE_UNAVAILABLE', 'user_store_unavailable');
    }
    if (user === null) throw new PsiError('IDENTITY_BINDING_REQUIRED', 'canonical_user_missing');
    return reply.send({
      protocol_version: PROTOCOL_VERSION,
      grant_id: grant.grant_id,
      expires_at: isoSeconds(grant.expires_at.getTime()),
      auth_context_id: grant.auth_context_id,
      binding_version: grant.binding_version,
      identity: { ghe_login: user.login },
      capabilities,
      operations: readOperations,
      correlation_id: state.correlationId,
    });
  });

  // ------------------------------------------------------------ API-INT-005~014 조회
  type ReadHandler = (
    request: FastifyRequest,
    reply: FastifyReply,
    query: Record<string, string>,
    invocation: ReadInvocation,
  ) => Promise<FastifyReply>;

  const readRoute = (id: string, handler: ReadHandler): void => {
    const operation = operationById(id);
    app.get(`${INTEGRATION_PREFIX}${operation.path}`, { preHandler: grantGuard }, async (request, reply) => {
      const query = parseStrictQuery(request.raw.url ?? '', operation.queryKeys);
      const state = stateOf(request);
      state.target = safeTarget(query['repository']);
      return handler(request, reply, query, invocationFor(request));
    });
  };

  readRoute('read.repositories', (_request, reply, query, invocation) =>
    executeRepositories(query, reply, invocation, deps.executions.repositories),
  );
  readRoute('read.search', (_request, reply, query, invocation) =>
    executeSearch(query, reply, invocation, deps.executions.search),
  );
  readRoute('read.resolve', (_request, reply, query, invocation) =>
    executeResolve(query, reply, invocation, deps.executions.resolve),
  );
  readRoute('read.merge_numbers.resolve', (_request, reply, query, invocation) =>
    executeMergeNumberResolve(query, reply, invocation, deps.executions.mergeNumbers),
  );
  readRoute('read.pull_request', (request, reply, _query, invocation) => {
    const params = request.params as { repository?: string; pr_number?: string };
    const repository = strictRepositoryParam(params.repository);
    stateOf(request).target = repository;
    return executePullRequestDetail(
      { repository, pr_number: strictPlainParam(params.pr_number) },
      reply,
      invocation,
      deps.executions.resolve,
    );
  });
  readRoute('read.commit', (request, reply, _query, invocation) => {
    const params = request.params as { repository?: string; commit_sha?: string };
    const repository = strictRepositoryParam(params.repository);
    stateOf(request).target = repository;
    return executeCommitDetail(
      { repository, commit_sha: strictPlainParam(params.commit_sha) },
      reply,
      invocation,
      deps.executions.resolve,
    );
  });
  const sourceOperations: readonly [string, SourceOperation][] = [
    ['read.source.tree', 'tree'],
    ['read.source.history', 'history'],
    ['read.source.diff', 'diff'],
    ['read.source.file', 'file'],
  ];
  for (const [id, sourceOperation] of sourceOperations) {
    readRoute(id, (request, reply, query, invocation) => {
      const repository = strictRepositoryParam((request.params as { repository?: string }).repository);
      stateOf(request).target = repository;
      return executeSource(sourceOperation, repository, query, reply, invocation, deps.executions.source);
    });
  }
}
