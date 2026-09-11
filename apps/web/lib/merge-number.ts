/**
 * M 번호 표시 모델 (WP-074 / FR-SEQ-008, CR-079, ADR-023 · 상세 설계 9절).
 *
 * ## 세 화면이 하나의 판정을 쓴다
 *
 * W-001 결과 행, W-002 헤더, W-004 구간 행이 같은 DTO 네 키를 받는다. 판정을
 * 화면마다 두면 "시퀀스 채번 대기"와 "M 번호 대기"를 가르는 규칙이 한쪽만
 * 바뀌는 날 세 화면이 서로 다른 말을 한다. 그래서 **순수 함수 하나**가 상태·
 * 문구·설명·링크 가능 여부를 정하고, `MergeNumberBadge`는 그리기만 한다
 * (C-014 `SequenceBadge`와 `lib/sequence.ts`가 세운 분리).
 *
 * ## 없는 값을 지어내지 않는다
 *
 * - 키 자체가 없으면(기능 off, 구버전 응답, 커밋 행) **영역을 그리지 않는다.**
 * - `pending`은 잠정 번호 없이 사유만 말한다 (FR-SEQ-008 예외 처리).
 * - 링크는 `assigned`에만 만든다 — 아직 없는 번호를 가리키는 링크는 거짓이다.
 *
 * ## 링크는 네 값을 전부 나른다
 *
 * `M-1900-42`라는 표기는 브랜치와 에폭을 담지 않는다 (API-SEQ-007). 저장소·
 * 브랜치·에폭·번호 넷이 있어야 서버가 공간을 고르지 않고 답할 수 있으므로,
 * 링크와 복사 URL은 `m_repository`·`m_base_branch`·`m_seq_epoch`·`m_number`를
 * 빠짐없이 싣는다. 일부만 있는 링크는 오류로 보이고 임의 값으로 메우지 않는다.
 */

/** `/search`가 받는 M 해석 진입 query key. 한 곳에 모아 링크·복사·진입이 같은 철자를 쓴다. */
export const MERGE_NUMBER_PARAM = {
  repository: 'm_repository',
  baseBranch: 'm_base_branch',
  seqEpoch: 'm_seq_epoch',
  number: 'm_number',
} as const;

/** API가 PR DTO에 additive로 싣는 M 상태 (API-SEQ-007, 상세 설계 9절). */
export const MERGE_NUMBER_STATES = ['assigned', 'pending', 'not_applicable', 'unavailable'] as const;
export type MergeNumberState = (typeof MERGE_NUMBER_STATES)[number];

/**
 * 목록·상세·범위 PR DTO의 M 키. **전부 선택**이다 — 기능이 꺼진 배포와 구버전
 * 응답에는 키가 없고, 그때 화면은 M 영역을 그리지 않는다.
 *
 * `merge_number_projection_state`는 운영 관측용이라 화면이 읽지 않는다.
 */
export interface MergeNumberFields {
  readonly merge_number?: string | null;
  readonly merge_number_state?: string | null;
  readonly merge_number_reason?: string | null;
  readonly merge_number_epoch?: number | null;
}

/** 판정에 필요한 행의 문맥. 링크를 만들려면 저장소와 브랜치를 알아야 한다. */
export interface MergeNumberContext {
  readonly kind: 'pull_request' | 'commit';
  /** `owner/name`. 모르면 링크를 만들지 않는다. */
  readonly repository: string | null;
  /** 시퀀스 공간의 base 브랜치. 모르면 링크를 만들지 않는다. */
  readonly baseBranch: string | null;
}

/** `assigned` 배지가 가리키는 곳. 네 값이 전부 있어야 성립한다. */
export interface MergeNumberLink {
  readonly repository: string;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly number: string;
  /** `/search?m_repository=…&m_base_branch=…&m_seq_epoch=…&m_number=…` */
  readonly href: string;
}

