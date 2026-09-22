/**
 * 커밋 관계 투영 러너 (JOB-REL-008 / WP-101, CR-116, FR-SRCH-002 AC-6).
 *
 * ## 무엇을 하나
 *
 * PostgreSQL의 관계 정본이 바뀐 커밋을 집어, **그 커밋을 소유하는 PR 전부**를 다시
 * 세어 색인에 대입한다. 한 PR의 번호로 배열을 덮지 않는다 — 그것이 N:M을 잃는
 * 길이고, 합집합은 반대로 **빠져야 할 번호를 남기는** 길이었다 (CR-011, DEV-019).
 *
 * ## 실행 시점에 정본을 다시 읽는다
 *
 * 큐에는 세대만 있고 배열은 없다. 예약 시점의 배열을 실어 두면 그 사이에 일어난
 * 변경을 옛 값으로 되돌린다 — `sequence_work`의 `materialize`가 같은 이유로 payload를
 * 힌트로만 쓴다 (DEV-605).
 *
 * ## M 기능 스위치와 무관하다
 *
 * `mergeNumberEnabled`를 보지 않는다. 관계는 M 번호가 꺼진 배포에서도 정확해야
 * 하고, FR-SRCH-002는 M과 아무 관계가 없다. 스위치를 여기 두면 M을 끈 배포에서
 * 잘못된 PR 번호가 영원히 남는다.
 *
 * ## 완료로 숨기지 않는다
 *
 * 문서 미생성·429·타임아웃·충돌은 전부 `retry`이고, 반복되면 `parked`로 **눈에
 * 남는다.** 그 중 `conflict`는 특히 중요하다 — 같은 세대에 다른 집합이 색인에
 * 있다는 것은 우리가 쓰지 않은 쓰기가 있었다는 뜻이고, 롤링 업데이트 중 남은
 * 구버전 합집합 워커가 그 원인일 수 있다.
 */

import { prCommitLinkRepo, type Pool } from '@prs/db';
import type { Client } from '@elastic/elasticsearch';
import { MAX_RETRIES } from '@prs/bus';
import { applyCommitLinks, type CommitLinkOutcome, type WriteTargets } from '@prs/es';
import type { WorkerMetrics } from './metrics.js';

/** 한 회차가 쥐는 lease 길이. 항목 하나가 ES 갱신 한 번이라 길게 잡지 않는다. */
export const LINK_LEASE_MS = 120_000;
export const LINK_CLAIM_LIMIT = 32;
/** 문서가 아직 없을 때의 대기. 투영이 만들 시간을 준다. */
export const LINK_DOCUMENT_WAIT_MS = 5_000;
/** 반복 실패의 보류 기간. 새 관계 변경이 오면 `bump`가 즉시 깨운다. */
export const LINK_PARK_MS = 5 * 60_000;
export const LINK_RETRY_MAX_MS = 60_000;

export interface CommitLinkLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository_id?: number;
  readonly commit_sha?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly generation?: number;
  readonly numbers?: readonly number[];
  readonly attempt?: number;
}

export interface CommitLinkDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly metrics: WorkerMetrics;
  /**
   * 재색인 울타리. 쓰기 대상 해석을 러너가 스스로 하지 않는다 (WP-035, DEV-296).
   *
   * **선택 항목이 아니다.** 기본값으로 「서비스 별칭에만」을 두면 호출부가 빠뜨렸을 때
   * 그 사실이 드러나지 않고, 재색인 중에 **관계 쓰기만 shadow에서 빠진다** — 그 사실은
   * 전환 뒤에야 드러난다. 울타리가 없는 자리(시험)는 그 뜻을 명시해서 넘긴다.
   */
  readonly withWrite: <T>(run: (targets: WriteTargets) => Promise<T>) => Promise<T>;
  readonly log?: (entry: CommitLinkLogEntry) => void;
  readonly now?: () => Date;
  readonly claimLimit?: number;
  readonly leaseMs?: number;
  readonly retryMaxMs?: number;
  readonly random?: () => number;
  /** 한 저장소로 좁힌다. 복구 잡이 쓴다. */
  readonly repositoryId?: number;
}

export interface CommitLinkCycle {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

function nowOf(deps: CommitLinkDeps): Date {
  return (deps.now ?? ((): Date => new Date()))();
}

/** 지수 백오프에 ±20% 지터. `sequence-work-runner`와 같은 규칙이다. */
function retryDelayMs(attempt: number, maxMs: number, random: () => number): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), maxMs);
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * 한 회차.
 *
 * 만료 lease 회수를 **맨 앞에서** 한다. `claimDueCommitLinks`는 `lease_until`을 보지
 * 않으므로(`ready`·`retry`만 집는다), 이것을 부르는 프로세스가 하나도 없으면 죽은
 * 워커의 몫이 영영 큐에 갇힌다.
 */
