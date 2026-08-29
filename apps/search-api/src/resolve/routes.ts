/**
 * `GET /resolve`, `GET /commits/…`, `GET /pull-requests/…`
 * (API-SRCH-001, API-SRCH-002, API-SRCH-003).
 *
 * 라우트가 하는 일은 셋뿐이다 — 파라미터를 검증하고, 서비스를 부르고, 오류를
 * 계약이 정한 모양으로 옮긴다. 판별은 `@prs/query`, 조회는 `service.ts`와
 * `detail.ts`가 갖는다.
 *
 * **접근 범위 밖은 404다** (THR-004). 403이면 "있지만 못 본다"가 새어 존재
 * 자체가 드러난다. 그래서 상세 조회는 접근 범위 필터를 지난 조회가 0건이면
 * 그대로 404가 되고, 그 판정에 범위 밖인지 없는지를 구분하는 코드가 없다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AccessScopeUnavailableError, PartialSearchError } from '@prs/es';
import { detectIdentifier } from '@prs/query';
import type { ErrorResponse } from '@prs/contracts';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { clampLimit, runResolve, type ResolveDeps } from './service.js';
import { getCommitDetail, getPullRequestDetail, type DetailDeps } from './detail.js';

export const RESOLVE_PATH = '/api/v1/resolve';
export const COMMIT_PATH = '/api/v1/commits/:repository/:commit_sha';
export const PULL_REQUEST_PATH = '/api/v1/pull-requests/:repository/:pr_number';

/** ES 조회 마감 (FR-SRCH-004 예외 처리: 3초 초과 시 `search_timeout`). */
export const RESOLVE_TIMEOUT_MS = 3_000;

/** `owner/name`. 경로 파라미터는 URL 인코딩되어 오므로 디코딩 후 검증한다. */
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const FULL_SHA = /^[0-9a-fA-F]{40}$/;
const PR_NUMBER = /^\d+$/;
const MAX_PR_NUMBER = 2_147_483_647;

function fail(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
  return reply.status(status).send(body);
}

function notFound(reply: FastifyReply, correlationId: string, message: string): FastifyReply {
  return fail(reply, 404, {
    error: { code: 'NOT_FOUND', message },
    correlation_id: correlationId,
  });
}

/**
 * 조회 중 난 오류를 계약의 모양으로 옮긴다.
 *
 * @returns 옮길 수 없는 오류면 `null` — 호출 측이 다시 던진다.
 */
function toErrorResponse(
  reply: FastifyReply,
  error: unknown,
  correlationId: string,
  loginPath: string,
): FastifyReply | null {
  const shape = toAuthError(error, { correlationId, loginPath });
  if (shape !== null) return sendAuthError(reply, shape);

  if (error instanceof AccessScopeUnavailableError) {
    // 볼 수 있는 저장소가 하나도 없다. 빈 결과가 아니라 명시적 실패다.
    return fail(reply, 503, {
      error: { code: 'PERMISSION_UNAVAILABLE', message: '접근 권한을 확인할 수 없어 조회를 거부한다' },
      correlation_id: correlationId,
    });
  }

  if (error instanceof PartialSearchError) {
    return fail(reply, 504, {
      error: { code: 'SEARCH_TIMEOUT', message: '검색이 부분 결과만 얻어 조회를 거부한다' },
      correlation_id: correlationId,
    });
  }

  return null;
}

export interface ResolveRouteOptions extends ResolveDeps, DetailDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
  /** 감사 기록의 정본 저장소 (WP-039 / FR-AUTH-004 AC-1 "상세 조회"). */
  readonly pool: Pool;
  /**
   * 이 GHE 인스턴스의 기준 URL (CR-017, DEV-064).
   *
   * 없으면 URL 해석을 하지 않는다 — 무엇이 우리 호스트인지 모르는 채로 경로만
   * 파싱하면 아무 URL이나 우리 저장소로 해석된다.
   */
  readonly gheBaseUrl: string | null;
}

