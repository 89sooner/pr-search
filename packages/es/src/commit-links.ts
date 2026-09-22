/**
 * 커밋 문서의 PR 연결 투영 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * ## 이 모듈이 `pull_request_numbers`를 소유한다
 *
 * `merge_seq`(CR-113)·`merge_number`(CR-115)와 같은 규율이다. 투영의 `params.doc`에
 * 싣지 않고 여기만 쓴다 — 투영이 돌 때마다 되돌아가면 안 되는 값이기 때문이다.
 *
 * 전에는 합집합이었다. 그래서 한 번 더해진 PR 번호가 영영 빠지지 않았다 (CR-011,
 * DEV-019). 지금은 **정본이 계산한 전체 집합을 대입한다.** 한 PR의 번호 하나로
 * 배열을 덮지 않는다 — 그 커밋을 소유하는 PR 전부를 PostgreSQL에서 세어 온 값이다.
 *
 * ## 왜 전용 generation이 필요한가
 *
 * 커밋 문서의 `document_version`은 **웹훅 수신 시각**이다. 커밋 하나가 여러 PR에
 * 속하므로, 그 값으로 관계 수정 권한을 판정하면 **다른 PR의 이벤트 시각이 이 PR의
 * 관계를 막거나 통과시킨다.** 그래서 관계에는 관계만의 세대가 있다.
 *
 * ## 네 가지 결과를 구분한다
 *
 * - 문서의 세대가 더 높다 → `stale`. 오래된 쓰기는 거절한다.
 * - 같은 세대, 같은 집합 → `noop`. 멱등이다.
 * - 같은 세대, **다른 집합** → `conflict`. 덮지 않고 기록한다. 구버전 합집합
 *   writer가 아직 돌고 있다는 조기 경보이기도 하다.
 * - 그 외 → `updated`.
 *
 * ## 빈 배열은 사실이고 필드 삭제가 아니다
 *
 * 연결이 0개면 `[]`를 **대입한다.** 필드를 지우면 "아직 모름"과 구분되지 않고,
 * `exists` 질의가 둘을 같게 본다. 합집합에 `[]`를 넘겨도 기존 원소는 빠지지
 * 않으므로 전용 대입만이 이 일을 할 수 있다.
 */

import type { Client } from '@elastic/elasticsearch';
import { commitDocId } from '@prs/domain';
import { dualWrite, type WriteTargets } from './write-targets.js';

const COMMIT_ALIAS = 'prs-commits' as const;

/** `pull_request_numbers`가 무엇으로 확정됐는가. 화면과 운영이 같은 어휘를 읽는다. */
export type CommitLinkState =
  /** 검증된 정본으로 확정했다. 빈 배열도 확정이다. */
  | 'verified'
  /** 관계는 있으나 완전성 근거가 없다. 더 있을 수 있다. */
  | 'partial';

export interface CommitLinkUpdate {
  readonly repositoryId: number;
  readonly commitSha: string;
  /** 정본이 계산한 **전체** 집합. 중복 없이 오름차순이어야 한다. */
  readonly numbers: readonly number[];
  readonly generation: number;
  readonly state: CommitLinkState;
}

export type CommitLinkOutcome =
  | 'updated'
  | 'noop'
  | 'stale'
  | 'conflict'
  /** 커밋 문서가 아직 없다. 투영이 만든 뒤 다시 온다. */
  | 'document_missing';

interface LinkSource {
  readonly pull_request_numbers?: readonly number[];
  readonly pr_links_generation?: number;
}

function sameNumbers(left: readonly number[] | undefined, right: readonly number[]): boolean {
  if (left === undefined) return false;
  if (left.length !== right.length) return false;
  const sorted = [...left].sort((a, b) => a - b);
  return sorted.every((value, index) => value === right[index]);
}

/**
 * 정본의 집합을 정규화한다. **호출부가 아니라 여기서 한다** — 순서가 흔들리면
 * 같은 관계가 다른 배열이 되어 멱등 판정이 깨지고, 그 결과가 `conflict`로 보인다.
 */