export type MergeNumberView =
  /** 그릴 것이 없다 — 기능 off, 구버전 응답, 커밋 행. */
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'shown';
      readonly state: MergeNumberState;
      readonly reason: string | null;
      /** 배지에 읽히는 문구. `assigned`면 표기 문자열 자체다. */
      readonly label: string;
      /** `aria-describedby`로 잇는 설명. 색과 문구만으로 전달되지 않는 사유를 말한다. */
      readonly description: string;
      readonly tone: 'accent' | 'neutral' | 'warning';
      /** `assigned`이고 문맥이 갖춰졌을 때만 있다. `pending`·`unavailable`에는 절대 없다. */
      readonly link: MergeNumberLink | null;
    };

function isMergeNumberState(value: unknown): value is MergeNumberState {
  return typeof value === 'string' && (MERGE_NUMBER_STATES as readonly string[]).includes(value);
}

/**
 * 투영이 주는 `owner/repo@branch`를 가른다.
 *
 * 저장소 이름에는 `@`가 올 수 없으므로 **첫 `@`**에서 자른다 — 브랜치 이름에는
 * `@`가 올 수 있어 마지막 `@`로 자르면 브랜치가 잘린다.
 */
export function splitSequenceSpace(
  space: string | null | undefined,
): { readonly repository: string; readonly baseBranch: string } | null {
  if (space === null || space === undefined) return null;
  const at = space.indexOf('@');
  if (at <= 0 || at === space.length - 1) return null;
  return { repository: space.slice(0, at), baseBranch: space.slice(at + 1) };
}

/** M 배지 링크·복사 URL. 네 키를 `URLSearchParams`로 직렬화한다 (상세 설계 9절). */
export function mergeNumberEntryHref(link: {
  readonly repository: string;
  readonly baseBranch: string;
  readonly seqEpoch: number | string;
  readonly number: string;
}): string {
  const params = new URLSearchParams();
  params.set(MERGE_NUMBER_PARAM.repository, link.repository);
  params.set(MERGE_NUMBER_PARAM.baseBranch, link.baseBranch);
  params.set(MERGE_NUMBER_PARAM.seqEpoch, String(link.seqEpoch));
  params.set(MERGE_NUMBER_PARAM.number, link.number);
  return `/search?${params.toString()}`;
}

/** `pending` 사유의 사람 읽는 설명. 내부 blocker 식별자는 서버가 주지 않으므로 여기에도 없다. */
const PENDING_REASON_TEXT: Readonly<Record<string, string>> = {
  pr_evidence_pending: '이 PR의 머지 근거를 아직 확인하는 중입니다.',
  predecessor_pending: '앞선 항목의 PR 연결이 확정되지 않아 그 지점에서 채번이 멈췄습니다.',
  negative_evidence_unavailable: '앞선 항목이 PR 없는 반영인지 확정할 근거가 아직 없습니다.',
  partial_lookup: '후보 조회가 아직 끝나지 않았습니다.',
  profile_unverified: '과거 머지 방식이 확인되지 않았습니다.',
  unsupported_merge_profile: '스쿼시가 아닌 머지 이력이 있어 채번하지 않습니다.',
  mapping_conflict: '머지 근거가 서로 모순되어 채번을 멈췄습니다.',
  fetch_failed: '머지 근거 조회가 일시 실패했습니다. 다음 회차에 다시 시도합니다.',
  canonical_mismatch: '정본 대조에 불일치가 있어 채번을 멈췄습니다.',
};

/**
 * 배지 판정.
 *
 * **결정 순서는 상세 설계 9절 그대로다**: 커밋/키 없음 → not_applicable →
 * unavailable → pending(not_sequenced 우선) → assigned. 이 순서를 바꾸면
 * 미머지 PR이 "대기"로, 조회 실패가 "대상 아님"으로 보인다 — 둘 다 거짓이다.
 */
