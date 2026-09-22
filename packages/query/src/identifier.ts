/**
 * 식별자 판별 (FR-SRCH-001, FR-SRCH-004 / 백엔드 아키텍처 4.5의 해석 순서).
 *
 * **여기가 브라우저에서도 돈다** (ADR-001). QA-W001-04가 "6자 이하 hex 입력이
 * **서버 호출 없이** 즉시 거부되고 사유가 표시된다"를 요구하기 때문이다. 그래서
 * 이 파일은 HTTP도 Elasticsearch도 모른다 — 문자열을 보고 "무엇으로 읽을
 * 것인가"까지만 정한다. 조회는 호출 측이 한다.
 *
 * ## 해석은 하나가 아니라 목록이다 (CR-017, DEV-066)
 *
 * 해석 순서 3단계는 "`#N` 또는 순수 정수 → pull_request", 5단계는
 * "7~39자 hex → commit(prefix)"인데 `1234567`은 **둘 다**다. 순서를 문자 그대로
 * 따르면 3단계가 먼저이므로 40자리 숫자도 PR 번호가 되어 커밋 조회가 영영
 * 일어나지 않는다.
 *
 * 그래서 판별기는 **우선순위 있는 해석 목록**을 돌려준다. 겹치는 입력은 두
 * 경로를 모두 조회하고 후보를 합친다. FR-SRCH-001 **AC-5가 이미 이 상황을
 * 정의한다** — "해석 후보가 2건 이상이면 후보 배열을 반환하고 자동 이동을
 * 수행하지 않는다".
 *
 * ## M 번호 문자열은 그 자체가 식별자다 (CR-114, FR-SRCH-001 AC-7)
 *
 * `M-1900-1450`은 저장소 코드와 조밀 서수를 담은 표기 문자열이다(`FR-SEQ-008`
 * AC-5). 사내 `pilot.17`에서 이 문자열을 검색창에 넣으면 전문 검색으로 떨어져
 * 토큰 `m`·`1900`·`1450`이 엉뚱한 제목에 걸렸다. 판별은 `@prs/domain`의
 * `parseMergeNumber` **하나**를 쓴다 — 워커·API·화면이 같은 규칙으로 문자열을
 * 만들고 읽어야 하며, 정규식을 여기서 한 번 더 적으면 저장소 코드 규칙이 한쪽만
 * 바뀐 날 같은 문자열이 다른 PR을 가리킨다. 어느 저장소·브랜치·에폭인지는
 * 여기서 모른다 — 코드가 같은 저장소가 여럿일 수 있고 그 판정은 서버가 접근
 * 범위 안에서 한다.
 */

import { formatMergeNumber, parseMergeNumber } from '@prs/domain';

/** 40자 전체 SHA. */
const FULL_SHA_LENGTH = 40;

/**
 * 축약 SHA의 최소 길이 (ADR-012).
 *
 * git의 기본 축약 길이가 7자다. 6자 이하는 충돌이 흔해 결과 50건 절삭에 계속
 * 걸리므로 검색 결과로서 유용하지 않다.
 */
export const MIN_SHA_PREFIX_LENGTH = 7;

