/**
 * `prsctl mnumber tags …` — M 번호 태그 운영 명령 (WP-100 / CR-115, FR-SEQ-012 AC-10).
 *
 * | 명령 | 하는 일 |
 * | --- | --- |
 * | `reconcile --repository o/n --base-branch b --dry-run` | 원격을 **읽기만** 해 정본과 대조한 요약을 찍는다. PG·GHE·작업 큐·감사에 아무것도 쓰지 않는다 |
 * | `reconcile --repository o/n --base-branch b` | `mnumber_tag_reconcile` 잡을 만든다(감사 `job.run`). `tag` 역할의 러너가 대조하고 누락을 durable work로 재요청한다 |
 * | `status --repository o/n --base-branch b` | 현재 에폭의 태그 상태 집계와 `tag` work 상태를 찍는다 |
 *
 * `prsctl`이 호스트 사용자 이름을 `--actor`로 넘긴다. 잡의 `requested_by`와 감사 기록에는
 * `prsctl:<actor>`가 남는다 — 재투영 명령과 같은 규율이다.
 */

import { randomUUID } from 'node:crypto';
import { auditRepo, jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, type Pool, type RepositoryRow } from '@prs/db';
import { sequenceSpaceLabel } from '@prs/domain';
import type { TagClient } from '@prs/github-tag';
import { TAG_RECONCILE_JOB, reconcileTags } from './mnumber-tag-reconcile.js';

export const TAG_COMMAND_ACTOR_PREFIX = 'prsctl:';
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type TagCommandExit = 0 | 1 | 2;

export interface TagCommandDeps {
  readonly pool: Pool;
  /** 태그 전용 App 클라이언트. dry-run에만 필요하다 — 자격이 없으면 `null`. */
  readonly client: TagClient | null;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = [
  '사용법:',
  '  mnumber-tag-cli reconcile --repository <owner/name> --base-branch <이름> [--dry-run] --actor <호스트 사용자>',
  '  mnumber-tag-cli status    --repository <owner/name> --base-branch <이름>',
];

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { positional, options };
}

function optionText(args: ParsedArgs, key: string): string | undefined {
  const value = args.options.get(key);
  return typeof value === 'string' ? value : undefined;
}

interface Target {
  readonly repository: RepositoryRow;
  readonly baseBranch: string;
  readonly label: string;
}

async function resolveTarget(args: ParsedArgs, deps: TagCommandDeps): Promise<Target | undefined> {
  const slug = optionText(args, 'repository');
  const baseBranch = optionText(args, 'base-branch');
  if (slug === undefined || baseBranch === undefined) {
    deps.err('--repository <owner/name>와 --base-branch <이름>이 필요하다.');
    return undefined;
  }
  const [owner, name, ...rest] = slug.split('/');
  if (owner === undefined || name === undefined || owner === '' || name === '' || rest.length > 0) {
    deps.err(`--repository는 owner/name 형식이다: ${slug}`);
    return undefined;
  }
  const repository = await repositoryRepo.findRepositoryBySlug(deps.pool, owner, name);
  if (repository === undefined) {
    deps.err(`등록되지 않은 저장소다: ${slug}`);
    return undefined;
  }
  if (!repository.sequence_branches.includes(baseBranch)) {
    deps.err(`채번 대상 브랜치가 아니다: ${baseBranch} (추적: ${repository.sequence_branches.join(', ') || '없음'})`);
    return undefined;
  }
  return { repository, baseBranch, label: sequenceSpaceLabel(slug, baseBranch) };
}

export async function runMnumberTagCommand(argv: readonly string[], deps: TagCommandDeps): Promise<TagCommandExit> {
  const args = parseArgs(argv);
  const command = args.positional[0];
  if (command === 'reconcile') return reconcile(args, deps);
  if (command === 'status') return status(args, deps);
  for (const line of USAGE) deps.err(line);
  return 2;
}

function printSummary(deps: TagCommandDeps, prefix: string, summary: Awaited<ReturnType<typeof reconcileTags>> & { kind: 'summary' }): void {
  const s = summary.summary;
  deps.out(`${prefix}${s.repository}@${s.base_branch} 에폭 ${String(s.seq_epoch)} 코드 ${s.code}: 정본 번호 ${String(s.db_numbered)}건, 원격 M 태그 ${String(s.remote_refs)}건${s.remote_truncated ? ' (목록 상한에서 잘림 — 부분 집계)' : ''}`);
  deps.out(`${prefix}판정: ok=${String(s.ok)} missing=${String(s.missing)} conflict=${String(s.conflict)} unexpected=${String(s.unexpected)}${s.dry_run ? '' : ` enqueued=${String(s.enqueued)}`}`);
  if (s.reopened > 0) deps.out(`${prefix}conflict였던 행 ${String(s.reopened)}건을 다시 열었다 — 원격에 없음을 확인했으므로 durable work로 재생성한다`);
  if (s.unblocked) deps.out(`${prefix}권한 차단을 풀었다 — 운영자의 명시적 대조 실행이다. 권한이 여전히 없으면 첫 생성이 다시 차단한다`);
  for (const name of s.examples.missing) deps.out(`${prefix}  missing   ${name}`);
  for (const one of s.examples.conflict) deps.out(`${prefix}  conflict  ${one.tag} 정본 ${one.expected.slice(0, 12)} 원격 ${one.found.slice(0, 12)} (${one.type})`);
  for (const name of s.examples.unexpected) deps.out(`${prefix}  unexpected ${name}`);
}

