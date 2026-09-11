/**
 * M 번호 DTO의 순수 판정 (WP-074 / FR-SEQ-008 AC-12 · AC-13, CR-079, 상세 설계 9절).
 *
 * ## 왜 한 곳인가
 *
 * 목록(`API-SRCH-004`)·상세(`API-SRCH-003`)·범위(`API-SEQ-001`)·해석(`API-SEQ-007`) 넷이
 * 같은 다섯 필드를 싣는다. 판정이 네 곳에 흩어지면 한쪽만 고쳐지는 날 같은 PR이
 * 화면마다 다른 상태로 보인다 — `sequence-context.ts`가 `seq:` 해석에 세운 규율과 같다.
 *
 * ## 결정 순서가 계약이다 (설계 9절 마지막 문단)
 *
 * 1. 미머지·비대상 브랜치 → `not_applicable`
 * 2. 정본 조회 실패 → `unavailable` / `mnumber_read_failed`
 * 3. 시퀀스 공간·행 없음 → `pending` / `not_sequenced`
 * 4. 번호 없음 → `pending`. 자기 자리가 막혔으면 그 사유, 앞이 막혔으면 `predecessor_pending`
 * 5. 번호 있음 → `assigned`. 표기 코드를 만들 수 없으면 `unavailable` / `repository_code_unavailable`
 *
 * 내부 blocker 서수는 **응답에 넣지 않는다** — 운영 CLI만 접근 권한 안에서 본다.
 */

import { formatMergeNumber, isMergeNumberBlockReason, repositoryCodeOf, type MergeNumberProjectionState, type MergeNumberState } from '@prs/domain';
import type { MergeNumberLookup, MergeNumberSpaceState } from '@prs/db';

/** 응답에 실리는 다섯 필드. 기능이 꺼진 배포에서는 이 객체 자체를 만들지 않는다. */
export interface MergeNumberFields {
  readonly merge_number: string | null;
  readonly merge_number_state: MergeNumberState;
  readonly merge_number_reason: string | null;
  readonly merge_number_epoch: number | null;
  readonly merge_number_projection_state: MergeNumberProjectionState;
}

export interface MergeNumberSubject {
  readonly repositoryId: number;
  readonly baseBranch: string | null;
  readonly prNumber: number;
  /** 저장소 **이름**(owner 제외). 표기 코드의 출처다 (OD-009). */
  readonly repositoryName: string | null;
  /** PR 상태. `merged`가 아니면 M 대상이 아니다. */
  readonly state: string | null;
  /** 색인이 지금 말하는 값. 목록은 hit에서 읽고, 없으면 `undefined`. */
  readonly indexed?: { readonly mergeNumber: number | null; readonly epoch: number | null };
}

export interface MergeNumberContext {
  /** 정본 batch 결과. 실패했으면 `null`이며 그때 전부 `unavailable`이다. */
  readonly canonical: {
    readonly spaces: readonly MergeNumberSpaceState[];
    readonly rows: readonly MergeNumberLookup[];
  } | null;
  /** 채번 대상 브랜치 목록. 알 수 없으면 `undefined`이며 그때 `branch_not_tracked`를 판정하지 않는다. */
  readonly trackedBranches?: ReadonlyMap<number, readonly string[]>;
}

function keyOf(repositoryId: number, baseBranch: string): string {
  return `${String(repositoryId)}\u0000${baseBranch}`;
}

/** 정본 batch 결과를 조회 가능한 모양으로 만든다. 페이지마다 한 번만 만든다. */
export interface CanonicalIndex {
  readonly spaceOf: (repositoryId: number, baseBranch: string) => MergeNumberSpaceState | undefined;
  readonly rowOf: (repositoryId: number, baseBranch: string, prNumber: number) => MergeNumberLookup | undefined;
}

/**
 * 같은 PR의 두 정본 행 중 어느 쪽을 답으로 쓸 것인가.
 *
 * 번호가 있는 행이 언제나 이긴다. 둘 다 있거나 둘 다 없으면 작은 서수가 이긴다 —
 * **조회 순서에 기대지 않는 것**이 요점이다.
 */
function preferRow(candidate: MergeNumberLookup, held: MergeNumberLookup): boolean {
  const candidateNumbered = candidate.merge_number !== null;
  const heldNumbered = held.merge_number !== null;
  if (candidateNumbered !== heldNumbered) return candidateNumbered;
  return candidate.merge_seq < held.merge_seq;
}

export function indexCanonical(canonical: NonNullable<MergeNumberContext['canonical']>): CanonicalIndex {
  const spaces = new Map<string, MergeNumberSpaceState>();
  for (const space of canonical.spaces) spaces.set(keyOf(space.repository_id, space.base_branch), space);
  /*
   * 한 PR에 정본 행이 둘일 수 있다 — **같은 PR의 이중 squash SHA**다 (설계 3절).
   *
   * `merge_sequence_numbered_pr_uk`는 `WHERE merge_number IS NOT NULL` 부분 인덱스라
   * 미채번 행의 중복을 막지 않고, 그 상태는 planner가 `mapping_conflict`로 멈추는
   * 바로 그 상태이므로 두 행이 정본에 **영구히 함께 남는다.**
   *
   * 그때 **부여된 번호를 가진 행이 이긴다.** 나중 행으로 덮으면 어느 행이 이길지
   * SQL이 돌려준 순서가 정하고, 같은 PR이 새로고침마다 `M-1900-42`와 "M 번호 대기"
   * 사이를 오간다 — `FR-SEQ-008 AC-3`이 "부여된 번호는 어떤 경우에도 옮겨 가지
   * 않는다"고 정한 것과 정면으로 어긋난다.
   *
   * 둘 다 번호가 없으면 **작은 서수**가 이긴다. 어느 쪽을 골라도 답은 같지만
   * (둘 다 `pending`이다) 고르는 규칙이 없으면 그 사실을 말할 수 없다.
   */
  const rows = new Map<string, MergeNumberLookup>();
  for (const row of canonical.rows) {
    const key = `${keyOf(row.repository_id, row.base_branch)}\u0000${String(row.pull_request_number)}`;
    const held = rows.get(key);
    if (held === undefined || preferRow(row, held)) rows.set(key, row);
  }
  return {
    spaceOf: (repositoryId, baseBranch) => spaces.get(keyOf(repositoryId, baseBranch)),
    rowOf: (repositoryId, baseBranch, prNumber) =>
      rows.get(`${keyOf(repositoryId, baseBranch)}\u0000${String(prNumber)}`),
  };
}

