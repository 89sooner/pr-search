/**
 * 조정 스캔 (JOB-ING-005 / WP-028, FR-ING-011, CR-033).
 *
 * 수집 결과와 GHE의 실제 상태를 주기적으로 대조해 **색인에서 빠진 PR**을 찾아
 * 되돌린다. 웹훅은 유실될 수 있고(전송 실패·재시작·서명 오류), 유실된 PR은
 * 아무도 눈치채지 못한 채 검색에서 영영 빠진다 — 조사 도구에서 그것이 가장 나쁜
 * 실패다.
 *
 * ## `since`가 없어서 `desc`로 읽는다 (CR-033, DEV-175)
 *
 * "최근 24시간 갱신 PR"(AC-2)을 물어야 하는데 `/pulls`에는 `since`가 없다.
 * `updated desc`로 읽어 컷오프에 닿으면 멈추는 것이 그 질문에 답하는 유일한
 * 방법이다 — **없는 파라미터를 있는 것처럼 만들지 않는다.** 백필의 `asc` 고정
 * (DEV-098)은 기본값으로 남아 그대로다.
 *
 * ## 되돌리는 방법은 백필과 같다
 *
 * `projectOne`을 그대로 쓴다. "간이 색인" 경로를 따로 만들면 문서 버전 규칙
 * (DEV-099)이나 벌크 항목 실패 처리(DEV-106) 중 하나만 갖는 두 번째 경로가
 * 생긴다.
 */

import { jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { GitHubApiError, type CommitGraph, type GitHubClient } from '@prs/github';
import { TOPICS, type EventBus } from '@prs/bus';
import {
  deterministicEventId,
  sequencePartitionKey,
  type SequenceRequested,
} from '@prs/domain';
import { applyMandatoryScopeFilter, search } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { projectOne, type BackfillDeps } from './backfill.js';
import type { WorkerMetrics } from './metrics.js';

/** 스케줄 기본값 (FR-ING-011 AC-1 — 설정값이며 기본 1시간). */
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 한 루프가 두 방아쇠를 함께 볼 때의 순회 간격 (CR-055).
 *
 * 주기 간격(기본 1시간)과 다른 값인 이유는 **수동 요청이 그만큼 지연되면 안
 * 되기 때문**이다. 매 순회에서 대기 중인 잡을 먼저 보고, 주기 스윕은 마지막
 * 실행 시각으로 판정한다.
 */
export const RECONCILE_POLL_MS = 5_000;

/** 수동 조정 스캔의 잡 유형과 대상. 서버가 정한 값과 같아야 한다. */
export const RECONCILE_JOB_TYPE = 'reconcile' as const;
/** 대조 창 (AC-2). */
export const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 이 수 이상 연속으로 완주하지 못하면 경보다 (예외 처리). */
export const RECONCILE_ALERT_CYCLES = 3;
const PAGE_SIZE = 100;

export interface ReconcileLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository?: string;
  readonly reason?: string;
  /** 수동 실행일 때의 잡 식별자 (CR-055). 주기 실행에는 없다. */
  readonly job_id?: number;
}

