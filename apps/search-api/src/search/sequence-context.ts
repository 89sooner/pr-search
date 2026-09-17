/**
 * 검색의 시퀀스 인용 바인딩 (CR-051 / API 계약 「시퀀스 인용 계약」).
 *
 * 백엔드 아키텍처 6.1의 **4-1단계**다 — 접근 범위 산출(2단계) 뒤, 조회
 * 실행(5단계) 앞에 선다. 순서가 통제인 이유는 둘이다: 공간 해석이 접근 통제를
 * 지나야 하고, 미등록과 범위 밖이 같은 `NOT_FOUND`가 되어야 한다.
 *
 * ## 라우트마다 만들지 않는다
 *
 * 규칙이 두 곳에 살면 한쪽만 넓어지는 날 아무 오류도 안 난다 (DEV-357이 접근
 * 범위 판정에서 배운 것과 같다). 검색 라우트가 이 함수 하나를 지나고, 그
 * 결과가 질의·지문·응답 셋에 함께 쓰인다.
 *
 * ## 새 해석 경로를 만들지 않는다
 *
 * 공간 확인은 `API-SEQ-001`이 쓰는 `resolveSpace`를 그대로 부른다. 두 번째
 * 해석 경로를 만들면 한쪽만 접근 통제가 넓어지는 날을 아무도 못 본다.
 */

import { analyzeMergeNumberBinding, analyzeSequenceBinding, type QueryAst, type SequenceBindingProblem } from '@prs/query';
import type { AccessScope } from '@prs/es';
import type { Pool } from '@prs/db';
import {
  parseRepositorySlug,
  readEpochParam,
  resolveSpace,
  type ResolvedSpace,
} from '../sequence/space.js';

/** 응답의 `sequence_context`. `seq:` 질의에서만 실린다. */
export interface SequenceContext {
  readonly sequence_space: string;
  readonly repository: string;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly sequence_state: ResolvedSpace['state'];
}

export type SequenceContextOutcome =
  /**
   * `seq:` 범위 조건이 없다. 이 질의는 어느 공간에도 묶이지 않는다.
   *
   * 이때 응답에 `sequence_context`·`epoch_stale`을 싣지 않는다 — 빈 값으로
   * 실으면 화면이 "공간이 없는 시퀀스 조회"라는 없는 상태를 그린다.
   */
  | { readonly kind: 'none' }
  /** 공간이 확정됐고 에폭이 일치한다. 이 에폭으로 조회한다. */
  | { readonly kind: 'bound'; readonly epoch: number; readonly context: SequenceContext }
  /**
   * 인용이 딛고 선 에폭이 현재와 다르다.
   *
   * **조회를 실행하지 않는다.** 현재 에폭으로 옮기는 것은 사용자의 명시적
   * 행위이며, 자동 재해석은 ADR-007이 막으려는 바로 그 동작이다.
   */
  | {
      readonly kind: 'stale';
      readonly requested: number;
      readonly context: SequenceContext;
    }
  /** 질의가 공간을 지목하지 못했다. `INVALID_PARAMETER`(field `q`). */
  | { readonly kind: 'unbindable'; readonly reason: SequenceBindingProblem }
  /** `seq_epoch` 파라미터의 형식이 틀렸다. `INVALID_PARAMETER`(field `seq_epoch`). */
  | { readonly kind: 'bad_epoch_param' }
  /**
   * `seq:`가 없는데 `seq_epoch`만 왔다.
   *
   * 조용히 무시하지 않는다 — 화면이 뜻 없는 파라미터를 계속 보내고, 나중에
   * 그 값이 뜻을 갖게 되는 날 아무도 그 자리를 다시 보지 않는다.
   */
  | { readonly kind: 'orphan_epoch_param' }
  /**
   * 지목한 공간을 확인할 수 없다. `NOT_FOUND` 하나로 답한다.
   *
   * 미등록·범위 밖·미채번 셋을 구분하지 않는 것은 `API-SEQ-001`이 이미 정한
   * 규율이다 (CR-027 DEV-137, THR-006). 새로운 존재 신탁을 만들지 않는다.
   */
  | { readonly kind: 'space_unavailable' };

export interface SequenceContextInput {
  readonly ast: QueryAst;
  /** 요청의 `seq_epoch` 원문. 파싱은 여기서 한다. */
  readonly rawEpoch: unknown;
  readonly scope: AccessScope;
}

function toContext(space: ResolvedSpace, repository: string): SequenceContext {
  return {
    sequence_space: space.sequenceSpace,
    repository,
    base_branch: space.baseBranch,
    seq_epoch: space.seqEpoch,
    sequence_state: space.state,
  };
}

/**
 * `seq:` 질의의 공간과 에폭을 확정한다.
 *
 * @returns 라우트가 그대로 분기할 수 있는 판정. 이 함수는 HTTP를 모른다.
 */
