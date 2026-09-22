/**
 * W-001 검색 커서 (WP-032 / FR-SRCH-008, ADR-010 + Amendment).
 *
 * 순회하는 것은 **Elasticsearch 검색 결과**다: PIT으로 색인 뷰를 고정하고
 * `search_after`로 정렬 값 뒤를 잇는다. 오프셋은 없다 (ADR-010).
 *
 * ## 지문이 결과 집합의 정체성이다
 *
 * 커서는 "그 순서에서 여기까지 왔다"를 말한다. 그 순서를 만든 조건이 달라지면
 * 위치의 뜻도 사라진다. 그래서 지문에 넣는 것은 **결과 집합을 정하는 것들**뿐이다.
 *
 * | 넣는다 | 왜 |
 * | --- | --- |
 * | 정규화한 질의 | 조건이 달라지면 다른 집합이다 |
 * | 정렬 키·방향 | 같은 집합이라도 순서가 다르면 위치가 뜻이 없다 |
 * | 유효 접근 범위 + `access_scope_version` | 권한이 회수되면 진행 중 페이징이 **죽는 것이 옳다** |
 * | `seq:` 질의의 **유효 시퀀스 에폭** | 재채번 뒤에는 같은 서수가 다른 커밋을 가리킨다 (CR-051) |
 *
 * | 넣지 않는다 | 왜 |
 * | --- | --- |
 * | `size` | 표현이지 정체성이 아니다. 같은 순서의 같은 집합에서 페이지 크기만 바뀌는 것은 질의 의미의 변경이 아니다 |
 * | `facets` 요청 여부 | 같은 이유. 패싯은 목록과 **다른 요청**이다 |
 *
 * `size`를 뺀 것이 정확성을 깨는지는 추측하지 않고 시험이 답한다 —
 * `search_after`는 정렬 값의 뒤를 잇는 조건이라 페이지 크기와 무관하지만,
 * 그 주장을 실제 Elasticsearch로 건다 (통합 「페이지 크기를 바꿔도」).
 */

import { createHash } from 'node:crypto';
import type { AccessScope } from '@prs/es';
import type { SortKey, SortOrder } from '@prs/es';
import {
  CURSOR_TTL_MS,
  CursorInvalidError,
  CursorQueryMismatchError,
  assertNotExpired,
  decodeEnvelope,
  encodeEnvelope,
  type CursorSigner,
} from '../cursor/envelope.js';

/**
 * 커서 스키마 버전.
 *
 * 봉투의 뜻이 바뀌면 올린다. 모르는 버전은 `CURSOR_INVALID`이며, 배포 중
 * 옛 커서를 든 사용자는 첫 페이지로 돌아간다 — 조용히 잘못 해석하는 것보다 낫다.
 */
export const SEARCH_CURSOR_VERSION = 1;

/** 봉투에 실리는 것. 키를 짧게 두는 이유는 커서가 URL에 실리기 때문이다. */
interface SearchCursorPayload {
  /** 스키마 버전. */
  readonly v: number;
  /** Point In Time 식별자. */
  readonly p: string;
  /** `search_after`에 넘길 정렬 키 값. */
  readonly s: readonly unknown[];
  /** 질의 지문. */
  readonly f: string;
  /** 만료 시각 (epoch ms). */
  readonly x: number;
}

/** 디코딩 결과. 지문 검증까지 끝난 상태다. */
export interface SearchCursor {
  readonly pitId: string;
  readonly searchAfter: readonly unknown[];
}

