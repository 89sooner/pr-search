/**
 * `references`가 **아닌** 간선의 결정론적 ID (WP-030 / CR-041, DEV-245).
 *
 * ## 왜 `reference_key`를 일반화하지 않는가
 *
 * `reference_key`는 **대상이 나중에 밝혀지는** 참조의 문제를 푸는 수단이다
 * (DEV-217). `Refs: abc1234`는 미해결일 때 축약 SHA를, 해결 뒤에는 40자 SHA를
 * 대상으로 가지므로 대상을 ID 재료에 넣으면 해결이 갱신이 아니라 새 문서가 된다.
 *
 * `reverts`·`cherry_picks`·`stacks_on`에는 그 문제가 없다 — **대상을 알아낸 뒤에**
 * 간선을 만들기 때문이다. 트레일러는 40자 SHA를 직접 적고, 제목 대조·patch-id
 * 대조·분기 대조는 후보 엔티티를 실제로 찾은 뒤에만 간선이 된다. 그래서 재료는
 * 데이터 모델 4.3장이 정한 그대로 **양 끝점**이다.
 *
 * 대상이 바뀌면 그것은 "같은 간선의 갱신"이 아니라 **다른 관계**다. 옛 간선은
 * 완전한 파생 집합 규율에 따라 제거되거나(`reverts`·`cherry_picks`) `detached`가
 * 된다(`stacks_on`).
 */

import { createHash } from 'node:crypto';

/** `referenceLinkId`와 같은 구분자. 본문에 나올 수 없는 문자여야 한다. */
const SEPARATOR = '\u001f';

/** 저장하는 간선 중 `references`가 아닌 것들. */
export type DerivedLinkType = 'reverts' | 'cherry_picks' | 'stacks_on';

export type DerivedEndpointKind = 'pull_request' | 'commit';

/**
 * 결정론적 간선 ID.
 *
 * 같은 입력은 언제나 같은 값이다 — 재파생이 중복 간선을 만들지 않고, PostgreSQL
 * 정본만으로 다시 만든 색인이 **같은 문서 ID**를 갖는다 (ADR-004).
 */
export function derivedLinkId(
  linkType: DerivedLinkType,
  fromType: DerivedEndpointKind,
  fromId: string,
  toType: DerivedEndpointKind,
  toId: string,
): string {
  return createHash('sha256')
    .update([linkType, fromType, fromId, toType, toId].join(SEPARATOR), 'utf8')
    .digest('hex');
}
