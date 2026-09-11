/**
 * M 번호의 공유 판정 (WP-074 / FR-SEQ-008, CR-077 · CR-079, ADR-023).
 *
 * **워커·API·화면이 같은 규칙을 써야 한다.** 표기 문자열(`M-<코드>-<번호>`)을
 * 만드는 자리와 읽는 자리가 갈라지면, 저장소 코드 판정이 한쪽만 바뀐 날 같은
 * 문자열이 서로 다른 PR을 가리킨다. 그래서 전송 수단을 모르는 순수 함수만 여기
 * 둔다 — `@prs/domain`은 워크스페이스 의존을 갖지 않는다.
 *
 * ## 저장소 코드 (OD-009)
 *
 * 저장소 **이름**의 유일한 연속 숫자 run이다. `smp1900` → `1900`. 숫자 run이 없거나
 * 둘 이상이면 코드를 **지어내지 않는다** — 첫 run을 고르거나 합치면 이름이 바뀐
 * 날 과거 인용이 조용히 다른 저장소를 가리킨다. 선행 0은 보존한다 (`app007` → `007`).
 */

/** JavaScript safe integer 상한. 이 위의 새 번호는 `number_capacity_exceeded`다 (C4). */
export const MERGE_NUMBER_MAX = 9007199254740991;

/** 표기 문자열 형식 (API-SEQ-007). suffix는 선행 0 없는 양의 정수다. */
export const MERGE_NUMBER_PATTERN = /^M-([0-9]+)-([1-9][0-9]*)$/;

export type RepositoryCodeOutcome =
  | { readonly kind: 'code'; readonly code: string }
  /** 이름에 숫자가 없다. */
  | { readonly kind: 'unavailable'; readonly reason: 'no_digits' }
  /** 숫자 run이 둘 이상이다. 임의로 고르지 않는다. */
  | { readonly kind: 'unavailable'; readonly reason: 'multiple_digit_runs' };

/**
 * 저장소 이름에서 코드를 뽑는다. `owner/name`이 아니라 **이름**만 받는다 —
 * 소유자 이름의 숫자는 코드가 아니다.
 */
export function repositoryCodeOf(repositoryName: string): RepositoryCodeOutcome {
  const runs = repositoryName.match(/[0-9]+/g) ?? [];
  if (runs.length === 0) return { kind: 'unavailable', reason: 'no_digits' };
  if (runs.length > 1) return { kind: 'unavailable', reason: 'multiple_digit_runs' };
  return { kind: 'code', code: runs[0] as string };
}

/** 표기 문자열. `number`는 1..`MERGE_NUMBER_MAX`의 정수여야 하며 그 밖은 던진다. */
export function formatMergeNumber(code: string, number: number): string {
  /*
   * **만든 문자열은 반드시 되읽을 수 있어야 한다.**
   *
   * `number`만 막고 `code`를 두면 `''`가 `M--3`을, `'19-00'`이 `M-19-00-3`을 만들고
   * 둘 다 `parseMergeNumber`가 `null`을 낸다 — 이 파일이 내건 왕복 불변식이 한쪽에서만
   * 지켜지는 셈이다. 지금은 호출부가 `repositoryCodeOf`의 결과만 넘겨 도달하지 않지만,
   * 불변식을 함수가 스스로 지키게 한다.
   */
  if (!/^[0-9]+$/.test(code)) {
    throw new RangeError(`저장소 코드가 숫자만으로 이루어지지 않았다: ${JSON.stringify(code)}`);
  }
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`M 번호가 1..${String(MERGE_NUMBER_MAX)} 범위의 정수가 아니다: ${String(number)}`);
  }
  return `M-${code}-${String(number)}`;
}

export interface ParsedMergeNumber {
  readonly code: string;
  /** 1..`MERGE_NUMBER_MAX`. 범위를 넘으면 파싱 자체가 실패한다. */
  readonly number: number;
}

