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

import { jobRepo, repositoryRepo, sequenceSpaceRepo, type JobRow, type JobState, type Pool } from '@prs/db';
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
  // `sequence_reproject`도 멈춰 이어 갈 지점이 없다 — durable work가 스스로 돌고 잡은 그것을 지켜볼 뿐이다 (CR-113).
  if (type !== 'reconcile' && type !== 'sequence_reproject') return byState;
  return byState.filter((action) => action === 'cancel');
}

/**
 * **`unknown_repository`가 없다** (CR-055). 저장소 검증은 `resolveJobTarget`이
 * 소유한다 — `reconcile`처럼 대상이 저장소가 아닌 유형이 생겼으므로, 만드는
 * 자리에서 저장소를 찾으면 그 유형이 언제나 거절된다.
 */
export type CreateJobOutcome =
  | { readonly kind: 'created'; readonly job: JobRow }
  /**
   * 같은 대상에 활성 잡이 이미 있다.
   *
   * **실행 중 잡의 식별자를 함께 준다** (FR-ADMIN-002 AC-4, PR #89 리뷰 P2).
   * 대상 문자열만 돌려주면 운영자는 "이미 돌고 있다"까지만 알고 **그 잡을 찾아갈
   * 수 없다** — 화면이 가리킬 곳이 없어 `QA-A003-03`이 요구하는 경로가 끊긴다.
   * 경합으로 졌을 때도 이긴 행을 다시 읽어 채운다.
   *
   * **식별자는 선택 값이 아니다** (DEV-444, PR #91 리뷰 P2). `number | null`로
   * 두면 라우트가 그 `null`을 필드 누락으로 옮겨 AC-4가 요구하는 409를 조용히
   * 어긴다. `conflict`라는 판정 자체가 **활성 잡이 실재한다**는 뜻이 되도록
   * 타입에서 그 상태를 없앤다 — 활성 잡이 없으면 그것은 충돌이 아니다.
   */
  | { readonly kind: 'conflict'; readonly jobId: number };

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
export const OPERATOR_JOB_TYPES = ['backfill', 'link_rebuild', 'reindex', 'reconcile', 'sequence_assign', 'sequence_reproject'] as const;

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
  /*
   * JOB-SEQ-006 수동 시퀀스 재투영 (CR-113 / FR-SEQ-001 AC-8). 러너
   * (`startSequenceReprojectRunner`)와 같은 변경에서 등재했다. 재채번이 아니다 —
   * 정본 서수를 색인에 다시 비출 뿐 에폭·서수·head를 바꾸지 않는다.
   */
  'sequence_reproject',
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
  /** `progress`는 잡 행의 INSERT에 함께 실을 입력이다 (`sequence_reproject`의 에폭·별칭). */
  | { readonly kind: 'ok'; readonly target: string; readonly progress?: Record<string, unknown> }
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

  if (type === 'sequence_reproject') {
    /*
     * 재투영은 **재채번이 아니다** (CR-113). 저장소·브랜치에 더해 `expected_epoch`를 받아
     * 러너가 현재 에폭과 대조한다 — force-push 직후 운영자가 모르는 새 에폭에 재투영하지
     * 않게 한다(확인서 CLI의 규율, CR-100). `aliases`는 대상 별칭을 좁힌다(기본 둘 다).
     * dry-run은 여기서 받지 않는다 — 잡 행 자체가 쓰기이며, 읽기 전용 점검은
     * `prsctl sequence reproject --dry-run`이 한다.
     */
    if (body['dry_run'] === true) {
      return { kind: 'invalid_parameter', message: 'dry-run은 API 잡으로 만들지 않는다 — prsctl sequence reproject --dry-run을 쓴다' };
    }
    const slug = body['repository'];
    const baseBranch = body['base_branch'];
    const expectedEpoch = body['expected_epoch'];
    if (typeof slug !== 'string' || typeof baseBranch !== 'string' || baseBranch === '') {
      return { kind: 'invalid_parameter', message: 'sequence_reproject는 repository와 base_branch를 받는다' };
    }
    if (typeof expectedEpoch !== 'number' || !Number.isInteger(expectedEpoch) || expectedEpoch < 1) {
      return { kind: 'invalid_parameter', message: 'sequence_reproject는 expected_epoch(양의 정수)를 받는다 — 현재 에폭은 시퀀스 공간 조회로 확인한다' };
    }
    const rawAliases = body['aliases'];
    const allowedAliases = ['prs-pull-requests', 'prs-commits'];
    if (rawAliases !== undefined && (!Array.isArray(rawAliases) || rawAliases.length === 0 || !rawAliases.every((one) => allowedAliases.includes(one)))) {
      return { kind: 'invalid_parameter', message: 'aliases는 prs-pull-requests·prs-commits의 비지 않은 부분집합이다', detail: { allowed: allowedAliases } };
    }
    const [owner, name] = splitTarget(slug);
    if (owner === '' || name === '') {
      return { kind: 'invalid_parameter', message: 'repository는 owner/name 형식이다' };
    }
    const repository = await repositoryRepo.findRepositoryBySlug(pool, owner, name);
    if (repository === undefined) return { kind: 'unknown_repository' };
    if (!repository.sequence_branches.includes(baseBranch)) {
      return {
        kind: 'invalid_parameter',
        message: '채번 대상 브랜치가 아니다',
        detail: { sequence_branches: repository.sequence_branches },
      };
    }
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, repository.repository_id, baseBranch);
    if (space === undefined) {
      return { kind: 'invalid_parameter', message: '채번된 적 없는 시퀀스 공간이다 — 재투영할 정본이 없다' };
    }
    if (space.seq_epoch !== expectedEpoch) {
      return {
        kind: 'invalid_parameter',
        message: 'expected_epoch가 현재 에폭과 다르다',
        detail: { expected_epoch: expectedEpoch, current_epoch: space.seq_epoch },
      };
    }
    return {
      kind: 'ok',
      target: sequenceSpaceLabel(`${owner}/${name}`, baseBranch),
      progress: {
        expected_epoch: expectedEpoch,
        aliases: rawAliases === undefined ? [...allowedAliases] : [...(rawAliases as string[])],
        repository_id: repository.repository_id,
        base_branch: baseBranch,
      },
    };
  }

  const target = body['target'];
  if (typeof target !== 'string' || target === '') {
    return { kind: 'invalid_parameter', message: 'target은 owner/repo 형식의 문자열이다' };
  }
  const [owner, name] = splitTarget(target);
  /*
   * **형식이 틀린 것과 등록되지 않은 것은 다른 오류다** (DEV-437). 형식
   * 검사를 빠뜨리면 `payments`처럼 슬래시 없는 값이 조회로 내려가 404를
   * 받고, 운영자는 **자기 오타를 "그 저장소가 없다"로 읽는다.**
   * `sequence_assign` 갈래는 이 검사를 갖고 있었고 이쪽만 빠져 있었다.
   */
  if (owner === '' || name === '') {
    return { kind: 'invalid_parameter', message: 'target은 owner/repo 형식의 문자열이다' };
  }
  /*
   * 등록되지 않은 저장소에 백필을 걸 수 없다. 걸어 두면 워커가 잡을 때마다
   * 실패하고, 운영자는 **저장소를 등록하지 않은 것**이 원인임을 알 수 없다.
   */
  const repository = await repositoryRepo.findRepositoryBySlug(pool, owner, name);
  if (repository === undefined) return { kind: 'unknown_repository' };
  return { kind: 'ok', target };
}