export interface ReconcileDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly client: GitHubClient;
  /** head 채번 요청을 싣는 버스. 게이트웨이가 쓰는 것과 같은 토픽이다 (DEV-180). */
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  /** 되돌리기가 쓸 백필 의존. `projectOne`이 요구하는 것과 같다. */
  readonly backfill: BackfillDeps;
  /**
   * 누락 PR 하나를 되돌린다. **기본값이 백필의 `projectOne`이다** — 되돌리기
   * 경로를 두 벌 두지 않는다는 결정(DEV-176)이 이 기본값에 있다.
   *
   * 주입은 시험을 위한 것이다. 되돌리기를 갈아 끼우라는 뜻이 아니라, 탐지·집계
   * 규칙을 백필 스택 전체 없이 검증하기 위한 이음매다.
   */
  /**
   * 팀 접근 범위 동기화 (WP-068 / CR-036, DEV-190).
   *
   * **마이그레이션은 기존 저장소에 빈 배열을 남긴다.** 등록 경로만이 그것을
   * 채우므로, 마이그레이션 이전부터 있던 저장소는 **누군가 다시 등록하기 전까지
   * 팀으로만 볼 수 있는 상태로 남는다** — 그리고 팀 웹훅의 역조회도 빈 배열이라
   * 그 저장소를 찾지 못한다. 정기 정비가 그 공백을 메운다.
   *
   * 없으면 하지 않는다 (GHE 자격 증명이 없는 배포).
   */
  readonly syncTeams?: (repository: RepositoryRow) => Promise<void>;
  /**
   * 정본 스냅숏 부트스트랩을 큐에 넣는다 (JOB-ING-010 / CR-037, DEV-194).
   *
   * **팀 접근 범위와 같은 이유로 여기에 있다** — 마이그레이션 010은 빈 표를
   * 남기고 그것을 채우는 경로가 없었다. 이미 저장소를 한 바퀴 도는 정기 정비에
   * 얹는 것이 새 스케줄러를 만들지 않는 길이다 (DEV-190의 선례).
   *
   * 한 주기에 일부만 넣는다 — 첫 배포에서 GHE 한도를 통째로 태우지 않는다.
   *
   * @returns 이번 주기에 큐에 넣은 저장소 수.
   */
  readonly enqueueSnapshotBootstrap?: () => Promise<number>;
  readonly reproject?: (
    deps: BackfillDeps,
    repository: RepositoryRow,
    summary: Parameters<typeof projectOne>[3],
  ) => Promise<boolean>;
  readonly log?: (fields: ReconcileLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReconcileResult {
  readonly scanned: number;
  readonly missing: number;
  readonly reprojected: number;
  readonly sequenceScheduled: boolean;
  /** 한도 소진 등으로 창을 끝까지 읽지 못했다. 다음 주기로 미룬다. */
  readonly deferred: boolean;
  /**
   * 중단 지시로 이 저장소의 조정을 끝내지 못했다 (DEV-443).
   *
   * **미룸과 다르다.** 미룸은 다음 주기가 이어받으라는 신호이고 연속 미완주를
   * 세는 근거가 되지만, 취소는 운영자가 일을 멈추라고 말한 것이다 — 그것을
   * 저장소의 건강 지표로 세면 취소할 때마다 경보가 울린다.
   */
  readonly stopped: boolean;
}

/** 색인에 이 PR 문서가 있는가. */
async function isIndexed(deps: ReconcileDeps, repositoryId: number, prNumber: number): Promise<boolean> {
  /*
   * 범위는 **지금 조정 중인 저장소 하나**다 (ADR-008).
   *
   * 시스템 작업이라고 강제 필터를 우회하지 않는다 — 우회 경로를 한 번 만들면
   * 그것이 다음 조회의 선례가 된다. 조정 대상이 그 저장소이므로 그 범위를
   * 그대로 주는 것이 정확하고, 타입 강제도 그대로 지난다.
   */
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { repository_id: repositoryId } }, { term: { pr_number: prNumber } }] } },
    { kind: 'explicit', repositoryIds: [repositoryId] },
  );
  const response = await search<{ pr_number?: number }>(deps.es, 'prs-pull-requests', scoped, {
    size: 1,
    routing: String(repositoryId),
    _source: ['pr_number'],
  });
  return response.hits.hits.length > 0;
}

/**
 * 한 저장소를 조정한다.
 *
 * 한도가 소진되면 **던지지 않고 `deferred`로 끝낸다** (예외 처리) — 한 저장소의
 * 한도 때문에 나머지 저장소의 스캔까지 버리면 그 주기가 통째로 사라진다.
 */