export async function resolveSequenceContext(
  pool: Pool,
  input: SequenceContextInput,
): Promise<SequenceContextOutcome> {
  const binding = analyzeSequenceBinding(input.ast);
  const epochParam = readEpochParam(input.rawEpoch);

  if (binding.kind === 'none') {
    // `seq:`가 없는데 에폭만 온 요청. 파라미터 형식보다 이 사실을 먼저 말한다 —
    // 형식이 맞아도 여전히 뜻이 없기 때문이다.
    if (epochParam.kind !== 'absent') return { kind: 'orphan_epoch_param' };
    return { kind: 'none' };
  }

  if (binding.kind === 'invalid') return { kind: 'unbindable', reason: binding.reason };
  if (epochParam.kind === 'invalid') return { kind: 'bad_epoch_param' };

  /*
   * 저장소 문자열이 `owner/name` 모양이 아니면 그 저장소는 존재할 수 없다.
   * 형식 오류로 따로 답하지 않는 이유는 **그것도 존재를 알려 주는 신호**이기
   * 때문이다 — 있을 수 없는 이름과 있지만 볼 수 없는 이름이 같은 답을 받는다.
   */
  const slug = parseRepositorySlug(binding.repository);
  if (slug === null) return { kind: 'space_unavailable' };

  const lookup = await resolveSpace(pool, slug, binding.baseBranch, input.scope);
  if (lookup.kind !== 'ok') return { kind: 'space_unavailable' };

  const context = toContext(lookup.space, binding.repository);

  if (epochParam.kind === 'value' && epochParam.epoch !== lookup.space.seqEpoch) {
    return { kind: 'stale', requested: epochParam.epoch, context };
  }

  /*
   * 파라미터가 없는 첫 요청이 여기로 온다 — **최초 바인딩**이다. 현재 에폭을
   * 유효 에폭으로 삼고, 화면이 그것을 URL에 새긴다 (ADR-007 규칙 5의 "공유 URL").
   */
  return { kind: 'bound', epoch: lookup.space.seqEpoch, context };
}

/** `mnum:` 질의의 공간·에폭 판정 (CR-106). `resolveSequenceContext`보다 얕다 — 아래 함수 주석 참고. */
export type MergeNumberRangeOutcome =
  /** `mnum:` 범위 조건이 없다. */
  | { readonly kind: 'none' }
  /** 공간이 확정됐다. 이 에폭으로 `merge_number_epoch`를 건다. */
  | { readonly kind: 'bound'; readonly epoch: number }
  /** 질의가 공간을 지목하지 못했다. `INVALID_PARAMETER`(field `q`). */
  | { readonly kind: 'unbindable'; readonly reason: SequenceBindingProblem }
  /** 지목한 공간을 확인할 수 없다. `NOT_FOUND` 하나로 답한다 (CR-027 DEV-137, THR-006). */
  | { readonly kind: 'space_unavailable' };

/**
 * `mnum:` 질의의 공간과 **현재** 에폭을 확정한다 (FR-SRCH-005 AC-9, CR-106).
 *
 * **`resolveSequenceContext`를 재사용하지 않는다.** 그 함수는 `seq_epoch` 파라미터로
 * 과거 에폭을 인용하고 낡았으면 `stale`로 멈추는 **공유 URL 인용** 기능까지
 * 담당하는데, `mnum:`은 그 기능이 없다 — 이 CR의 승인 범위는 세대 혼입 방지뿐이고,
 * M 번호 범위를 과거 에폭으로 고정 인용하는 기능은 승인되지 않았다. 그래서 `mnum:`은
 * 언제나 **현재** 에폭을 쓰고, 그 값이 다르다고 조회를 멈추는 `stale` 판정이 없다.
 *
 * **공간 조회를 두 번 하지 않는다.** `seq:`와 `mnum:`이 같은 질의에 있으면 AST의
 * 같은 `repo:`·`base:`에서 나오므로 지목하는 공간이 항상 같다 — `resolveSequenceContext`가
 * 이미 그 공간을 읽었다면 `reuse`로 그 결과를 받아 재사용한다. **이것은 최적화가
 * 아니라 정합성이다**: 두 번 읽으면 그 사이 강제 푸시가 에폭을 올릴 때 한 응답
 * 안에서 `seq_epoch` 게이트와 `merge_number_epoch` 게이트가 서로 다른 세대를 보게
 * 되어, 세대 혼입을 막으려는 이 기능 자체가 그 혼입을 만든다(독립 검토가 실측한
 * 경합, CR-106).
 *
 * @param reuse `resolveSequenceContext`가 이미 확정한 공간. `repository`·`baseBranch`가
 *   이 함수가 판정한 것과 같을 때만 쓴다 — 다르면(있을 수 없지만 방어적으로) 새로 읽는다.
 * @returns 라우트가 그대로 분기할 수 있는 판정. 이 함수는 HTTP를 모른다.
 */
export async function resolveMergeNumberRangeEpoch(
  pool: Pool,
  input: { readonly ast: QueryAst; readonly scope: AccessScope },
  reuse?: { readonly repository: string; readonly baseBranch: string; readonly epoch: number },
): Promise<MergeNumberRangeOutcome> {
  const binding = analyzeMergeNumberBinding(input.ast);
  if (binding.kind === 'none') return { kind: 'none' };
  if (binding.kind === 'invalid') return { kind: 'unbindable', reason: binding.reason };

  if (reuse !== undefined && reuse.repository === binding.repository && reuse.baseBranch === binding.baseBranch) {
    return { kind: 'bound', epoch: reuse.epoch };
  }

  const slug = parseRepositorySlug(binding.repository);
  if (slug === null) return { kind: 'space_unavailable' };

  const lookup = await resolveSpace(pool, slug, binding.baseBranch, input.scope);
  if (lookup.kind !== 'ok') return { kind: 'space_unavailable' };

  return { kind: 'bound', epoch: lookup.space.seqEpoch };
}