/**
 * 표기 문자열을 읽는다. **BigInt로 범위를 확인한 뒤** number로 옮긴다 (API-SEQ-007).
 * `parseInt`의 접두 허용·지수·소수·공백은 전부 `null`이다.
 */
export function parseMergeNumber(text: string): ParsedMergeNumber | null {
  const match = MERGE_NUMBER_PATTERN.exec(text);
  if (match === null) return null;
  const code = match[1] as string;
  const digits = match[2] as string;
  // 자릿수만으로 먼저 거른다 — 수천 자리 문자열을 BigInt로 만들 이유가 없다.
  if (digits.length > 16) return null;
  const value = BigInt(digits);
  if (value < 1n || value > BigInt(MERGE_NUMBER_MAX)) return null;
  return { code, number: Number(value) };
}

/**
 * 채번이 멈추는 사유 (상세 설계 3·8·9절의 고정 enum).
 *
 * `sequence_space.mnumber_blocked_reason`과 API의 `merge_number_reason`이 같은
 * 값을 쓴다. 임의 예외 문구를 여기 넣지 않는다.
 */
export const MERGE_NUMBER_BLOCK_REASONS = [
  /** 이 항목의 PR 근거를 아직 조회하지 못했거나 조회가 아직 비어 있다. */
  'pr_evidence_pending',
  /** 전체 열거가 두 번 비었으나 부재를 확정할 근거가 없다 (DEV-581). */
  'negative_evidence_unavailable',
  /** 후보 열거가 페이지 상한에서 잘렸다. 다음 회차가 cursor에서 잇는다. */
  'partial_lookup',
  /** 과거 머지 방식이 증명되지 않았다. */
  'profile_unverified',
  /** 2-parent 이상 커밋이거나 rebase로 알려진 입력이다. squash 프로파일 밖이다. */
  'unsupported_merge_profile',
  /** 확정된 근거끼리 모순된다 — 같은 PR의 이중 SHA, 확정 뒤 다른 PR 출현 등. */
  'mapping_conflict',
  /** 후보·상세 조회가 일시 실패했다. */
  'fetch_failed',
  /** 다음 번호가 safe integer 상한을 넘는다 (C4). */
  'number_capacity_exceeded',
  /** checkpoint 너머에서 이미 부여된 번호가 발견됐다 — 정본 불일치다. */
  'canonical_mismatch',
] as const;

export type MergeNumberBlockReason = (typeof MERGE_NUMBER_BLOCK_REASONS)[number];

export function isMergeNumberBlockReason(value: string): value is MergeNumberBlockReason {
  return (MERGE_NUMBER_BLOCK_REASONS as readonly string[]).includes(value);
}

/** API가 PR 항목마다 싣는 M 상태 (API-SEQ-007, 상세 설계 9절). */
export const MERGE_NUMBER_STATES = ['assigned', 'pending', 'not_applicable', 'unavailable'] as const;
export type MergeNumberState = (typeof MERGE_NUMBER_STATES)[number];

/**
 * `pending`의 사유. 자기 항목의 blocker 사유 외에 둘이 더 있다 —
 * 앞선 항목 때문에 멈춘 `predecessor_pending`과 아직 `merge_seq`가 없는 `not_sequenced`.
 */
export type MergeNumberPendingReason = MergeNumberBlockReason | 'predecessor_pending' | 'not_sequenced';

/** `not_applicable`·`unavailable`의 사유. */
export type MergeNumberOtherReason =
  | 'not_merged'
  | 'branch_not_tracked'
  | 'mnumber_read_failed'
  | 'repository_code_unavailable'
  | 'number_capacity_exceeded';

/** 실제 검색 hit의 M 값이 정본과 대조된 사실만 `in_sync`다 (상세 설계 7절). */
export const MERGE_NUMBER_PROJECTION_STATES = ['in_sync', 'pending', 'unknown'] as const;
export type MergeNumberProjectionState = (typeof MERGE_NUMBER_PROJECTION_STATES)[number];
