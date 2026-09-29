import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from '@prs/db';
import type { ErrorCode } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import { AccessScopeUnavailableError } from '@prs/es';
import type { AuthContext } from '../auth/context.js';
import { sessionInvocation, type ReadInvocation } from '../auth/read-invocation.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { FULL_SHA, SourceRangeError, SourceSnapshotChanged, sourceComparison, sourceFile, sourceFileWindow, sourceHistory, sourceTree, sourceTreeComparison, validPath, validRef } from './service.js';

/**
 * 한 source 요청의 기한 (CR-132). 슬롯 대기와 여러 GitHub 호출을 모두 덮는다 — 원시 창 읽기의 호출 기한도 이 안이다.
 * 사용자가 볼 수 있는 총량(이어 읽기)과 다른 보호다: 한 요청이 오래 붙잡지 못하게 할 뿐, 다음 창·페이지는 새 요청이다.
 */
export const SOURCE_REQUEST_DEADLINE_MS = 120_000;
const OFFSET = /^(0|[1-9][0-9]{0,15})$/;
/** 트리 비교 커서는 GitHub가 준 경로를 비교에만 쓴다 — GitHub 경로로 보내지 않으므로 파일 경로 규칙보다 넓다. */
const MAX_CURSOR = 4096;
const COMPARISON_KEYS = ['listing', 'after', 'base', 'head', 'related'] as const;

/** `es`는 선택이다 (CR-107) — 없으면 History의 PR 연결 배치 조회를 건너뛴다. `deadlineMs`는 시험용이다(기본 `SOURCE_REQUEST_DEADLINE_MS`). */
export interface SourceRouteOptions { pool: Pool; reader: () => GitHubSourceReader; auth: AuthContext; loginPath: string; es?: Client; deadlineMs?: number }
/** source 조회의 실행 재료 (CR-112). 일반 경로와 PIPE 연동 경로가 같은 값을 넘긴다. 세션 컨텍스트는 없다. */
export type SourceExecution = Omit<SourceRouteOptions, 'auth'>;
export const SOURCE_OPERATIONS = ['tree', 'history', 'file', 'diff'] as const;
export type SourceOperation = (typeof SOURCE_OPERATIONS)[number];
export function registerSourceRoutes(app: FastifyInstance, options: SourceRouteOptions): void {
  const { auth, ...execution } = options;
  for (const operation of SOURCE_OPERATIONS) {
    app.get(`/api/v1/source/:repository/${operation}`, async (request, reply) =>
      executeSource(operation, (request.params as { repository: string }).repository, request.query as Record<string, unknown>, reply, sessionInvocation(request, auth), execution));
  }
}
/**
 * source 조회 본문 (CR-112가 라우트에서 꺼냈다 — 검사 순서·감사·응답은 그대로다).
 *
 * **접근 범위 확인이 GHE 조회보다 먼저다**(PSI-D06). PIPE 연동 경로도 이 함수를 부른다.
 *
 * CR-132: 사용자가 연결을 끊거나(응답을 끝내기 전의 `close`) 요청 기한이 지나면 한 신호로 슬롯 대기와 GitHub 호출을
 * 멈춘다. 새 동작(`offset`, `listing=tree`, `related=all`)은 그 파라미터를 보낼 때만 켜진다 — 보내지 않는 호출의
 * 응답 모양은 예전과 같다.
 */