export function registerResolveRoutes(app: FastifyInstance, options: ResolveRouteOptions): void {
  const { auth, loginPath, gheBaseUrl, pool, ...deps } = options;

  /*
   * 상세 조회 감사 (`FR-AUTH-004` AC-1 "상세 조회", WP-039).
   *
   * **찾지 못한 조회도 남긴다.** 범위 밖과 부재를 화면에는 구분해 주지 않지만
   * (THR-004) **감사에는 시도 자체가 남아야 한다** — 보안 담당자가 조사하는 것이
   * 바로 "누가 무엇을 열어 보려 했는가"이고, 실패한 시도를 지우면 그 물음에
   * 답할 수 없다.
   *
   * **`/resolve`는 기록하지 않는다.** 그것은 식별자 해석이지 상세 조회가
   * 아니며, 후보 목록을 받은 뒤 실제로 연 화면이 여기를 지난다. 둘 다 남기면
   * 한 번의 조사가 두 번으로 세어진다 (CR-054).
   */
  const recordView = async (
    userId: string,
    kind: 'commit' | 'pull_request',
    repository: string,
    id: string,
    found: boolean,
    correlationId: string,
  ): Promise<void> => {
    await recordAuditBestEffort(pool, {
      userId,
      action: 'entity.view',
      target: `${kind}:${repository}:${id}`,
      query: null,
      resultCode: found ? 'ok' : 'not_found',
      correlationId,
    });
  };

  /** 세션을 검증하고 사용자 ID를 준다. 실패하면 응답을 보내고 `null`. */
  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
  ): Promise<string | null> {
    try {
      return (await authenticateSession(request, auth.sessions)).userId;
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) {
        await sendAuthError(reply, shape);
        return null;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- API-SRCH-001
  app.get(RESOLVE_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const userId = await authenticate(request, reply, correlationId);
    if (userId === null) return reply;

    const raw = typeof query['q'] === 'string' ? query['q'] : '';

    /*
     * 판별이 조회보다 먼저다.
     *
     * 7자 미만 hex는 **조회하지 않고** 400이다 (FR-SRCH-004 AC-2). 화면도 같은
     * 코드로 같은 판정을 하므로(QA-W001-04) 정상 경로에서는 이 요청 자체가
     * 오지 않는다 — 여기 도달하는 것은 화면을 거치지 않은 호출이다.
     */
    const detection = detectIdentifier(raw, {
      ...(gheBaseUrl === null ? {} : { gheBaseUrl }),
    });

    if (detection.rejection !== null) {
      return fail(reply, 400, {
        error: {
          code: detection.rejection.code,
          message: detection.rejection.message,
          detail: {
            min_length: detection.rejection.min_length,
            actual_length: detection.rejection.actual_length,
          },
        },
        correlation_id: correlationId,
      });
    }

    const hint = typeof query['repository'] === 'string' ? query['repository'] : null;
    const repositoryHint = hint !== null && REPOSITORY.test(hint) ? hint : null;

    try {
      const scope = await auth.scopes.resolve(userId);
      const result = await runResolve(
        { detection, scope, repositoryHint, limit: clampLimit(query['limit']) },
        deps,
      );

      return reply.send({
        input: result.input,
        detected_kind: result.detected_kind,
        candidates: result.candidates,
        truncated: result.truncated,
        /*
         * 0건은 오류가 아니다 (FR-SRCH-001 예외 처리).
         *
         * HTTP 200에 빈 배열과 사유 코드를 싣는다. 404로 만들면 "없다"와
         * "못 본다"가 섞이고, 화면이 저장소 등록 상태를 안내할 자리를 잃는다.
         */
        ...(result.reason_code === null
          ? {}
          : {
              reason_code: result.reason_code,
              hint: '이 문자열과 일치하는 커밋·PR이 없습니다. 저장소가 수집 대상인지 확인하세요.',
            }),
        correlation_id: correlationId,
      });
    } catch (error) {
      const response = toErrorResponse(reply, error, correlationId, loginPath);
      if (response !== null) return response;
      throw error;
    }
  });

  // ---------------------------------------------------------------- API-SRCH-002
  app.get(COMMIT_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = request.params as { repository?: string; commit_sha?: string };

    const userId = await authenticate(request, reply, correlationId);
    if (userId === null) return reply;

    const repository = decodeURIComponent(params.repository ?? '');
    const commitSha = params.commit_sha ?? '';

    if (!REPOSITORY.test(repository)) {
      return notFound(reply, correlationId, '저장소를 찾을 수 없습니다');
    }
    if (!FULL_SHA.test(commitSha)) {
      // 상세 조회는 40자 전체 SHA만 받는다. 접두 해석은 `/resolve`의 몫이다.
      return notFound(reply, correlationId, '커밋을 찾을 수 없습니다');
    }

    try {
      const scope = await auth.scopes.resolve(userId);
      const detail = await getCommitDetail(repository, commitSha, scope, deps);
      await recordView(userId, 'commit', repository, commitSha, detail !== null, correlationId);
      if (detail === null) {
        // 범위 밖인지 없는지를 구분하지 않는다 — 구분하면 존재가 샌다 (THR-004).
        return notFound(reply, correlationId, '커밋을 찾을 수 없습니다');
      }
      return reply.send({ ...detail, correlation_id: correlationId });
    } catch (error) {
      const response = toErrorResponse(reply, error, correlationId, loginPath);
      if (response !== null) return response;
      throw error;
    }
  });

  // ---------------------------------------------------------------- API-SRCH-003
  app.get(PULL_REQUEST_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = request.params as { repository?: string; pr_number?: string };

    const userId = await authenticate(request, reply, correlationId);
    if (userId === null) return reply;

    const repository = decodeURIComponent(params.repository ?? '');
    const rawNumber = params.pr_number ?? '';

    if (!REPOSITORY.test(repository)) {
      return notFound(reply, correlationId, '저장소를 찾을 수 없습니다');
    }
    if (!PR_NUMBER.test(rawNumber)) {
      return notFound(reply, correlationId, 'PR을 찾을 수 없습니다');
    }
    const prNumber = Number(rawNumber);
    if (prNumber < 1 || prNumber > MAX_PR_NUMBER) {
      return notFound(reply, correlationId, 'PR을 찾을 수 없습니다');
    }

    try {
      const scope = await auth.scopes.resolve(userId);
      const detail = await getPullRequestDetail(repository, prNumber, scope, deps);
      await recordView(userId, 'pull_request', repository, rawNumber, detail !== null, correlationId);
      if (detail === null) {
        return notFound(reply, correlationId, 'PR을 찾을 수 없습니다');
      }
      return reply.send({ ...detail, correlation_id: correlationId });
    } catch (error) {
      const response = toErrorResponse(reply, error, correlationId, loginPath);
      if (response !== null) return response;
      throw error;
    }
  });
}