export async function reconcileRepository(
  deps: ReconcileDeps,
  repository: RepositoryRow,
  /**
   * 중단 지시가 들어왔는가 (DEV-443, PR #91 리뷰 P1).
   *
   * 저장소 **사이**에서만 보면 활성 저장소가 하나뿐이거나 그 저장소의 창이
   * 넓을 때 취소가 사실상 무시된다 — 화면은 "취소됨"을 보이는데 스캔은 남은
   * 페이지를 계속 읽고 GHE를 태운다.
   *
   * ## 저장소 안에서 끊어도 안전한 이유
   *
   * 이 스캔에는 **재개 커서가 없다.** 매 회차가 `RECONCILE_WINDOW_MS` 창을
   * 처음부터 다시 읽고, 이미 색인된 PR은 `isIndexed`가 걸러 낸다. PR 하나의
   * 되돌리기는 그 자체로 완결되며 다음 회차가 남은 것만 다시 집는다. 끊어서
   * 부분으로 남는 것은 **"이번 회차가 창을 끝까지 읽었다"는 사실 하나뿐**이고,
   * 그것은 아래에서 `recordCompletedReconciliation`을 부르지 않는 것으로 지킨다.
   *
   * 백필이 페이지 사이에서만 멈추는 것은 그쪽이 커서를 저장하기 때문이다.
   * 여기에는 저장할 커서가 없으므로 같은 제약이 성립하지 않는다.
   */
  cancelled?: () => Promise<boolean>,
): Promise<ReconcileResult> {
  const log = deps.log ?? ((): void => undefined);
  const now = (deps.now ?? ((): Date => new Date()))();
  const cutoff = now.getTime() - RECONCILE_WINDOW_MS;
  const ref = { owner: repository.owner, repo: repository.name };
  const slug = `${repository.owner}/${repository.name}`;

  let scanned = 0;
  let missing = 0;
  let reprojected = 0;
  let deferred = false;
  let stopped = false;

  /**
   * 한 번 참이면 그대로 남는다 — 확인 지점마다 답이 흔들리면 절반은 멈추고
   * 절반은 계속하는 상태가 된다.
   */
  const shouldStop = async (): Promise<boolean> => {
    if (stopped) return true;
    if (cancelled === undefined) return false;
    if (!(await cancelled())) return false;
    stopped = true;
    log({ level: 'info', message: '중단 지시로 저장소 조정을 멈춘다', repository: slug, reason: 'cancelled' });
    return true;
  };

  scan: for (let page = 1; ; page += 1) {
    // 다음 GHE 왕복을 시작하기 전에 본다.
    if (await shouldStop()) break;
    let items;
    try {
      const result = await deps.client.listPullRequestsPage(ref, page, {
        priority: 'backfill',
        perPage: PAGE_SIZE,
        // 최근 것부터. 컷오프에 닿으면 멈춘다 (DEV-175).
        direction: 'desc',
      });
      items = result.items;
      if (!result.hasMore && items.length === 0) break;
    } catch (error) {
      if (error instanceof GitHubApiError && error.kind === 'rate_limited') {
        deferred = true;
        log({ level: 'warn', message: '한도 소진으로 다음 주기로 미룬다', repository: slug, reason: 'rate_limited' });
        break;
      }
      throw error;
    }

    for (const summary of items) {
      const updatedAt = Date.parse(summary.updated_at ?? '');
      // 창을 벗어나면 그 뒤는 전부 더 오래된 것이다 — `desc`라서 성립한다.
      if (!Number.isNaN(updatedAt) && updatedAt < cutoff) break scan;

      scanned += 1;
      if (await isIndexed(deps, repository.repository_id, summary.number)) continue;

      missing += 1;
      deps.metrics.reconcileMissing.inc({ repository: slug, kind: 'pull_request' });
      /*
       * 되돌리기 직전이 이 순회에서 가장 비싼 지점이다 — PR 하나의 보강이 GHE를
       * 여러 번 부른다. 이미 색인된 PR은 여기에 닿지 않으므로 확인 횟수는 실제
       * 누락 건수만큼이며, 그만큼이 취소가 기다리는 최대 단위다.
       */
      if (await shouldStop()) break scan;
      // 되돌리기는 백필과 같은 경로다 — 두 번째 방식을 만들지 않는다.
      const reproject = deps.reproject ?? ((d, r, sm) => projectOne(d, null, r, sm));
      // 출처를 남긴다 — 스냅숏이 어느 경로에서 왔는지가 조사에 필요하다 (DEV-184).
      const backfillDeps = { ...deps.backfill, snapshotSource: 'reconcile' as const };
      if (await reproject(backfillDeps, repository, summary)) reprojected += 1;
    }

    if (items.length < PAGE_SIZE) break;
  }

  /*
   * 중단 뒤에는 후속 단계를 실행하지 않는다 (DEV-443). 채번 예약도 팀 범위
   * 동기화도 **이 회차가 하기로 한 일**이며, 취소는 그 일을 멈추라는 뜻이다.
   * 완주 기록은 더욱 그렇다 — 창을 끝까지 읽지 못한 회차의 `missing`은 부분값이라
   * 미룸과 똑같은 이유로 "최근 결과"가 될 수 없다.
   */
  if (stopped) {
    return { scanned, missing, reprojected, sequenceScheduled: false, deferred, stopped: true };
  }

  const sequenceScheduled = await scheduleHeadSequence(deps, repository);

  /*
   * 팀 접근 범위를 맞춘다 (CR-036, DEV-190). 등록 경로만으로는 마이그레이션
   * 이전 저장소가 영영 빈 채로 남는다. 실패해도 조정 스캔을 멈추지 않는다.
   */
  if (deps.syncTeams !== undefined) {
    try {
      await deps.syncTeams(repository);
    } catch (error) {
      log({
        level: 'warn',
        message: '팀 접근 범위 동기화 실패 — 다음 주기가 다시 시도한다',
        repository: slug,
        reason: String(error).slice(0, 200),
      });
    }
  }

  /*
   * 최근 **완료된** 조정 결과를 남긴다 (WP-034 / FR-ING-011 AC-6, CR-050 DEV-352).
   *
   * **미룬 회차는 기록하지 않는다.** 한도가 소진돼 창을 끝까지 읽지 못한
   * 회차의 `missing`은 부분값이라 언제나 실제보다 작다 — 그것을 "최근 결과"로
   * 표시하면 W-009 사용자는 "거의 다 수집됐다"로 읽고, 이 화면의 목적이 정확히
   * 그 오독을 막는 것이다. 예외로 끝난 회차는 이 지점에 닿지도 않는다.
   *
   * `reconcile_missing_total` 지표는 그대로 둔다 — 누적 추세와 시점 스냅숏은
   * 답하는 물음이 다르고, 지표 저장소가 없는 배치에서는 조회 서비스가 그
   * counter를 읽을 방법 자체가 없다.
   *
   * 기록 실패가 조정을 멈추지 않는다 — 팀 범위 동기화와 같은 처분이다.
   */
  if (!deferred) {
    try {
      await repositoryRepo.recordCompletedReconciliation(
        deps.pool,
        repository.repository_id,
        missing,
        (deps.now ?? ((): Date => new Date()))(),
      );
    } catch (error) {
      log({
        level: 'warn',
        message: '조정 결과 기록 실패 — 다음 완주 회차가 다시 남긴다',
        repository: slug,
        reason: String(error).slice(0, 200),
      });
    }
  }

  return { scanned, missing, reprojected, sequenceScheduled, deferred, stopped: false };
}

