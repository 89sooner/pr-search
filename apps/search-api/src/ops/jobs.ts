/**
 * API-ADM-002 잡 실행·중단·진행률 (WP-019 / CR-022, DEV-103).
 *
 * **실행 지시는 이벤트가 아니라 `job` 행이다.** 이 모듈은 행을 만들고 상태를
 * 전이시킬 뿐이고, 실제 실행은 배치 워커가 그 행을 원자적으로 claim해서 한다.
 *
 * 이 모듈이 하지 않는 것 하나: **동시 실행 상한을 여기서 막지 않는다.**
 * 상한은 *동시에 도는 수*의 제약이지 *요청받을 수 있는 수*의 제약이 아니다
 * (FR-ING-006 AC-6). 넷째 요청을 400으로 막으면 운영자가 앞의 셋이 끝나는
 * 것을 지켜보다 다시 눌러야 한다.
 */

import { jobRepo, repositoryRepo, type JobRow, type JobState, type Pool } from '@prs/db';
import { sequenceSpaceLabel } from '@prs/domain';

/** `PATCH`가 받는 것. **이 셋뿐이다** (CR-022, DEV-103). */
export const JOB_ACTIONS = ['pause', 'resume', 'cancel'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export function isJobAction(value: unknown): value is JobAction {
  return typeof value === 'string' && (JOB_ACTIONS as readonly string[]).includes(value);
}

/**
 * 응답에 실을 모양.
 *
 * **`cursor`를 내보내지 않는다** (CR-022, DEV-103). 재개 지점은 워커의 내부
 * 상태이고, 운영자가 읽을 수 있으면 고치고 싶어진다 — 고치면 재개가 무엇을
 * 이어받는지 아무도 보장하지 못한다.
 */
export function toJobResponse(row: JobRow): Record<string, unknown> {
  return {
    job_id: row.job_id,
    type: row.type,
    target: row.target,
    state: row.state,
    progress: row.progress,
    requested_by: row.requested_by,
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    error: row.error,
    allowed_actions: allowedActionsForJob(row.type, row.state),
  };
}

/**
 * 이 잡이 지금 받을 수 있는 제어 동작 (FR-ADMIN-002 AC-7, CR-055).
 *
 * **상태가 정하는 상한을 잡 유형이 더 좁힐 수 있다.** `jobRepo.allowedActionsFor`
 * 는 전이 표만 보므로 `queued`·`running`이면 언제나 `pause`를 준다. 그런데
 * `reconcile`은 전량 스윕이 한 번에 도는 잡이라 **중간에 멈춰 이어서 할 지점이
 * 없다** — 러너가 지원하지 않는 동작을 화면이 제시하면 운영자가 눌러 놓고
 * 멈추기를 기다린다. 그래서 그 유형에서는 `pause`·`resume`을 뺀다.
 *
 * 화면은 이 목록을 그대로 그린다. **좁히는 판정을 화면이 다시 하지 않는다.**
 */
export function allowedActionsForJob(type: string, state: JobState): readonly JobAction[] {
  const byState = jobRepo.allowedActionsFor(state);
  if (type !== 'reconcile') return byState;
  return byState.filter((action) => action === 'cancel');
}

/**
 * **`unknown_repository`가 없다** (CR-055). 저장소 검증은 `resolveJobTarget`이
 * 소유한다 — `reconcile`처럼 대상이 저장소가 아닌 유형이 생겼으므로, 만드는
 * 자리에서 저장소를 찾으면 그 유형이 언제나 거절된다.
 */
export type CreateJobOutcome =
  | { readonly kind: 'created'; readonly job: JobRow }
  | { readonly kind: 'conflict' };

/**
 * 잡을 큐에 넣는다.
 *
 * 같은 `(type, target)`에 활성 잡이 있으면 `conflict`다 — 부분 유니크 인덱스가
 * DB에서 강제하므로 **먼저 검사하지 않아도** 경합에서 둘이 뜨지 않는다.
 * 여기서 미리 보는 것은 409를 돌려주기 위한 것이지 정합성을 위한 것이 아니다.
 */
/**
 * **집는 러너가 있는** 잡 유형 (CR-045, DEV-301).
 *
 * 러너 없는 유형이 큐에 들어가면 아무도 잡지 않는 유령 잡이 남고, 운영자는
 * 진행률이 영원히 0인 이유를 알 수 없다 (DEV-178).
 *
 * - `backfill`: JOB-ING-004 (WP-019)
 * - `link_rebuild`: JOB-REL-006 참조 간선 전량 재파생 (WP-029 / CR-039)
 * - `reindex`: JOB-ING-006 무중단 재색인 (WP-035 / CR-045). **러너와 같은
 *   커밋에서 등재한다** — 먼저 등재하면 DEV-178이 된다
 * - `reconcile`: JOB-ING-005 조정 스캔 (WP-040 / CR-055). 러너는 주기 스윕과
 *   **같은 루프**다 — 두 루프로 만들면 전량 스캔이 겹친다
 * - `sequence_assign`: JOB-SEQ-001 시퀀스 채번 (WP-040 / CR-055). 버스 소비자와
 *   같은 `assignSequence`로 모이며 공간별 advisory lock이 직렬을 지킨다
 *
 * 이 목록은 "운영자가 목록·진행률·중단·취소를 쓸 수 있다"는 뜻이지
 * "API-ADM-002로 만들 수 있다"는 뜻이 **아니다.** 생성 가능 목록은 아래 것이다.
 */
export const OPERATOR_JOB_TYPES = ['backfill', 'link_rebuild', 'reindex', 'reconcile', 'sequence_assign'] as const;

export type OperatorJobType = (typeof OPERATOR_JOB_TYPES)[number];

export function isOperatorJobType(value: unknown): value is OperatorJobType {
  return typeof value === 'string' && (OPERATOR_JOB_TYPES as readonly string[]).includes(value);
}

/**
 * API-ADM-002의 **일반 잡 생성**이 받는 유형 (CR-045, DEV-301·302).
 *
 * `reindex`는 여기 없다. SRS가 API-ADM-004를 재색인의 진입점으로 이미 정했고,
 * **enqueue seam은 하나여야** 하기 때문이다 — 두 진입점이 각자 대상 버전을
 * 고르면 한쪽만 상한을 보거나 한쪽만 다른 번호를 고른다. API-ADM-002는
 * 목록·진행률·중단·취소라는 공통 표면을 계속 소유하고 **생성만** 이 경로가 갖는다.
 *
 * 두 목록을 하나로 두면 러너 등재(위)가 곧 생성 개방이 되어, 이 경계가
 * 다음 잡 유형에서 조용히 사라진다.
 *
 * `reconcile`·`sequence_assign`은 CR-055가 러너와 **같은 변경에서** 더했다
 * (FR-ADMIN-002 AC-6). 먼저 열면 DEV-178·DEV-180이 다시 일어난다.
 */
export const CREATABLE_GENERIC_JOB_TYPES = [
  'backfill',
  'link_rebuild',
  'reconcile',
  'sequence_assign',
] as const;

export type CreatableGenericJobType = (typeof CREATABLE_GENERIC_JOB_TYPES)[number];

export function isCreatableGenericJobType(value: unknown): value is CreatableGenericJobType {
  return typeof value === 'string' && (CREATABLE_GENERIC_JOB_TYPES as readonly string[]).includes(value);
}

/**
 * `reconcile` 잡의 대상. **서버가 정하고 클라이언트는 고르지 않는다** (CR-055).
 *
 * `FR-ING-011` AC-2가 스캔 대상을 "등록된 각 저장소"로 정했으므로 이 잡의
 * 대상은 언제나 등록 저장소 전체다. 저장소 식별자는 `owner/name` 형식이라
 * 언제나 `/`를 포함하므로 이 값과 충돌하지 않는다.
 */
export const RECONCILE_TARGET = 'all';

export type ResolveTargetOutcome =
  | { readonly kind: 'ok'; readonly target: string }
  | { readonly kind: 'unknown_repository' }
  | { readonly kind: 'invalid_parameter'; readonly message: string; readonly detail?: Record<string, unknown> };

/**
 * 잡 유형마다 다른 요청 본문을 하나의 `target` 문자열로 옮긴다 (CR-055).
 *
 * **클라이언트가 `target`을 직접 보내지 않는 유형이 있다.** `reconcile`은 대상이
 * 하나뿐이고, `sequence_assign`은 저장소와 브랜치 둘을 받아 서버가 공간
 * 식별자를 조립한다 — 문자열을 그대로 받으면 서로 다른 공간이 같은 문자열로
 * 충돌하거나 채번 대상이 아닌 브랜치가 큐에 들어간다.
 *
 * `target` 형식은 **잡 유형이 소유하는 대상의 정체성**을 따른다. 저장소를
 * 대상으로 하는 잡은 `owner/repo`, 시퀀스 공간을 대상으로 하는 잡은
 * `owner/repo@브랜치`다 — 후자는 `API-ADM-007`의 `sequence_reassign`이 이미
 * 쓰는 형식이고 `parseSequenceSpaceLabel`이 그것을 읽는다.
 */
export async function resolveJobTarget(
  pool: Pool,
  type: CreatableGenericJobType,
  body: Record<string, unknown>,
): Promise<ResolveTargetOutcome> {
  if (type === 'reconcile') {
    /*
     * 대상을 받지 않는다. 보내도 무시하지 않고 **거절한다** — 무시하면 운영자는
     * 자기가 지정한 저장소만 스캔됐다고 믿는다.
     */
    if (body['target'] !== undefined || body['repository'] !== undefined) {
      return {
        kind: 'invalid_parameter',
        message: 'reconcile은 대상을 받지 않는다 — 언제나 등록 저장소 전체다',
      };
    }
    return { kind: 'ok', target: RECONCILE_TARGET };
  }

  if (type === 'sequence_assign') {
    const slug = body['repository'];
    const baseBranch = body['base_branch'];
    if (typeof slug !== 'string' || typeof baseBranch !== 'string' || baseBranch === '') {
      return {
        kind: 'invalid_parameter',
        message: 'sequence_assign은 repository와 base_branch를 받는다',
      };
    }
    const [owner, name] = splitTarget(slug);
    if (owner === '' || name === '') {
      return { kind: 'invalid_parameter', message: 'repository는 owner/name 형식이다' };
    }
    const repository = await repositoryRepo.findRepositoryBySlug(pool, owner, name);
    if (repository === undefined) return { kind: 'unknown_repository' };
    /*
     * **채번 대상 브랜치가 아니면 거절한다** (FR-ING-009 AC-2). 큐에 넣어도
     * `assignSequence`가 `skipped`로 돌려주므로 잡은 "완료"로 끝나고, 운영자는
     * 아무 일도 일어나지 않은 이유를 알 수 없다.
     */
    if (!repository.sequence_branches.includes(baseBranch)) {
      return {
        kind: 'invalid_parameter',
        message: '채번 대상 브랜치가 아니다',
        detail: { sequence_branches: repository.sequence_branches },
      };
    }
    return { kind: 'ok', target: sequenceSpaceLabel(`${owner}/${name}`, baseBranch) };
  }

  const target = body['target'];
  if (typeof target !== 'string' || target === '') {
    return { kind: 'invalid_parameter', message: 'target은 owner/repo 형식의 문자열이다' };
  }
  const [owner, name] = splitTarget(target);
  /*
   * 등록되지 않은 저장소에 백필을 걸 수 없다. 걸어 두면 워커가 잡을 때마다
   * 실패하고, 운영자는 **저장소를 등록하지 않은 것**이 원인임을 알 수 없다.
   */
  const repository = await repositoryRepo.findRepositoryBySlug(pool, owner, name);
  if (repository === undefined) return { kind: 'unknown_repository' };
  return { kind: 'ok', target };
}

/**
 * 잡 행을 만든다. **대상은 `resolveJobTarget`이 이미 검증한 값이다** — 여기서
 * 다시 저장소를 찾지 않는다. `reconcile`의 대상은 저장소가 아니므로 그 조회가
 * 남아 있으면 그 유형이 언제나 `unknown_repository`로 거절된다.
 */
export async function createJob(
  pool: Pool,
  type: CreatableGenericJobType,
  target: string,
  requestedBy: string,
): Promise<CreateJobOutcome> {
  const existing = await jobRepo.findActiveJob(pool, type, target);
  if (existing !== undefined) return { kind: 'conflict' };

  try {
    const jobId = await jobRepo.enqueueJob(pool, type, target, requestedBy);
    const job = await jobRepo.findJobById(pool, jobId);
    // 방금 넣은 행을 못 읽는 것은 있을 수 없다 — 있으면 그것이 진짜 오류다.
    if (job === undefined) throw new Error('생성한 잡을 다시 읽지 못했다');
    return { kind: 'created', job };
  } catch (error) {
    // 검사와 삽입 사이에 다른 요청이 넣었다. 유니크 위반이 그것을 말해 준다.
    if (isUniqueViolation(error)) return { kind: 'conflict' };
    throw error;
  }
}

export type TransitionOutcome =
  | { readonly kind: 'ok'; readonly job: JobRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_transition'; readonly state: JobRow['state'] };

/**
 * 상태를 전이한다.
 *
 * **불가능한 전이를 조용히 무시하지 않는다** — 운영자가 중단을 눌렀는데
 * 200이 돌아오면 멈춘 줄 알고 자리를 뜬다. 현재 상태를 함께 돌려주어
 * 왜 안 되는지 알 수 있게 한다.
 */
export async function applyJobAction(
  pool: Pool,
  jobId: number,
  action: JobAction,
): Promise<TransitionOutcome> {
  const updated = await jobRepo.transitionJob(pool, jobId, action);
  if (updated !== undefined) return { kind: 'ok', job: updated };

  const current = await jobRepo.findJobById(pool, jobId);
  if (current === undefined) return { kind: 'not_found' };
  return { kind: 'invalid_transition', state: current.state };
}

function splitTarget(target: string): readonly [string, string] {
  const slash = target.indexOf('/');
  if (slash < 0) return [target, ''];
  return [target.slice(0, slash), target.slice(slash + 1)];
}

/** PostgreSQL의 유니크 위반. `job_active_uk`가 걸렸다는 뜻이다. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}