export function mergeNumberView(fields: MergeNumberFields, context: MergeNumberContext): MergeNumberView {
  // 커밋에는 M 개념이 없다 (FR-SEQ-008 AC-1). 키가 실려 와도 그리지 않는다.
  if (context.kind === 'commit') return { kind: 'hidden' };
  const state = fields.merge_number_state;
  // 키가 없거나 모르는 값이면 기능 off와 같게 본다 — 구버전 응답도 여기로 온다.
  if (!isMergeNumberState(state)) return { kind: 'hidden' };

  const reason = typeof fields.merge_number_reason === 'string' ? fields.merge_number_reason : null;

  switch (state) {
    case 'not_applicable':
      if (reason === 'branch_not_tracked') {
        return shown(state, reason, '채번 비대상 브랜치', '대상 브랜치가 채번 대상이 아니어서 M 번호가 없습니다.', 'neutral');
      }
      return shown(state, reason, 'M 번호 대상 아님', '머지되지 않은 PR에는 M 번호가 없습니다.', 'neutral');

    case 'unavailable':
      if (reason === 'repository_code_unavailable') {
        return shown(
          state,
          reason,
          '저장소 코드 확인 필요',
          '저장소 이름에서 코드를 정할 수 없어 M 번호를 표기하지 못했습니다. 번호 자체는 부여되었을 수 있습니다.',
          'warning',
        );
      }
      if (reason === 'number_capacity_exceeded') {
        return shown(state, reason, 'M 번호 확인 불가', 'M 번호가 표기 가능한 범위를 넘어 표시하지 않습니다.', 'warning');
      }
      return shown(state, reason, 'M 번호 확인 불가', 'M 번호를 확인하지 못했습니다. 다시 시도하면 표시될 수 있습니다.', 'warning');

    case 'pending': {
      if (reason === 'not_sequenced') {
        return shown(
          state,
          reason,
          '시퀀스 채번 대기',
          '머지 시퀀스가 아직 채번되지 않아 M 번호를 계산하지 않았습니다. 잠정 번호는 없습니다.',
          'neutral',
        );
      }
      const why = reason === null ? '사유를 아직 확인하지 못했습니다.' : (PENDING_REASON_TEXT[reason] ?? `사유 코드: ${reason}.`);
      return shown(state, reason, 'M 번호 대기', `M 번호가 아직 부여되지 않았습니다. ${why} 잠정 번호는 없습니다.`, 'neutral');
    }

    case 'assigned': {
      const number = fields.merge_number;
      /*
       * `assigned`인데 표기 문자열이 없으면 서버 계약 위반이다. 없는 번호를
       * 그릴 수 없으므로 "확인 불가"로 말한다 — 빈 배지는 "번호가 없다"로 읽힌다.
       */
      if (typeof number !== 'string' || number === '') {
        return shown('unavailable', reason, 'M 번호 확인 불가', 'M 번호 표기를 받지 못했습니다. 다시 시도하면 표시될 수 있습니다.', 'warning');
      }
      const epoch = typeof fields.merge_number_epoch === 'number' ? fields.merge_number_epoch : null;
      const link =
        epoch !== null && context.repository !== null && context.baseBranch !== null
          ? {
              repository: context.repository,
              baseBranch: context.baseBranch,
              seqEpoch: epoch,
              number,
              href: mergeNumberEntryHref({
                repository: context.repository,
                baseBranch: context.baseBranch,
                seqEpoch: epoch,
                number,
              }),
            }
          : null;
      const space =
        context.repository !== null && context.baseBranch !== null
          ? `${context.repository}@${context.baseBranch}`
          : '이 시퀀스 공간';
      const epochText = epoch === null ? '' : ` (에폭 ${String(epoch)})`;
      return {
        kind: 'shown',
        state,
        reason,
        label: number,
        description: `${space}의 M 번호${epochText}. PR 번호를 대체하지 않으며 선후관계 확인에만 씁니다. 시퀀스 에폭이 바뀌면 무효가 됩니다.`,
        tone: 'accent',
        link,
      };
    }
  }
}

function shown(
  state: MergeNumberState,
  reason: string | null,
  label: string,
  description: string,
  tone: 'accent' | 'neutral' | 'warning',
): MergeNumberView {
  return { kind: 'shown', state, reason, label, description, tone, link: null };
}

