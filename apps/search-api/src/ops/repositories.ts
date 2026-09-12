/**
 * 저장소 등록 관리 (API-ADM-001, FR-ING-009).
 *
 * HTTP를 모르는 순수 로직이다. 라우트는 `routes.ts`가 감싼다.
 *
 * **소유자·이름만 클라이언트에게서 받는다.** `repository_id`·`org_id`·
 * `visibility`는 GHE에 물어서 채운다 (CR-013, DEV-033). 그 세 값 위에 ADR-008의
 * 필수 접근 범위 필터가 서 있어서, 클라이언트가 주장한 값을 그대로 믿으면
 * 잘못된 조직으로 색인된 문서가 접근 통제를 통과한다.
 *
 * **해제는 소프트 삭제다.** 행도 문서도 지우지 않고 표식만 붙인다 (AC-3).
 * 조사 이력의 보존이 이 제품의 목적이다.
 */

import {
  jobRepo,
  mergeSequenceRepo,
  registrationRequestRepo,
  repositoryRepo,
  withReindexWrite,
  withTransaction,
  type Pool,
  type RegistrationRequestRow,
  type RepositoryRow,
} from '@prs/db';
import { sequenceSpaceLabel } from '@prs/domain';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { MAX_SEQUENCE_BRANCHES } from '@prs/db';
import { applyRepositoryTeams, markRepositoryArchived, type MarkArchivedResult } from '@prs/es';
import type { Client as EsClient } from '@elastic/elasticsearch';
import { syncRepositoryTeamScope } from '@prs/authz';
import { AdminRejected } from './errors.js';

/** GHE App이 저장소를 다루려면 필요한 권한. 403 본문에 그대로 실어 보낸다. */
export const REQUIRED_APP_PERMISSIONS = ['metadata:read', 'contents:read', 'pull_requests:read'] as const;

/** 등록에 필요한 만큼의 GHE 사실. `@prs/github`의 클라이언트가 이 모양으로 답한다. */
export interface GheRepositoryFacts {
  readonly repository_id: number;
  readonly org_id: number;
  readonly visibility: 'public' | 'internal' | 'private';
  readonly default_branch: string;
}

/**
 * GHE 조회 포트.
 *
 * 좁은 포트로 두는 이유는 이 모듈이 토큰 풀·스케줄러·rate limit을 알 필요가
 * 없기 때문이다. 그것들은 `@prs/github`이 이미 계약 시험으로 덮고 있다.
 *
 * 접근할 수 없으면 `null`을 돌려준다. 404와 403을 구분하지 않는다 — GitHub이
 * 권한 없는 저장소를 404로 감추기 때문에 구분하려는 시도 자체가 추측이 된다.
 */
export type GheRepositoryLookup = (owner: string, name: string) => Promise<GheRepositoryFacts | null>;

export interface RegistryDeps {
  readonly pool: Pool;
  readonly es: EsClient;
  readonly lookup: GheRepositoryLookup;
  /**
   * 저장소에 접근 가능한 팀 (WP-068 / CR-035, DEV-185).
   *
   * **없으면 팀을 채우지 않는다** — GHE 자격 증명이 없는 배포에서 등록이 막히면
   * 안 되고, 팀을 모르는 채로 빈 배열을 쓰면 기존 값을 지운다.
   */
  readonly listTeams?: (owner: string, name: string) => Promise<readonly { id: number; slug: string }[]>;
  readonly log?: (entry: RegistryLogEntry) => void;
}

export interface RegistryLogEntry {
  // `warn`은 팀 접근 범위 동기화가 락 대기로 회차를 미룰 때 쓴다 (CR-037, DEV-191).
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly correlation_id?: string;
  readonly repository_id?: number;
  readonly repository?: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly base_branch?: string;
}

export interface RegisterInput {
  readonly owner: string;
  readonly name: string;
  readonly sequenceBranches: readonly string[];
  readonly mirrorEnabled?: boolean;
  readonly backfill?: boolean;
}

export interface RegisterResult {
  readonly repository: RepositoryRow;
  readonly created: boolean;
  /** 재등록으로 표식이 풀린 문서 수. 신규 등록이면 0이다. */
  readonly documentsMarked: number;
  /** 백필 잡을 큐에 넣었으면 잡 식별자. */
  readonly backfillJobId: number | null;
  /**
   * 이 등록이 종료시킨 등록 검토 요청들 (FR-ING-009 AC-11).
   *
   * **하나가 아니라 목록이다** — 여러 사용자가 같은 저장소를 요청했으면 실제
   * 등록 하나가 그 전부의 목적을 충족한다. 0건은 정상이다(요청 없이 등록할 수
   * 있다).
   */
  readonly fulfilledRequests: readonly RegistrationRequestRow[];
  /** 새로 대상이 된 브랜치의 채번 잡 식별자들 (AC-12). */
  readonly sequenceJobIds: readonly number[];
}