const HEX = /^[0-9a-f]+$/;
/** `owner/repo` — GitHub이 허용하는 문자만. */
const OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** `#1234` 또는 `owner/repo#1234`. */
const HASH_NUMBER = /^(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#(\d+)$/;
const DIGITS = /^\d+$/;

/**
 * PR 번호 상한.
 *
 * GitHub의 이슈·PR 번호는 32비트 정수 범위 안에 있다. 이보다 큰 숫자를 PR로
 * 읽으면 40자리 숫자가 PR 번호가 되는 우스운 일이 생긴다 (DEV-066).
 */
const MAX_PR_NUMBER = 2_147_483_647;

/** 하나의 해석. 우선순위는 배열 순서다. */
export type Identifier =
  /** 40자 hex. `term` 질의로 정확히 하나를 찾는다. */
  | { readonly kind: 'commit'; readonly match: 'exact'; readonly sha: string }
  /** 7~39자 hex. `prefix` 질의 (ADR-012). */
  | { readonly kind: 'commit'; readonly match: 'prefix'; readonly sha: string }
  /** PR 번호. `repository`가 `null`이면 접근 범위 안에서 후보를 찾는다. */
  | { readonly kind: 'pull_request'; readonly repository: string | null; readonly number: number }
  /**
   * M 번호 표기 문자열 (CR-114, FR-SRCH-001 AC-7).
   *
   * `code`는 저장소 이름의 숫자 부분(OD-009)이고 `number`는 그 시퀀스 공간의 조밀
   * 서수다. `label`은 정규화된 표기(`M-<code>-<number>`)로, 입력이 `[M-…]`처럼
   * 제목 접두 그대로였거나 소문자 `m`이었어도 이 값은 정본 형식이다. 어느
   * 저장소·브랜치·에폭인지는 서버가 접근 범위 안에서 판정한다.
   */
  | { readonly kind: 'merge_number'; readonly code: string; readonly number: number; readonly label: string }
  /** 자유 텍스트. 전문 검색으로 위임한다 (FR-SRCH-001 AC-4). */
  | { readonly kind: 'text' };

export type IdentifierKind = Identifier['kind'];

export interface IdentifierDetection {
  /** 정규화된 입력 (양끝 공백 제거). */
  readonly input: string;
  /**
   * 우선순위 순 해석 목록. 비어 있지 않다 — 아무것도 안 맞으면 `text` 하나다.
   *
   * 겹치는 입력(`1234567`)은 2건이다: PR 번호 먼저, SHA 접두 다음 (DEV-066).
   */
  readonly interpretations: readonly Identifier[];
  /**
   * 조회하기 전에 이미 틀린 입력 (FR-SRCH-004 AC-2).
   *
   * 7자 미만 hex가 유일한 경우다. 화면이 서버를 부르지 않고 바로 거절한다
   * (QA-W001-04). `null`이면 조회로 진행한다.
   */
  readonly rejection: IdentifierRejection | null;
}

export interface IdentifierRejection {
  /** API 계약 6장의 코드. 상태 코드는 만들지 않는다 — 이 패키지는 HTTP를 모른다. */
  readonly code: 'SHA_PREFIX_TOO_SHORT';
  readonly message: string;
  /** 몇 자가 필요한지. 화면이 "7자 이상 입력하세요"를 만든다. */
  readonly min_length: number;
  readonly actual_length: number;
}

export interface DetectOptions {
  /**
   * 이 GHE 인스턴스의 기준 URL (CR-017, DEV-064).
   *
   * **호스트 비교는 생략할 수 없다.** 호스트를 보지 않고 경로만 파싱하면
   * `https://other.example/acme/payments/pull/1`이 우리 저장소의 PR로 해석된다.
   * 접근 범위가 데이터를 막아 주더라도 엉뚱한 저장소로 해석하는 것 자체가
   * 오답이다. 없으면 URL 해석을 아예 하지 않는다.
   */
  readonly gheBaseUrl?: string | undefined;
}

const TEXT_ONLY: readonly Identifier[] = [{ kind: 'text' }];

/** 호스트만 꺼낸다. 파싱할 수 없으면 `null`. */
function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * GHE URL을 해석한다 (해석 1단계, FR-SRCH-001 AC-3).
 *
 * `https://<host>/<owner>/<repo>/pull/1234` → PR
 * `https://<host>/<owner>/<repo>/commit/<sha>` → 커밋
 *
 * 호스트가 다르면 `null`이다 — 그 URL은 우리 것이 아니다.
 */
function fromUrl(input: string, gheBaseUrl: string | undefined): Identifier | null {
  if (gheBaseUrl === undefined || gheBaseUrl === '') return null;

  const expected = hostOf(gheBaseUrl);
  const actual = hostOf(input);
  if (expected === null || actual === null || expected !== actual) return null;

  let path: string;
  try {
    path = new URL(input).pathname;
  } catch {
    return null;
  }

  // `/owner/repo/pull/1234` → ['owner', 'repo', 'pull', '1234']
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.length < 4) return null;

  const [owner, repo, resource, value] = parts;
  if (owner === undefined || repo === undefined || resource === undefined || value === undefined) {
    return null;
  }
  const repository = `${owner}/${repo}`;
  if (!OWNER_REPO.test(repository)) return null;

  if (resource === 'pull' || resource === 'pulls') {
    if (!DIGITS.test(value)) return null;
    const number = Number(value);
    if (number < 1 || number > MAX_PR_NUMBER) return null;
    return { kind: 'pull_request', repository, number };
  }

  if (resource === 'commit' || resource === 'commits') {
    const sha = value.toLowerCase();
    if (!HEX.test(sha) || sha.length !== FULL_SHA_LENGTH) return null;
    return { kind: 'commit', match: 'exact', sha };
  }

  return null;
}

/**
 * `M-<코드>-<번호>` (CR-114, FR-SRCH-001 AC-7).
 *
 * 받아들이는 변형은 둘뿐이다 — PR 제목 접두를 그대로 붙여 넣은 `[M-1900-1450]`과
 * 소문자 `m`. 그 밖은 `parseMergeNumber`의 판정 그대로다: 선행 0이 붙은 번호,
 * 공백, 코드 없는 `M-1450`은 전부 `null`이며 그때 이 문자열은 `text`다.
 * 저장소 코드의 선행 0은 보존한다(`M-007-3`의 코드는 `007`이다, `repositoryCodeOf`).
 */
function fromMergeNumber(input: string): Identifier | null {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text.startsWith('m-')) text = `M${text.slice(1)}`;
  const parsed = parseMergeNumber(text);
  if (parsed === null) return null;
  return { kind: 'merge_number', code: parsed.code, number: parsed.number, label: formatMergeNumber(parsed.code, parsed.number) };
}

/** `#1234` / `owner/repo#1234` (해석 2·3단계, FR-SRCH-001 AC-2). */
function fromHashNumber(input: string): Identifier | null {
  const matched = HASH_NUMBER.exec(input);
  if (matched === null) return null;

  const number = Number(matched[2]);
  if (!Number.isInteger(number) || number < 1 || number > MAX_PR_NUMBER) return null;

  return { kind: 'pull_request', repository: matched[1] ?? null, number };
}

