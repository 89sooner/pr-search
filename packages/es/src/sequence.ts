/**
 * 채번 결과를 문서에 반영한다 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * PostgreSQL이 시퀀스의 정본이고 (`merge_sequence`), Elasticsearch는 그것을
 * 조회 가능하게 비친 것이다 (ADR-004). **PostgreSQL 커밋이 먼저다** — 여기서
 * 실패해도 시퀀스 값은 살아 있고 durable 투영 작업이 다시 비춘다 (CR-113).
 *
 * ## 서수 쓰기는 이 파일에 없다 (CR-113)
 *
 * 옛 `applySequenceToDocuments`(SHA 목록 `update_by_query`)는 없는 문서와 가드에 걸린
 * 문서를 말하지 못해 누락이 성공처럼 지나갔다. 서수는 이제 `sequence-projection.ts`의
 * 문서 단위 투영기만 쓴다. 여기 남은 것은 에폭 상향과 PR 조회다.
 *
 * `document_version`은 건드리지 않는다. 시퀀스는 웹훅이 나르는 엔티티 상태가
 * 아니라 이 시스템이 git 히스토리에서 파생한 값이라 버전 비교의 대상이 아니다
 * — `markRepositoryArchived`가 등록 상태를 다루는 것과 같은 원리다. 버전을
 * 올리면 뒤늦게 도착한 정상 웹훅이 "오래된 이벤트"로 밀려 사라진다.
 */

import type { Client } from '@elastic/elasticsearch';
import { search } from './search.js';
import { applyMandatoryScopeFilter } from './scoped-query.js';
import { dualWrite, type WriteTargets } from './write-targets.js';

/** 한 인덱스에서의 `update_by_query` 판정 재료. `updated`만 보면 안 된다 (CR-113). */
export interface UpdateByQueryTally {
  readonly updated: number;
  readonly noops: number;
  readonly version_conflicts: number;
  readonly failures: number;
  readonly timed_out: boolean;
  readonly total: number;
}

export interface ApplySequenceResult {
  /** 별칭별 갱신 문서 수. */
  readonly updated: Readonly<Record<string, number>>;
  readonly total: number;
  /** 별칭별 판정 재료. 충돌·실패·시간 초과가 있으면 `complete`가 아니다. */
  readonly tallies: Readonly<Record<string, UpdateByQueryTally>>;
  /**
   * 세 별칭 모두 충돌·실패·시간 초과 없이 끝났는가. 아니면 호출 측은 durable
   * full sweep에 맡긴다 — 재채번·복구는 같은 트랜잭션에서 그것을 이미 요청했다.
   */
  readonly complete: boolean;
}

function tallyOf(response: {
  readonly updated?: number;
  readonly noops?: number;
  readonly version_conflicts?: number;
  readonly failures?: readonly unknown[];
  readonly timed_out?: boolean;
  readonly total?: number;
}): UpdateByQueryTally {
  return {
    updated: Number(response.updated ?? 0),
    noops: Number(response.noops ?? 0),
    version_conflicts: Number(response.version_conflicts ?? 0),
    failures: (response.failures ?? []).length,
    timed_out: response.timed_out === true,
    total: Number(response.total ?? 0),
  };
}

function isCompleteTally(tally: UpdateByQueryTally): boolean {
  return tally.version_conflicts === 0 && tally.failures === 0 && !tally.timed_out;
}

/**
 * 재채번 뒤 문서의 에폭을 새 값으로 올린다 (WP-022 / CR-026, DEV-129).
 *
 * base 이전 구간은 **서수가 같아도 에폭은 바뀐다** — 인용은 `(seq, epoch)`
 * 쌍이고(ADR-007 규칙 5), 문서가 옛 에폭을 달고 있으면 조회가 그 문서를
 * `epoch_stale`로 오판한다. 문서 단위 투영기로 전체를 넘기면 요청이 저장소
 * 크기에 비례하므로, 에폭만 올리는 갱신은 `update_by_query` 하나로 먼저 하고
 * 정확한 서수·공간은 durable full sweep이 문서마다 다시 확인한다 (CR-113).
 *
 * **`merge_seq`가 있는 문서만 만진다.** 서수를 받은 적 없는 문서에 에폭을
 * 붙이면 "서수 없이 에폭만 있는" 반쪽 상태가 생긴다 — API 계약 DTO 표준이
 * 셋(seq·epoch·space)을 함께 반환하라고 못박은 이유와 같다.
 *
 * `document_version`은 건드리지 않는다.
 */