export async function runCommitLinkOnce(deps: CommitLinkDeps): Promise<CommitLinkCycle> {
  const log = deps.log ?? ((): void => undefined);
  const random = deps.random ?? Math.random;
  const retryMaxMs = deps.retryMaxMs ?? LINK_RETRY_MAX_MS;
  const outcomes: Record<string, number> = {};
  const bump = (outcome: string): void => {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    deps.metrics.commitLinkProjectionTotal.inc({ outcome });
  };

  await prCommitLinkRepo.reclaimExpiredCommitLinkLeases(deps.pool);

  const rows = await prCommitLinkRepo.claimDueCommitLinks(deps.pool, {
    limit: deps.claimLimit ?? LINK_CLAIM_LIMIT,
    leaseMs: deps.leaseMs ?? LINK_LEASE_MS,
    ...(deps.repositoryId === undefined ? {} : { repositoryId: deps.repositoryId }),
  });
  if (rows.length === 0) return { claimed: 0, outcomes };

  for (const row of rows) {
    const repositoryId = Number(row.repository_id);
    const lease = { repositoryId, commitSha: row.commit_sha, leaseToken: row.lease_token as string };

    /*
     * **정본을 지금 읽는다.** claim 시점의 세대가 아니라 이 조회가 본 세대를 쓴다 —
     * 한 문장으로 읽으므로 세대와 집합이 같은 스냅숏이다.
     */
    const canonical = await prCommitLinkRepo.readCommitLinkProjection(deps.pool, repositoryId, row.commit_sha);
    if (canonical === undefined) {
      // 행이 사라졌다. 우리가 쥔 lease도 무효이므로 남길 것이 없다.
      bump('vanished');
      continue;
    }

    let outcome: CommitLinkOutcome;
    try {
      const run = async (targets: WriteTargets): Promise<CommitLinkOutcome> =>
        applyCommitLinks(
          deps.es,
          {
            repositoryId,
            commitSha: row.commit_sha,
            numbers: canonical.numbers,
            generation: canonical.generation,
            state: canonical.verified ? 'verified' : 'partial',
          },
          targets,
        );
      outcome = await deps.withWrite(run);
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error).slice(0, 200);
      const attempt = row.attempt_count;
      if (attempt >= MAX_RETRIES) {
        log({ level: 'error', message: '관계 투영이 반복 실패해 보류한다', repository_id: repositoryId, commit_sha: row.commit_sha, reason, attempt });
      }
      await prCommitLinkRepo.releaseCommitLink(deps.pool, lease, {
        state: attempt >= MAX_RETRIES ? 'parked' : 'retry',
        availableAt: new Date(nowOf(deps).getTime() + (attempt >= MAX_RETRIES ? LINK_PARK_MS : retryDelayMs(attempt, retryMaxMs, random))),
        reason,
      });
      bump('error');
      continue;
    }

    if (outcome === 'document_missing') {
      /*
       * 집합이 비어 있고 문서도 없으면 **이미 원하는 상태다.** 없는 문서에 "PR이
       * 0개"를 적을 필요가 없고, 그러자고 역할도 메시지도 없는 문서를 만들면
       * 검색 결과에 빈 커밋이 뜬다.
       */
      if (canonical.numbers.length === 0) {
        await prCommitLinkRepo.completeCommitLink(deps.pool, lease, canonical.generation, []);
        bump('absent_ok');
        continue;
      }
      const attempt = row.attempt_count;
      if (attempt >= MAX_RETRIES) {
        log({ level: 'error', message: '커밋 문서가 계속 없어 관계를 비추지 못한다', repository_id: repositoryId, commit_sha: row.commit_sha, reason: 'document_missing', attempt });
      }
      await prCommitLinkRepo.releaseCommitLink(deps.pool, lease, {
        state: attempt >= MAX_RETRIES ? 'parked' : 'retry',
        availableAt: new Date(nowOf(deps).getTime() + (attempt >= MAX_RETRIES ? LINK_PARK_MS : LINK_DOCUMENT_WAIT_MS)),
        reason: 'document_missing',
      });
      bump('document_missing');
      continue;
    }

    if (outcome === 'conflict') {
      /*
       * **덮지 않는다.** 같은 세대에 다른 집합이 있다는 것은 우리가 쓰지 않은 쓰기가
       * 있었다는 뜻이다 — 구버전 합집합 워커, 사람의 손, 또는 갈라진 정본. 증거를
       * 지우고 나면 무슨 일이 있었는지 아무도 모른다. 정본의 세대가 올라야
       * (재수집·복구) 다시 쓴다.
       */
      // 라벨 없이 센다 — 어느 커밋이었는지는 아래 로그와 `conflict_at`이 답한다.
      deps.metrics.commitLinkConflictTotal.inc();
      log({
        level: 'warn',
        message: '같은 세대에 다른 관계 집합이 색인에 있다 — 덮지 않는다',
        repository_id: repositoryId,
        commit_sha: row.commit_sha,
        generation: canonical.generation,
        numbers: canonical.numbers,
        reason: 'generation_conflict',
      });
      await prCommitLinkRepo.releaseCommitLink(deps.pool, lease, {
        state: 'parked',
        availableAt: new Date(nowOf(deps).getTime() + LINK_PARK_MS),
        reason: 'generation_conflict',
        conflict: true,
      });
      bump('conflict');
      continue;
    }

    if (outcome === 'stale') {
      /*
       * 색인의 세대가 우리 정본보다 높다. 정본이 뒤로 간 적은 없으므로 이것은
       * **다른 워커가 더 새로운 세대를 이미 썼다**는 뜻이다. 우리 몫은 지난 일이고
       * 그 워커가 완료를 기록한다. 실패가 아니다.
       */
      /*
       * **정본 세대가 그대로인데 색인이 더 높다면 비정상이다** (CR-116 / DEV-751).
       *
       * 정상 경로에서 이 자리의 뜻은 "다른 워커가 더 새로운 세대를 이미 썼다"이고,
       * 그때 우리가 읽은 세대는 방금 집은 행의 세대보다 크다. 두 값이 같다면 아무도
       * 우리를 앞지르지 않은 것이고, 그렇다면 색인의 더 높은 세대는 **PostgreSQL이
       * 되감긴 흔적**이다 — 마이그레이션 036을 되돌렸다가 다시 적용하면 세대가 1부터
       * 다시 시작하고 색인은 옛 값을 쥔 채 남는다. 조용히 완료로 접으면 그 갈라짐이
       * 영영 드러나지 않는다.
       */
      if (canonical.generation === Number(row.generation)) {
        log({
          level: 'warn',
          message: '색인의 관계 세대가 정본보다 높다 — 정본이 되감겼을 수 있다',
          repository_id: repositoryId,
          commit_sha: row.commit_sha,
          generation: canonical.generation,
          reason: 'generation_rewound',
        });
      }
      await prCommitLinkRepo.completeCommitLink(deps.pool, lease, canonical.generation, canonical.numbers);
      bump('stale');
      continue;
    }

    const acked = await prCommitLinkRepo.completeCommitLink(deps.pool, lease, canonical.generation, canonical.numbers);
    if (!acked) {
      // lease를 잃었다. 결과는 색인에 있고 다른 워커가 같은 정본으로 이어 간다.
      log({ level: 'warn', message: 'lease를 잃어 관계 투영 결과를 기록하지 못했다', repository_id: repositoryId, commit_sha: row.commit_sha, reason: 'lease_lost' });
      bump('lease_lost');
      continue;
    }
    bump(outcome);
  }

  return { claimed: rows.length, outcomes };
}

