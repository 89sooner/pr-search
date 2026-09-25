/**
 * `prsctl links plan|apply|refetch|status`의 규칙 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * | 명령 | 하는 일 | 쓰는 곳 |
 * | --- | --- | --- |
 * | `links plan` (기본) | 정본과 색인을 맞대어 무엇이 바뀔지만 센다 | **아무 데도 쓰지 않는다** |
 * | `links apply` | 바뀔 커밋에 투영 의도를 만든다. 색인은 러너가 쓴다 | PostgreSQL 작업 큐 |
 * | `links refetch` | 완전성 근거가 없는 PR만 GHE에서 다시 읽는다 | PostgreSQL 관계·관측 |
 * | `links status` | 관계 통계와 밀린 투영, 충돌·보류 수를 보여 준다 | 읽기만 |
 * | `links import-stacks` | 배포 전 서비스 인덱스의 `stacks_on` 간선을 스택 정본으로 **한 번** 옮긴다 (CR-121, OD-017) | PostgreSQL `pull_request_stack` |
 *
 * ## 복구는 재색인이 아니다
 *
 * 인덱스를 만들지도 전환하지도 않는다. `merge_seq`·`merge_number`·`seq_epoch`·`head`·
 * 원격 M 태그를 건드리지 않는다. 이 명령이 바꾸는 것은 커밋 문서의
 * `pull_request_numbers`와 그 세대, 그리고 PR 투영이 `source_commit`으로 덮은 **체인 커밋의
 * `role`**(CR-117 — 체인이 정한 값으로만, 단방향)뿐이다.
 *
 * ## `apply`는 `plan`을 다시 계산한다
 *
 * 계획을 파일로 주고받지 않는다. 계획과 실행 사이에 새 웹훅이 들어오면 그 계획은
 * 이미 낡았고, 낡은 계획을 실행하는 것이 이 CR이 고치려는 결함과 같은 종류의
 * 잘못이기 때문이다.
 */

import { randomUUID } from 'node:crypto';
import { auditRepo, jobRepo, repositoryRepo, prCommitLinkRepo, type Pool, type RepositoryRow } from '@prs/db';
import type { Client } from '@elastic/elasticsearch';
import type { GitHubClient } from '@prs/github';
import { applyLinkRepair, planLinkRepair, refetchLinkEvidence, type LinkRepairPlan } from './link-repair.js';
import { importServingStacks } from './stack-import.js';

export const LINK_REPAIR_JOB = 'pr_link_repair' as const;
export const LINK_COMMAND_ACTOR_PREFIX = 'prsctl:';
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** 한 줄에 찍을 PR 번호 상한. 넘치면 수만 알린다 — 목록이 소음이 되면 아무도 안 읽는다. */
const BLOCKING_PR_PRINT_LIMIT = 50;

export type LinkCommandExit = 0 | 1 | 2;