/**
 * 잡 생성 경합을 다시 시도하는 상한 (DEV-444).
 *
 * 유니크 위반과 재조회 사이에서 이긴 행이 끝나는 창은 한 번 지나가면 다시
 * 같은 모양으로 열리기 어렵다. **무한 재시도는 두지 않는다** — 그 창이 계속
 * 열린다는 것은 다른 문제가 있다는 뜻이고, 그때 요청을 영원히 붙잡는 것은
 * 운영자에게 아무것도 알려 주지 않는다.
 */
const CREATE_JOB_RACE_ATTEMPTS = 3;

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
  progress: Record<string, unknown> = {},
): Promise<CreateJobOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    const existing = await jobRepo.findActiveJob(pool, type, target);
    if (existing !== undefined) return { kind: 'conflict', jobId: existing.job_id };

    try {
      const jobId = await jobRepo.enqueueJob(pool, type, target, requestedBy, progress);
      const job = await jobRepo.findJobById(pool, jobId);
      // 방금 넣은 행을 못 읽는 것은 있을 수 없다 — 있으면 그것이 진짜 오류다.
      if (job === undefined) throw new Error('생성한 잡을 다시 읽지 못했다');
      return { kind: 'created', job };
    } catch (error) {
      // 검사와 삽입 사이에 다른 요청이 넣었다. 유니크 위반이 그것을 말해 준다.
      if (!isUniqueViolation(error)) throw error;

      /*
       * 경합에서 졌다. **이긴 행을 다시 읽는다** — 그 행이 운영자가 찾아가야 할
       * 잡이고, 여기서 포기하면 경합으로 진 요청만 잡 식별자를 잃는다.
       */
      const winner = await jobRepo.findActiveJob(pool, type, target);
      if (winner !== undefined) return { kind: 'conflict', jobId: winner.job_id };

      /*
       * 이긴 행이 **이 사이에 끝났다** (DEV-444, PR #91 리뷰 P2). 유니크 인덱스는
       * 활성 상태에만 걸리므로 그 행이 종료되는 순간 제약도 사라진다 —
       * **지금은 충돌이 없다.** 식별자 없는 409를 내면 운영자는 "이미 돌고 있다"는
       * 말을 듣고도 갈 곳이 없고, 실제로는 아무것도 돌고 있지 않다.
       * 요청이 원래 하려던 일을 한다.
       */
      if (attempt >= CREATE_JOB_RACE_ATTEMPTS) {
        /*
         * 활성 잡이 이 짧은 창에서 계속 생겼다 사라진다. 드물지만 실재할 수 있고,
         * 그때 **없는 제품 오류 코드를 지어내지 않는다** — 재시도 가능한 내부
         * 실패로 올려 기존 처리 정책이 답하게 한다.
         */
        throw new Error(`잡 생성 경합이 ${String(CREATE_JOB_RACE_ATTEMPTS)}회 연속 갈렸다: ${type}:${target}`);
      }
    }
  }
}