async function reconcile(args: ParsedArgs, deps: TagCommandDeps): Promise<TagCommandExit> {
  const target = await resolveTarget(args, deps);
  if (target === undefined) return 2;

  if (args.options.get('dry-run') === true) {
    if (deps.client === null) {
      deps.err('dry-run은 원격 태그 목록을 읽어야 한다 — 태그 전용 App 자격(GHE_TAG_*)이 필요하다.');
      return 2;
    }
    const outcome = await reconcileTags({ pool: deps.pool, client: deps.client }, target, { dryRun: true });
    if (outcome.kind === 'error') {
      deps.err(`[dry-run] 대조하지 못했다: ${outcome.reason}`);
      return 1;
    }
    printSummary(deps, '[dry-run] ', outcome);
    deps.out('[dry-run] 아무것도 쓰지 않았다. missing이 0이 아니면 --dry-run 없이 다시 실행해 누락 태그를 durable work로 재요청한다. conflict는 옮기지 않는다 — RUNBOOK 7.F를 따른다.');
    return 0;
  }

  const actor = optionText(args, 'actor');
  if (actor === undefined || !ACTOR_PATTERN.test(actor)) {
    deps.err('--actor <호스트 사용자>가 필요하다 (영문·숫자·`._-` 1~64자). `prsctl mnumber tags`는 이 값을 스스로 채운다.');
    return 2;
  }
  const requestedBy = `${TAG_COMMAND_ACTOR_PREFIX}${actor}`;
  const correlationId = randomUUID();
  const active = await jobRepo.findActiveJob(deps.pool, TAG_RECONCILE_JOB, target.label);
  if (active !== undefined) {
    await auditRepo.recordAudit(deps.pool, { userId: requestedBy, action: 'job.run', target: `${TAG_RECONCILE_JOB}:${target.label}`, resultCode: 'JOB_CONFLICT', correlationId });
    deps.err(`같은 공간에 활성 대조 잡이 이미 있다: job_id=${String(active.job_id)} state=${active.state}.`);
    return 1;
  }
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, target.repository.repository_id, target.baseBranch);
  const jobId = await jobRepo.enqueueJob(deps.pool, TAG_RECONCILE_JOB, target.label, requestedBy, {
    repository_id: target.repository.repository_id,
    base_branch: target.baseBranch,
    ...(space === undefined ? {} : { seq_epoch_at_request: space.seq_epoch }),
  });
  await auditRepo.recordAudit(deps.pool, { userId: requestedBy, action: 'job.run', target: `${TAG_RECONCILE_JOB}:${target.label}`, resultCode: 'created', correlationId });
  deps.out(`태그 대조 잡을 만들었다: job_id=${String(jobId)} ${target.label} (requested_by ${requestedBy})`);
  deps.out('worker-annotate(tag 역할)의 JOB-SEQ-007 러너가 원격 태그를 읽어 대조하고, 누락은 durable tag work로 다시 만든다. 다른 SHA를 가리키는 태그는 보고만 한다.');
  return 0;
}

async function status(args: ParsedArgs, deps: TagCommandDeps): Promise<TagCommandExit> {
  const target = await resolveTarget(args, deps);
  if (target === undefined) return 2;
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, target.repository.repository_id, target.baseBranch);
  if (space === undefined) {
    deps.err(`채번된 적 없는 시퀀스 공간이다: ${target.label}`);
    return 2;
  }
  const counts = await mergeSequenceRepo.countTagStates(deps.pool, { repositoryId: target.repository.repository_id, baseBranch: target.baseBranch, seqEpoch: space.seq_epoch });
  const work = await sequenceWorkRepo.listWorkForSpace(deps.pool, target.repository.repository_id, target.baseBranch, ['tag']);
  const workByState: Record<string, number> = {};
  for (const row of work) {
    if (row.seq_epoch !== space.seq_epoch) continue;
    workByState[row.state] = (workByState[row.state] ?? 0) + 1;
  }
  deps.out(`${target.label} 에폭 ${String(space.seq_epoch)} state=${space.state} tag_enabled=${String(target.repository.tag_enabled)}${target.repository.tag_blocked_at === null ? '' : ` blocked_at=${target.repository.tag_blocked_at.toISOString()} (${target.repository.tag_blocked_reason ?? ''})`}`);
  deps.out(`태그 상태: ${Object.entries(counts).map(([state, n]) => `${state}=${String(n)}`).join(' ') || '(번호 없음)'}`);
  deps.out(`tag work: ${Object.entries(workByState).map(([state, n]) => `${state}=${String(n)}`).join(' ') || '(없음)'}`);
  const jobs = await jobRepo.latestJobsByTarget(deps.pool, TAG_RECONCILE_JOB, [target.label]);
  const latest = jobs.get(target.label);
  if (latest !== undefined) deps.out(`최근 대조 잡: job_id=${String(latest.job_id)} state=${latest.state}${latest.error === null ? '' : ` error=${latest.error}`}`);
  return 0;
}
