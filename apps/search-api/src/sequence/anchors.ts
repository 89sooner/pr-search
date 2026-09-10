/**
 * 앵커 정규화 (API-SEQ-002, FR-SEQ-003).
 *
 * "어떤 형태든 하나의 시퀀스 값으로." 표현을 유형으로 가르는 것은 `@prs/domain`의
 * `classifyAnchor`가 하고(화면과 공유한다), 여기서는 그 유형을 **이 저장소의 이
 * 에폭에서** 실제 서수로 바꾼다.
 *
 * ## 정본은 PostgreSQL이다 (CR-027, DEV-130)
 *
 * 다섯 유형 중 넷이 `merge_sequence` 조회 하나로 끝난다. 그 표가 first-parent
 * walk의 결과 그 자체이므로, **"이 커밋이 대상 브랜치 체인에 있는가"라는 물음이
 * 곧 "이 표에 행이 있는가"** 가 된다 — AC-2가 요구하는 판정에 별도의 그래프 호출이
 * 필요 없다.
 *
 * Elasticsearch를 부르는 곳은 한 군데뿐이다: 체인 밖 커밋의 **대체 앵커 제안**.
 * 원본 커밋과 머지 커밋의 대응은 PR 문서에만 있다.
 */

import { mergeSequenceRepo, releaseRepo } from '@prs/db';
import type { Pool, SequencePoint } from '@prs/db';
import {
  SUPPORTED_ANCHOR_FORMATS,
  boundaryOf,
  classifyAnchor,
  type AnchorPosition,
} from '@prs/domain';
import { applyMandatoryScopeFilter, search, type AccessScope } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import type { ResolvedSpace } from './space.js';

/** 한 요청이 담을 수 있는 앵커 수. `from`·`to` 둘이 정상이고, 여유를 조금 둔다. */
export const MAX_ANCHORS = 8;

export interface AnchorInput {
  readonly position: AnchorPosition;
  readonly expression: string;
}

/** 정규화 성공. AC-5가 요구하는 넷(원본 표현·서수·커밋 SHA·에폭)을 모두 담는다. */
export interface ResolvedAnchor {
  readonly position: AnchorPosition;
  readonly expression: string;
  readonly kind: 'sequence' | 'pull_request' | 'commit' | 'time' | 'release';
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly boundary: 'exclusive' | 'inclusive';
  readonly occurred_at: string;
}

/** 대체 앵커 제안 (FR-SEQ-003 AC-2). 오류로 끝내지 않고 다음 수를 준다. */
export interface SuggestedAnchor {
  readonly kind: 'commit';
  readonly commit_sha: string;
  readonly reason: string;
}

export interface AnchorFailure {
  readonly position: AnchorPosition;
  readonly expression: string;
  readonly code:
    | 'ANCHOR_NOT_ON_BRANCH'
    | 'ANCHOR_NOT_MERGED'
    | 'ANCHOR_UNRESOLVABLE'
    | 'SEQUENCE_SPACE_MISMATCH';
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export type AnchorOutcome =
  | { readonly kind: 'resolved'; readonly anchor: ResolvedAnchor }
  | { readonly kind: 'failed'; readonly failure: AnchorFailure };

export interface AnchorDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly timeoutMs?: number;
}

/**
 * 체인 밖 커밋을 대상 브랜치에 반영한 머지 커밋을 찾는다 (AC-2).
 *
 * PR 문서의 `source_commit_shas`가 그 대응을 갖는다. **`base_branch`까지 좁히는
 * 이유**는 같은 커밋이 여러 브랜치로 머지될 수 있어서다 — 다른 브랜치의 머지
 * 커밋을 제안하면 그것은 또 체인 밖이다.
 *
 * 찾더라도 그 머지 커밋이 실제로 이 에폭의 체인에 있는지 확인한다. 확인 없이
 * 제안하면 사용자가 그대로 넣었을 때 같은 오류가 한 번 더 난다.
 */