/**
 * 보이는 목록/상세에 `pending`이 하나라도 있는가 — 자동 재검증의 조건이다.
 *
 * 커밋 항목은 키가 없으므로 자연히 세지 않는다.
 */
export function hasPendingMergeNumber(
  items: readonly (MergeNumberFields & { readonly kind?: 'pull_request' | 'commit' })[],
): boolean {
  /*
   * **배지가 그리지 않는 행은 세지 않는다.**
   *
   * 커밋에는 M 개념이 없어 `mergeNumberView`가 `hidden`을 낸다. 그런데도 그 행을
   * `pending`으로 세면 **보이지 않는 것을 기다리느라** 60초 동안 재검증이 헛돈다.
   * 같은 파일의 두 함수가 "이 행에 M이 있는가"에 다른 답을 하면 안 된다.
   */
  return items.some((item) => item.kind !== 'commit' && item.merge_number_state === 'pending');
}

// ---------------------------------------------------------------- 자동 재검증 정책

/** 재검증 간격. 행별 poll이 아니라 **현재 요청 하나**를 이 간격으로 다시 보낸다. */
export const MERGE_NUMBER_POLL_INTERVAL_MS = 5_000;
/** 이 시간이 지나면 자동 재검증을 멈추고 수동 새로고침을 제시한다. */
export const MERGE_NUMBER_POLL_DEADLINE_MS = 60_000;

export type RevalidationDecision =
  /** 지금 같은 요청을 한 번 더 보낸다. */
  | 'revalidate'
  /** 탭이 보이지 않는다 — 보내지 않는다. */
  | 'skip_hidden'
  /** 직전 요청이 아직 돌아오지 않았다 — 겹치지 않는다. */
  | 'skip_in_flight'
  /** 60초가 지났다 — 멈추고 수동 새로고침을 제시한다. */
  | 'stop_deadline'
  /** 재검증할 이유가 없다 (pending 없음, 화면이 ready가 아님). */
  | 'idle';

export interface RevalidationInput {
  readonly pending: boolean;
  /** 화면이 결과를 보이는 상태인가. 오류·낡은 에폭·인증 만료면 `false`다. */
  readonly enabled: boolean;
  readonly hidden: boolean;
  readonly inFlight: boolean;
  /** 이 pending 회차가 시작된 시각. 아직 시작하지 않았으면 `null`. */
  readonly startedAt: number | null;
  readonly now: number;
}

/**
 * 한 tick의 결정. **순서가 우선순위다**: 이유 없음 → 마감 → 숨김 → 진행 중 → 보냄.
 *
 * 마감을 숨김보다 먼저 보는 이유: 탭을 오래 숨겨 두었다 돌아와도 60초가
 * 지났으면 다시 시작하지 않고 수동 새로고침을 제시해야 한다.
 */
export function revalidationDecision(input: RevalidationInput): RevalidationDecision {
  if (!input.pending || !input.enabled) return 'idle';
  if (input.startedAt !== null && input.now - input.startedAt >= MERGE_NUMBER_POLL_DEADLINE_MS) {
    return 'stop_deadline';
  }
  if (input.hidden) return 'skip_hidden';
  if (input.inFlight) return 'skip_in_flight';
  return 'revalidate';
}

// ---------------------------------------------------------------- `/search` M 해석 진입

export type MergeNumberEntry =
  /** M 진입 키가 하나도 없다 — 보통의 검색 화면이다. */
  | { readonly kind: 'absent' }
  /** 일부만 있다. 오류를 보이고 **임의 branch/epoch로 메우지 않는다.** */
  | { readonly kind: 'partial'; readonly present: readonly string[]; readonly missing: readonly string[] }
  /** 같은 key가 여러 번 왔다. 어느 것이 뜻인지 알 수 없으므로 고르지 않는다. */
  | { readonly kind: 'duplicated'; readonly keys: readonly string[] }
  | {
      readonly kind: 'complete';
      readonly repository: string;
      readonly baseBranch: string;
      /** 원문 그대로다. 형식 판정은 서버가 한다 (`seq_epoch`과 같은 규칙, PR #64 P1). */
      readonly seqEpoch: string;
      readonly number: string;
    };