/**
 * 대상 브랜치 head에 서수가 없으면 채번을 요청한다 (FR-ING-011 AC-5).
 *
 * 원장 §7이 적어 둔 빈칸을 메우는 항목이다 — 채번은 push 웹훅이 온 저장소만
 * 따라가므로, 웹훅을 놓친 저장소는 아무도 채번을 요청하지 않는다.
 *
 * ## 잡 행이 아니라 **살아 있는 경로**로 보낸다 (CR-034, DEV-180)
 *
 * 처음에는 `sequence_assign` 잡 행을 넣었다. 그런데 **그 유형을 집는 러너가
 * 없다** — 데이터베이스 잡을 claim하는 곳은 백필뿐이고, 정상 채번은 버스
 * 이벤트가 몬다. 그래서 그 행은 영원히 `queued`로 남고, 게다가
 * `findActiveJob`이 그것을 보고 **이후의 모든 복구 시도를 막는다.** 고치려고
 * 만든 것이 고치지 못하게 막는 자물쇠가 된다.
 *
 * 두 번째 채번 실행 구조를 만들지 않는다. 이미 정식으로 살아 있는 경로
 * (`prs:sequence` → `sequence.requested` → JOB-SEQ-001 → `assignSequence`)로
 * 보낸다. 게이트웨이가 push 웹훅에서 내는 것과 **같은 이벤트**다.
 *
 * `head_sha`를 실어 보내지만 소비자는 그것을 맹신하지 않고 실행 시 그래프 head를
 * 다시 읽는다 — 기존 규칙이 그대로 통제한다.
 */
