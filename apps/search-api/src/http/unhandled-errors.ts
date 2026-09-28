/**
 * 처리되지 않은 오류의 공통 분류와 진단 기록 (CR-129 / DEV-786).
 *
 * 공개 리스너(`buildServer`)와 PIPE 연동 리스너가 **같은 분류**를 쓴다. 두 리스너가 다른 것은 응답
 * 봉투(공개 `ErrorResponse` / 연동 `PsiErrorBody`)와 인증뿐이고, 이 파일은 인증을 모른다 — 공개 앱에
 * 연동의 자격 검사를 끼워 넣지 않는다.
 *
 * ## 무엇이 클라이언트 오류인가
 *
 * **Fastify가 요청을 읽다 낸 오류**(`code`가 `FST_`로 시작하고 상태가 4xx)만 클라이언트 오류다. 그 밖의
 * 예외는 `statusCode` 속성이 있어도 서버 오류다 — Elasticsearch `ResponseError`는 `statusCode`를 게터로
 * 내놓으므로, 속성만 보고 가르면 서버가 잘못 조립한 질의(400)가 사용자의 잘못처럼 나가고 기록도 남지 않는다.
 *
 * ## 진단 기록에 싣지 않는 것
 *
 * 오류 문구, 요청 URL(`q=`에 검색어가 실린다), 헤더, 본문. 문구에는 GHE 응답·SQL 조각·토큰·소스 본문이
 * 섞일 수 있다. 대신 경로 **패턴**, 수명 주기 단계, 오류 이름과 종류, 허용 목록을 지난 코드, 스택의 호출
 * 위치(문구 줄은 버린다)만 남긴다. 무엇을 물었는지는 검색 감사 기록이 맡는다 — 두 기록을 섞지 않는다.
 */

import { errors as esErrors } from '@elastic/elasticsearch';
import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { ErrorResponse } from '@prs/contracts';

// ------------------------------------------------------------------ 분류

/** Fastify가 요청을 읽다 낸 클라이언트 오류. 그 밖의 오류는 `null`이다. */
export interface FrameworkClientError {
  /** Fastify가 정한 상태 (4xx). */
  readonly status: number;
  /** `FST_`로 시작하는 Fastify 오류 코드. */
  readonly code: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function frameworkClientError(error: unknown): FrameworkClientError | null {
  if (!isRecord(error)) return null;
  const code = typeof error['code'] === 'string' ? error['code'] : '';
  const status = typeof error['statusCode'] === 'number' ? error['statusCode'] : 0;
  if (!code.startsWith('FST_') || status < 400 || status >= 500) return null;
  return { status, code };
}

/** 오류가 어느 의존에서 왔는가. 운영자가 로그 한 줄로 먼저 가를 축이다. */
export type ErrorKind = 'elasticsearch' | 'postgres' | 'redis' | 'github' | 'network' | 'application';

const REDIS_ERROR_NAMES: ReadonlySet<string> = new Set(['ReplyError', 'MaxRetriesPerRequestError', 'ParserError']);
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NODE_ERRNO = /^E[A-Z0-9_]{1,31}$/;
const ES_ERROR_TYPE = /^[a-z_]{1,80}$/;
const GITHUB_KIND = /^[a-z_]{1,40}$/;

export interface ErrorClassification {
  readonly name: string;
  readonly kind: ErrorKind;
  /** 허용 목록을 지난 코드만. 원인 문구는 여기에 오지 않는다. */
  readonly code?: string;
}

function safeName(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return error.name;
  if (error instanceof Error) return 'Error';
  return typeof error;
}

export function classifyError(error: unknown): ErrorClassification {
  const name = safeName(error);
  if (error instanceof esErrors.ElasticsearchClientError) {
    if (error instanceof esErrors.ResponseError) {
      const status = error.meta.statusCode;
      const body: unknown = error.meta.body;
      const inner = isRecord(body) && isRecord(body['error']) ? body['error']['type'] : undefined;
      const type = typeof inner === 'string' && ES_ERROR_TYPE.test(inner) ? inner : null;
      const parts = [typeof status === 'number' ? String(status) : null, type].filter((part) => part !== null);
      return parts.length === 0 ? { name, kind: 'elasticsearch' } : { name, kind: 'elasticsearch', code: parts.join(':') };
    }
    return { name, kind: 'elasticsearch' };
  }
  if (!isRecord(error)) return { name, kind: 'application' };
  const code = error['code'];
  if (name === 'GitHubApiError') {
    const kind = error['kind'];
    const status = error['status'];
    const parts = [
      typeof kind === 'string' && GITHUB_KIND.test(kind) ? kind : null,
      typeof status === 'number' ? String(status) : null,
    ].filter((part) => part !== null);
    return parts.length === 0 ? { name, kind: 'github' } : { name, kind: 'github', code: parts.join(':') };
  }
  // node-postgres의 서버 오류(`DatabaseError`)는 이름이 `error`이고 심각도와 SQLSTATE를 갖는다.
  if (typeof error['severity'] === 'string' && typeof code === 'string' && SQLSTATE.test(code)) {
    return { name, kind: 'postgres', code };
  }
  if (REDIS_ERROR_NAMES.has(name)) return { name, kind: 'redis' };
  if (typeof code === 'string' && NODE_ERRNO.test(code) && typeof error['syscall'] === 'string') {
    return { name, kind: 'network', code };
  }
  return { name, kind: 'application' };
}

const FRAME = /^\s+at \S/;
const MAX_FRAMES = 5;
const MAX_FRAME_LENGTH = 240;

/**
 * 스택에서 호출 위치 줄만 고른다.
 *
 * 스택의 머리는 `이름: 문구`이고 문구는 여러 줄일 수 있다. 문구에 사용자가 넣은 줄바꿈과 `    at …`이
 * 섞이면 호출 위치처럼 보이므로, **머리(`String(error)`)를 통째로 떼어 낸 나머지**에서만 고른다. 머리가
 * 스택 앞과 맞지 않으면(생성 뒤 문구가 바뀐 경우) 아무것도 싣지 않는다. 운영자는 이 줄로 코드의 어느
 * 단계에서 던졌는지 찾는다.
 */
export function stackFrames(error: unknown): readonly string[] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
  const header = String(error);
  if (!error.stack.startsWith(header)) return [];
  return error.stack
    .slice(header.length)
    .split('\n')
    .filter((line) => FRAME.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim().slice(0, MAX_FRAME_LENGTH));
}

