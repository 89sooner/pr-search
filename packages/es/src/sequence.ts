/**
 * 채번 결과를 문서에 반영한다 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * PostgreSQL이 시퀀스의 정본이고 (`merge_sequence`), Elasticsearch는 그것을
 * 조회 가능하게 비친 것이다 (ADR-004). **PostgreSQL 커밋이 먼저다** — 여기서
 * 실패해도 시퀀스 값은 살아 있고 다음 회차가 다시 비춘다.
 *
 * `document_version`은 건드리지 않는다. 시퀀스는 웹훅이 나르는 엔티티 상태가
 * 아니라 이 시스템이 git 히스토리에서 파생한 값이라 버전 비교의 대상이 아니다
 * — `markRepositoryArchived`가 등록 상태를 다루는 것과 같은 원리다. 버전을
 * 올리면 뒤늦게 도착한 정상 웹훅이 "오래된 이벤트"로 밀려 사라진다.
 */

import type { Client } from '@elastic/elasticsearch';

/**
 * 커밋 하나에 붙일 시퀀스.
 *
 * `sequenceSpace`는 **표시용 문자열**이다 (CR-025, DEV-119). 범위 질의는
 * `repository_id` + `base_branch`로 거르며 이 값을 필터로 쓰지 않는다 —
 * 저장소 이름이 바뀌면 같은 공간이 두 문자열로 갈라져 범위 조회가 오류 없이
 * 절반만 돌려준다.
 */
export interface SequenceAssignment {
  readonly commitSha: string;
  readonly mergeSeq: number;
}

export interface ApplySequenceInput {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly sequenceSpace: string;
  readonly assignments: readonly SequenceAssignment[];
}

export interface ApplySequenceResult {
  /** 별칭별 갱신 문서 수. */
  readonly updated: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * 한 번에 보내는 커밋 수.
 *
 * 스크립트 파라미터로 SHA→서수 표를 통째로 넘기므로 요청 크기가 커밋 수에
 * 비례한다. 백필 직후의 첫 채번은 수만 건이 될 수 있어 잘라 보낸다.
 */
export const SEQUENCE_CHUNK = 1_000;

/**
 * 커밋 문서와 PR 문서에 서수를 붙인다.
 *
 * ## 커밋과 PR을 다르게 다루는 이유
 *
 * 커밋 문서는 `commit_sha`로 직접 찾는다. PR 문서는 **머지 커밋의 SHA**로
 * 찾는다(`merge_commit_sha`) — PR의 서수는 그 PR이 대상 브랜치에 들어간
 * 지점의 서수이고, 그것이 곧 머지 커밋의 서수다. 원본 커밋(`source_commit_shas`)
 * 으로 찾으면 아직 머지되지 않은 PR까지 서수를 받게 된다.
 *
 * ## `_routing`을 반드시 넘긴다
 *
 * `prs-commits`는 12샤드, `prs-pull-requests`는 6샤드이고 문서는 모두
 * `repository_id`로 라우팅되어 있다. 라우팅 없이 질의하면 전 샤드를 훑어
 * 느려지기만 하는 게 아니라, 이 갱신이 저장소 하나에만 닿아야 한다는 사실이
 * 질의 조건에만 남는다.
 */
export async function applySequenceToDocuments(
  client: Client,
  input: ApplySequenceInput,
): Promise<ApplySequenceResult> {
  const updated: Record<string, number> = { 'prs-commits': 0, 'prs-pull-requests': 0 };

  for (let offset = 0; offset < input.assignments.length; offset += SEQUENCE_CHUNK) {
    const chunk = input.assignments.slice(offset, offset + SEQUENCE_CHUNK);
    const seqBySha: Record<string, number> = {};
    for (const entry of chunk) seqBySha[entry.commitSha.toLowerCase()] = entry.mergeSeq;
    const shas = Object.keys(seqBySha);
    if (shas.length === 0) continue;

    updated['prs-commits'] =
      (updated['prs-commits'] ?? 0) +
      (await updateOne(client, input, 'prs-commits', 'commit_sha', shas, seqBySha));
    updated['prs-pull-requests'] =
      (updated['prs-pull-requests'] ?? 0) +
      (await updateOne(client, input, 'prs-pull-requests', 'merge_commit_sha', shas, seqBySha));
  }

  return { updated, total: Object.values(updated).reduce((sum, n) => sum + n, 0) };
}

async function updateOne(
  client: Client,
  input: ApplySequenceInput,
  alias: string,
  shaField: string,
  shas: readonly string[],
  seqBySha: Readonly<Record<string, number>>,
): Promise<number> {
  const response = await client.updateByQuery({
    index: alias,
    routing: String(input.repositoryId),
    refresh: true,
    /*
     * 충돌은 넘긴다. 같은 문서를 투영이 동시에 갱신 중이면 다음 채번 회차가
     * 잡는다 — 여기서 요청 전체를 실패시키면 나머지 문서까지 서수를 놓친다.
     */
    conflicts: 'proceed',
    query: {
      bool: {
        filter: [
          { term: { repository_id: input.repositoryId } },
          { terms: { [shaField]: [...shas] } },
        ],
      },
    },
    script: {
      lang: 'painless',
      /*
       * 두 가지를 스크립트 안에서 확인한다.
       *
       * 1. **필드가 없을 수 있다.** 머지되지 않은 PR에는 `merge_commit_sha`가
       *    없다. 없는 값에 `.toLowerCase()`를 부르면 갱신 전체가 깨진다.
       * 2. **표에 없는 SHA는 건드리지 않는다.** `terms` 필터가 이미 걸렀지만,
       *    스크립트가 자기 입력을 확인하지 않으면 필터가 한 번 틀렸을 때
       *    `null` 서수가 문서에 박힌다.
       *
       * 대조 전에 소문자로 내린다. 색인은 `lowercase_normalizer`가 정규화하지만
       * `_source`는 들어온 대로 남으므로, 투영의 대소문자 처리에 이 갱신이
       * 매달리지 않게 한다.
       */
      source:
        'def v = ctx._source.' +
        shaField +
        '; if (v != null) { def s = params.seq.get(v.toLowerCase());' +
        ' if (s != null) { ctx._source.merge_seq = s; ctx._source.seq_epoch = params.epoch;' +
        ' ctx._source.sequence_space = params.space; ctx._source.base_branch = params.branch; } }',
      params: {
        seq: seqBySha,
        epoch: input.seqEpoch,
        space: input.sequenceSpace,
        branch: input.baseBranch,
      },
    },
  });

  return Number(response.updated ?? 0);
}
