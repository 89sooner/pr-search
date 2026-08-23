/**
 * 앵커 표현의 분류 (WP-023 / FR-SEQ-003, API-SEQ-002).
 *
 * **서버와 화면이 같은 코드를 쓴다** (ADR-001). W-004는 조회 버튼을 누르기 전에
 * 앵커가 말이 되는지 알아야 하고(QA-W004-09), 서버는 같은 판정으로 정규화한다 —
 * 규칙이 두 곳에 따로 있으면 화면이 통과시킨 입력을 서버가 거절하는 날이 온다.
 *
 * 이 파일은 **표현을 유형으로 가르는 데까지만** 한다. 유형을 시퀀스 값으로
 * 바꾸는 일은 저장소를 봐야 하므로 search-api가 맡는다.
 *
 * ## 가르는 순서가 답을 바꾼다
 *
 * `1234`는 PR 번호일 수도 서수일 수도 있다. 순서를 정해 한쪽을 이기게 하면
 * **입력은 통과하지만 사용자가 뜻하지 않은 구간이 나온다** — 그리고 그 구간은
 * 오류 없이 그럴듯하게 생겼다. 범위 인용이 조용히 틀리는 것이 이 제품이 막으려는
 * 실패이므로, 모호한 입력은 **이기게 하지 않고 물어본다** (`ambiguous`).
 *
 * 그래서 다섯 유형은 각자 **겹치지 않는 형태**를 갖는다.
 */

/** 축약 SHA 최소 길이 (ADR-012). `@prs/query`의 `MIN_SHA_PREFIX_LENGTH`와 같은 값이다. */
export const MIN_ANCHOR_SHA_LENGTH = 7;

/** `seq:1342` 또는 `@1342`. */
const SEQUENCE_EXPRESSION = /^(?:seq:|@)(\d+)$/i;
/** `#1234`. 저장소 접두는 받지 않는다 — 앵커의 저장소는 요청이 정한다. */
const PR_EXPRESSION = /^#(\d+)$/;
const HEX = /^[0-9a-f]+$/i;
const DIGITS = /^\d+$/;
/** `YYYY-MM-DD` 뒤에 시각이 붙을 수 있다. 연도만으로는 시각으로 읽지 않는다 — 태그 이름과 겹친다. */
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/**
 * PR 번호 상한 (DEV-066과 같은 근거).
 *
 * 이것이 없으면 40자리 숫자가 PR 번호가 된다. 서수에도 같은 상한을 쓴다 —
 * `merge_seq`는 `BIGINT`지만 `Number`로 다루는 이상 안전 정수 밖의 값을
 * 받아들이면 비교가 조용히 틀린다.
 */
const MAX_ANCHOR_NUMBER = 2_147_483_647;

export type AnchorPosition = 'from' | 'to';

/**
 * 분류 결과.
 *
 * `release`가 마지막인 것은 **남은 것을 태그로 본다**는 뜻이다. 태그 이름에는
 * 형식 제약이 거의 없어서 앞의 넷에 걸리지 않은 문자열을 태그로 읽는 것 말고
 * 다른 방법이 없다.
 */
export type AnchorExpression =
  /** `seq:1342` / `@1342`. 값이 그대로 서수다. 실재 여부는 저장소가 답한다. */
  | { readonly kind: 'sequence'; readonly value: number }
  /** `#1234`. 그 PR의 머지 커밋 서수로 바뀐다 (AC-3). */
  | { readonly kind: 'pull_request'; readonly number: number }
  /** 7~40자 hex. 40자면 `exact`, 그 아래는 `prefix` (ADR-012). */
  | { readonly kind: 'commit'; readonly sha: string; readonly match: 'exact' | 'prefix' }
  /** ISO 8601 시각. 그 시각 이전 마지막 커밋의 서수로 바뀐다 (AC-4). */
  | { readonly kind: 'time'; readonly instant: string }
  /** 그 밖의 문자열. 릴리스 태그로 읽는다 (AC-1). */
  | { readonly kind: 'release'; readonly tag: string }
  /**
   * 두 유형 이상으로 읽히는 입력.
   *
   * **가장 흔한 것이 맨 숫자다.** `1234`는 `#1234`(PR)일 수도 `seq:1234`(서수)일
   * 수도 있고, 7자리 이상이면 SHA 접두이기도 하다. 하나를 골라 주면 사용자는
   * 자기가 고르지 않은 구간을 보게 된다.
   */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
  /** 형태 자체가 앵커가 될 수 없다. 7자 미만 hex처럼 조회 전에 이미 틀린 입력이다. */
  | { readonly kind: 'invalid'; readonly reason: string };