/** URL 질의에서 M 진입을 읽는다. 값이 비어 있으면 없는 것으로 본다. */
export function readMergeNumberEntry(params: URLSearchParams): MergeNumberEntry {
  const keys = [
    MERGE_NUMBER_PARAM.repository,
    MERGE_NUMBER_PARAM.baseBranch,
    MERGE_NUMBER_PARAM.seqEpoch,
    MERGE_NUMBER_PARAM.number,
  ] as const;
  const values = new Map<string, string>();
  const duplicated: string[] = [];
  for (const key of keys) {
    const all = params.getAll(key);
    /*
     * **중복 키를 조용히 첫 값으로 접지 않는다** (설계 9절: 중복 query key는 400).
     *
     * 접으면 서로 다른 두 번호를 담은 링크가 오류 없이 하나로 이동한다 — 사용자는
     * 자기가 무엇을 열었는지 모른 채 그 답을 인용하게 된다. 서버가 400을 낼 기회
     * 자체가 사라지므로 여기서 말한다.
     */
    if (all.length > 1) duplicated.push(key);
    const raw = all[0];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed !== '') values.set(key, trimmed);
  }
  if (duplicated.length > 0) return { kind: 'duplicated', keys: duplicated };
  if (values.size === 0) return { kind: 'absent' };
  if (values.size < keys.length) {
    return {
      kind: 'partial',
      present: keys.filter((key) => values.has(key)),
      missing: keys.filter((key) => !values.has(key)),
    };
  }
  return {
    kind: 'complete',
    repository: values.get(MERGE_NUMBER_PARAM.repository) as string,
    baseBranch: values.get(MERGE_NUMBER_PARAM.baseBranch) as string,
    seqEpoch: values.get(MERGE_NUMBER_PARAM.seqEpoch) as string,
    number: values.get(MERGE_NUMBER_PARAM.number) as string,
  };
}

/** BFF 경유 해석 URL. 프록시가 `/api/v1/merge-numbers/resolve`로 넘긴다 (API-SEQ-007). */
export function mergeNumberResolveUrl(entry: Extract<MergeNumberEntry, { kind: 'complete' }>): string {
  const params = new URLSearchParams();
  params.set('repository', entry.repository);
  params.set('base_branch', entry.baseBranch);
  params.set('merge_number', entry.number);
  params.set('seq_epoch', entry.seqEpoch);
  return `/api/merge-numbers/resolve?${params.toString()}`;
}

/** PR 상세 경로. 조각마다 인코딩한다 — `owner/name`의 `/`가 경로를 가르는 것이 맞다. */
export function pullRequestHref(repository: string, prNumber: number): string | null {
  const [owner, name, ...rest] = repository.split('/');
  if (owner === undefined || owner === '' || name === undefined || name === '' || rest.length > 0) return null;
  return `/pr/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${String(prNumber)}`;
}

export type MergeNumberResolveOutcome =
  | {
      readonly kind: 'assigned';
      readonly prNumber: number;
      readonly mergeNumber: string;
      readonly seqEpoch: number | null;
      readonly sequenceSpace: string | null;
      /** 상세 경로. 저장소 이름이 `owner/name` 모양이 아니면 `null`이다. */
      readonly href: string | null;
    }
  /** M 방향에서는 도달할 수 없다고 계약이 말하지만, 오면 잠정값 없이 대기로 보인다. */
  | { readonly kind: 'pending'; readonly reason: string | null; readonly prNumber: number | null }
  | {
      readonly kind: 'epoch_stale';
      readonly sequenceSpace: string | null;
      readonly requestedEpoch: number | null;
      readonly currentEpoch: number | null;
    }
  | { readonly kind: 'no_sequence'; readonly reason: string | null; readonly message: string }
  | { readonly kind: 'not_found' }
  /** 이 배포에서 기능이 꺼져 있다 (404 + `detail.reason = feature_disabled`). */
  | { readonly kind: 'feature_disabled' }
  | { readonly kind: 'invalid'; readonly message: string; readonly field: string | null; readonly reason: string | null }
  | { readonly kind: 'auth_expired'; readonly loginPath: string | null }
  | { readonly kind: 'error'; readonly code: string; readonly message: string; readonly correlationId: string | null; readonly status: number };