async function suggestMergeCommit(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  sha: string,
): Promise<SuggestedAnchor | null> {
  const scoped = applyMandatoryScopeFilter(
    {
      bool: {
        filter: [
          { term: { repository_id: space.repositoryId } },
          { term: { base_branch: space.baseBranch } },
          { term: { source_commit_shas: sha.toLowerCase() } },
        ],
      },
    },
    scope,
  );

  const response = await search<{ merge_commit_sha?: string }>(deps.es, 'prs-pull-requests', scoped, {
    size: 1,
    _source: ['merge_commit_sha'],
    routing: String(space.repositoryId),
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });

  const mergeSha = response.hits.hits[0]?._source?.merge_commit_sha;
  if (mergeSha === undefined || mergeSha === '') return null;

  const point = await mergeSequenceRepo.findPointByCommit(
    deps.pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    mergeSha,
  );
  if (point === null) return null;

  return {
    kind: 'commit',
    commit_sha: mergeSha.toLowerCase(),
    reason: '이 커밋을 대상 브랜치에 반영한 머지 커밋',
  };
}

function resolved(
  input: AnchorInput,
  kind: ResolvedAnchor['kind'],
  point: SequencePoint,
): AnchorOutcome {
  return {
    kind: 'resolved',
    anchor: {
      position: input.position,
      expression: input.expression,
      kind,
      merge_seq: point.mergeSeq,
      commit_sha: point.commitSha,
      boundary: boundaryOf(input.position),
      occurred_at: point.committedAt.toISOString(),
    },
  };
}

function failed(
  input: AnchorInput,
  code: AnchorFailure['code'],
  message: string,
  detail: Readonly<Record<string, unknown>> = {},
): AnchorOutcome {
  return {
    kind: 'failed',
    failure: {
      position: input.position,
      expression: input.expression,
      code,
      message,
      detail: { expression: input.expression, ...detail },
    },
  };
}

/**
 * 앵커 하나를 서수로 바꾼다.
 *
 * 유형별 처리는 문서의 판정 순서 표(API-SEQ-002)와 1:1이다.
 */
export async function resolveAnchor(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  input: AnchorInput,
): Promise<AnchorOutcome> {
  const expression = classifyAnchor(input.expression);
  const { repositoryId, baseBranch, seqEpoch } = space;

  switch (expression.kind) {
    case 'sequence': {
      /*
       * 값이 이미 서수다. 그래도 실재를 확인한다 — 없는 서수를 그대로 받으면
       * 구간이 조용히 비고, 사용자는 "그 구간에 아무것도 없다"로 읽는다.
       */
      const point = await mergeSequenceRepo.findPointBySeq(
        deps.pool,
        repositoryId,
        baseBranch,
        seqEpoch,
        expression.value,
      );
      if (point === null) {
        return failed(
          input,
          'ANCHOR_UNRESOLVABLE',
          `이 시퀀스 공간에 없는 서수입니다: ${String(expression.value)}`,
          { sequence_space: space.sequenceSpace, seq_epoch: seqEpoch, head_seq: space.headSeq },
        );
      }
      return resolved(input, 'sequence', point);
    }

    case 'pull_request': {
      const point = await mergeSequenceRepo.findPointByPullRequest(
        deps.pool,
        repositoryId,
        baseBranch,
        seqEpoch,
        expression.number,
      );
      if (point !== null) return resolved(input, 'pull_request', point);

      /*
       * 이 표에 없다는 것은 **머지 커밋이 이 체인에 없다**는 뜻이다. 두 가지가
       * 그 원인일 수 있고, 사용자가 해야 할 일이 서로 다르므로 갈라 준다:
       * 아직 머지되지 않았거나(AC-3), 다른 브랜치로 머지됐거나(공간 불일치).
       */
      const state = await pullRequestState(deps, space, scope, expression.number);
      if (state.kind === 'other_branch') {
        return failed(
          input,
          'SEQUENCE_SPACE_MISMATCH',
          `이 PR은 ${space.sequenceSpace}가 아니라 ${state.baseBranch} 브랜치로 머지됩니다.`,
          { sequence_space: space.sequenceSpace, pull_request_base_branch: state.baseBranch },
        );
      }
      return failed(
        input,
        'ANCHOR_NOT_MERGED',
        `머지되지 않은 PR은 앵커가 될 수 없습니다: #${String(expression.number)}`,
        { pr_number: expression.number },
      );
    }

    case 'commit': {
      const points =
        expression.match === 'exact'
          ? await exactCommit(deps.pool, space, expression.sha)
          : await mergeSequenceRepo.findPointsByCommitPrefix(
              deps.pool,
              repositoryId,
              baseBranch,
              seqEpoch,
              expression.sha,
            );

      if (points.length === 1) return resolved(input, 'commit', points[0]!);

      if (points.length > 1) {
        /*
         * 접두가 둘 이상에 걸렸다. 하나를 골라 주면 사용자는 자기가 뜻하지 않은
         * 구간을 보고도 그 사실을 모른다 (ADR-012).
         */
        return failed(
          input,
          'ANCHOR_UNRESOLVABLE',
          `축약 SHA가 둘 이상의 커밋에 해당합니다: ${expression.sha}`,
          { ambiguous: true, min_length: expression.sha.length + 1 },
        );
      }

      // 체인에 없다. 머지 커밋을 대체 앵커로 제안한다 (AC-2).
      const suggested = await suggestMergeCommit(deps, space, scope, expression.sha);
      return failed(
        input,
        'ANCHOR_NOT_ON_BRANCH',
        `이 커밋은 ${space.sequenceSpace}의 first-parent 체인에 없습니다.`,
        suggested === null ? {} : { suggested_anchor: suggested },
      );
    }

    case 'time': {
      const point = await mergeSequenceRepo.findPointAtOrBefore(
        deps.pool,
        repositoryId,
        baseBranch,
        seqEpoch,
        new Date(expression.instant),
      );
      if (point === null) {
        return failed(
          input,
          'ANCHOR_UNRESOLVABLE',
          `이 시각 이전에 대상 브랜치의 커밋이 없습니다: ${expression.instant}`,
          { instant: expression.instant },
        );
      }
      return resolved(input, 'time', point);
    }

    case 'release':
      return resolveReleaseTagAnchor(deps, space, scope, input, expression.tag);

    case 'ambiguous':
      return failed(input, 'ANCHOR_UNRESOLVABLE', '앵커가 두 가지 이상으로 읽힙니다.', {
        candidates: expression.candidates,
        supported_formats: SUPPORTED_ANCHOR_FORMATS,
      });

    default:
      return failed(input, 'ANCHOR_UNRESOLVABLE', expression.reason, {
        supported_formats: SUPPORTED_ANCHOR_FORMATS,
      });
  }
}