// ------------------------------------------------------------------ 수명 주기 단계

/** 오류가 난 요청 수명 주기의 단계. 전역 훅이 요청마다 갱신한다. */
export type LifecycleStage = 'request' | 'parsing' | 'validation' | 'handler' | 'serialization';

const STAGE = new WeakMap<FastifyRequest, LifecycleStage>();

function mark(stage: LifecycleStage) {
  return (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    STAGE.set(request, stage);
    done();
  };
}

/**
 * 단계를 기록하는 전역 훅. **경로를 등록하기 전에** 불러야 모든 경로에 걸린다.
 *
 * 경로 자신의 훅보다 먼저 돈다 — 경로의 `preHandler`(역할 검사 등)에서 던진 오류는 `handler` 단계로 적힌다.
 */
export function trackLifecycleStage(app: FastifyInstance): void {
  app.addHook('onRequest', mark('request'));
  app.addHook('preParsing', (request, _reply, _payload, done) => {
    STAGE.set(request, 'parsing');
    done();
  });
  app.addHook('preValidation', mark('validation'));
  app.addHook('preHandler', mark('handler'));
  app.addHook('preSerialization', (request, _reply, payload, done) => {
    STAGE.set(request, 'serialization');
    done(null, payload);
  });
}

export function lifecycleStageOf(request: FastifyRequest): LifecycleStage {
  return STAGE.get(request) ?? 'request';
}

// ------------------------------------------------------------------ 진단 기록

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 앞단이 보낸 `X-Correlation-Id`. UUID가 아니면 버린다 — 임의 문자열을 기록 식별자로 쓰지 않는다. */
export function upstreamCorrelationId(header: string | string[] | undefined): string | null {
  return typeof header === 'string' && UUID.test(header) ? header.toLowerCase() : null;
}

/** 처리되지 않은 오류 한 건의 진단 기록 (관측성 3.1). 운영 로그 함수에 그대로 넘기려고 타입 별칭이다. */
export type UnhandledErrorLog = {
  readonly level: 'error' | 'warn';
  readonly event: 'http.unhandled_error' | 'http.client_error';
  readonly message: string;
  readonly correlation_id: string;
  /** web 프록시가 붙인 상관 ID. 이 요청의 식별자가 아니라 앞 구간과 잇는 참고값이다. */
  readonly upstream_correlation_id?: string;
  readonly method: string;
  /** 경로 **패턴**(`/api/v1/search`). 요청 URL을 싣지 않는다 — 질의 문자열에 검색어가 있다. */
  readonly route: string | null;
  readonly stage: LifecycleStage;
  readonly status: number;
  readonly error_name: string;
  readonly error_kind: ErrorKind;
  readonly error_code?: string;
  readonly frames?: readonly string[];
};

export type UnhandledErrorLogger = (entry: UnhandledErrorLog) => void;

function routePattern(request: FastifyRequest): string | null {
  const url = request.routeOptions.url;
  return typeof url === 'string' && url.length <= 200 ? url : null;
}

/**
 * 진단 기록 한 줄을 만든다. 클라이언트 오류는 `warn`이고 호출 위치를 싣지 않는다.
 */