export interface UnregisterResult {
  readonly repository: RepositoryRow;
  readonly documentsMarked: number;
}

const SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;

function requireSlugPart(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdminRejected('INVALID_PARAMETER', `${field}가 필요하다`);
  }
  const trimmed = value.trim();
  if (!SLUG_PATTERN.test(trimmed)) {
    throw new AdminRejected('INVALID_PARAMETER', `${field}에 쓸 수 없는 문자가 있다`);
  }
  return trimmed;
}

/**
 * 시퀀스 대상 브랜치를 다듬고 상한을 본다 (AC-2).
 *
 * 중복을 접은 **뒤에** 센다. `["main","main"]`을 2개로 세면 사용자가 이해할 수
 * 없는 이유로 거절당한다.
 */
export function normalizeBranches(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AdminRejected('INVALID_PARAMETER', 'sequence_branches는 배열이어야 한다');
  }

  const branches: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new AdminRejected('INVALID_PARAMETER', '브랜치 이름이 비었다');
    }
    const trimmed = entry.trim();
    if (!branches.includes(trimmed)) branches.push(trimmed);
  }

  if (branches.length > MAX_SEQUENCE_BRANCHES) {
    throw new AdminRejected(
      'BRANCH_LIMIT_EXCEEDED',
      `시퀀스 대상 브랜치는 저장소당 최대 ${String(MAX_SEQUENCE_BRANCHES)}개다`,
      { limit: MAX_SEQUENCE_BRANCHES, given: branches.length },
    );
  }
  return branches;
}

export async function listRepositories(
  deps: RegistryDeps,
  filter: repositoryRepo.RepositoryFilter,
  limit: number,
  offset: number,
): Promise<{ readonly items: readonly RepositoryRow[]; readonly total: number }> {
  const [items, total] = await Promise.all([
    repositoryRepo.listRepositories(deps.pool, filter, limit, offset),
    repositoryRepo.countRepositories(deps.pool, filter),
  ]);
  return { items, total };
}

