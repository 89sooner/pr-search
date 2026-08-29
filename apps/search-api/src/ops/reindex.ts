/**
 * API-ADM-004 무중단 재색인 시작 (WP-035 / FR-ING-008, CR-045~047).
 *
 * ## `alias`만 받는다 (DEV-294)
 *
 * 클라이언트가 `prs-pull-requests-v9` 같은 구체 인덱스를 지목하면 **이미 서비스
 * 중인 인덱스를 대상으로 삼는 요청이 성립한다.** 다음 버전을 정하는 것은
 * 서버이며, 서버는 "아직 쓰이지 않은 다음 번호"를 고른다 (DEV-309).
 *
 * ## enqueue seam은 하나다 (DEV-302)
 *
 * 이 라우트와 CLI가 **같은 `enqueueReindex`**를 부른다. 두 진입점이 각자
 * 알고리즘을 만들면 한쪽만 상한을 보거나 한쪽만 다음 버전을 다르게 고르고,
 * 그 차이는 두 경로를 모두 써 본 사람만 발견한다.
 */

import { jobRepo, reindexRepo, type Pool, type ReindexIndexPort } from '@prs/db';

import { AdminRejected } from './errors.js';
import type { AuditLog } from '../audit/recorder.js';

export interface ReindexDeps {
  readonly pool: Pool;
  /** 감사 기록 실패를 남길 곳. 없으면 지표만 오른다 (WP-039). */
  readonly log?: AuditLog;
  /** 색인 이름을 아는 쪽. `@prs/db`가 Elasticsearch를 의존하지 않게 한다. */
  readonly index: ReindexIndexPort;
}

/**
 * 재색인 잡을 만든다.
 *
 * 상한을 넘으면 `409 REINDEX_BUSY`이며 **실행 중인 별칭을 함께 알려 준다** —
 * 운영자가 무엇을 기다려야 하는지 알아야 다음을 고른다.
 */
export async function startReindex(
  deps: ReindexDeps,
  alias: unknown,
  requestedBy: string,
): Promise<Record<string, unknown>> {
  if (typeof alias !== 'string' || alias === '') {
    throw new AdminRejected('INVALID_PARAMETER', 'alias는 안정 별칭 문자열이어야 한다');
  }

  const outcome = await reindexRepo.enqueueReindex(deps.pool, deps.index, alias, requestedBy);

  switch (outcome.kind) {
    case 'invalid_alias':
      throw new AdminRejected('INVALID_PARAMETER', '알 수 없는 별칭이다 — 구체 인덱스는 받지 않는다', {
        alias: outcome.value,
      });
    case 'conflict':
      throw new AdminRejected('JOB_CONFLICT', '같은 별칭에 활성 재색인이 이미 있다', { alias: outcome.alias });
    case 'busy':
      /*
       * 전 별칭을 통틀어 활성 재색인은 하나뿐이다 (DEV-300) — 재색인은 클러스터
       * 자원을 통째로 쓰므로 일반 잡의 동시 실행 3을 적용하지 않는다.
       */
      throw new AdminRejected('REINDEX_BUSY', '다른 별칭이 재색인 중이다', { alias: outcome.alias });
    case 'queued': {
      const job = await jobRepo.findJobById(deps.pool, outcome.jobId);
      if (job === undefined) throw new Error('생성한 재색인 잡을 다시 읽지 못했다');
      return {
        job_id: job.job_id,
        type: job.type,
        state: job.state,
        alias,
        source_index: outcome.sourceIndex,
        target_index: outcome.targetIndex,
      };
    }
  }
}