/**
 * 40자 SHA. 유일 색인이 있으므로 0건 아니면 1건이다.
 *
 * 접두 경로와 같은 모양(배열)으로 돌려주어 호출 측이 길이 하나로 판정하게 한다 —
 * 유형별로 분기가 갈라지면 "둘 이상"의 처리를 한쪽에서 빠뜨리게 된다.
 */
async function exactCommit(
  pool: Pool,
  space: ResolvedSpace,
  sha: string,
): Promise<SequencePoint[]> {
  const point = await mergeSequenceRepo.findPointByCommit(
    pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    sha,
  );
  return point === null ? [] : [point];
}

type PullRequestState =
  | { readonly kind: 'other_branch'; readonly baseBranch: string }
  /** 미머지이거나 이 시스템이 모르는 PR. 사용자가 할 일은 같다 — 머지를 기다린다. */
  | { readonly kind: 'not_merged' };

/**
 * PR이 왜 이 체인에 없는지 가른다.
 *
 * `merge_sequence`에 없는 이유는 둘이고, 그 둘은 **사용자가 할 일이 다르다.**
 * 다른 브랜치면 브랜치를 바꿔야 하고, 미머지면 기다려야 한다. "없다"로 뭉뚱그리면
 * 사용자는 어느 쪽인지 알 수 없다.
 */
async function pullRequestState(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  prNumber: number,
): Promise<PullRequestState> {
  const scoped = applyMandatoryScopeFilter(
    {
      bool: {
        filter: [{ term: { repository_id: space.repositoryId } }, { term: { pr_number: prNumber } }],
      },
    },
    scope,
  );

  const response = await search<{ base_branch?: string; merged_at?: string }>(
    deps.es,
    'prs-pull-requests',
    scoped,
    {
      size: 1,
      _source: ['base_branch', 'merged_at'],
      routing: String(space.repositoryId),
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    },
  );

  const source = response.hits.hits[0]?._source;
  const baseBranch = source?.base_branch;
  if (baseBranch !== undefined && baseBranch !== '' && baseBranch !== space.baseBranch) {
    return { kind: 'other_branch', baseBranch };
  }
  return { kind: 'not_merged' };
}