export function normalizeLinkNumbers(numbers: readonly number[]): number[] {
  return [...new Set(numbers.filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
}

/**
 * 한 커밋 문서의 관계를 쓴다. active와 shadow 모두에 적용한다 (`dualWrite`).
 *
 * 순서: 문서 읽기(분류) → 스크립트 갱신(세대 가드). 가드를 스크립트에만 두면
 * `noop`의 이유를 알 수 없어 "왜 반영되지 않았나"에 답하지 못한다 — 특히
 * `conflict`는 운영자가 **반드시** 보아야 하는 사실이라 결과로 나와야 한다.
 *
 * **문서를 만들지 않는다.** 없는 커밋에 빈 관계 문서를 만들면 역할도 메시지도
 * 없는 문서가 검색에 뜬다. 없으면 `document_missing`이고 러너가 다시 온다.
 */
export async function applyCommitLinks(
  client: Client,
  update: CommitLinkUpdate,
  targets: WriteTargets,
): Promise<CommitLinkOutcome> {
  return write(client, update, { targets });
}

/**
 * 구체 인덱스 하나에만 쓴다 — **재구축의 것이다** (CR-116 / DEV-750).
 *
 * 별칭으로 쓰는 위 함수와 나눈 이유는, 재구축이 `SERVING_ONLY`를 넘겨 이중 쓰기
 * 울타리를 형식적으로 통과하는 모양을 만들지 않기 위해서다. 그 모양은 **운영
 * 경로가 재색인을 조용히 지나치는 것**과 구별되지 않고, 그것을 잡는 파수꾼이
 * 이미 있다(`dual-write.test.ts`). 여기서는 대상이 인자로 오므로 울타리가 필요 없다.
 *
 * 별칭으로 판정하면 **서비스 인덱스의 상태가 새 인덱스의 쓰기를 막는다.** 서비스
 * 쪽에 충돌(구버전 writer가 남긴 다른 집합)이 있으면 `conflict`가 나고, 그 결론
 * 때문에 아직 비어 있는 대상 인덱스에 아무것도 쓰이지 않는다 — 그러면 전환 뒤
 * 그 커밋의 SHA → PR이 사라진다. 서비스 인덱스의 충돌은 복구 명령이 세대를 올려
 * 푸는 일이고, 재구축이 대신 짊어질 일이 아니다.
 */
export async function applyCommitLinksToIndex(
  client: Client,
  update: CommitLinkUpdate,
  index: string,
): Promise<CommitLinkOutcome> {
  return write(client, update, { index });
}

async function write(
  client: Client,
  update: CommitLinkUpdate,
  destination: { readonly targets: WriteTargets } | { readonly index: string },
): Promise<CommitLinkOutcome> {
  const sha = update.commitSha.toLowerCase();
  const id = commitDocId(update.repositoryId, sha);
  const routing = String(update.repositoryId);
  const numbers = normalizeLinkNumbers(update.numbers);
  const direct = 'index' in destination;
  const index = direct ? destination.index : COMMIT_ALIAS;

  let source: LinkSource | undefined;
  try {
    const found = await client.get<LinkSource>({
      index,
      id,
      routing,
      _source_includes: ['pull_request_numbers', 'pr_links_generation'],
    });
    source = found._source ?? undefined;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return 'document_missing';
    throw error;
  }
  if (source === undefined) return 'document_missing';

  const stored = source.pr_links_generation;
  if (stored !== undefined && stored > update.generation) return 'stale';
  if (stored !== undefined && stored === update.generation && !sameNumbers(source.pull_request_numbers, numbers)) {
    /*
     * **같은 세대, 다른 집합.** 우리가 쓴 값이 아니다 — 구버전 합집합 writer가
     * 더했거나, 사람이 직접 고쳤거나, 정본과 색인이 갈라졌다. 덮어써서 증거를
     * 지우지 않는다. 정본의 세대가 올라야(재수집·복구) 다시 쓴다.
     */
    return 'conflict';
  }

  const send = async (target: string): Promise<string> => {
    const response = await client.update({
      index: target,
      id,
      routing,
      retry_on_conflict: 3,
      script: {
        lang: 'painless',
        /*
         * 두 번째 방어선이다. 읽기와 쓰기 사이에 다른 러너가 더 높은 세대를
         * 썼을 수 있고, 그 창은 `retry_on_conflict`의 재실행에서도 열린다.
         *
         * **`document_version`을 건드리지 않는다.** `role`·`base_branch`·`merge_seq`·
         * `merge_number`도 마찬가지다 — 관계 갱신이 다른 소유자의 필드를 덮으면
         * 그 워커의 결과가 조용히 되돌아간다.
         */
        source:
          'def cur = ctx._source.pr_links_generation;' +
          ' if (cur != null && cur > params.generation) { ctx.op = "noop"; return; }' +
          ' boolean same = cur != null && cur == params.generation' +
          '  && ctx._source.pr_links_state == params.state' +
          '  && ctx._source.pull_request_numbers != null' +
          '  && ctx._source.pull_request_numbers.size() == params.numbers.size()' +
          '  && ctx._source.pull_request_numbers.containsAll(params.numbers);' +
          ' if (same) { ctx.op = "noop"; return; }' +
          ' ctx._source.pull_request_numbers = params.numbers;' +
          ' ctx._source.pr_links_generation = params.generation;' +
          ' ctx._source.pr_links_state = params.state;',
        params: { numbers, generation: update.generation, state: update.state },
      },
    });
    return String(response.result);
  };

  // 구체 인덱스를 지목했으면 이중 쓰기를 하지 않는다 — 그 인덱스가 전부다.
  const result = direct ? await send(index) : await dualWrite(destination.targets, COMMIT_ALIAS, 'update', send);

  return result === 'noop' ? 'noop' : 'updated';
}