async function scheduleHeadSequence(deps: ReconcileDeps, repository: RepositoryRow): Promise<boolean> {
  const graph = deps.graphFor(repository);
  const ref = { owner: repository.owner, repo: repository.name };
  let scheduled = false;

  for (const baseBranch of repository.sequence_branches) {
    const head = await graph.resolveHead(ref, baseBranch);
    // 브랜치가 없는 것은 오류가 아니다 — 채번할 것이 없다.
    if (head === null) continue;

    const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, baseBranch);
    if (space === undefined) continue;

    const seq = await mergeSequenceRepo.findSeqByCommit(
      deps.pool,
      repository.repository_id,
      baseBranch,
      space.seq_epoch,
      head,
    );
    if (seq !== null) continue;

    const correlationId = `reconcile:${String(repository.repository_id)}:${baseBranch}`;
    const payload: SequenceRequested = {
      repository_id: repository.repository_id,
      base_branch: baseBranch,
      head_sha: head,
      correlation_id: correlationId,
    };
    await deps.bus.publish(
      TOPICS.sequence,
      // 파티션 키는 게이트웨이와 같은 규칙이다 — 공간별 직렬이 유지된다.
      sequencePartitionKey(repository.repository_id, baseBranch),
      {
        // 같은 head에 대한 재요청은 같은 ID다 — 멱등이 결정론에서 나온다.
        event_id: deterministicEventId(
          'sequence.requested',
          String(repository.repository_id),
          baseBranch,
          head,
        ),
        event_name: 'sequence.requested',
        correlation_id: correlationId,
        occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
        payload,
      },
    );
    scheduled = true;
  }

  return scheduled;
}

/** 저장소별 연속 미완주 횟수. 3 이상이면 경보다. */
const incompleteCycles = new Map<string, number>();

export function resetReconcileCycles(): void {
  incompleteCycles.clear();
}

