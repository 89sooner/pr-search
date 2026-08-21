/**
 * 식별자 해석 질의 (FR-SRCH-001 ~ FR-SRCH-004 / 데이터 모델 6장의 조회 패턴).
 *
 * 여기서 만드는 것은 **접근 범위가 아직 붙지 않은** 질의다. 호출 측이
 * `applyMandatoryScopeFilter`를 거쳐야 `search`에 넣을 수 있다 (ADR-008) — 그
 * 강제는 타입이 한다.
 *
 * 판별(`@prs/query`의 `detectIdentifier`)과 조회를 나눈 이유는 판별이
 * 브라우저에서도 돌아야 하기 때문이다 (QA-W001-04). 이 파일은 서버 전용이다.
 */

import type { estypes } from '@elastic/elasticsearch';

/**
 * 접두 검색 결과 상한 (FR-SRCH-004 AC-3).
 *
 * 넘으면 앞의 50건과 `truncated: true`를 준다. 상한 자체보다 **넘었다는 사실을
 * 알리는 것**이 중요하다 — 조용히 자르면 "이것이 전부"로 읽힌다.
 */
export const MAX_PREFIX_CANDIDATES = 50;

/** 커밋 SHA가 들어 있는 PR 문서의 필드. 40자 hex 폴백이 이 순서로 본다. */
export const PR_SHA_FIELDS = ['merge_commit_sha', 'head_sha', 'base_sha'] as const;

/** 40자 SHA → 커밋 하나 (`term`, 데이터 모델 6장 p95 100ms). */
export function commitExactQuery(sha: string): estypes.QueryDslQueryContainer {
  return { term: { commit_sha: sha } };
}

/**
 * 7~39자 접두 → 커밋 (`prefix`, ADR-012).
 *
 * `edge_ngram`을 쓰지 않는 이유가 ADR-012에 있다. SHA는 균등 분포 16진
 * 문자열이라 7자 접두는 16^7 ≈ 2.7억 분의 1 공간이고, `prefix`는 term 사전에서
 * 정렬된 범위를 seek하므로 스캔이 매우 짧다.
 */
export function commitPrefixQuery(prefix: string): estypes.QueryDslQueryContainer {
  return { prefix: { commit_sha: prefix } };
}

/**
 * PR 번호 → PR 문서.
 *
 * `repository`가 `null`이면 저장소를 좁히지 않는다 — 접근 범위 안의 모든
 * 저장소에서 그 번호를 찾는다. 여러 저장소에 같은 번호가 있는 것이 정상이므로
 * 후보가 여럿 나올 수 있고, 그것이 FR-SRCH-001 AC-5가 말하는 상황이다.
 */
export function pullRequestQuery(
  prNumber: number,
  repository: string | null,
): estypes.QueryDslQueryContainer {
  const filter: estypes.QueryDslQueryContainer[] = [{ term: { pr_number: prNumber } }];
  if (repository !== null) filter.push({ term: { repository } });
  return { bool: { filter } };
}

/**
 * 40자 hex가 커밋 문서에 없을 때의 폴백 (백엔드 아키텍처 4.5).
 *
 * PR 문서에는 `merge_commit_sha`·`head_sha`·`base_sha`가 들어 있다. 커밋 문서가
 * 아직 색인되지 않았어도 PR 쪽에서 그 SHA를 아는 경우가 있다 — 투영이 PR
 * 문서를 먼저 쓰고 커밋 문서를 잇따라 쓰기 때문이다.
 *
 * **접두에는 쓰지 않는다.** 이 세 필드는 `keyword`라 `prefix`가 가능하지만,
 * 접두 폴백까지 열면 7자 입력 하나가 인덱스 둘에 각각 prefix 질의를 던진다.
 * ADR-012가 예산을 잡은 것은 커밋 인덱스 하나다.
 */
export function shaFallbackQuery(sha: string): estypes.QueryDslQueryContainer {
  return {
    bool: {
      minimum_should_match: 1,
      should: PR_SHA_FIELDS.map((field) => ({ term: { [field]: sha } })),
    },
  };
}

/**
 * 저장소 + SHA로 커밋 하나 (API-SRCH-002).
 *
 * 문서 ID(`{repository_id}:{sha}`)를 알면 더 빠르지만, 경로 파라미터는
 * `owner/name`이라 `repository_id`를 모른다. 레지스트리를 한 번 더 도는 대신
 * 두 `term`으로 좁힌다 — 라우팅이 없어도 `repository` term이 샤드를 좁힌다.
 */
export function commitDetailQuery(repository: string, sha: string): estypes.QueryDslQueryContainer {
  return { bool: { filter: [{ term: { repository } }, { term: { commit_sha: sha } }] } };
}

/** 저장소 + PR 번호로 PR 하나 (API-SRCH-003). */
export function pullRequestDetailQuery(
  repository: string,
  prNumber: number,
): estypes.QueryDslQueryContainer {
  return { bool: { filter: [{ term: { repository } }, { term: { pr_number: prNumber } }] } };
}

/**
 * PR 번호 여럿 → PR 문서들 (SHA → PR 역추적의 두 번째 단계).
 *
 * 데이터 모델 6장의 경로다: `prs-commits` → `pull_request_numbers` →
 * `prs-pull-requests`. 커밋 하나가 여러 PR에 속할 수 있으므로(N:M) 번호가
 * 배열이고, FR-SRCH-002 AC-5가 그 전부를 요구한다.
 */
export function pullRequestsByNumbersQuery(
  repository: string,
  prNumbers: readonly number[],
): estypes.QueryDslQueryContainer {
  return {
    bool: {
      filter: [{ term: { repository } }, { terms: { pr_number: [...prNumbers] } }],
    },
  };
}