export interface LinkCommandDeps {
  readonly pool: Pool;
  readonly es: Client;
  /** `refetch`에만 필요하다. 없으면 그 명령만 거절한다. */
  readonly client?: GitHubClient;
  /**
   * 행위 주체. `prsctl`이 호스트 사용자 이름을 넘긴다.
   *
   * **이름 없이는 쓰는 명령을 실행하지 않는다** (`prsctl sequence`와 같은 규율). 잡의
   * `requested_by`와 감사 기록에 `prsctl:<사용자>`로 남는다. 읽기만 하는
   * `plan`·`status`에는 필요 없다 — 바꾼 것이 없으면 남길 주체도 없다.
   */
  readonly actor?: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = [
  '사용법:',
  '  prsctl links plan    --repository <owner/name> [--pr <번호>]...',
  '  prsctl links apply   --repository <owner/name> [--pr <번호>]...',
  '  prsctl links refetch --repository <owner/name> [--pr <번호>]... [--limit <수>]',
  '  prsctl links status  --repository <owner/name>',
  '  prsctl links import-stacks --repository <owner/name> [--dry-run]',
  '',
  'apply·refetch·import-stacks는 --actor(호스트 사용자 이름)가 필요하다. prsctl이 자동으로 넘긴다.',
  '',
  'plan은 PostgreSQL·Elasticsearch·작업 큐에 아무것도 쓰지 않는다. apply는 바뀔 커밋에',
  '투영 의도만 만들고 PR 연결 색인은 러너가 쓴다. 예외 하나: --pr 없이 돌리면 역할이',
  'source_commit으로 덮인 체인 커밋의 역할을 apply가 직접 되돌린다(CR-117).',
  '서수·M 번호·에폭·head·태그는 바꾸지 않는다.',
  '',
  'import-stacks는 배포 전부터 서비스 인덱스에만 있던 스택 간선(해제 이력 포함)을 스택 정본으로',
  '한 번 옮긴다. 이미 있는 관계는 덮지 않고, 서비스 인덱스는 바꾸지 않는다. 첫 prs-links 재색인',
  '전에 저장소마다 돌린다 — 돌리지 않으면 재색인의 전환 전 검증이 막는다.',
];

function parse(argv: readonly string[]): { command: string; repository?: string; prNumbers: number[]; limit?: number; actor?: string; dryRun?: true; bad?: string } {
  const prNumbers: number[] = [];
  let repository: string | undefined;
  let limit: number | undefined;
  let actor: string | undefined;
  let dryRun = false;
  let command = '';
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      if (command === '') command = token;
      continue;
    }
    // 값이 없는 깃발은 하나뿐이다.
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return { command, prNumbers, bad: `${token}에 값이 없다` };
    index += 1;
    if (token === '--repository') repository = value;
    else if (token === '--actor') actor = value;
    else if (token === '--pr') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number <= 0) return { command, prNumbers, bad: `PR 번호가 아니다: ${value}` };
      prNumbers.push(number);
    } else if (token === '--limit') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number <= 0) return { command, prNumbers, bad: `--limit이 양의 정수가 아니다: ${value}` };
      limit = number;
    } else return { command, prNumbers, bad: `알 수 없는 옵션: ${token}` };
  }
  return {
    command,
    ...(repository === undefined ? {} : { repository }),
    prNumbers,
    ...(limit === undefined ? {} : { limit }),
    ...(actor === undefined ? {} : { actor }),
    ...(dryRun ? { dryRun: true as const } : {}),
  };
}

/** 쓰는 명령의 행위 주체. 모양이 아니면 거절한다 — 감사 기록에 임의 문자열을 넣지 않는다. */
function resolveActor(deps: LinkCommandDeps): string | null {
  const actor = deps.actor ?? '';
  if (!ACTOR_PATTERN.test(actor)) {
    deps.err('--actor가 필요하다 (호스트 사용자 이름). 행위 주체 없이 관계를 바꾸지 않는다.');
    return null;
  }
  return `${LINK_COMMAND_ACTOR_PREFIX}${actor}`;
}

async function resolveRepository(
  deps: LinkCommandDeps,
  slug: string | undefined,
): Promise<RepositoryRow | LinkCommandExit> {
  if (slug === undefined) {
    deps.err('--repository가 필요하다 (owner/name)');
    return 2;
  }
  const [owner, name] = slug.split('/');
  if (owner === undefined || name === undefined || owner === '' || name === '') {
    deps.err(`저장소 형식이 아니다: ${slug}`);
    return 2;
  }
  const row = await repositoryRepo.findRepositoryBySlug(deps.pool, owner, name);
  if (row === undefined) {
    deps.err(`등록되지 않은 저장소다: ${slug}`);
    return 1;
  }
  return row;
}

