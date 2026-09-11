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
 *
 * ## 접근 범위는 **호출부가 이미 건 것이다**
 *
 * 이 함수는 접근 범위를 다시 걸지 않는다. 받은 `repositoryId`가 사용자가 볼 수 있는
 * 저장소라는 것을 **부르는 쪽이 보장한다** — 목록·범위는 필수 범위 필터를 지난 ES
 * hit에서, 상세는 이미 권한을 확인한 PR 문서에서 그 값을 뽑는다 (ADR-008).
 *
 * **범위를 거치지 않은 저장소 ID를 여기에 넣지 마라.** M 번호는 "그 PR이 존재하고
 * 언제쯤 들어왔다"를 말하므로, 권한 밖 저장소의 번호가 나가면 `API-SEQ-007`이 미등록과
 * 권한 밖을 같은 404로 답하는 이유가 그 자리에서 무너진다. 새 호출부를 붙일 때는
 * 그 입력이 어느 범위 검사를 지나왔는지 먼저 확인한다.
 */

import { mergeSequenceRepo, withReadSnapshot, type Pool } from '@prs/db';
import {
  mergeNumberFieldsOf,
  repositoryNameOf,
  type MergeNumberFields,
  type MergeNumberSubject,
} from './merge-number-view.js';

/**
 * 한 PR 항목의 대조 재료. 호출부가 자기 DTO에서 뽑아 준다.
 *
 * `repositoryId`는 **접근 범위를 이미 지난 값**이어야 한다 (위 머리글 참고).
 */
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
      /*
       * **한 스냅숏 안에서 전부 읽는다** (설계 9절 / API-SEQ-007, DEV-592).
       *
       * 공간·행·대상 브랜치를 `Pool`에 따로 물으면 문장마다 다른 커넥션일 수 있고,
       * 그 사이 재채번이 커밋하면 공간은 옛 에폭을 행은 새 에폭을 말한다. 한 응답이
       * 두 세대를 섞으면 화면이 에폭 4를 적으면서 에폭 5의 링크를 만든다.
       */
      canonical = await withReadSnapshot(pool, (client) => mergeSequenceRepo.lookupMergeNumbers(client, tuples));
    } catch {
      /*
       * 정본을 읽지 못했다. **검색 결과는 그대로 나간다** — M 하나 때문에 이미 만든
       * 목록을 버리지 않는다 (설계 9절). 화면은 `unavailable`을 보고 재시도를 권한다.
       */
      canonical = null;
    }
  } else {
    canonical = { spaces: [], rows: [], tracked: new Map() };
  }

  return subjects.map((subject) =>
    subject === null
      ? null
      : mergeNumberFieldsOf(subject, {
          canonical,
          ...(canonical === null ? {} : { trackedBranches: canonical.tracked }),
        }),
  );
}
