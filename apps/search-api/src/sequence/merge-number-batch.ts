/**
 * 페이지 단위 M 번호 정본 대조 (WP-074 / ADR-023 C5, CR-079, API 계약 8절).
 *
 * ## 행별 호출을 만들지 않는다
 *
 * 목록·상세·범위가 응답을 만들기 직전에 **페이지에 포함된 PR 튜플만** 모아
 * PostgreSQL에 한 번 묻는다. 행마다 HTTP를 부르는 것도, 행마다 SQL을 부르는 것도
 * 아니다 — 25행 목록이 26번 왕복하면 그 비용이 사용자에게 그대로 간다.
 *
 * ## 정본이 이긴다
 *
 * 색인의 `merge_number`는 표시를 빠르게 하려고 비친 값이고, 응답에 싣는 값은
 * **정본**이다. 둘이 다르면 정본을 답하고 그 사실을 `merge_number_projection_state`로
 * 알린다 (상세 설계 7절). 잘못된 에폭이 화면에 노출되지 않는 것이 이 선택의 이유다.
 *
 * ## DB가 실패해도 검색 결과를 숨기지 않는다
 *
 * M 부분만 `unavailable`로 표시하고 목록은 그대로 나간다 (설계 9절). 해석 API는
 * 정본이 필수이므로 그쪽만 500이다.
 */

import { mergeSequenceRepo, type Pool } from '@prs/db';
import {
  mergeNumberFieldsOf,
  repositoryNameOf,
  type MergeNumberFields,
  type MergeNumberSubject,
} from './merge-number-view.js';

/** 한 PR 항목의 대조 재료. 호출부가 자기 DTO에서 뽑아 준다. */
export interface MergeNumberInput {
  readonly repositoryId: number | null;
  readonly repositorySlug: string | null;
  readonly baseBranch: string | null;
  readonly prNumber: number | null;
  readonly state: string | null;
  /** 색인이 지금 말하는 값. 없으면 관측 상태가 `unknown`이다. */
  readonly indexed?: { readonly mergeNumber: number | null; readonly epoch: number | null };
}

/** 입력 순서와 1:1인 결과. M 대상이 아닌 항목(커밋 등)은 `null`이며 호출부가 키를 만들지 않는다. */
export type MergeNumberOutput = readonly (MergeNumberFields | null)[];

/**
 * 페이지의 M 필드를 한 번에 만든다.
 *
 * @returns 입력과 같은 길이의 배열. 기능이 꺼져 있으면 전부 `null`이다.
 */
export async function resolveMergeNumberFields(
  pool: Pool,
  inputs: readonly MergeNumberInput[],
  options: { readonly enabled: boolean } = { enabled: true },
): Promise<MergeNumberOutput> {
  if (!options.enabled) return inputs.map(() => null);

  const subjects = inputs.map((input): MergeNumberSubject | null => {
    if (input.repositoryId === null || input.prNumber === null) return null;
    return {
      repositoryId: input.repositoryId,
      baseBranch: input.baseBranch,
      prNumber: input.prNumber,
      repositoryName: repositoryNameOf(input.repositorySlug),
      state: input.state,
      ...(input.indexed === undefined ? {} : { indexed: input.indexed }),
    };
  });

  const tuples = subjects
    .filter((subject): subject is MergeNumberSubject => subject !== null && subject.baseBranch !== null)
    .map((subject) => ({
      repositoryId: subject.repositoryId,
      baseBranch: subject.baseBranch as string,
      prNumber: subject.prNumber,
    }));

  let canonical: Awaited<ReturnType<typeof mergeSequenceRepo.lookupMergeNumbers>> | null = null;
  if (tuples.length > 0) {
    try {
      canonical = await mergeSequenceRepo.lookupMergeNumbers(pool, tuples);
    } catch {
      /*
       * 정본을 읽지 못했다. **검색 결과는 그대로 나간다** — M 하나 때문에 이미 만든
       * 목록을 버리지 않는다 (설계 9절). 화면은 `unavailable`을 보고 재시도를 권한다.
       */
      canonical = null;
    }
  } else {
    canonical = { spaces: [], rows: [] };
  }

  return subjects.map((subject) =>
    subject === null ? null : mergeNumberFieldsOf(subject, { canonical }),
  );
}