/** 등록된 저장소를 한 바퀴 조정한다. */
export async function runReconcileSweep(
  deps: ReconcileDeps,
  /**
   * 중단 지시가 들어왔는가 (PR #89 리뷰 P1).
   *
   * **상태를 보존하는 것만으로는 중단이 아니다.** 조건부 종료 전이는 잡 행이
   * `cancelled`로 남는 것까지만 보장하고, 그동안 전량 스윕은 저장소를 계속
   * 돌며 GHE를 부른다 — 화면은 "취소됨"을 보이는데 비싼 스캔이 진행 중이다.
   * `FR-ADMIN-002`의 중단 계약은 **요청을 반영하라**고 말하며 그것은 일을
   * 멈추라는 뜻이다.
   *
   * **저장소 안까지 전달한다** (DEV-443, PR #91 리뷰 P1). 저장소 사이에서만
   * 보면 활성 저장소가 하나뿐일 때 취소가 사실상 무시된다. 안전한 경계는
   * `reconcileRepository`가 정하며 그 인자 주석이 근거를 적어 둔다.
   *
   * **이것은 협조적 중단이지 30초 강제 종료가 아니다** (DEV-447). 이미 시작한
   * PR 하나의 보강은 끝까지 가며, 그 시간에 상한을 거는 재료가 아직 없다.
   */
  cancelled?: () => Promise<boolean>,
): Promise<{
  readonly repositories: number;
  readonly missing: number;
  readonly deferred: number;
  /** 중단 지시로 남은 저장소를 돌지 않았다. */
  readonly stopped: boolean;
}> {
  const log = deps.log ?? ((): void => undefined);
  const repositories = await repositoryRepo.listRepositories(deps.pool, { status: 'active' });
  let missing = 0;
  let deferred = 0;

  /*
   * 정본 스냅숏 부트스트랩 예약 (CR-037, DEV-194). 저장소 순회 **앞에** 둔다 —
   * 개별 저장소의 조정이 실패해도 예약은 이미 끝나 있다.
   *
   * 실패해도 조정 스캔을 멈추지 않는다. 다음 주기가 다시 시도하고, 그 사이
   * 정합성 감시는 그 저장소를 `snapshot_bootstrap_pending`으로 정직하게 보고한다.
   */
  if (deps.enqueueSnapshotBootstrap !== undefined) {
    try {
      const queued = await deps.enqueueSnapshotBootstrap();
      if (queued > 0) {
        log({ level: 'info', message: `정본 스냅숏 부트스트랩 ${String(queued)}건을 큐에 넣었다` });
      }
    } catch (error) {
      log({
        level: 'warn',
        message: '부트스트랩 예약 실패 — 다음 주기가 다시 시도한다',
        reason: String(error).slice(0, 200),
      });
    }
  }

  let stopped = false;
  for (const repository of repositories) {
    if (cancelled !== undefined && (await cancelled())) {
      stopped = true;
      log({ level: 'info', message: '중단 지시로 조정 스캔을 멈춘다', reason: 'cancelled' });
      break;
    }
    const slug = `${repository.owner}/${repository.name}`;
    try {
      const result = await reconcileRepository(deps, repository, cancelled);
      missing += result.missing;
      if (result.stopped) {
        /*
         * 저장소 **안에서** 멈췄다 (DEV-443). 남은 저장소를 돌지 않으며
         * **연속 미완주로 세지도 않는다** — 취소는 그 저장소의 건강 문제가
         * 아니라 운영자의 지시이고, 그것을 미룸과 같이 세면 취소할 때마다
         * 경보가 울린다.
         */
        stopped = true;
        break;
      }
      if (result.deferred) {
        deferred += 1;
        const streak = (incompleteCycles.get(slug) ?? 0) + 1;
        incompleteCycles.set(slug, streak);
        deps.metrics.reconcileIncompleteCycles.set(streak, { repository: slug });
        if (streak >= RECONCILE_ALERT_CYCLES) {
          /*
           * 미룸 자체는 정상이다. **미룸이 반복되는 것**이 문제다 — 그 저장소는
           * 사실상 조정되지 않고 있다.
           */
          log({
            level: 'error',
            message: `조정 스캔이 ${String(streak)}주기 연속 완주하지 못했다`,
            repository: slug,
            reason: 'incomplete_cycles',
          });
        }
      } else {
        incompleteCycles.set(slug, 0);
        deps.metrics.reconcileIncompleteCycles.set(0, { repository: slug });
      }
    } catch (error) {
      log({ level: 'error', message: '조정 스캔 실패', repository: slug, reason: String(error).slice(0, 200) });
    }
  }

  return { repositories: repositories.length, missing, deferred, stopped };
}

export interface ReconcileSweeper {
  stop(): Promise<void>;
}

/**
 * 조정 스캔 루프 (JOB-ING-005 / FR-ING-011 AC-1·AC-7).
 *
 * ## 두 방아쇠를 한 루프가 처리한다 (CR-055, PR #88 리뷰 P2)
 *
 * 주기 실행과 운영자의 즉시 실행은 **같은 스캔 구현을 지나며 동시에 돌지
 * 않는다.** 그것을 락으로 보장하지 않고 **구조로** 보장한다 — 이 파일에
 * `runReconcileSweep`를 부르는 자리가 하나뿐이면 겹칠 수 있는 형태가 없다.
 *
 * **두 루프를 두고 배포로 막으려던 설계를 버렸다.** `reconcile` 역할이 복제본
 * 1개로 배치되어 있다는 사실은 프로세스 수를 제한할 뿐, 한 프로세스 안의
 * 독립적인 비동기 루프 둘을 직렬화하지 못한다 — 주기 스윕이 GHE 응답을
 * 기다리는 `await` 지점에서 잡 러너가 깨어나면 같은 전량 스캔이 겹친다.
 *
 * 순회 간격은 주기 간격보다 짧다. 수동 요청이 최대 한 시간 지연되면 "즉시
 * 실행"이 아니기 때문이며, 주기 스윕은 마지막 실행 시각으로 판정한다.
 */
