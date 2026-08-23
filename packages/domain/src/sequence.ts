/**
 * 시퀀스 채번의 공유 판정 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * **게이트웨이와 채번 워커가 둘 다 쓴다.** 게이트웨이가 push 웹훅에서 채번
 * 대상을 뽑아 `prs:sequence`에 싣고, 워커가 그것을 받는다 — 뽑는 규칙이 두 곳에
 * 따로 있으면 언젠가 갈라지고, 갈라진 날 시퀀스가 조용히 어긋난다.
 */

/** 40자 0은 "그런 커밋이 없다"는 뜻의 git 표기다. 브랜치 삭제 push가 `after`에 이것을 넣는다. */
const ZERO_SHA = '0000000000000000000000000000000000000000';

const FULL_SHA = /^[0-9a-f]{40}$/;

const BRANCH_PREFIX = 'refs/heads/';

/**
 * `refs/heads/<name>` → `<name>`.
 *
 * **태그와 그 밖의 ref는 `null`이다.** `refs/tags/v1.0`을 브랜치로 읽으면 태그
 * 하나가 시퀀스 공간 하나를 만들어 내고, 그 공간은 영원히 커밋 하나짜리로 남는다.
 */
export function branchFromRef(ref: string): string | null {
  if (!ref.startsWith(BRANCH_PREFIX)) return null;
  const name = ref.slice(BRANCH_PREFIX.length);
  return name === '' ? null : name;
}

/** push 웹훅에서 뽑아낸 채번 대상. */
export interface PushTarget {
  readonly repositoryId: number;
  readonly baseBranch: string;
  /** push 시점의 head. 채번은 이 값을 신뢰하지 않고 그래프에서 다시 읽는다. */
  readonly headSha: string;
}

export type PushOutcome =
  | { readonly kind: 'target'; readonly target: PushTarget }
  /** 채번 대상이 아니다. 실패가 아니므로 실패 대기열로 보내지 않는다. */
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * push 웹훅 payload → 채번 대상 (CR-025, DEV-116).
 *
 * **레지스트리를 조회하지 않는다.** 어느 브랜치가 채번 대상인지
 * (`repository.sequence_branches`)는 채번 워커가 판단한다 — 그 조회를 게이트웨이에
 * 두면 수신 응답 예산(NFR-002 p95 300ms)에 왕복 하나가 더해지고 수신 경로에 새
 * 실패 지점이 생긴다.
 */
export function extractPushTarget(payload: unknown): PushOutcome {
  const root = asRecord(payload);
  if (root === undefined) return { kind: 'invalid', reason: 'payload가 객체가 아니다' };

  const ref = typeof root['ref'] === 'string' ? root['ref'] : undefined;
  if (ref === undefined) return { kind: 'invalid', reason: 'push payload에 ref가 없다' };

  const branch = branchFromRef(ref);
  if (branch === null) return { kind: 'skip', reason: `브랜치 push가 아니다: ${ref}` };

  // 삭제는 두 가지로 온다 — `deleted: true`와 `after`가 40자 0.
  if (root['deleted'] === true) return { kind: 'skip', reason: `브랜치 삭제: ${branch}` };

  const after = typeof root['after'] === 'string' ? root['after'].toLowerCase() : undefined;
  if (after === undefined) return { kind: 'invalid', reason: 'push payload에 after가 없다' };
  if (after === ZERO_SHA) return { kind: 'skip', reason: `브랜치 삭제: ${branch}` };
  if (!FULL_SHA.test(after)) return { kind: 'invalid', reason: `after가 40자 SHA가 아니다: ${after}` };

  const repository = asRecord(root['repository']);
  if (repository === undefined) return { kind: 'invalid', reason: 'push payload에 repository가 없다' };
  const repositoryId = repository['id'];
  if (typeof repositoryId !== 'number' || !Number.isInteger(repositoryId) || repositoryId <= 0) {
    return { kind: 'invalid', reason: 'repository.id가 양의 정수가 아니다' };
  }

  return { kind: 'target', target: { repositoryId, baseBranch: branch, headSha: after } };
}

/** `prs:sequence`의 파티션 키. 같은 시퀀스 공간의 채번이 직렬화되게 한다 (비동기 문서 2장). */
export function sequencePartitionKey(repositoryId: number, baseBranch: string): string {
  return `${String(repositoryId)}:${baseBranch}`;
}

/**
 * 문서에 싣는 시퀀스 공간 문자열 (CR-025, DEV-119).
 *
 * **표시 전용이다.** `SequencePosition`이 이 값을 화면에 그대로 출력하므로 사람이
 * 읽는 형태(`acme/payments@main`)여야 하고, API 계약의 모든 예시가 그 모양이다.
 *
 * **범위 질의의 필터로 쓰지 않는다.** 저장소 소유자·이름이 바뀌면 같은 시퀀스
 * 공간의 문서가 두 문자열로 갈라지고, `term(sequence_space)`로 거른 범위 조회가
 * **오류 없이 절반만** 돌려준다. 범위는 `repository_id` + `base_branch`로 거른다 —
 * 둘 다 네 매핑에 이미 있다.
 */
export function sequenceSpaceLabel(repositorySlug: string, baseBranch: string): string {
  return `${repositorySlug}@${baseBranch}`;
}