function printPlan(deps: LinkCommandDeps, plan: LinkRepairPlan): void {
  deps.out(`저장소: ${plan.repository}`);
  deps.out(`훑은 커밋: ${String(plan.scanned)}`);
  // 고유 커밋 수와 간선 수는 **다른 값이다**. 커밋 하나에서 두 PR이 빠지면 커밋 1, 간선 2다.
  deps.out(`바뀔 커밋: ${String(plan.commitsChanged)} (더할 간선 ${String(plan.edgesAdded)} · 지울 간선 ${String(plan.edgesRemoved)})`);
  /*
   * 지울 간선 가운데 체인 규칙 몫 (CR-117). `git merge dev`로 받아 온 dev 체인 커밋에서 그 PR
   * 번호가 빠지는 수이며, 관측 확정 여부와 무관하게 지운다.
   */
  deps.out(`  그중 dev 체인 커밋에서 빠질 간선: ${String(plan.edgesChainExcluded)} (커밋 ${String(plan.chainExcludedCommits)})`);
  deps.out(
    plan.roleMismatches === null
      ? '역할이 source_commit으로 덮인 체인 커밋: --pr로 좁힌 실행이라 대조하지 않았다'
      : `역할이 source_commit으로 덮인 체인 커밋: ${String(plan.roleMismatches)} (apply가 체인이 정한 역할로 되돌린다)`,
  );
  deps.out(`그대로: ${String(plan.unchanged)}`);
  deps.out(`근거 없어 이번 실행에서 제외: ${String(plan.blocked)} (색인에 남는다는 보장은 아니다 — refetch로 근거를 먼저 세운다)`);
  deps.out(`대조 실패: ${String(plan.failed)}`);
  deps.out(`완전성 근거 없는 PR: ${String(plan.unverifiedPullRequests)} (prsctl links refetch로 줄인다)`);
  if (plan.blockingPullRequests.length > 0) {
    /*
     * **이 목록이 `refetch`의 범위다.** 수만 알려 주면 운영자는 저장소 전체를 다시
     * 읽을 수밖에 없고, 그것은 확정되지 않은 모든 PR을 원격에서 읽는다는 뜻이다.
     */
    const shown = plan.blockingPullRequests.slice(0, BLOCKING_PR_PRINT_LIMIT);
    const more = plan.blockingPullRequests.length - shown.length;
    deps.out(
      `  근거가 필요한 PR: ${shown.map((one) => `--pr ${String(one)}`).join(' ')}` +
        (more > 0 ? ` (${String(more)}개 더 있다 — 나눠서 돌린다)` : ''),
    );
  }
  if (plan.samples.length > 0) {
    deps.out('표본:');
    for (const sample of plan.samples) {
      deps.out(
        `  ${sample.commitSha.slice(0, 12)} 색인=[${sample.indexed.join(',')}] 정본=[${sample.canonical.join(',')}]` +
          ` 더함=[${sample.added.join(',')}] 지움=[${sample.removed.join(',')}] 체인=[${sample.chainExcluded.join(',')}]` +
          ` 보류=[${sample.withheld.join(',')}]`,
      );
    }
  }
}

