/**
 * A-002 저장소 등록 관리의 화면 판정 (WP-040 / FR-ING-009, CR-055).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다.
 *
 * ## 이 모듈이 하지 않는 것
 *
 * **요청을 `fulfilled`로 옮기지 않는다.** 승인은 성공한 등록 그 자체이며
 * (FR-ING-009 AC-11), 화면의 "등록" 버튼은 `C-043`의 폼을 채우기만 한다.
 * 그 조작만으로 상태가 바뀌면 등록되지 않은 채 승인된 행이 생긴다.
 */

/** `API-ADM-009`가 내는 요청 하나. */
export interface RegistrationRequestView {
  readonly request_id: string;
  readonly requested_by: string;
  readonly repository: string;
  readonly created_at: string;
  readonly status: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
  readonly resolution_note: string | null;
}

export type RequestStatus = 'pending' | 'fulfilled' | 'dismissed';

const STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  pending: 'Queued',
  fulfilled: 'Registered',
  dismissed: 'Closed',
};

export function requestStatusLabel(status: string): string {
  return STATUS_LABELS[status as RequestStatus] ?? status;
}

/**
 * 이 요청에 그릴 조작.
 *
 * `pending`만 처리할 수 있다 — 종료된 요청을 다시 여는 경로는 만들지 않았다
 * (AC-11). 재검토가 필요해지면 그것은 별도 요구사항이다.
 */
export function requestActionable(request: RegistrationRequestView): boolean {
  return request.status === 'pending';
}

/**
 * 요청 목록에서 폼으로 넘길 값.
 *
 * `owner/name`을 쪼개 돌려준다. 형식이 아니면 `null`이며, 그때 화면은 "등록"
 * 버튼을 그리지 않는다 — 채울 수 없는 폼을 여는 것보다 낫다.
 */
export function requestPrefill(request: RegistrationRequestView): { owner: string; name: string } | null {
  const slash = request.repository.indexOf('/');
  if (slash < 0) return null;
  const owner = request.repository.slice(0, slash);
  const name = request.repository.slice(slash + 1);
  if (owner === '' || name === '') return null;
  return { owner, name };
}

/** 시퀀스 대상 브랜치 상한 (FR-ING-009 AC-2). 서버도 같은 값을 강제한다. */
export const MAX_SEQUENCE_BRANCHES = 10;

export type BranchesOutcome =
  | { readonly kind: 'ok'; readonly branches: readonly string[] }
  | { readonly kind: 'limit_exceeded'; readonly given: number };

/**
 * 브랜치 입력을 정규화한다.
 *
 * **서버 검증을 대신하지 않는다** — 클라이언트를 우회해도 `API-ADM-001`이
 * 거절한다. 여기서 미리 알리는 것은 운영자가 제출 뒤에야 알게 되는 것을 막기
 * 위해서다.
 */
export function normalizeBranchInput(raw: string): BranchesOutcome {
  const branches: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const trimmed = part.trim();
    if (trimmed === '' || branches.includes(trimmed)) continue;
    branches.push(trimmed);
  }
  if (branches.length > MAX_SEQUENCE_BRANCHES) {
    return { kind: 'limit_exceeded', given: branches.length };
  }
  return { kind: 'ok', branches };
}

/** 이번 변경으로 새로 대상이 되는 브랜치. 채번 잡이 생기는 것들이다 (AC-12). */
export function addedBranches(before: readonly string[], after: readonly string[]): readonly string[] {
  const had = new Set(before);
  return after.filter((branch) => !had.has(branch));
}

/**
 * 해제 확인 문구 (QA-A002-03).
 *
 * **"삭제"라는 낱말을 쓰지 않는다.** 사용자가 데이터 손실로 오해하면 해제를
 * 회피하고, 그러면 수집이 멈춰야 할 저장소가 계속 돈다.
 */
export const UNREGISTER_CONFIRM_MESSAGE =
  'New event collection will stop. Existing search documents will be retained.';

/**
 * 등록 요청 종료 사유의 상한. 마이그레이션 020의 CHECK와 같은 값이다.
 *
 * 여기서 세는 이유는 서버가 거절하기 전에 알리기 위해서이며, **서버 검증을
 * 대신하지 않는다.**
 */
export const MAX_RESOLUTION_NOTE = 500;

export function noteTooLong(note: string): boolean {
  return note.trim().length > MAX_RESOLUTION_NOTE;
}

/**
 * 목록의 행 수를 전체 수처럼 쓰지 않는다 (CR-055).
 *
 * `API-ADM-009`는 `total`을 내지 않는다 — 세려면 전량을 훑어야 하고, 화면이
 * 필요로 하는 것은 "처리할 것이 남았는가"다. 그 답은 커서가 준다.
 */
export function hasMoreRequests(nextCursor: string | null): boolean {
  return nextCursor !== null;
}