export type TransitionOutcome =
  | { readonly kind: 'ok'; readonly job: JobRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_transition'; readonly state: JobRow['state'] }
  /**
   * 상태로는 가능하지만 **이 잡 유형의 러너가 지원하지 않는** 동작이다
   * (PR #89 리뷰 P2).
   *
   * `allowedActionsForJob`가 응답에서 빼는 것만으로는 부족하다 — 그 필드는
   * 화면을 위한 안내이고, **변이 경로가 같은 판정을 강제하지 않으면 직접
   * 호출하는 클라이언트가 그것을 지나간다.** `reconcile`을 `pause`로 옮기면
   * 러너에 멈출 지점이 없어 전량 스윕은 완주하고 행만 `paused`가 되며,
   * `resume`이 같은 스캔을 다시 큐에 넣는다.
   */
  | {
      readonly kind: 'unsupported_action';
      readonly type: string;
      readonly allowed: readonly JobAction[];
    };

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
  /*
   * **응답 필드가 유일한 방어선이 아니다** (PR #89 리뷰 P2). 잡 유형이 좁힌
   * 목록을 여기서 먼저 확인한다 — 상태 전이보다 앞이어야 한다. 뒤에 두면
   * `transitionJob`이 이미 행을 옮겨 놓은 뒤가 된다.
   */
  const before = await jobRepo.findJobById(pool, jobId);
  if (before === undefined) return { kind: 'not_found' };

  const allowed = allowedActionsForJob(before.type, before.state);
  if (!allowed.includes(action)) {
    /*
     * 상태가 막는 것과 유형이 막는 것을 가른다. 전자는 "지금은 안 된다"이고
     * 후자는 "이 잡에는 그 동작이 없다"이며, 운영자의 다음 행동이 다르다.
     */
    return jobRepo.allowedActionsFor(before.state).includes(action)
      ? { kind: 'unsupported_action', type: before.type, allowed }
      : { kind: 'invalid_transition', state: before.state };
  }

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
