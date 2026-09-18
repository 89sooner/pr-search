import { randomUUID } from 'node:crypto';
import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '@prs/db';
import type { ErrorCode } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import { AccessScopeUnavailableError } from '@prs/es';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { FULL_SHA, SourceSnapshotChanged, sourceComparison, sourceFile, sourceHistory, sourceTree, validPath, validRef } from './service.js';

/** `es`는 선택이다 (CR-107) — 없으면 History의 PR 연결 배치 조회를 건너뛴다. */
export interface SourceRouteOptions { pool: Pool; reader: () => GitHubSourceReader; auth: AuthContext; loginPath: string; es?: Client }
export function registerSourceRoutes(app: FastifyInstance, options: SourceRouteOptions): void {
  for (const operation of ['tree', 'history', 'file', 'diff'] as const) {
    app.get(`/api/v1/source/:repository/${operation}`, async (request, reply) => {
      reply.header('cache-control', 'private, no-store').header('pragma', 'no-cache').header('x-content-type-options', 'nosniff');
      const correlationId = randomUUID();
      let resultCode = 'SOURCE_UNAVAILABLE'; let observedRevision: unknown = null;
      const fail = (status: number, code: ErrorCode, message: string) => { resultCode = code; return reply.code(status).send({ error: { code, message }, correlation_id: correlationId }); };
      let userId: string | undefined;
      const repository = (request.params as { repository: string }).repository;
      const query = request.query as Record<string, unknown>;
      try {
        const principal = await authenticateSession(request, options.auth.sessions); userId = principal.userId;
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return fail(400, 'INVALID_PARAMETER', 'Repository must use owner/name format.');
        const [owner, name] = repository.split('/') as [string, string];
        if ([owner, name].some(part => part === '.' || part === '..')) return fail(400, 'INVALID_PARAMETER', 'Invalid repository name.');
        const scope = await options.auth.scopes.resolve(userId);
        const found = await resolveRepository(options.pool, { owner, name }, scope);
        if (found.kind !== 'ok') return fail(404, 'NOT_FOUND', 'Repository not found.');
        if (['path', 'ref', 'revision', 'tree_sha', 'commit'].some(key => query[key] !== undefined && typeof query[key] !== 'string')) return fail(400, 'INVALID_PARAMETER', 'Source parameters must be strings.');
        const path = typeof query['path'] === 'string' ? query['path'] : '';
        const ref = typeof query['ref'] === 'string' ? query['ref'] : '';
        const revision = typeof query['revision'] === 'string' ? query['revision'] : '';
        const treeSha = typeof query['tree_sha'] === 'string' ? query['tree_sha'] : '';
        const page = query['page'] === undefined ? 1 : Number(query['page']);
        if (!validPath(path) || (ref && !validRef(ref)) || !Number.isInteger(page) || page < 1 || page > 1000 || (revision && !FULL_SHA.test(revision)) || (treeSha && (!FULL_SHA.test(treeSha) || !revision))) return fail(400, 'INVALID_PARAMETER', 'Invalid path, reference, or page.');
        const reader = options.reader(); const repo = { owner, repo: name };
        let result: unknown;
        if (operation === 'tree') {
          if (path && !treeSha) return fail(400, 'INVALID_PARAMETER', 'Expanding a directory requires its tree SHA and revision.');
          result = await sourceTree(reader, repo, { ref, path, ...(treeSha ? { treeSha, revision } : {}) });
        } else if (operation === 'history') result = await sourceHistory(reader, repo, { ref, path, page }, options.es ? { es: options.es, scope } : undefined);
        else if (operation === 'file') {
          if (!path || !revision) return fail(400, 'INVALID_PARAMETER', 'A file path and full revision SHA are required.');
          result = await sourceFile(reader, repo, revision, path);
        } else {
          const pr = query['pr'] === undefined ? undefined : Number(query['pr']);
          const commit = typeof query['commit'] === 'string' ? query['commit'] : undefined;
          if ((pr === undefined) === (commit === undefined) || (pr !== undefined && (!Number.isSafeInteger(pr) || pr < 1 || pr > 2147483647)) || (commit !== undefined && !FULL_SHA.test(commit)) || page > 30) return fail(400, 'INVALID_PARAMETER', 'Choose one PR number or full commit SHA.');
          result = await sourceComparison(reader, repo, { page, ...(pr !== undefined ? { pr } : {}), ...(commit !== undefined ? { commit } : {}) });
        }
        resultCode = 'OK';
        if (result && typeof result === 'object') observedRevision = 'revision' in result ? result.revision : 'head' in result ? result.head : null;
        return reply.send(result);
      } catch (error) {
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
        if (userId) await recordAuditBestEffort(options.pool, { userId, action: 'entity.view', target: `source:${operation}:${repository.slice(0, 255)}`, query: JSON.stringify({ path: typeof query['path'] === 'string' ? query['path'].slice(0, 2048) : null, ref: query['ref'], revision: query['revision'], commit: query['commit'], pr: query['pr'], observed_revision: observedRevision }), resultCode, correlationId });
      }
    });
  }
}