export type AnchorKind = AnchorExpression['kind'];

/** 사용자가 볼 지원 형식 목록 (FR-SEQ-003 예외 처리: "지원 앵커 형식 목록을 반환한다"). */
export const SUPPORTED_ANCHOR_FORMATS: readonly string[] = [
  'seq:1342 또는 @1342 (시퀀스 값)',
  '#1234 (PR 번호)',
  '9f0a1b2 이상 40자까지의 커밋 SHA (최소 7자)',
  '2026-08-12T20:00:00Z (시각)',
  'build-20260812-03 (릴리스 태그)',
];

function positiveWithin(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_ANCHOR_NUMBER) return null;
  return value;
}

/**
 * 앵커 표현을 유형으로 가른다.
 *
 * 순서가 곧 규칙이다. 앞의 검사는 **접두사가 붙어 모호하지 않은** 형태들이고,
 * 뒤로 갈수록 형태의 제약이 느슨해진다.
 */
export function classifyAnchor(raw: string): AnchorExpression {
  const input = raw.trim();
  if (input === '') return { kind: 'invalid', reason: '앵커가 비어 있다' };

  // 1. `seq:` / `@` 접두. 접두가 있으므로 다른 무엇과도 겹치지 않는다.
  const sequenceMatch = SEQUENCE_EXPRESSION.exec(input);
  if (sequenceMatch !== null) {
    const value = positiveWithin(sequenceMatch[1] ?? '');
    if (value === null) return { kind: 'invalid', reason: `시퀀스 값이 범위를 벗어난다: ${input}` };
    return { kind: 'sequence', value };
  }

  // 2. `#` 접두.
  const prMatch = PR_EXPRESSION.exec(input);
  if (prMatch !== null) {
    const number = positiveWithin(prMatch[1] ?? '');
    if (number === null) return { kind: 'invalid', reason: `PR 번호가 범위를 벗어난다: ${input}` };
    return { kind: 'pull_request', number };
  }

  /*
   * 3. 맨 숫자 — 여기서 갈라 준다.
   *
   * hex이기도 하므로 아래 SHA 분기보다 **먼저** 판정해야 한다. 뒤에 두면
   * `1234567`이 조용히 SHA 접두가 되고, 사용자가 뜻한 PR #1234567은 사라진다.
   */
  if (DIGITS.test(input)) {
    const candidates = [`#${input} (PR 번호)`, `seq:${input} (시퀀스 값)`];
    if (input.length >= MIN_ANCHOR_SHA_LENGTH) candidates.push(`${input} (커밋 SHA 접두)`);
    return { kind: 'ambiguous', candidates };
  }

  // 4. hex — 길이가 유형과 오류를 함께 정한다 (ADR-012).
  if (HEX.test(input)) {
    if (input.length > 40) return { kind: 'invalid', reason: `SHA가 40자를 넘는다: ${String(input.length)}자` };
    if (input.length < MIN_ANCHOR_SHA_LENGTH) {
      return {
        kind: 'invalid',
        reason: `축약 SHA는 최소 ${String(MIN_ANCHOR_SHA_LENGTH)}자여야 한다: ${String(input.length)}자`,
      };
    }
    const sha = input.toLowerCase();
    return { kind: 'commit', sha, match: sha.length === 40 ? 'exact' : 'prefix' };
  }

  /*
   * 5. 시각 — `YYYY-MM-DD`로 시작할 때만 본다.
   *
   * `Date.parse`만 믿으면 안 된다: 실행 환경에 따라 `build-3` 같은 문자열까지
   * 받아 주는 파서가 있고, 그러면 태그가 시각이 된다. 형태로 먼저 좁힌 뒤
   * 파싱으로 확인한다.
   */
  if (DATE_LIKE.test(input)) {
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) return { kind: 'invalid', reason: `시각으로 읽을 수 없다: ${input}` };
    return { kind: 'time', instant: new Date(parsed).toISOString() };
  }

  // 6. 남은 것은 태그다.
  return { kind: 'release', tag: input };
}

/**
 * 위치가 경계를 정한다.
 *
 * 표현이 아니라 **위치**가 정하는 것이 핵심이다. 반개구간 `(from, to]`가
 * `git log A..B`와 같은 뜻이려면 시작은 늘 열려 있고 끝은 늘 닫혀 있어야 하며,
 * 앵커가 태그든 SHA든 그 규칙은 달라지지 않는다.
 */
export function boundaryOf(position: AnchorPosition): 'exclusive' | 'inclusive' {
  return position === 'from' ? 'exclusive' : 'inclusive';
}