export function unhandledErrorLog(
  request: FastifyRequest,
  error: unknown,
  input: { readonly correlationId: string; readonly status: number; readonly client: boolean },
): UnhandledErrorLog {
  const classification = classifyError(error);
  const upstream = upstreamCorrelationId(request.headers['x-correlation-id']);
  const frames = input.client ? [] : stackFrames(error);
  return {
    level: input.client ? 'warn' : 'error',
    event: input.client ? 'http.client_error' : 'http.unhandled_error',
    message: input.client
      ? `요청을 읽지 못해 거절했다 (${classification.name})`
      : `처리되지 않은 오류 (${classification.name})`,
    correlation_id: input.correlationId,
    ...(upstream === null || upstream === input.correlationId ? {} : { upstream_correlation_id: upstream }),
    method: request.method,
    route: routePattern(request),
    stage: lifecycleStageOf(request),
    status: input.status,
    error_name: classification.name,
    error_kind: classification.kind,
    ...(classification.code === undefined ? {} : { error_code: classification.code }),
    ...(frames.length === 0 ? {} : { frames }),
  };
}

/**
 * 기록이 실패해도 응답은 나가야 한다 — 기록 한 줄을 **만드는 일**과 쓰는 일 모두를 감싼다. 오류 처리기
 * 안의 예외는 프레임워크 기본 본문(내부 문구 포함)으로 떨어지므로, 여기서 두 번째 오류를 만들지 않는다.
 */
export function writeSafely(log: UnhandledErrorLogger | undefined, build: () => UnhandledErrorLog): void {
  if (log === undefined) return;
  try {
    log(build());
  } catch {
    // 기록 수단이나 분류가 실패했다. 응답까지 막지 않는다.
  }
}

// ------------------------------------------------------------------ 공개 리스너

/** 공개 API 응답의 고정 문구 (계약 6장). 원인 문구를 넘기는 길을 두지 않는다. */
const PUBLIC_MESSAGES = {
  INTERNAL_ERROR: '예상하지 못한 오류로 요청을 처리하지 못했다. 문의할 때 correlation_id를 함께 알려 달라',
  INVALID_PARAMETER: '요청 형식이 올바르지 않다',
  PAYLOAD_TOO_LARGE: '요청 본문이 너무 크다',
  UNSUPPORTED_MEDIA_TYPE: '지원하지 않는 요청 본문 형식이다',
  NOT_FOUND: '요청한 경로가 없다',
} as const;

type PublicFailureCode = keyof typeof PUBLIC_MESSAGES;

function publicBody(code: PublicFailureCode, correlationId: string): ErrorResponse {
  return { error: { code, message: PUBLIC_MESSAGES[code] }, correlation_id: correlationId };
}

function publicClientFailure(client: FrameworkClientError): { readonly status: number; readonly code: PublicFailureCode } {
  if (client.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return { status: 413, code: 'PAYLOAD_TOO_LARGE' };
  if (client.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
  if (client.code === 'FST_ERR_NOT_FOUND') return { status: 404, code: 'NOT_FOUND' };
  return { status: 400, code: 'INVALID_PARAMETER' };
}

/**
 * 공개 리스너의 공통 오류 처리 (CR-129 / DEV-786).
 *
 * - 경로가 스스로 처리한 오류(입력·권한·미존재·속도 제한·일시 장애)는 여기에 오지 않는다 — 그 응답은 그대로다.
 * - Fastify가 요청을 읽다 낸 오류는 그 상태로, 계약의 오류 봉투로 답한다.
 * - 그 밖의 예외는 500 `INTERNAL_ERROR`와 고정 문구, `correlation_id`로 답하고, 같은 ID로 진단을 남긴다.
 * - 없는 경로는 404 `NOT_FOUND` 봉투다. 기록하지 않는다(훑는 요청이 로그를 채운다).
 *
 * correlation ID는 `request.id`다 — 서버가 `genReqId`로 만든 UUID이며 앞단 헤더를 받지 않는다.
 * **경로를 등록하기 전에** 불러야 단계 훅이 모든 경로에 걸린다.
 */
export function registerPublicErrorHandling(app: FastifyInstance, log?: UnhandledErrorLogger): void {
  trackLifecycleStage(app);

  app.setErrorHandler(async (error, request, reply) => {
    const correlationId = request.id;
    const client = frameworkClientError(error);
    if (client !== null) {
      const failure = publicClientFailure(client);
      writeSafely(log, () => unhandledErrorLog(request, error, { correlationId, status: failure.status, client: true }));
      return reply.status(failure.status).send(publicBody(failure.code, correlationId));
    }
    writeSafely(log, () => unhandledErrorLog(request, error, { correlationId, status: 500, client: false }));
    return reply.status(500).send(publicBody('INTERNAL_ERROR', correlationId));
  });

  app.setNotFoundHandler(async (request, reply) => reply.status(404).send(publicBody('NOT_FOUND', request.id)));
}