/**
 * 릴리스 태그 하나를 서수로 바꾼다 (FR-SEQ-003 AC-1 / WP-024, CR-028 DEV-142).
 *
 * **정본은 PostgreSQL `release` 표다.** JOB-REL-007이 미러의 refs/tags
 * 스냅숏을 그 표로 동기화하고(DEV-143 — 미러는 태그를 갱신한다, 실측),
 * 여기서는 태그 이름으로 그 표를 읽는다.
 *
 * 서수는 **현재 에폭으로 다시 확인한다.** 표의 서수는 동기화 시점 에폭에
 * 묶이므로(DEV-149), 재채번 직후에는 낡았을 수 있다 — 태그가 가리키는
 * 커밋의 서수를 현재 에폭 체인에서 다시 찾는 것이 늘 옳은 답이다.
 *
 * API-SEQ-002의 release 분기와 API-SEQ-003(릴리스 비교)이 **같은 판정을 쓴다**
 * (CR-030, DEV-157). 비교 쪽은 `classifyAnchor`를 거치지 않고 태그 이름을
 * 그대로 넣는다 — 태그에는 형식 제약이 없어 `deadbee` 같은 이름이 분류를
 * 거치면 SHA 접두로 오독된다.
 */
export async function resolveReleaseTagAnchor(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  input: AnchorInput,
  tag: string,
): Promise<AnchorOutcome> {
  const { repositoryId, baseBranch, seqEpoch } = space;

  const release = await releaseRepo.findReleaseByTag(deps.pool, repositoryId, tag);
  if (release === undefined) {
    const indexed = await releaseRepo.hasAnyRelease(deps.pool, repositoryId);
    return failed(
      input,
      'ANCHOR_UNRESOLVABLE',
      indexed
        ? `그런 릴리스 태그가 없습니다: ${tag}`
        : `이 저장소의 릴리스가 아직 수집되지 않았습니다: ${tag}`,
      {
        ...(indexed ? { reason: 'tag_not_found' } : { reason: 'release_not_indexed' }),
        supported_formats: SUPPORTED_ANCHOR_FORMATS,
      },
    );
  }

  const point = await mergeSequenceRepo.findPointByCommit(
    deps.pool,
    repositoryId,
    baseBranch,
    seqEpoch,
    release.commit_sha,
  );
  if (point !== null) {
    const anchor = resolved(input, 'release', point);
    if (anchor.kind === 'resolved') {
      // 릴리스 앵커의 시각은 커밋 시각이 아니라 릴리스 시각이다 (API-SEQ-002 예시).
      return { kind: 'resolved', anchor: { ...anchor.anchor, occurred_at: release.released_at.toISOString() } };
    }
    return anchor;
  }

  /*
   * 이 공간의 체인에 없다. 태그가 **다른** 시퀀스 브랜치의 체인에는 있으면
   * 공간 불일치이고(브랜치를 바꾸면 된다), 어디에도 없으면 체인 밖 태그다
   * (원본 커밋을 가리키는 태그 — 머지 커밋 제안이 다음 수다).
   */
  if (release.base_branch !== null && release.base_branch !== baseBranch) {
    return failed(
      input,
      'SEQUENCE_SPACE_MISMATCH',
      `이 릴리스는 ${space.sequenceSpace}가 아니라 ${release.base_branch} 브랜치에 있습니다.`,
      { sequence_space: space.sequenceSpace, release_base_branch: release.base_branch },
    );
  }
  const suggested = await suggestMergeCommit(deps, space, scope, release.commit_sha);
  return failed(
    input,
    'ANCHOR_NOT_ON_BRANCH',
    `이 릴리스의 커밋은 ${space.sequenceSpace}의 first-parent 체인에 없습니다.`,
    suggested === null ? {} : { suggested_anchor: suggested },
  );
}

/** 앵커 여럿을 한 번에. 위치별로 하나씩 오는 것이 정상이지만 강제하지는 않는다. */
export async function resolveAnchors(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  inputs: readonly AnchorInput[],
): Promise<readonly AnchorOutcome[]> {
  const outcomes: AnchorOutcome[] = [];
  for (const input of inputs) {
    outcomes.push(await resolveAnchor(deps, space, scope, input));
  }
  return outcomes;
}
