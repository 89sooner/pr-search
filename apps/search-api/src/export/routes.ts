/** API-SRCH-006 / WP-044. Authentication applies equally to files and status. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { authRepo, jobRepo, searchExportRepo, type Pool } from '@prs/db';
import { analyzePrNumberBinding, parseQuery, QueryParseError } from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { applyMandatoryScopeFilter, assertNoShardFailures, buildQuery, collectNames, collectExport, search, DEFAULT_SORT_KEY, EXPORT_LIMIT, ExportLimitError, ExportAsyncRequiredError, isSortKey, resolveSearchTarget, serializeExport, type ExportFormat, type ExportPlan } from '@prs/es';
import type { SearchRouteOptions } from '../search/routes.js';
import { checkMergeNumberFeatureFlag, toMergeNumberRangeFailure, toPrNumberRangeFailure, toSequenceFailure } from '../search/routes.js';
import { resolveMergeNumberRangeEpoch, resolveSequenceContext } from '../search/sequence-context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { recordAuditBestEffort } from '../audit/recorder.js';

function file(reply: FastifyReply, content: string, format: ExportFormat): FastifyReply {
  return reply.header('cache-control', 'private, no-store').header('content-disposition', `attachment; filename="pr-search.${format}"`)
    .type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8').send(content);
}
async function audit(pool: Pool, userId: string, q: string, result: string, target: number | null, correlationId: string): Promise<void> {
  await recordAuditBestEffort(pool, { userId, action: 'export.create', target: target === null ? null : String(target), query: q, resultCode: result, correlationId });
}
export function registerExportRoutes(app: FastifyInstance, deps: SearchRouteOptions): void {
  app.post('/api/v1/exports', async (request, reply) => {
    const correlationId = randomUUID();
    const fail = (status: number, code: string, message: string, reason?: string) => reply.status(status).send({ error: { code, message, ...(reason === undefined ? {} : { detail: { reason } }) }, correlation_id: correlationId });
    let userId: string | undefined;
    let q = '';
    try {
      userId = (await authenticateSession(request, deps.auth.sessions)).userId;
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body['q'] !== 'string' || (body['format'] !== 'csv' && body['format'] !== 'json')) return fail(400, 'INVALID_PARAMETER', 'q와 csv 또는 json 형식이 필요합니다.');
      q = body['q'];
      const format = body['format'];
      const sort = body['sort'] ?? DEFAULT_SORT_KEY;
      if (typeof sort !== 'string' || !isSortKey(sort) || (body['order'] !== undefined && body['order'] !== 'asc' && body['order'] !== 'desc')) return fail(400, 'INVALID_PARAMETER', '정렬 조건이 올바르지 않습니다.');
      const ast = parseQuery(q);
      const cached = await deps.auth.scopes.resolveCached(userId);
      const scope = toAccessScope(cached);
      const sequence = await resolveSequenceContext(deps.pool, {
        ast,
        rawEpoch: typeof body['seq_epoch'] === 'number' ? String(body['seq_epoch']) : body['seq_epoch'],
        scope,
      });
      const failure = toSequenceFailure(sequence, correlationId);
      if (failure !== null) return reply.status(failure.status).send(failure.body);
      if (sequence.kind === 'stale') return fail(409, 'INVALID_PARAMETER', '시퀀스 에폭이 변경되었습니다. 검색을 갱신하세요.', 'epoch_stale');

      /*
       * `pr_number:`·`mnum:` (CR-106). `/search`와 같은 파서를 쓰므로 같은
       * 판정을 거친다 — 독립 검토가 이 세 판정 없이 `mnum:`을 내보내면
       * `buildQuery`의 `MergeNumberEpochRequiredError`가 잡히지 않은 채
       * 아래 catch의 일반 503으로 떨어지는 것을 실측으로 잡아냈다.
       */
      const mnumFlagFailure = checkMergeNumberFeatureFlag(ast, deps.mergeNumberEnabled ?? false, correlationId);
      if (mnumFlagFailure !== null) return reply.status(mnumFlagFailure.status).send(mnumFlagFailure.body);
      const prNumberFailure = toPrNumberRangeFailure(analyzePrNumberBinding(ast), correlationId);
      if (prNumberFailure !== null) return reply.status(prNumberFailure.status).send(prNumberFailure.body);
      const mergeNumberRange = await resolveMergeNumberRangeEpoch(
        deps.pool,
        { ast, scope },
        sequence.kind === 'bound'
          ? { repository: sequence.context.repository, baseBranch: sequence.context.base_branch, epoch: sequence.context.seq_epoch }
          : undefined,
      );
      const mergeNumberFailure = toMergeNumberRangeFailure(mergeNumberRange, correlationId);
      if (mergeNumberFailure !== null) return reply.status(mergeNumberFailure.status).send(mergeNumberFailure.body);
      const mergeNumberEpoch = mergeNumberRange.kind === 'bound' ? mergeNumberRange.epoch : null;
      const mergeNumberBaseBranch = mergeNumberRange.kind === 'bound' ? mergeNumberRange.baseBranch : null;

      const resolved = resolveSearchTarget(ast, ['prs-pull-requests', 'prs-commits']);
      const names = collectNames(resolved.ast);
      const resolution = await deps.resolveNames(names);
      const built = buildQuery(resolved.ast, resolution, {
        ...(sequence.kind === 'bound' ? { sequenceEpoch: sequence.epoch } : {}),
        ...(mergeNumberEpoch === null ? {} : { mergeNumberEpoch }),
        // 검색과 같은 판정, 같은 항이다 (CR-114) — 내보내기만 브랜치 없이 에폭 항을 걸지 않는다.
        ...(mergeNumberBaseBranch === null ? {} : { mergeNumberBaseBranch }),
      });
      const plan: ExportPlan = { target: resolved.target, scope, query: built.query, repositoryIds: cached.repositoryIds, sort, order: body['order'] === 'asc' ? 'asc' : 'desc' };
      const storedPlan = { ...plan, q, ...(sequence.kind === 'bound' ? { sequenceContext: sequence.context } : {}) };
      const check = () => searchExportRepo.assertExportScope(deps.pool, { user_id: userId!, scope_version: cached.version, plan: storedPlan });
      await check();
      const scoped = applyMandatoryScopeFilter(built.query, scope);
      let total = 0;
      if (resolved.target !== null) {
        const counted = await search(deps.es, resolved.target, scoped, { size: 0, track_total_hits: EXPORT_LIMIT + 1 });
        assertNoShardFailures(counted);
        if (counted.timed_out || counted.terminated_early) throw new Error('export_partial');
        total = typeof counted.hits.total === 'number' ? counted.hits.total : counted.hits.total?.value ?? 0;
      }
      if (total > EXPORT_LIMIT) {
        await audit(deps.pool, userId, q, 'export_limit_exceeded', null, correlationId);
        return fail(400, 'EXPORT_LIMIT_EXCEEDED', '내보내기는 100,000건까지 가능합니다.', 'export_limit_exceeded');
      }
      if (body['preview'] === true) return reply.header('cache-control', 'no-store').send({ total, mode: total <= 1000 ? 'sync' : 'async' });
      if (total <= 1000) {
        const rows = await collectExport(deps.es, plan, check, true).catch((error: unknown) => {
          if (error instanceof ExportAsyncRequiredError) return null;
          throw error;
        });
        if (rows !== null) {
          const latest = await deps.auth.scopes.resolveCached(userId);
          const user = await authRepo.findUserById(deps.pool, userId);
          if (user === null || user.access_scope_version !== cached.version || latest.version !== cached.version || rows.some((row) => !latest.repositoryIds.includes(Number(row['repository_id'])))) return fail(409, 'PERMISSION_UNAVAILABLE', '접근 권한이 변경되었습니다. 다시 요청하세요.');
          await audit(deps.pool, userId, q, 'completed', null, correlationId);
          return file(reply, serializeExport(rows, format), format);
        }
      }
      const jobId = await searchExportRepo.createExport(deps.pool, { user_id: userId, scope_version: cached.version, repository_ids: [...cached.repositoryIds], format, plan: storedPlan });
      await audit(deps.pool, userId, q, 'queued', jobId, correlationId);
      return reply.status(202).header('cache-control', 'no-store').send({ job_id: jobId, state: 'queued', status_url: `/api/v1/exports/${jobId}`, download_url: null, correlation_id: correlationId });
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath: deps.loginPath });
      if (shape !== null) return sendAuthError(reply, shape);
      if (error instanceof QueryParseError) return fail(400, error.code, error.message);
      if (userId !== undefined) await audit(deps.pool, userId, q, error instanceof ExportLimitError ? 'export_limit_exceeded' : 'failed', null, correlationId);
      if (error instanceof ExportLimitError) return fail(400, 'EXPORT_LIMIT_EXCEEDED', '내보내기는 100,000건까지 가능합니다.', 'export_limit_exceeded');
      return fail(503, 'EXPORT_UNAVAILABLE', '내보내기를 완료하지 못했습니다. 다시 시도하세요.');
    }
  });
  for (const download of [false, true]) {
    app.get(`/api/v1/exports/:id${download ? '/download' : ''}`, async (request, reply) => {
      const correlationId = randomUUID();
      const fail = () => reply.status(404).send({ error: { code: 'NOT_FOUND', message: '내보내기를 찾을 수 없습니다.' }, correlation_id: correlationId });
      try {
        const userId = (await authenticateSession(request, deps.auth.sessions)).userId;
        const id = Number((request.params as { id: string }).id);
        if (!Number.isSafeInteger(id) || id < 1) return fail();
        const row = await searchExportRepo.findExport(deps.pool, id);
        if (row === undefined || row.user_id !== userId) return fail();
        const current = await deps.auth.scopes.resolveCached(userId);
        if (current.version !== row.scope_version || row.repository_ids.some((repo) => !current.repositoryIds.includes(repo))) return fail();
        await searchExportRepo.assertExportScope(deps.pool, row);
        const job = await jobRepo.findJobById(deps.pool, id);
        if (job === undefined) return fail();
        const ready = job.state === 'completed' && row.content !== null;
        if (download) return ready ? file(reply, row.content!, row.format) : fail();
        return reply.header('cache-control', 'private, no-store').send({ job_id: id, state: job.state, total: row.row_count, error: job.error, download_url: ready ? `/api/v1/exports/${id}/download` : null, correlation_id: correlationId });
      } catch (error) {
        const shape = toAuthError(error, { correlationId, loginPath: deps.loginPath });
        if (shape !== null) return sendAuthError(reply, shape);
        return fail();
      }
    });
  }
}
