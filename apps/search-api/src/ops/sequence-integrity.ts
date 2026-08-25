/**
 * 시퀀스 정합성 점검과 재채번 (API-ADM-007 / WP-028, FR-ADMIN-003, CR-033).
 *
 * ## 점검은 관찰이다
 *
 * 이 모듈에는 `sequence_space`를 쓰는 경로가 없다. 그래프를 읽지 못해 점검이
 * 실패해도 공간 상태는 그대로다 (CR-033, DEV-171 / SRS v2.5). `unknown`은 이미
 * "채번된 적 없는 브랜치"라는 뜻으로 API-SEQ-006·C-027·W-004가 표시하고 있어
 * (CR-029), 거기에 "점검 실패"를 얹으면 **한 번의 일시적 그래프 오류가 이미 선
 * 화면들을 거짓말하게 만든다.** 진단 실행의 실패는 진단 결과에 담긴다.
 *
 * ## 검사하지 않은 것을 "일치"라고 적지 않는다
 *
 * 실패한 점검은 `check_state: "failed"`이며 `consistent`를 아예 싣지 않는다.
 * 실패를 `consistent: true`로 표현하면 그 한 줄이 거짓이다 (DEV-133과 같은 규율).
 */

import { integrityRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { firstSequenceMismatch, sampleFromSeq, type SequenceMismatch } from '@prs/domain';
import { CommitGraphError, type CommitGraph } from '@prs/github';
import { QueryParseError, parseQuery, type QueryAst } from '@prs/query';

export type IntegrityMode = 'sample' | 'full';

export function parseIntegrityMode(raw: unknown): IntegrityMode | null {
  if (raw === undefined || raw === null || raw === '') return 'sample';
  if (raw === 'sample' || raw === 'full') return raw;
  return null;
}

export interface IntegrityDeps {
  readonly pool: Pool;
  /** 저장소별로 미러/API 중 무엇을 쓸지 고른 그래프 (ADR-005, `selectCommitGraph`). */
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
}

export interface ImpactEstimate {
  readonly affected_commit_count: number;
  readonly invalidated_safe_marker_count: number;
  readonly affected_saved_search_count: number;
}

export type IntegrityOutcome =
  | {
      readonly kind: 'completed';
      readonly seqEpoch: number;
      readonly checkedCount: number;
      readonly consistent: boolean;
      readonly firstMismatch: SequenceMismatch | null;
      readonly impact: ImpactEstimate | null;
    }
  /** 그래프를 읽지 못했다. **공간 상태는 바꾸지 않는다** (CR-033, DEV-171). */
  | {
      readonly kind: 'failed';
      readonly seqEpoch: number;
      readonly reason: 'commit_graph_unavailable' | 'branch_head_missing';
      readonly message: string;
    }
  | { readonly kind: 'not_found'; readonly message: string };

/**
 * 저장된 서수-커밋 대응을 실제 first-parent 체인과 대조한다.
 *
 * 체인은 **처음부터** 걷는다. `merge_seq`는 `git rev-list --first-parent
 * --reverse`의 1-기반 서수이므로(ADR-007) 배열 첨자가 곧 서수 대응이고, 표본
 * 모드는 그 대응 중 **뒤쪽 1000개만** 본다. 중간부터 걸으면 시작점 자체가
 * 저장분에서 온 값이라, 히스토리가 그 앞에서 바뀌었을 때 **바뀐 사실이 대조에서
 * 사라진다** — 검증의 기준을 검증 대상에서 가져오는 셈이다.
 */
export async function runIntegrityCheck(
  deps: IntegrityDeps,
  input: { readonly repository: RepositoryRow; readonly baseBranch: string; readonly mode: IntegrityMode },
): Promise<IntegrityOutcome> {
  const { repository, baseBranch, mode } = input;
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
  if (space === undefined) {
    return { kind: 'not_found', message: `채번된 적이 없는 시퀀스 공간이다: ${repository.owner}/${repository.name}@${baseBranch}` };
  }

  const headSeq = Number(space.head_seq);
  const fromSeq = mode === 'full' ? 1 : sampleFromSeq(headSeq);
  const stored = await integrityRepo.listStoredSequence(
    deps.pool,
    repository.repository_id,
    baseBranch,
    space.seq_epoch,
    fromSeq,
  );

  const graph = deps.graphFor(repository);
  const ref = { owner: repository.owner, repo: repository.name };
  let actual: readonly string[];
  try {
    const head = await graph.resolveHead(ref, baseBranch);
    if (head === null) {
      /*
       * 브랜치가 사라졌다. 이것은 그래프 오류가 아니라 **실측된 사실**이지만,
       * 저장분과 대조할 체인이 없으므로 "일치/불일치"를 말할 수 없다. 점검을
       * 실패로 끝내고 사유를 밝힌다 — 공간 상태는 여기서도 바꾸지 않는다.
       */
      return {
        kind: 'failed',
        seqEpoch: space.seq_epoch,
        reason: 'branch_head_missing',
        message: `대상 브랜치를 찾을 수 없어 점검을 마치지 못했습니다: ${baseBranch}`,
      };
    }
    actual = await graph.firstParentRevList(ref, { from: null, to: head });
  } catch (error) {
    if (!(error instanceof CommitGraphError)) throw error;
    return {
      kind: 'failed',
      seqEpoch: space.seq_epoch,
      reason: 'commit_graph_unavailable',
      message: '커밋 그래프를 읽을 수 없어 점검을 마치지 못했습니다.',
    };
  }

  const mismatch = firstSequenceMismatch(stored, actual);
  if (mismatch === null) {
    return {
      kind: 'completed',
      seqEpoch: space.seq_epoch,
      checkedCount: stored.length,
      consistent: true,
      firstMismatch: null,
      impact: null,
    };
  }

  return {
    kind: 'completed',
    seqEpoch: space.seq_epoch,
    checkedCount: stored.length,
    consistent: false,
    firstMismatch: mismatch,
    impact: await estimateImpact(deps, repository, baseBranch, space.seq_epoch, mismatch.mergeSeq),
  };
}

/**
 * 재채번이 무엇을 무효로 만드는지 **실제 데이터로** 센다.
 *
 * 계산하지 않은 항목을 `0`으로 채우지 않는다 (DEV-133). 세 항목 모두 질의가
 * 성립하므로 여기서 나온 0은 "세어 보니 없다"이며, 그것은 참이다.
 */
async function estimateImpact(
  deps: IntegrityDeps,
  repository: RepositoryRow,
  baseBranch: string,
  seqEpoch: number,
  fromSeq: number,
): Promise<ImpactEstimate> {
  const slug = `${repository.owner}/${repository.name}`;
  const [commits, markers, queries] = await Promise.all([
    integrityRepo.countAffectedCommits(deps.pool, repository.repository_id, baseBranch, seqEpoch, fromSeq),
    integrityRepo.countInvalidatedSafeMarkers(deps.pool, repository.repository_id, baseBranch, seqEpoch, fromSeq),
    integrityRepo.listSavedSearchQueries(deps.pool),
  ]);
  return {
    affected_commit_count: commits,
    invalidated_safe_marker_count: markers,
    affected_saved_search_count: countAffectedSavedSearches(queries, slug, baseBranch),
  };
}

/** 한 질의에서 어떤 키의 값들을 op별로 모은다. */
function valuesOf(ast: QueryAst, key: 'repo' | 'base', negated: boolean): readonly string[] {
  const want = negated ? 'not_eq' : 'eq';
  return ast.filters.flatMap((filter) =>
    filter.key === key && filter.op === want && 'values' in filter ? filter.values : [],
  );
}

/**
 * 이 질의가 대상 공간의 재채번으로 **의미가 바뀔 수 있는가** (CR-033, DEV-173).
 *
 * 세는 것은 *"정확히 이 공간만 가리키는 검색"*이 아니라 *"바뀔 가능성이 있는
 * 검색"*이다. 그래서 **좁히지 않은 질의는 후보에 넣는다** — `repo:`가 없는
 * 검색은 대상 저장소도 포함하므로, 빼면 영향을 실제보다 작게 보고하게 된다.
 *
 * 반대로 `seq` 술어가 없으면 재채번이 그 질의의 뜻을 바꾸지 않는다. 서수의
 * 의미가 바뀌는 것이 재채번이고, 서수를 묻지 않는 검색은 그 영향 밖이다.
 */
export function isAffectedByReassign(ast: QueryAst, repositorySlug: string, baseBranch: string): boolean {
  if (!ast.filters.some((filter) => filter.key === 'seq')) return false;

  const lower = repositorySlug.toLowerCase();
  const repos = valuesOf(ast, 'repo', false);
  if (repos.length > 0 && !repos.some((value) => value.toLowerCase() === lower)) return false;
  // 명시적으로 제외한 검색은 영향받지 않는다 (`-repo:acme/payments`).
  if (valuesOf(ast, 'repo', true).some((value) => value.toLowerCase() === lower)) return false;

  const bases = valuesOf(ast, 'base', false);
  if (bases.length > 0 && !bases.includes(baseBranch)) return false;
  if (valuesOf(ast, 'base', true).includes(baseBranch)) return false;

  return true;
}

/**
 * 영향받는 저장 검색 수.
 *
 * **문자열을 훑지 않고 파서를 쓴다** (CR-033, DEV-173). `"seq:"`가 인용 안의
 * 본문이거나 부정 필터일 때 문자열 검색은 전부 오답을 낸다.
 *
 * 파싱에 실패하는 질의는 세지 않는다 — 이미 실행 불가능한 검색이며, 영향 수를
 * 부풀리는 것은 운영자가 재채번을 판단하는 근거를 나쁘게 만든다.
 */
export function countAffectedSavedSearches(
  queries: readonly string[],
  repositorySlug: string,
  baseBranch: string,
): number {
  let affected = 0;
  for (const raw of queries) {
    let ast: QueryAst;
    try {
      ast = parseQuery(raw);
    } catch (error) {
      if (error instanceof QueryParseError) continue;
      throw error;
    }
    if (isAffectedByReassign(ast, repositorySlug, baseBranch)) affected += 1;
  }
  return affected;
}

/**
 * 재채번 요청의 확인 문자열 검증 (FLOW-008).
 *
 * 저장소 이름과 **정확히** 같아야 한다. 공백을 다듬거나 대소문자를 무시하지
 * 않는다 — 이 값의 목적은 운영자가 지금 무엇을 되돌릴 수 없게 만드는지 한 번
 * 더 읽게 하는 것이고, 관대해질수록 그 목적에서 멀어진다.
 */
export function confirmationMatches(confirmation: unknown, repositorySlug: string): boolean {
  return typeof confirmation === 'string' && confirmation === repositorySlug;
}

/** 재채번 뒤 예상 에폭. 고정값이 아니라 현재 에폭에서 계산한다. */
export async function expectedNewEpoch(
  pool: Pool,
  repositoryId: number,
  baseBranch: string,
): Promise<number | null> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, repositoryId, baseBranch);
  return space === undefined ? null : space.seq_epoch + 1;
}