export async function applyEpochBump(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly newEpoch: number;
    readonly sequenceSpace: string;
  },
  targets: WriteTargets,
): Promise<ApplySequenceResult> {
  const updated: Record<string, number> = {};
  const tallies: Record<string, UpdateByQueryTally> = {};
  let total = 0;

  for (const alias of ['prs-commits', 'prs-pull-requests'] as const) {
    const tally = await dualWrite(targets, alias, 'update_by_query', async (index) => {
    const response = await client.updateByQuery({
      index,
      routing: String(input.repositoryId),
      refresh: true,
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [
            { term: { repository_id: input.repositoryId } },
            { term: { base_branch: input.baseBranch } },
            { exists: { field: 'merge_seq' } },
          ],
          // 이미 새 에폭인 문서는 건드리지 않는다. 재실행이 싸진다.
          must_not: [{ term: { seq_epoch: input.newEpoch } }],
        },
      },
      script: {
        lang: 'painless',
        source: 'ctx._source.seq_epoch = params.epoch; ctx._source.sequence_space = params.space;',
        params: { epoch: input.newEpoch, space: input.sequenceSpace },
      },
    });
      return tallyOf(response);
    });
    tallies[alias] = tally;
    updated[alias] = tally.updated;
    total += tally.updated;
  }

  /*
   * `updated`만으로 완료를 말하지 않는다 (CR-113). 충돌(`conflicts: 'proceed'`가 넘긴 것)·
   * 실패·시간 초과가 하나라도 있으면 일부 문서가 옛 에폭으로 남았을 수 있다 — 그 문서는
   * 재채번이 같은 트랜잭션에서 요청한 full sweep이 정본 값으로 다시 쓴다.
   */
  return { updated, total, tallies, complete: Object.values(tallies).every(isCompleteTally) };
}

/**
 * 이 머지 커밋에 대응하는 PR 번호 (CR-025, DEV-118).
 *
 * ## 접근 범위를 우회하지 않는다
 *
 * 처음에는 `client.search`를 직접 부르고 아키텍처 시험의 허용 목록에 넣으려
 * 했다. **그것이 틀렸다.** 이 잡은 자기가 채번하는 **저장소 하나**만 보면
 * 되고, 그 사실은 예외가 아니라 **정확한 접근 범위**다. 그래서 저장소 하나짜리
 * `explicit` 범위를 만들어 필수 필터를 그대로 통과한다 — 불변식에 구멍을 내지
 * 않으면서, 코드가 "이 잡은 이 저장소만 본다"를 스스로 말한다.
 *
 * 허용 목록에 넣었다면 그 목록이 워커 수만큼 늘어나고, 사용자 대면 예외
 * (DEV-051)와 시스템 내부 조회가 한 목록에서 섞였을 것이다.
 *
 * @returns 대응하는 PR을 모르면 `null`. 직접 푸시이거나 아직 그 PR이 투영되지
 * 않았다는 뜻이며, 둘을 여기서 가르지 않는다 — 어느 쪽이든 지금은 모른다.
 */
export async function findPullRequestByMergeCommit(
  client: Client,
  repositoryId: number,
  commitSha: string,
): Promise<number | null> {
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { merge_commit_sha: commitSha.toLowerCase() } }] } },
    { kind: 'explicit', repositoryIds: [repositoryId] },
  );

  const response = await search<{ pr_number?: number }>(client, 'prs-pull-requests', scoped, {
    size: 1,
    _source: ['pr_number'],
    routing: String(repositoryId),
  });

  const found = response.hits.hits[0]?._source?.pr_number;
  return typeof found === 'number' ? found : null;
}