/** 지문을 만드는 재료. 한 요청에서 한 번만 산출한 접근 범위를 그대로 받는다. */
export interface FingerprintInput {
  /** 사용자가 친 원문이 아니라 **정규화한** 질의. */
  readonly query: string;
  readonly sortKey: SortKey;
  readonly order: SortOrder;
  readonly scope: AccessScope;
  readonly scopeVersion: number;
  /**
   * `seq:` 범위 질의의 유효 에폭. `seq:`가 없으면 `null` (CR-051, DEV-361).
   *
   * `seq_epoch`은 `q` 밖의 파라미터라 여기 넣지 않으면 **질의가 같고 에폭만
   * 다른 두 조회가 같은 지문을 갖는다.** 그러면 재채번 뒤에도 옛 커서가
   * 받아들여져 다른 세대의 서수 위에서 순회가 이어진다.
   *
   * PIT과 혼동하지 않는다 — PIT은 색인 뷰를 고정하지 그 서수가 무엇을
   * 뜻하는지를 고정하지 않는다. 두 장치는 다른 것을 지킨다.
   */
  readonly sequenceEpoch: number | null;
  /**
   * `mnum:` 범위 질의의 유효 M 번호 에폭. `mnum:`이 없으면 `null` (CR-106).
   *
   * **`sequenceEpoch`과 별도 재료다.** 값은 같은 공간이면 같은 정수이지만,
   * 색인에서 두 값을 담는 필드(`seq_epoch`·`merge_number_epoch`)가 다른
   * 투영 작업이 다른 시점에 쓰는 별개 필드라서, `sequenceEpoch` 하나만
   * 지문에 넣으면 **M 번호 투영만 새 세대로 넘어간 질의**와 **PR 투영까지
   * 새 세대로 넘어간 질의**가 같은 지문을 가질 수 있다 — 그러면 세대가
   * 섞인 순회를 지문이 잡아내지 못한다.
   */
  readonly mergeNumberEpoch: number | null;
  /**
   * `mnum:` 범위 질의가 묶인 시퀀스 공간의 기준 브랜치. `mnum:`이 없으면 `null` (CR-114).
   *
   * `repo:`만 적은 질의는 유일한 추적 브랜치로 묶이는데 그 브랜치가 질의 문자열에 없다.
   * 지문에 넣지 않으면 페이지 사이에 추적 브랜치가 바뀌어도(에폭은 두 공간 모두 1일 수
   * 있다) 같은 지문이 나와, 옛 커서가 다른 공간의 서수 위에서 순회를 잇는다. `base:`를
   * 적은 질의는 문자열에 이미 브랜치가 있지만 재료를 경로마다 다르게 만들지 않는다.
   */
  readonly mergeNumberBaseBranch: string | null;
  /**
   * 지문에 덧붙이는 결속 (CR-112 / ADR-025).
   *
   * **없으면 재료가 이전과 한 글자도 다르지 않다** — 이미 발급된 공개 커서가 그대로 통한다
   * (추가 전용 변경). PIPE 연동은 client와 canonical 사용자를 넣어, 우연히 범위가 같은 다른
   * 사용자나 다른 client의 커서를 받지 않는다.
   */
  readonly binding?: string;
}

/**
 * 접근 범위를 **정렬해** 문자열로.
 *
 * 정렬하지 않으면 같은 권한이 조회마다 다른 지문을 만든다 — GHE가 주는 순서도
 * 캐시가 돌려주는 순서도 안정적이라는 보장이 없다. 그러면 사용자는 아무것도
 * 바꾸지 않았는데 두 번째 페이지에서 `CURSOR_QUERY_MISMATCH`를 본다.
 */
function scopeMaterial(scope: AccessScope): string {
  const sorted = (values: readonly number[] | readonly string[]): string =>
    [...values].map(String).sort().join(',');

  if (scope.kind === 'explicit') {
    return `explicit|${sorted(scope.repositoryIds)}`;
  }
  return `org_team|${sorted(scope.orgIds)}|${sorted(scope.teamIds)}|${sorted(scope.visibilities)}`;
}