async function markDocuments(
  deps: RegistryDeps,
  repositoryId: number,
  archived: boolean,
  correlationId: string,
): Promise<MarkArchivedResult> {
  try {
    // 등록 상태 표식도 이중 쓰기 대상이다 (WP-035, DEV-295).
    return await withReindexWrite(deps.pool, (targets) =>
      markRepositoryArchived(deps.es, repositoryId, archived, targets),
    );
  } catch (error) {
    // 표식 실패가 등록·해제 자체를 되돌리지는 않는다. PostgreSQL이 시스템
    // 오브 레코드이고 ES는 그로부터 재구성 가능한 파생 뷰다 (ADR-004).
    // 조용히 넘기지 않고 남긴다 — 다시 부르면 멱등하게 이어진다.
    deps.log?.({
      level: 'error',
      message: '문서 표식 갱신에 실패했다',
      correlation_id: correlationId,
      repository_id: repositoryId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { updated: {}, total: 0 };
  }
}

export async function registerRepository(
  deps: RegistryDeps,
  input: RegisterInput,
  actor: string,
  correlationId: string,
): Promise<RegisterResult> {
  const owner = requireSlugPart(input.owner, 'owner');
  const name = requireSlugPart(input.name, 'name');
  const branches = normalizeBranches(input.sequenceBranches);

  const facts = await deps.lookup(owner, name);
  if (facts === null) {
    // 접근할 수 없는 저장소를 등록하면 수집이 영영 비어 있는 채로 "등록됨"으로
    // 보인다. 필요한 권한을 함께 돌려준다 (FR-ING-009 예외 처리).
    await recordAuditBestEffort(
      deps.pool,
      {
        userId: actor,
        action: 'repository.register',
        target: `${owner}/${name}`,
        resultCode: 'FORBIDDEN_ROLE',
        correlationId,
      },
      deps.log,
    );
    throw new AdminRejected('FORBIDDEN_ROLE', `${owner}/${name}에 접근할 수 없다`, {
      required_permissions: [...REQUIRED_APP_PERMISSIONS],
    });
  }

  const existing = await repositoryRepo.findRepositoryById(deps.pool, facts.repository_id);

  /*
   * **정본 쓰기와 요청 종료를 한 트랜잭션에 둔다** (FR-ING-009 AC-11, CR-055).
   *
   * 저장소가 `active`인데 그 식별자의 등록 검토 요청이 `pending`으로 남는
   * 상태를 **성공한 등록 하나가 만들어서는 안 된다.** 둘을 따로 쓰면 그 사이의
   * 실패가 정확히 그 상태를 남기고, 운영자는 이미 등록된 저장소를 대기열에서
   * 다시 본다.
   *
   * **GHE 조회·팀 동기화·ES 갱신·백필 큐잉은 이 경계 밖이다.** 외부 호출을
   * 트랜잭션에 담으면 그 호출이 느린 동안 락이 잡혀 있고, GHE 일시 오류가
   * 정본 쓰기를 통째로 되돌린다 — `assignSequence`가 같은 이유로 커밋 뒤에
   * Elasticsearch를 만진다.
   */
  const fulfilled = await withTransaction(deps.pool, async (client) => {
    await repositoryRepo.upsertRepository(client, {
      repository_id: facts.repository_id,
      owner,
      name,
      org_id: facts.org_id,
      visibility: facts.visibility,
      sequence_branches: branches,
      mirror_enabled: input.mirrorEnabled ?? true,
      status: 'active',
    });
    return registrationRequestRepo.fulfillPendingForSlug(client, owner, name, actor);
  });

  /*
   * 팀 접근 범위를 채운다 (WP-068 / CR-035, DEV-114·186).
   *
   * 조회한 팀을 `team` 표에도 넣는다 — `resolveTeamIds`(WP-013)가 `team:` 질의의
   * slug를 ID로 옮길 때 그 표를 읽는데, 채우는 자리가 없어 **이름이 ID로
   * 옮겨지지 않아 질의가 한 건도 맞히지 못했다.** 조회한 것만 넣으므로 별도
   * 동기화 잡을 만들지 않는다.
   */
  await syncRepositoryTeams(deps, facts.repository_id, facts.org_id, owner, name, correlationId);

  // 해제됐던 저장소를 다시 등록하면 문서의 표식도 풀어야 한다. 풀지 않으면
  // 되살아난 저장소가 계속 "해제됨"으로 보인다.
  const documentsMarked =
    existing?.status === 'archived' ? (await markDocuments(deps, facts.repository_id, false, correlationId)).total : 0;

  const backfillJobId = input.backfill === true ? await enqueueBackfill(deps, owner, name, actor) : null;

  /*
   * **새로 대상이 된 브랜치의 채번을 요청한다** (FR-ING-009 AC-12, CR-055).
   *
   * 백필이 대신하지 않는다 — 백필은 PR 문서를 채우고 채번은 first-parent
   * 커밋에 서수를 붙이는 별개의 책임이다. 조정 스캔이 다음 주기에 결국
   * 복구하지만, 그때까지 운영자는 자기가 방금 더한 브랜치의 공간이 비어 있는
   * 이유를 알 수 없다.
   */
  const sequenceJobIds = await enqueueSequenceAssign(
    deps,
    owner,
    name,
    newBranches(existing?.sequence_branches, branches),
    actor,
  );

  await recordAuditBestEffort(
    deps.pool,
    {
      userId: actor,
      action: 'repository.register',
      target: `${owner}/${name}`,
      resultCode: existing === undefined ? 'created' : 'updated',
      correlationId,
    },
    deps.log,
  );

  const repository = await repositoryRepo.findRepositoryById(deps.pool, facts.repository_id);
  if (repository === undefined) throw new Error('등록 직후 저장소를 찾지 못했다');

  deps.log?.({
    level: 'info',
    message: existing === undefined ? '저장소를 등록했다' : '저장소 등록을 갱신했다',
    correlation_id: correlationId,
    repository_id: facts.repository_id,
    repository: `${owner}/${name}`,
    actor,
  });

  return {
    repository,
    created: existing === undefined,
    documentsMarked,
    backfillJobId,
    fulfilledRequests: fulfilled,
    sequenceJobIds,
  };
}

/**
 * 이번 변경으로 **새로 대상이 된** 브랜치.
 *
 * 빠진 브랜치는 돌려주지 않는다 — 대상 목록에서 빼는 것은 기존 시퀀스를 지우는
 * 일이 아니고(FR-ING-009 AC-12), 그 커밋들의 서수는 이미 인용된 값이다.
 */
function newBranches(before: readonly string[] | undefined, after: readonly string[]): readonly string[] {
  const had = new Set(before ?? []);
  return after.filter((branch) => !had.has(branch));
}

/**
 * 브랜치마다 `sequence_assign` 잡을 넣는다 (JOB-SEQ-001 / CR-055).
 *
 * **`target`은 `API-ADM-002`가 만드는 것과 같은 형식이다** — 러너 하나가 두
 * 경로의 행을 모두 읽으므로 형식이 갈리면 한쪽을 해석하지 못한다.
 *
 * 실패해도 등록·변경을 되돌리지 않는다. 같은 공간에 활성 잡이 있으면
 * `job_active_uk`가 막는데 그것은 **이미 채번이 예약돼 있다는 뜻**이라 오류가
 * 아니고, 그 밖의 실패도 조정 스캔이 다음 주기에 복구한다.
 */
async function enqueueSequenceAssign(
  deps: RegistryDeps,
  owner: string,
  name: string,
  branches: readonly string[],
  actor: string,
): Promise<readonly number[]> {
  const ids: number[] = [];
  for (const baseBranch of branches) {
    const target = sequenceSpaceLabel(`${owner}/${name}`, baseBranch);
    try {
      ids.push(await jobRepo.enqueueJob(deps.pool, 'sequence_assign', target, actor));
    } catch {
      deps.log?.({
        level: 'warn',
        message: '채번 잡이 이미 큐에 있어 새로 넣지 않았다',
        repository: `${owner}/${name}`,
        base_branch: baseBranch,
      });
    }
  }
  return ids;
}

/**
 * 백필 요청을 큐에 남긴다 (CR-013, DEV-031).
 *
 * 실행 주체 `batch` 워커는 WP-019가 세운다. 그때까지 요청을 조용히 버리지 않고
 * `job` 행으로 남겨 둔다 — 같은 대상에 활성 잡이 있으면 `job_active_uk`가
 * 막으므로 두 번 눌러도 하나다.
 */
async function enqueueBackfill(
  deps: RegistryDeps,
  owner: string,
  name: string,
  actor: string,
): Promise<number | null> {
  try {
    return await jobRepo.enqueueJob(deps.pool, 'backfill', `${owner}/${name}`, actor);
  } catch {
    // 이미 큐에 있다. 등록 자체를 실패시킬 이유가 아니다.
    return null;
  }
}

export interface UpdateResult {
  readonly repository: RepositoryRow;
  /** 새로 대상이 된 브랜치의 채번 잡 식별자들 (FR-ING-009 AC-12). */
  readonly sequenceJobIds: readonly number[];
  /** 표기 재개를 요청했다면 그 결과 (WP-075 안전성 보강). */
  readonly annotateResumed?: { readonly block_cleared: boolean; readonly targets_reopened: number };
}

export interface UpdateRepositoryOptions {
  /**
   * 표기를 **운영자의 판단으로** 다시 연다.
   *
   * 두 가지를 함께 푼다: 권한 오류로 걸린 실행 중 차단과, 서버가 본문을 바꿔 저장해
   * 멈춘 행(`body_changed`)이다. 둘 다 **스스로는 풀리지 않는 상태**이며, 그렇게 둔
   * 이유가 있다 — 앞의 것은 「읽을 수 있다」가 「고칠 수 있다」를 뜻하지 않기
   * 때문이고, 뒤의 것은 자동 재시도가 이미 확인된 차이를 덮기 때문이다.
   *
   * 이미 GHE에 붙은 제목을 되돌리지 않는다. 여는 것은 **다음 시도의 자격**뿐이다.
   */
  readonly resumeAnnotation?: boolean;
}

export async function updateRepository(
  deps: RegistryDeps,
  repositoryId: number,
  settings: repositoryRepo.RepositorySettings,
  actor: string,
  correlationId: string,
  options: UpdateRepositoryOptions = {},
): Promise<UpdateResult> {
  /*
   * **바꾸기 전 목록을 먼저 읽는다** (CR-055). 갱신 뒤에 읽으면 무엇이 새로
   * 들어왔는지 알 수 없고, 그러면 브랜치를 더할 때마다 전부 다시 채번하거나
   * 아무것도 채번하지 않는 둘 중 하나가 된다.
   */
  const before = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  const updated = await repositoryRepo.updateRepositorySettings(deps.pool, repositoryId, settings);
  if (updated === undefined) {
    throw new AdminRejected('NOT_FOUND', `등록되지 않은 저장소다: ${String(repositoryId)}`);
  }

  await recordAuditBestEffort(
    deps.pool,
    {
      userId: actor,
      action: 'repository.update',
      target: `${updated.owner}/${updated.name}`,
      resultCode: 'updated',
      correlationId,
    },
    deps.log,
  );

  /*
   * **감사는 `repository.update` 하나만 남긴다** (CR-054의 규율). 사용자가 누른
   * 것은 설정 변경 하나이고, 그 결과로 생긴 채번 잡을 `job.run`으로 함께
   * 기록하면 **같은 행위가 두 번 세어져** 감사 로그에서 실제 실행 횟수를 알 수
   * 없게 된다. 운영자가 A-003에서 직접 채번을 실행한 경우만 `job.run`이다.
   */
  const sequenceJobIds = await enqueueSequenceAssign(
    deps,
    updated.owner,
    updated.name,
    newBranches(before?.sequence_branches, updated.sequence_branches),
    actor,
  );

  if (options.resumeAnnotation !== true) return { repository: updated, sequenceJobIds };

  /*
   * **재개는 설정 변경과 같은 감사 한 줄에 담는다** (CR-054의 규율). 운영자가 누른
   * 것은 「이 저장소의 표기를 다시 열어라」 하나이고, 그것을 액션 둘로 쪼개면 같은
   * 행위가 두 번 세어진다. 몇 건을 다시 열었는지는 응답이 말한다.
   */
  const blocked = before?.annotate_blocked_at !== null && before?.annotate_blocked_at !== undefined;
  await repositoryRepo.clearAnnotationBlock(deps.pool, repositoryId);
  const reopened = await mergeSequenceRepo.resumeAnnotateTargets(deps.pool, repositoryId);
  const refreshed = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  return {
    repository: refreshed ?? updated,
    sequenceJobIds,
    annotateResumed: { block_cleared: blocked, targets_reopened: reopened },
  };
}

export async function unregisterRepository(
  deps: RegistryDeps,
  repositoryId: number,
  actor: string,
  correlationId: string,
): Promise<UnregisterResult> {
  const archived = await repositoryRepo.setRepositoryStatus(deps.pool, repositoryId, 'archived');
  if (archived === undefined) {
    throw new AdminRejected('NOT_FOUND', `등록되지 않은 저장소다: ${String(repositoryId)}`);
  }

  const marked = await markDocuments(deps, repositoryId, true, correlationId);

  await recordAuditBestEffort(
    deps.pool,
    {
      userId: actor,
      action: 'repository.unregister',
      target: `${archived.owner}/${archived.name}`,
      resultCode: 'archived',
      correlationId,
    },
    deps.log,
  );

  deps.log?.({
    level: 'info',
    message: '저장소 등록을 해제했다',
    correlation_id: correlationId,
    repository_id: repositoryId,
    repository: `${archived.owner}/${archived.name}`,
    actor,
  });

  return { repository: archived, documentsMarked: marked.total };
}

/**
 * GHE의 저장소 팀을 정본과 색인에 반영한다 (WP-068 / CR-035·036).
 *
 * **판정과 쓰기는 `@prs/authz`의 공유 구현이 한다** (CR-036, DEV-188). 등록
 * 경로와 팀 웹훅 경로가 같은 동기화를 하는데 각자 구현하면 한쪽만 고쳐지는
 * 날이 오고, 접근 범위에서 그것은 유출이다.
 *
 * 실패해도 등록을 되돌리지 않는다 — 저장소는 등록됐고 팀은 다음 동기화가
 * 채운다. 여기서 던지면 GHE 일시 오류가 등록 자체를 막는다.
 */
export async function syncRepositoryTeams(
  deps: RegistryDeps,
  repositoryId: number,
  orgId: number,
  owner: string,
  name: string,
  correlationId: string,
): Promise<{ readonly changed: boolean; readonly teamIds: readonly number[] }> {
  const listTeams = deps.listTeams;
  if (listTeams === undefined) return { changed: false, teamIds: [] };

  try {
    const outcome = await syncRepositoryTeamScope(
      {
        pool: deps.pool,
        index: {
          applyRepositoryTeams: (repositoryId, teamIds) =>
            withReindexWrite(deps.pool, (targets) =>
              applyRepositoryTeams(deps.es, repositoryId, teamIds, targets),
            ),
        },
        source: { listRepositoryTeams: listTeams },
        log: (entry) => deps.log?.({ ...entry, correlation_id: correlationId }),
      },
      { repository_id: repositoryId, owner, name, org_id: orgId },
    );
    return { changed: outcome.changed, teamIds: outcome.teamIds };
  } catch (error) {
    deps.log?.({
      level: 'error',
      message: '팀 접근 범위를 채우지 못했다 — 등록은 유지된다',
      correlation_id: correlationId,
      repository_id: repositoryId,
      repository: `${owner}/${name}`,
      reason: String(error).slice(0, 200),
    });
    return { changed: false, teamIds: [] };
  }
}