export function startReconcileSweeper(
  deps: ReconcileDeps,
  options: { readonly intervalMs?: number; readonly pollMs?: number } = {},
): ReconcileSweeper {
  const interval = options.intervalMs ?? RECONCILE_INTERVAL_MS;
  const poll = options.pollMs ?? RECONCILE_POLL_MS;
  const now = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;
  /** 마지막 주기 스윕 시각. `null`이면 아직 한 번도 돌지 않았다. */
  let lastScheduledAt: number | null = null;

  let wake: () => void = () => undefined;
  const interruptibleSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = () => undefined;
        resolve();
      }, ms);
      wake = (): void => {
        clearTimeout(timer);
        wake = () => undefined;
        resolve();
      };
    });
  const sleep = deps.sleep ?? interruptibleSleep;

  const describe = (result: { repositories: number; missing: number; deferred: number }): string =>
    `저장소 ${String(result.repositories)}개, 누락 ${String(result.missing)}, 미룸 ${String(result.deferred)}`;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        /*
         * **수동 잡을 먼저 본다.** 상한은 1이다 — 활성 잡 하나 제약(AC-4)이
         * 이미 수동 중복을 막지만, claim 자체도 하나로 묶어 두어야 이 루프가
         * 한 순회에 스캔을 두 번 돌 수 없다.
         */
        const job = await jobRepo.claimNextJob(deps.pool, RECONCILE_JOB_TYPE, 1);
        if (job !== undefined) {
          try {
            /*
             * **취소를 스윕 안까지 전달한다** (PR #89 리뷰 P1). 종료 상태만
             * 보존하면 잡은 `cancelled`인데 전량 스캔이 계속 돌아 GHE를 태운다.
             */
            const result = await runReconcileSweep(deps, async () => {
              return !(await jobRepo.isJobRunning(deps.pool, job.job_id));
            });
            /*
             * **`running`일 때만 종료 상태를 쓴다** (DEV-196). 스캔이 도는 동안
             * 운영자가 취소했으면 그 사실을 덮지 않는다.
             */
            const moved = await jobRepo.finishJobIfRunning(deps.pool, job.job_id, 'completed', null);
            log({
              level: result.missing > 0 ? 'warn' : 'info',
              message: moved
                ? `수동 조정 스캔 완료 — ${describe(result)}`
                : `수동 조정 스캔이 끝났으나 잡 상태가 이미 바뀌어 있어 덮지 않았다 — ${describe(result)}`,
              job_id: job.job_id,
            });
          } catch (error) {
            await jobRepo.finishJobIfRunning(deps.pool, job.job_id, 'failed', String(error).slice(0, 500));
            log({
              level: 'error',
              message: '수동 조정 스캔 실패',
              job_id: job.job_id,
              reason: String(error).slice(0, 200),
            });
          }
        } else if (lastScheduledAt === null || now().getTime() - lastScheduledAt >= interval) {
          /*
           * 주기 스윕. **시작 시각을 먼저 찍는다** — 끝나고 찍으면 스캔에 걸린
           * 시간만큼 다음 주기가 밀려 간격이 조금씩 길어진다.
           */
          lastScheduledAt = now().getTime();
          const result = await runReconcileSweep(deps);
          log({
            level: result.missing > 0 ? 'warn' : 'info',
            message: `조정 스캔 완료 — ${describe(result)}`,
          });
        }
      } catch (error) {
        log({ level: 'error', message: '조정 스캔 스윕 실패', reason: String(error).slice(0, 200) });
      }
      if (stopped) break;
      await sleep(poll);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake();
      await loop;
    },
  };
}