export async function executeSource(operation: SourceOperation, repository: string, query: Record<string, unknown>, reply: FastifyReply, invocation: ReadInvocation, options: SourceExecution): Promise<FastifyReply> {
  reply.header('cache-control', 'private, no-store').header('pragma', 'no-cache').header('x-content-type-options', 'nosniff');
  const { correlationId } = invocation;
  let resultCode = 'SOURCE_UNAVAILABLE'; let observedRevision: unknown = null;
  const fail = (status: number, code: ErrorCode, message: string) => { resultCode = code; return reply.code(status).send({ error: { code, message }, correlation_id: correlationId }); };
  let userId: string | undefined;
  const controller = new AbortController();
  const deadline = setTimeout(() => { controller.abort(new DOMException('Source request deadline exceeded', 'TimeoutError')); }, options.deadlineMs ?? SOURCE_REQUEST_DEADLINE_MS);
  // 응답을 다 보낸 뒤의 close는 정상 종료다. 끝내기 전의 close만 사용자가 끊은 것이다.
  const onClose = () => { if (!reply.raw.writableFinished) controller.abort(); };
  reply.raw.once('close', onClose);
  const call = { signal: controller.signal };
  try {
    const principal = await invocation.identify(); userId = principal.userId;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return fail(400, 'INVALID_PARAMETER', 'Repository must use owner/name format.');
    const [owner, name] = repository.split('/') as [string, string];
    if ([owner, name].some(part => part === '.' || part === '..')) return fail(400, 'INVALID_PARAMETER', 'Invalid repository name.');
    const scope = await principal.resolveScope();
    const found = await resolveRepository(options.pool, { owner, name }, scope);
    if (found.kind !== 'ok') return fail(404, 'NOT_FOUND', 'Repository not found.');
    if (['path', 'ref', 'revision', 'tree_sha', 'commit', 'offset', ...COMPARISON_KEYS].some(key => query[key] !== undefined && typeof query[key] !== 'string')) return fail(400, 'INVALID_PARAMETER', 'Source parameters must be strings.');
    const path = typeof query['path'] === 'string' ? query['path'] : '';
    const ref = typeof query['ref'] === 'string' ? query['ref'] : '';
    const revision = typeof query['revision'] === 'string' ? query['revision'] : '';
    const treeSha = typeof query['tree_sha'] === 'string' ? query['tree_sha'] : '';
    // CR-132: History 페이지의 1,000 상한을 없앴다 — 50,000번째 커밋 뒤도 이어 읽는다(Diff의 30은 GitHub의 3,000개 상한이라 그대로다).
    const page = query['page'] === undefined ? 1 : Number(query['page']);
    if (!validPath(path) || (ref && !validRef(ref)) || !Number.isSafeInteger(page) || page < 1 || (revision && !FULL_SHA.test(revision)) || (treeSha && (!FULL_SHA.test(treeSha) || !revision))) return fail(400, 'INVALID_PARAMETER', 'Invalid path, reference, or page.');
    const offsetText = typeof query['offset'] === 'string' ? query['offset'] : undefined;
    if (offsetText !== undefined && (operation === 'history' || operation === 'diff')) return fail(400, 'INVALID_PARAMETER', 'Offset applies only to tree and file reads.');
    if (offsetText !== undefined && (!OFFSET.test(offsetText) || !Number.isSafeInteger(Number(offsetText)))) return fail(400, 'INVALID_PARAMETER', 'Offset must be a non-negative integer.');
    const offset = offsetText === undefined ? undefined : Number(offsetText);
    if (operation !== 'diff' && COMPARISON_KEYS.some(key => query[key] !== undefined)) return fail(400, 'INVALID_PARAMETER', 'Comparison parameters apply only to diff.');
    const reader = options.reader(); const repo = { owner, repo: name };
    let result: unknown;
    if (operation === 'tree') {
      if (path && !treeSha) return fail(400, 'INVALID_PARAMETER', 'Expanding a directory requires its tree SHA and revision.');
      result = await sourceTree(reader, repo, { ref, path, ...(treeSha ? { treeSha, revision } : {}), ...(offset !== undefined ? { offset } : {}) }, call);
    } else if (operation === 'history') result = await sourceHistory(reader, repo, { ref, path, page }, options.es ? { es: options.es, scope } : undefined, call);
    else if (operation === 'file') {
      if (!path || !revision) return fail(400, 'INVALID_PARAMETER', 'A file path and full revision SHA are required.');
      result = offset === undefined ? await sourceFile(reader, repo, revision, path, call) : await sourceFileWindow(reader, repo, revision, path, offset, call);
    } else if (query['listing'] !== undefined) {
      // CR-132: 트리 비교 목록. 호출자가 일반 비교에서 고정한 SHA를 그대로 받는다.
      const head = typeof query['head'] === 'string' ? query['head'] : '';
      const base = typeof query['base'] === 'string' ? query['base'] : undefined;
      const after = typeof query['after'] === 'string' ? query['after'] : undefined;
      if (query['listing'] !== 'tree' || ['pr', 'commit', 'page', 'related'].some(key => query[key] !== undefined) || !FULL_SHA.test(head) || (base !== undefined && !FULL_SHA.test(base)) || (after !== undefined && (after === '' || after.length > MAX_CURSOR || after.includes('\u0000')))) return fail(400, 'INVALID_PARAMETER', 'A tree listing needs a full head SHA, an optional full base SHA, and an optional path cursor.');
      result = await sourceTreeComparison(reader, repo, { base: base ?? null, head, after: after ?? null }, call);
    } else {
      const pr = query['pr'] === undefined ? undefined : Number(query['pr']);
      const commit = typeof query['commit'] === 'string' ? query['commit'] : undefined;
      if (['after', 'base', 'head'].some(key => query[key] !== undefined) || (query['related'] !== undefined && query['related'] !== 'all')) return fail(400, 'INVALID_PARAMETER', 'Base, head, and after need listing=tree; related accepts only all.');
      if ((pr === undefined) === (commit === undefined) || (pr !== undefined && (!Number.isSafeInteger(pr) || pr < 1 || pr > 2147483647)) || (commit !== undefined && !FULL_SHA.test(commit)) || page > 30) return fail(400, 'INVALID_PARAMETER', 'Choose one PR number or full commit SHA.');
      result = await sourceComparison(reader, repo, { page, ...(pr !== undefined ? { pr } : {}), ...(commit !== undefined ? { commit } : {}), ...(query['related'] === 'all' ? { related: 'all' as const } : {}) }, call);
    }
    resultCode = 'OK';
    if (result && typeof result === 'object') observedRevision = 'revision' in result ? result.revision : 'head' in result ? result.head : null;
    return reply.send(result);
  } catch (error) {
    if (controller.signal.aborted) {
      const reason: unknown = controller.signal.reason;
      if (reason instanceof Error && reason.name === 'TimeoutError') return fail(502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub in time. Please retry.');
      // 사용자가 연결을 끊었다. 응답은 닿지 않지만 모양은 지키고, 감사에는 취소로 남긴다.
      const sent = fail(502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.');
      resultCode = 'CANCELLED';
      return sent;
    }
    if (error instanceof SourceRangeError) return fail(400, 'INVALID_PARAMETER', error.message);
    if (error instanceof SourceSnapshotChanged) return fail(409, 'SOURCE_CHANGED', 'This pull request changed during analysis. Close and reopen the comparison.');
    const authError = toAuthError(error, { correlationId, loginPath: options.loginPath });
    if (authError) { resultCode = authError.body.error.code; return sendAuthError(reply, authError); }
    if (error instanceof AccessScopeUnavailableError) return fail(503, 'PERMISSION_UNAVAILABLE', 'Repository access could not be verified.');
    if (error instanceof GitHubApiError) {
      if (error.kind === 'not_found') return fail(404, 'NOT_FOUND', 'The requested repository object was not found.');
      if (error.kind === 'rate_limited' || error.kind === 'secondary_rate_limited') { if (error.retryAt) reply.header('retry-after', Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000))); return fail(429, 'SOURCE_RATE_LIMITED', 'GitHub is rate limited. Try again later.'); }
      if (error.kind === 'auth') return fail(503, 'SOURCE_PERMISSION_REQUIRED', 'The configured GitHub App requires repository Contents read permission.');
    }
    // Upstream error strings may contain response fragments. Never log or echo them.
    return fail(502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.');
  } finally {
    clearTimeout(deadline);
    reply.raw.off('close', onClose);
    // 본문은 싣지 않는다(NFR-005). 이어 읽기 위치·비교 대상만 남긴다 (CR-132).
    if (userId) await recordAuditBestEffort(options.pool, { userId, action: 'entity.view', target: `source:${operation}:${repository.slice(0, 255)}`, query: JSON.stringify({ path: typeof query['path'] === 'string' ? query['path'].slice(0, 2048) : null, ref: query['ref'], revision: query['revision'], commit: query['commit'], pr: query['pr'], offset: query['offset'], listing: query['listing'], base: query['base'], head: query['head'], after: typeof query['after'] === 'string' ? query['after'].slice(0, 2048) : undefined, related: query['related'], observed_revision: observedRevision }), resultCode, correlationId });
  }
}