/**
 * hex 문자열을 커밋 해석으로 (해석 4·5·6단계).
 *
 * 대소문자를 구분하지 않는다 (FR-SRCH-004 AC-4). 매핑의 `lowercase_normalizer`가
 * 색인 쪽을 맞추고 여기가 질의 쪽을 맞춘다.
 */
function fromHex(input: string): Identifier | null {
  const sha = input.toLowerCase();
  if (!HEX.test(sha)) return null;
  if (sha.length === FULL_SHA_LENGTH) return { kind: 'commit', match: 'exact', sha };
  if (sha.length >= MIN_SHA_PREFIX_LENGTH && sha.length < FULL_SHA_LENGTH) {
    return { kind: 'commit', match: 'prefix', sha };
  }
  return null;
}

/**
 * 문자열 하나를 해석 목록으로 옮긴다.
 *
 * 아무것도 던지지 않는다. 7자 미만 hex도 예외가 아니라 `rejection`으로
 * 돌려준다 — 화면이 서버를 부르지 않고 그대로 표시해야 하기 때문이다
 * (QA-W001-04).
 */
export function detectIdentifier(raw: string, options: DetectOptions = {}): IdentifierDetection {
  const input = raw.trim();

  if (input === '') {
    return { input, interpretations: TEXT_ONLY, rejection: null };
  }

  const url = fromUrl(input, options.gheBaseUrl);
  if (url !== null) {
    return { input, interpretations: [url], rejection: null };
  }

  /*
   * M 번호 문자열은 다른 어떤 해석과도 겹치지 않는다 (CR-114). `M-`으로 시작하므로
   * hex도 정수도 `#N`도 아니다 — 해석은 이것 하나이며 후보가 여럿인 경우는 같은
   * 코드를 가진 저장소가 여럿일 때이고, 그것은 서버가 후보 배열로 답한다(AC-5).
   */
  const mergeNumber = fromMergeNumber(input);
  if (mergeNumber !== null) {
    return { input, interpretations: [mergeNumber], rejection: null };
  }

  const interpretations: Identifier[] = [];

  const hash = fromHashNumber(input);
  if (hash !== null) interpretations.push(hash);

  /*
   * 순수 정수는 PR 번호이면서 SHA 접두일 수 있다 (DEV-066).
   *
   * 둘 다 넣는다. 순서는 해석 순서 3단계가 5단계보다 앞이라는 것을 지키되,
   * 커밋 경로를 막지는 않는다. 상한을 넘는 숫자는 PR로 읽지 않는다 —
   * 40자리 숫자가 PR 번호일 리 없다.
   */
  if (hash === null && DIGITS.test(input)) {
    const number = Number(input);
    if (Number.isInteger(number) && number >= 1 && number <= MAX_PR_NUMBER) {
      interpretations.push({ kind: 'pull_request', repository: null, number });
    }
  }

  const hex = fromHex(input);
  if (hex !== null) {
    interpretations.push(hex);
  } else if (interpretations.length === 0 && HEX.test(input.toLowerCase())) {
    /*
     * hex인데 해석이 안 됐다 = 7자 미만이다 (FR-SRCH-004 AC-2).
     *
     * `interpretations.length === 0`을 함께 보는 이유는 `123`처럼 짧은 숫자가
     * 이미 PR 번호로 읽혔기 때문이다. PR #123을 "7자 미만 SHA"라고 거절하면
     * 안 된다.
     */
    return {
      input,
      interpretations: TEXT_ONLY,
      rejection: {
        code: 'SHA_PREFIX_TOO_SHORT',
        message: `A shortened SHA must contain at least ${String(MIN_SHA_PREFIX_LENGTH)} characters`,
        min_length: MIN_SHA_PREFIX_LENGTH,
        actual_length: input.length,
      },
    };
  }

  /*
   * 릴리스 태그는 판별하지 않는다 (CR-017, DEV-065).
   *
   * 해석 7단계가 "태그 패턴"을 말하지만 그 패턴이 무엇인지는 SRS에도
   * 아키텍처에도 없고 `prs-releases`도 아직 비어 있다(WP-024). 패턴을
   * 추측해 넣으면 `v1`·`build-2`가 릴리스로 오분류되어 전문 검색으로 가야 할
   * 질의가 0건이 된다. FR-SRCH-001 AC-4대로 `text`로 둔다.
   */
  if (interpretations.length === 0) {
    return { input, interpretations: TEXT_ONLY, rejection: null };
  }

  return { input, interpretations, rejection: null };
}

/**
 * 응답의 `detected_kind`.
 *
 * 후보를 만들어 낸 해석이 있으면 그 유형이고, 없으면 우선순위 1위의 유형이다.
 * 호출 측이 조회 결과를 알기 때문에 판별 자체는 여기서 하지 않고 헬퍼만 둔다.
 */
export function primaryKind(detection: IdentifierDetection): IdentifierKind {
  return detection.interpretations[0]?.kind ?? 'text';
}