/**
 * 해석 응답 판정 (API-SEQ-007 CR-079 상태 표).
 *
 * **HTTP 코드와 `error.code`·`detail.reason`으로만 가른다.** 문구를 재해석하지
 * 않는다 — 서버가 정한 코드로 분기해야 두 곳의 판단이 갈리지 않는다.
 */
export function judgeMergeNumberResolve(
  status: number,
  body: unknown,
  repository: string,
): MergeNumberResolveOutcome {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  if (status >= 200 && status < 300) {
    if (record['epoch_stale'] === true) {
      return {
        kind: 'epoch_stale',
        sequenceSpace: stringOrNull(record['sequence_space']),
        requestedEpoch: numberOrNull(record['requested_seq_epoch']),
        currentEpoch: numberOrNull(record['seq_epoch']),
      };
    }
    const prNumber = numberOrNull(record['pr_number']);
    const mergeNumber = stringOrNull(record['merge_number']);
    if (record['merge_number_state'] === 'assigned' && prNumber !== null && mergeNumber !== null) {
      return {
        kind: 'assigned',
        prNumber,
        mergeNumber,
        seqEpoch: numberOrNull(record['seq_epoch']),
        sequenceSpace: stringOrNull(record['sequence_space']),
        href: pullRequestHref(repository, prNumber),
      };
    }
    if (record['merge_number_state'] === 'pending') {
      return { kind: 'pending', reason: stringOrNull(record['merge_number_reason']), prNumber };
    }
    // 2xx인데 아는 모양이 아니다 — 성공으로 위장하지 않는다.
    return { kind: 'error', code: 'UNEXPECTED_RESPONSE', message: '해석 응답의 모양이 계약과 다릅니다.', correlationId: stringOrNull(record['correlation_id']), status };
  }

  const error = (typeof record['error'] === 'object' && record['error'] !== null ? record['error'] : {}) as Record<string, unknown>;
  const code = stringOrNull(error['code']) ?? 'UNKNOWN';
  const message = stringOrNull(error['message']) ?? '해석에 실패했습니다.';
  const detail = (typeof error['detail'] === 'object' && error['detail'] !== null ? error['detail'] : {}) as Record<string, unknown>;
  const reason = stringOrNull(detail['reason']);
  const correlationId = stringOrNull(record['correlation_id']);

  if (status === 401 || code === 'UNAUTHENTICATED') {
    return { kind: 'auth_expired', loginPath: stringOrNull(detail['login_path']) };
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return reason === 'feature_disabled' ? { kind: 'feature_disabled' } : { kind: 'not_found' };
  }
  if (status === 409 || code === 'NO_SEQUENCE') return { kind: 'no_sequence', reason, message };
  if (status === 400 || code === 'INVALID_PARAMETER') {
    return { kind: 'invalid', message, field: stringOrNull(detail['field']), reason };
  }
  return { kind: 'error', code, message, correlationId, status };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * 응답의 `pr_number`·`seq_epoch`를 읽는다.
 *
 * **정수와 범위를 본다** (설계 9절: `1..2147483647`). `Number.isFinite`만 보면
 * `1.5`가 `/pr/acme/pay/1.5`를, `-3`이 `/pr/acme/pay/-3`을 만든다 — 서버가 낼 수
 * 없는 값이지만, 그 계약을 판정하는 자리가 여기이므로 여기서 막는다.
 */
const INT4_MAX = 2_147_483_647;

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= INT4_MAX ? value : null;
}