export interface CommitLinkRunner {
  readonly stop: () => Promise<void>;
}

/**
 * 러너 루프. 집은 것이 있으면 poll을 건너뛰고 바로 다음 회차로 간다 —
 * backlog를 1초에 32건씩 흘리지 않기 위해서다.
 */
export function startCommitLinkRunner(
  deps: CommitLinkDeps,
  options: { readonly pollMs?: number } = {},
): CommitLinkRunner {
  const pollMs = options.pollMs ?? 1_000;
  let stopped = false;
  let wake: () => void = () => undefined;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      let claimed = 0;
      try {
        claimed = (await runCommitLinkOnce(deps)).claimed;
      } catch (error) {
        // 회차 전체가 실패해도 루프를 끝내지 않는다 — 다음 회차가 같은 큐를 본다.
        (deps.log ?? ((): void => undefined))({
          level: 'error',
          message: '관계 투영 회차가 실패했다',
          reason: String(error instanceof Error ? error.message : error).slice(0, 200),
        });
      }
      if (stopped) break;
      if (claimed > 0) continue;
      await new Promise<void>((resolve) => {
        wake = resolve;
        const timer = setTimeout(resolve, pollMs);
        if (typeof timer.unref === 'function') timer.unref();
      });
    }
  })();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      wake();
      await loop;
    },
  };
}