export async function runLinkRepairCommand(
  argv: readonly string[],
  deps: LinkCommandDeps,
): Promise<LinkCommandExit> {
  const parsed = parse(argv);
  if (parsed.bad !== undefined) {
    deps.err(parsed.bad);
    for (const line of USAGE) deps.err(line);
    return 2;
  }
  if (parsed.command === '' || parsed.command === 'help') {
    for (const line of USAGE) deps.out(line);
    return parsed.command === '' ? 2 : 0;
  }

  const repository = await resolveRepository(deps, parsed.repository);
  if (typeof repository === 'number') return repository;
  const filter = { prNumbers: parsed.prNumbers };

  if (parsed.command === 'status') {
    const counts = await prCommitLinkRepo.countCommitLinks(deps.pool, Number(repository.repository_id));
    const pending = await prCommitLinkRepo.countPendingCommitLinks(deps.pool, Number(repository.repository_id));
    deps.out(`저장소: ${repository.owner}/${repository.name}`);
    deps.out(`관계: 커밋 ${String(counts.commits)} · 간선 ${String(counts.edges)}`);
    const entries = Object.entries(pending);
    deps.out(entries.length === 0 ? '밀린 투영: 없음' : `밀린 투영: ${entries.map(([state, count]) => `${state}=${String(count)}`).join(' ')}`);
    return 0;
  }

  if (parsed.command === 'plan') {
    printPlan(deps, await planLinkRepair({ pool: deps.pool, es: deps.es }, repository, filter));
    return 0;
  }

  if (parsed.command === 'apply') {
    const actor = resolveActor(deps);
    if (actor === null) return 2;
    const label = `${repository.owner}/${repository.name}`;
    const correlationId = randomUUID();
    /*
     * 잡 행을 남긴다 — 운영 화면의 Jobs에서 **누가 언제 무엇을 정리했는지**가 보여야 한다.
     * 이 명령이 커밋 수천 건의 PR 연결을 바꿀 수 있고, 그 사실이 터미널 출력에만 남으면
     * 나중에 「왜 사라졌나」에 답할 근거가 없다.
     */
    const active = await jobRepo.findActiveJob(deps.pool, LINK_REPAIR_JOB, label);
    if (active !== undefined) {
      await auditRepo.recordAudit(deps.pool, { userId: actor, action: 'job.run', target: `${LINK_REPAIR_JOB}:${label}`, resultCode: 'JOB_CONFLICT', correlationId });
      deps.err(`같은 저장소에 활성 복구 잡이 이미 있다: job_id=${String(active.job_id)} state=${active.state}.`);
      return 1;
    }
    await jobRepo.enqueueJob(deps.pool, LINK_REPAIR_JOB, label, actor, {
      repository_id: repository.repository_id,
      pr_numbers: parsed.prNumbers,
    });
    /*
     * **이 명령이 자기 잡을 집는다.** 비동기 러너가 따로 없으므로 큐에 넣고 끝내면
     * 아무도 집지 않는 `queued` 행이 남는다 — DEV-178·DEV-180이 두 번 밟은 함정이고,
     * 그 행이 활성 잡 제약에 걸려 이후의 복구까지 막는다. `claimNextJob`은 동시
     * 실행도 하나로 묶는다: 두 운영자가 같은 저장소를 동시에 정리하지 않는다.
     */
    const claimed = await jobRepo.claimNextJob(deps.pool, LINK_REPAIR_JOB, 1);
    if (claimed === undefined) {
      deps.err('복구 잡을 집지 못했다 — 다른 복구가 이미 돌고 있다.');
      return 1;
    }
    const jobId = claimed.job_id;
    await auditRepo.recordAudit(deps.pool, { userId: actor, action: 'job.run', target: `${LINK_REPAIR_JOB}:${label}`, resultCode: 'created', correlationId });
    try {
      // 계획을 **다시 계산한다.** 출력은 운영자가 무엇을 실행했는지 남기는 증거다.
      const plan = await planLinkRepair({ pool: deps.pool, es: deps.es }, repository, filter);
      printPlan(deps, plan);
      const result = await applyLinkRepair({ pool: deps.pool, es: deps.es }, repository, filter);
      /*
       * **조건부 전이다.** 무방비 `finishJob`은 운영자가 그 사이에 취소한 것을
       * 완료로 덮는다 (DEV-196·DEV-436).
       */
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'completed');
      deps.out(`투영 의도: ${String(result.scheduled)}건 (이미 큐에 있던 것 ${String(result.skippedStale)}건, 근거 없어 보류 ${String(result.blocked)}건)`);
      if (result.rolesRestored !== null) {
        deps.out(`체인 커밋 역할 되돌림: ${String(result.rolesRestored)}건 (source_commit → 체인이 정한 역할)`);
      }
      deps.out(`PR 연결 색인 쓰기는 관계 투영 러너가 한다. prsctl links status로 수렴을 확인한다. (job_id=${String(jobId)})`);
      return 0;
    } catch (error) {
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', String(error).slice(0, 500));
      throw error;
    }
  }

  if (parsed.command === 'refetch') {
    if (resolveActor(deps) === null) return 2;
    if (deps.client === undefined) {
      deps.err('refetch에는 GHE 자격이 필요하다 — 이 프로세스에 설정되지 않았다');
      return 1;
    }
    const result = await refetchLinkEvidence(
      { pool: deps.pool, es: deps.es, client: deps.client },
      repository,
      { ...filter, ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) },
    );
    deps.out(`다시 읽은 PR: ${String(result.attempted)}`);
    deps.out(`확정: ${String(result.verified)} · 여전히 불완전: ${String(result.stillIncomplete)} · 조회 실패: ${String(result.failed)}`);
    deps.out(`관계가 바뀐 커밋: ${String(result.affectedCommits)}`);
    if (result.stillIncomplete > 0 || result.failed > 0) {
      deps.out('불완전·실패 항목은 관계를 지우지 않는다. 사유는 pull_request_link_observation에 남는다.');
    }
    return 0;
  }

  if (parsed.command === 'import-stacks') {
    const label = `${repository.owner}/${repository.name}`;
    const print = (result: Awaited<ReturnType<typeof importServingStacks>>, dryRun: boolean): void => {
      deps.out(`저장소: ${label}`);
      deps.out(`서비스 stacks_on 간선: ${String(result.scanned)}`);
      deps.out(
        `${dryRun ? '넣을' : '넣은'} 행: ${String(result.inserted)} · 이미 있음: ${String(result.existing)} · 형식 오류로 두는 간선: ${String(result.invalid)}`,
      );
      if (dryRun) deps.out('--dry-run: 아무것도 쓰지 않았다.');
    };
    if (parsed.dryRun === true) {
      print(await importServingStacks({ pool: deps.pool, es: deps.es }, repository, { dryRun: true }), true);
      return 0;
    }
    const actor = resolveActor(deps);
    if (actor === null) return 2;
    const correlationId = randomUUID();
    // `apply`와 같은 규율이다 — 잡 행과 감사 기록을 남기고, 같은 저장소의 복구와 겹치지 않는다.
    const active = await jobRepo.findActiveJob(deps.pool, LINK_REPAIR_JOB, label);
    if (active !== undefined) {
      await auditRepo.recordAudit(deps.pool, { userId: actor, action: 'job.run', target: `${LINK_REPAIR_JOB}:${label}`, resultCode: 'JOB_CONFLICT', correlationId });
      deps.err(`같은 저장소에 활성 복구 잡이 이미 있다: job_id=${String(active.job_id)} state=${active.state}.`);
      return 1;
    }
    await jobRepo.enqueueJob(deps.pool, LINK_REPAIR_JOB, label, actor, {
      repository_id: repository.repository_id,
      operation: 'import_stacks',
    });
    const claimed = await jobRepo.claimNextJob(deps.pool, LINK_REPAIR_JOB, 1);
    if (claimed === undefined) {
      deps.err('복구 잡을 집지 못했다 — 다른 복구가 이미 돌고 있다.');
      return 1;
    }
    const jobId = claimed.job_id;
    await auditRepo.recordAudit(deps.pool, { userId: actor, action: 'job.run', target: `${LINK_REPAIR_JOB}:${label}`, resultCode: 'created', correlationId });
    try {
      const result = await importServingStacks({ pool: deps.pool, es: deps.es }, repository, { dryRun: false });
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'completed');
      print(result, false);
      deps.out(`스택 간선은 이제 정본에서 파생된다. 다음 파생이 해제 상태를 색인에 맞춘다. (job_id=${String(jobId)})`);
      return 0;
    } catch (error) {
      await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', String(error).slice(0, 500));
      throw error;
    }
  }

  deps.err(`알 수 없는 명령: ${parsed.command}`);
  for (const line of USAGE) deps.err(line);
  return 2;
}