/**
 * 질의 지문.
 *
 * 해시를 쓰는 것은 커서 길이 때문이다 — 접근 범위가 500개 저장소면 그 목록이
 * 그대로 URL에 실린다. 충돌은 실질적 관심사가 아니다: 지문이 같으면서 조건이
 * 다른 SHA-256 쌍을 사용자가 만들 수 있어도, 그것으로 얻는 것은 **자기 접근
 * 범위 안에서** 다른 순서를 잇는 것뿐이다. 강제 필터는 질의 시점에 다시 걸린다.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const material = [
    input.query,
    input.sortKey,
    input.order,
    scopeMaterial(input.scope),
    String(input.scopeVersion),
    // `seq:`가 없는 질의에는 재료가 **없다**. `0` 같은 대체값을 쓰면 그 값이
    // 언젠가 실제 에폭과 충돌한다 — 에폭은 1부터다 (CR-051).
    input.sequenceEpoch === null ? '' : String(input.sequenceEpoch),
    // 같은 이유로 `mnum:`의 유효 에폭도 별도 자리에 넣는다 (CR-106) — 필드가
    // 다르므로 재료도 따로다.
    input.mergeNumberEpoch === null ? '' : String(input.mergeNumberEpoch),
    // `mnum:` 공간의 브랜치는 있을 때만 재료다 (CR-114) — 없는 질의에 빈 자리를 더하면
    // `mnum:` 없는 공개 커서의 지문까지 바뀐다. 결속과 같은 규칙이다.
    ...(input.mergeNumberBaseBranch === null ? [] : [`mnum_base:${input.mergeNumberBaseBranch}`]),
    // 결속은 있을 때만 재료가 된다 — 없을 때 빈 자리를 더하면 공개 커서의 지문이 바뀐다.
    ...(input.binding === undefined ? [] : [`binding:${input.binding}`]),
  ].join(' ');

  return createHash('sha256').update(material, 'utf8').digest('base64url').slice(0, 22);
}

export function encodeSearchCursor(
  cursor: SearchCursor,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: SearchCursorPayload = {
    v: SEARCH_CURSOR_VERSION,
    p: cursor.pitId,
    s: cursor.searchAfter,
    f: fingerprint,
    x: nowMs + CURSOR_TTL_MS,
  };
  return encodeEnvelope(payload, signer);
}

/**
 * 커서를 연다.
 *
 * **검사 순서가 곧 오류의 뜻이다.** 서명이 깨진 커서에 대고 "조건이 바뀌었다"고
 * 답하면 사용자는 질의를 의심하고, 훼손된 입력을 서버가 해석하려 든 셈이 된다.
 *
 *   1. 봉투 형식 · 서명 — 여기까지 `CURSOR_INVALID`
 *   2. 스키마 버전 · 만료 · 필드 모양 — `CURSOR_INVALID`
 *   3. 지문 — 여기서만 `CURSOR_QUERY_MISMATCH`
 *
 * @throws {CursorInvalidError}
 * @throws {CursorQueryMismatchError}
 */
export function decodeSearchCursor(
  raw: string,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): SearchCursor {
  const payload = decodeEnvelope(raw, signer) as Partial<SearchCursorPayload>;

  if (payload.v !== SEARCH_CURSOR_VERSION) {
    throw new CursorInvalidError(`모르는 커서 버전: ${String(payload.v)}`);
  }
  assertNotExpired(payload.x, nowMs);

  if (typeof payload.p !== 'string' || payload.p === '') {
    throw new CursorInvalidError('PIT 식별자가 없다');
  }
  /*
   * 정렬 키 값의 **모양**만 본다 (`ADR-010`의 "정렬 키 값 형식 오류").
   *
   * 값 자체를 검증하지 않는 이유는 그것이 정렬 키마다 다르고(날짜·정수·문자열),
   * 여기서 판정하려면 정렬 키 표를 이 파일에 복사해야 하기 때문이다. 모양이
   * 틀리면 Elasticsearch가 거절하고 그것은 500이 아니라 이 커서의 문제다.
   */
  if (!Array.isArray(payload.s) || payload.s.length === 0) {
    throw new CursorInvalidError('정렬 키 값이 없다');
  }

  if (typeof payload.f !== 'string' || payload.f === '') {
    throw new CursorInvalidError('지문이 없다');
  }
  if (payload.f !== fingerprint) {
    throw new CursorQueryMismatchError('질의·정렬·접근 범위가 커서 발급 시점과 다르다');
  }

  return { pitId: payload.p, searchAfter: payload.s };
}