/** 아는 사유만 그대로 쓴다. 모르는 값은 일반 대기로 접는다 — 내부 문구를 싣지 않는다. */
function blockReasonOf(raw: string | null): string {
  if (raw === null) return 'pr_evidence_pending';
  return isMergeNumberBlockReason(raw) ? raw : 'pr_evidence_pending';
}

const UNAVAILABLE = (reason: string): MergeNumberFields => ({
  merge_number: null,
  merge_number_state: 'unavailable',
  merge_number_reason: reason,
  merge_number_epoch: null,
  merge_number_projection_state: 'unknown',
});

const NOT_APPLICABLE = (reason: string): MergeNumberFields => ({
  merge_number: null,
  merge_number_state: 'not_applicable',
  merge_number_reason: reason,
  merge_number_epoch: null,
  merge_number_projection_state: 'unknown',
});

const PENDING = (reason: string, epoch: number | null): MergeNumberFields => ({
  merge_number: null,
  merge_number_state: 'pending',
  merge_number_reason: reason,
  merge_number_epoch: epoch,
  merge_number_projection_state: 'unknown',
});

/**
 * 색인 반영 상태 (상세 설계 7절).
 *
 * **실제 hit의 값이 정본과 같을 때만 `in_sync`다.** DB 값만 최신이면 `pending`,
 * hit 자체를 확인하지 못했으면 `unknown`이다. DB 대행 값으로 `in_sync`를 합성하지 않는다.
 */
export function projectionStateOf(
  canonicalNumber: number,
  canonicalEpoch: number,
  indexed: MergeNumberSubject['indexed'],
): MergeNumberProjectionState {
  if (indexed === undefined) return 'unknown';
  return indexed.mergeNumber === canonicalNumber && indexed.epoch === canonicalEpoch ? 'in_sync' : 'pending';
}

/** PR 하나의 M 필드. 순서는 위 주석의 다섯 단계다. */
export function mergeNumberFieldsOf(subject: MergeNumberSubject, context: MergeNumberContext): MergeNumberFields {
  if (subject.state !== null && subject.state !== 'merged') return NOT_APPLICABLE('not_merged');
  if (subject.baseBranch === null) return PENDING('not_sequenced', null);

  const tracked = context.trackedBranches?.get(subject.repositoryId);
  if (tracked !== undefined && !tracked.includes(subject.baseBranch)) {
    return NOT_APPLICABLE('branch_not_tracked');
  }

  if (context.canonical === null) return UNAVAILABLE('mnumber_read_failed');
  const index = indexCanonical(context.canonical);
  const space = index.spaceOf(subject.repositoryId, subject.baseBranch);
  if (space === undefined) return PENDING('not_sequenced', null);

  const row = index.rowOf(subject.repositoryId, subject.baseBranch, subject.prNumber);
  if (row === undefined) return PENDING('not_sequenced', space.seq_epoch);

  if (row.merge_number === null) {
    const blockedSeq = space.mnumber_blocked_seq;
    if (blockedSeq !== null && Number(blockedSeq) === row.merge_seq) {
      /*
       * **사유는 고정 enum만 나간다** (설계 6.1·9절).
       *
       * 이 열은 응답의 `merge_number_reason`으로 그대로 나가고 화면이 "사유 코드:
       * …"로 렌더한다. 쓰기 쪽이 타입으로 막고 있지만 DB 제약은 길이뿐이므로,
       * **읽는 쪽도 한 번 더 본다** — 내부 예외 메시지가 여기로 새면 접속 주소가
       * 화면에 적힌다.
       */
      return PENDING(blockReasonOf(space.mnumber_blocked_reason), space.seq_epoch);
    }
    if (blockedSeq !== null && row.merge_seq > Number(blockedSeq)) {
      return PENDING('predecessor_pending', space.seq_epoch);
    }
    // 아직 확인하지 않은 구간이다 — 막힌 것이 아니라 회차가 오지 않았다.
    return PENDING('pr_evidence_pending', space.seq_epoch);
  }

  if (subject.repositoryName === null) return UNAVAILABLE('repository_code_unavailable');
  const code = repositoryCodeOf(subject.repositoryName);
  if (code.kind !== 'code') return UNAVAILABLE('repository_code_unavailable');

  return {
    merge_number: formatMergeNumber(code.code, row.merge_number),
    merge_number_state: 'assigned',
    merge_number_reason: null,
    merge_number_epoch: row.seq_epoch,
    merge_number_projection_state: projectionStateOf(row.merge_number, row.seq_epoch, subject.indexed),
  };
}

/** `owner/name@branch` 라벨에서 저장소 이름만 꺼낸다. 브랜치 이름의 `@`는 첫 `@`가 경계다. */
export function repositoryNameOf(repositorySlug: string | null): string | null {
  if (repositorySlug === null) return null;
  const slash = repositorySlug.indexOf('/');
  if (slash < 0) return null;
  const name = repositorySlug.slice(slash + 1);
  return name === '' ? null : name;
}
