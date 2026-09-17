/**
 * PR 검색 문서의 `state` (ENT-CORE-002, CR-101 / DEV-718).
 *
 * ## GitHub은 `merged`라는 state를 주지 않는다
 *
 * REST API와 웹훅의 `pull_request.state`는 `open`·`closed` 둘뿐이고, 병합 여부는 `merged`(불리언)와
 * `merged_at`이 따로 말한다. 그런데 이 제품의 계약은 처음부터 세 값이었다 — API 문서의 예시,
 * `is:merged`/`state:merged` 질의, 화면의 「Merged」 배지, M 번호 조회의 `not_merged` 판정, 늦은 PR
 * 스냅숏이 채번을 재개하는 관문(`snapshot.ts`)이 전부 `state === 'merged'`를 전제한다. 투영만 원시
 * 값을 그대로 써서 병합된 PR이 어디에서도 병합으로 보이지 않았다(사내 pilot.12: Merged 필터와
 * My merged PRs가 0건).
 *
 * ## 규칙은 한 곳에 둔다
 *
 * 병합 신호(`merged === true` 또는 `merged_at`)가 있으면 `merged`, 없으면 GitHub이 준 값 그대로다.
 * 투영(`documents.ts`)이 이 함수를 쓰고, 이미 저장된 스냅숏은 마이그레이션 032가 같은 규칙으로
 * 바로잡는다. 질의 쪽(`DERIVED_STATE`)은 바꾸지 않는다 — 문서가 계약을 따르면 질의는 이미 맞다.
 */

import type { PullRequestState } from './entities.js';

/** 문서가 갖는 세 상태 — `entities.ts`의 `PullRequestState`와 같은 어휘다. 원시 값이 예상 밖이면(`unknown` 등) 그대로 두어 사실을 지어내지 않는다. */
export const PULL_REQUEST_STATES: readonly PullRequestState[] = ['open', 'closed', 'merged'];

export interface PullRequestStateSignals {
  /** GitHub이 준 원시 state (`open` | `closed`, 드물게 `unknown`). */
  readonly state: string;
  readonly merged?: boolean | null;
  readonly merged_at?: string | null;
}

export function derivePullRequestState(input: PullRequestStateSignals): string {
  if (input.merged === true) return 'merged';
  if (typeof input.merged_at === 'string' && input.merged_at !== '') return 'merged';
  return input.state;
}
