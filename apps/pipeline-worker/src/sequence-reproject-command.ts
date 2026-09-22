/**
 * `prsctl sequence reproject|status`의 규칙 (CR-113 / WP-098, FR-SEQ-001 AC-8, JOB-SEQ-006).
 *
 * ## 무엇을 하는가
 *
 * | 명령 | 하는 일 |
 * | --- | --- |
 * | `reproject --dry-run` | 정본과 색인을 읽어 **무엇을 쓰게 될지**만 센다. PostgreSQL·Elasticsearch·작업 큐에 아무것도 쓰지 않는다 — 감사 기록도 남기지 않는다(바뀐 것이 없다) |
 * | `reproject` | `sequence_reproject` 잡을 만들고(감사 `job.run`), 러너가 durable work를 예약해 끝낼 때까지 기다리며 상태를 찍는다. 잡 러너·durable 러너와 **같은 경로**다 — CLI만의 투영 구현은 없다 |
 * | `status` | 공간의 현재 에폭·head, 최근 재투영 잡, 이 에폭의 `project` work를 보여 준다 |
 *
 * ## 재투영은 재채번이 아니다
 *
 * 이 명령은 Git을 읽지 않고, 에폭을 올리지 않고, `merge_seq`·M 번호·head를 바꾸지 않는다.
 * `--expected-epoch`를 받아 현재 에폭과 대조하는 이유는 확인서(`prsctl mnumber attest`)와 같다 —
 * force-push 직후 운영자가 모르는 새 에폭에 손대지 않는다.
 *
 * ## 행위 주체
 *
 * `prsctl`이 호스트 사용자 이름을 `--actor`로 넘긴다. 잡의 `requested_by`와 감사 기록에는
 * `prsctl:<사용자>`로 남는다. 이름 없이는 만들지 않는다.
 */

import { randomUUID } from 'node:crypto';
import type { Client } from '@elastic/elasticsearch';
import { auditRepo, jobRepo, repositoryRepo, sequenceProjectionRepo, sequenceSpaceRepo, sequenceWorkRepo, type Pool, type RepositoryRow } from '@prs/db';
import { sequenceSpaceLabel } from '@prs/domain';
import { PROJECTION_PAGE, projectItems, resolveTargets, spaceOf, type SkippedTarget } from './sequence-projection.js';
import { REPROJECT_ALIASES, REPROJECT_JOB, type ReprojectAlias } from './sequence-reproject-runner.js';

export const REPROJECT_COMMAND_ACTOR_PREFIX = 'prsctl:';
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type ReprojectCommandExit = 0 | 1 | 2;

export interface ReprojectCommandDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

const USAGE = [
  '사용법:',
  '  prsctl sequence reproject --repository <owner/name> --base-branch <이름> --expected-epoch <에폭> [--alias prs-pull-requests|prs-commits]... [--dry-run] [--wait-seconds <초>]',
  '  prsctl sequence status --repository <owner/name> --base-branch <이름>',
  '',
  '재투영은 PostgreSQL에 확정된 머지 시퀀스를 Elasticsearch 문서에 다시 비춘다. 재채번이 아니다 —',
  '에폭·서수·M 번호·head를 바꾸지 않는다. --dry-run은 PostgreSQL·Elasticsearch·작업 큐에 아무것도 쓰지 않는다.',
];

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, readonly (string | true)[]>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, (string | true)[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    const list = options.get(key) ?? [];
    if (next === undefined || next.startsWith('--')) {
      list.push(true);
    } else {
      list.push(next);
      i += 1;
    }
    options.set(key, list);
  }
  return { positional, options };
}

function optionText(args: ParsedArgs, key: string): string | undefined {
  const value = args.options.get(key)?.[0];
  return typeof value === 'string' ? value : undefined;
}

function optionFlag(args: ParsedArgs, key: string): boolean {
  return args.options.has(key);
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

interface Target {
  readonly repository: RepositoryRow;
  readonly baseBranch: string;
  readonly label: string;
}

async function resolveTarget(args: ParsedArgs, deps: ReprojectCommandDeps): Promise<Target | undefined> {
  const slug = optionText(args, 'repository');
  const baseBranch = optionText(args, 'base-branch');
  if (slug === undefined || !slug.includes('/') || baseBranch === undefined || baseBranch === '') {
    deps.err('--repository <owner/name>과 --base-branch <이름>이 필요하다.');
    return undefined;
  }
  const slash = slug.indexOf('/');
  const repository = await repositoryRepo.findRepositoryBySlug(deps.pool, slug.slice(0, slash), slug.slice(slash + 1));
  if (repository === undefined) {
    deps.err(`등록되지 않은 저장소다: ${slug}`);
    return undefined;
  }
  if (!repository.sequence_branches.includes(baseBranch)) {
    deps.err(`채번 대상 브랜치가 아니다: ${baseBranch} (대상: ${repository.sequence_branches.join(', ')})`);
    return undefined;
  }
  return { repository, baseBranch, label: sequenceSpaceLabel(slug, baseBranch) };
}

function aliasesOf(args: ParsedArgs, deps: ReprojectCommandDeps): readonly ReprojectAlias[] | undefined {
  const raw = (args.options.get('alias') ?? []).filter((one): one is string => typeof one === 'string');
  if (raw.length === 0) return [...REPROJECT_ALIASES];
  for (const one of raw) {
    if (!(REPROJECT_ALIASES as readonly string[]).includes(one)) {
      deps.err(`--alias는 ${REPROJECT_ALIASES.join(' 또는 ')}만 받는다: ${one}`);
      return undefined;
    }
  }
  return [...new Set(raw)] as ReprojectAlias[];
}

export async function runSequenceReprojectCommand(argv: readonly string[], deps: ReprojectCommandDeps): Promise<ReprojectCommandExit> {
  const args = parseArgs(argv);
  const command = args.positional[0];
  if (command === 'reproject') return reproject(args, deps);
  if (command === 'status') return status(args, deps);
  for (const line of USAGE) deps.err(line);
  return 2;
}

function countSkips(skipped: readonly SkippedTarget[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const one of skipped) out[one.reason] = (out[one.reason] ?? 0) + 1;
  return out;
}

async function reproject(args: ParsedArgs, deps: ReprojectCommandDeps): Promise<ReprojectCommandExit> {
  const target = await resolveTarget(args, deps);
  if (target === undefined) return 2;
  const expectedEpoch = positiveInt(optionText(args, 'expected-epoch'));
  if (expectedEpoch === undefined) {
    deps.err('--expected-epoch <에폭>(양의 정수)이 필요하다. 현재 값은 `prsctl sequence status`로 본다.');
    return 2;
  }
  const aliases = aliasesOf(args, deps);
  if (aliases === undefined) return 2;
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, target.repository.repository_id, target.baseBranch);
  if (space === undefined) {
    deps.err(`채번된 적 없는 시퀀스 공간이다: ${target.label}`);
    return 2;
  }
  if (space.seq_epoch !== expectedEpoch) {
    deps.err(`--expected-epoch ${String(expectedEpoch)}가 현재 에폭 ${String(space.seq_epoch)}과 다르다. 현재 값을 확인한 뒤 다시 지정한다.`);
    return 2;
  }
  const kinds: ('commit' | 'pull_request')[] = aliases.map((alias) => (alias === 'prs-commits' ? 'commit' : 'pull_request'));

  if (optionFlag(args, 'dry-run')) {
    /*
     * 읽기 전용. 정본을 페이지로 읽고 색인의 현재 값과 대조해 "썼을 것"을 센다. 쓰기는
     * 없다 — `dryRun: true`는 투영기가 bulk를 보내지 않게 하고, 작업 큐에도 잡 행에도
     * 감사 기록에도 아무것도 남기지 않는다.
     */
    const projection = spaceOf(target.repository, target.baseBranch, space.seq_epoch);
    const counts: Record<string, number> = {};
    const samples: string[] = [];
    let cursor = 0;
    let rows = 0;
    for (;;) {
      const page = await sequenceProjectionRepo.listProjectionTargetsAfter(deps.pool, {
        repositoryId: projection.repositoryId,
        baseBranch: projection.baseBranch,
        seqEpoch: projection.seqEpoch,
        afterSeq: cursor,
        limit: PROJECTION_PAGE,
      });
      if (page.length === 0) break;
      rows += page.length;
      const resolved = resolveTargets(projection, page, 'live', kinds);
      const outcome = await projectItems({ pool: deps.pool, es: deps.es }, projection, resolved, { dryRun: true });
      counts['would_update'] = (counts['would_update'] ?? 0) + outcome.wouldUpdate.length;
      counts['already_current'] = (counts['already_current'] ?? 0) + outcome.settled.length;
      counts['stale_epoch'] = (counts['stale_epoch'] ?? 0) + outcome.staleEpoch.length;
      for (const one of outcome.pending) {
        const key = `${one.outcome.kind}${one.outcome.reason === undefined ? '' : `:${one.outcome.reason}`}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (samples.length < 20) samples.push(`${key} ${one.item.docId} seq=${String(one.item.mergeSeq)}`);
      }
      for (const one of outcome.wouldUpdate) {
        if (samples.length < 20) samples.push(`would_update ${one.docId}${one.observed === undefined ? '' : ` (현재 merge_seq=${String(one.observed.merge_seq)} seq_epoch=${String(one.observed.seq_epoch)})`}`);
      }
      for (const [reason, n] of Object.entries(countSkips(outcome.skipped))) counts[`skip_${reason}`] = (counts[`skip_${reason}`] ?? 0) + n;
      cursor = page[page.length - 1]?.merge_seq ?? cursor;
      if (page.length < PROJECTION_PAGE) break;
    }
    deps.out(`[dry-run] ${target.label} @${String(space.seq_epoch)} head_seq=${String(space.head_seq)} 정본 행 ${String(rows)}건, 대상 별칭 ${aliases.join(', ')}`);
    deps.out(`[dry-run] 판정: ${Object.entries(counts).map(([key, n]) => `${key}=${String(n)}`).join(' ') || '(대상 없음)'}`);
    for (const line of samples) deps.out(`[dry-run]   ${line}`);
    deps.out('[dry-run] 아무것도 쓰지 않았다. would_update가 0이 아니면 --dry-run 없이 다시 실행해 재투영한다.');
    return 0;
  }

  const actor = optionText(args, 'actor');
  if (actor === undefined || !ACTOR_PATTERN.test(actor)) {
    deps.err('--actor <호스트 사용자>가 필요하다 (영문·숫자·`._-` 1~64자). `prsctl sequence`는 이 값을 스스로 채운다.');
    return 2;
  }
  const requestedBy = `${REPROJECT_COMMAND_ACTOR_PREFIX}${actor}`;
  const correlationId = randomUUID();

  const active = await jobRepo.findActiveJob(deps.pool, REPROJECT_JOB, target.label);
  if (active !== undefined) {
    await auditRepo.recordAudit(deps.pool, { userId: requestedBy, action: 'job.run', target: `${REPROJECT_JOB}:${target.label}`, resultCode: 'JOB_CONFLICT', correlationId });
    deps.err(`같은 공간에 활성 재투영 잡이 이미 있다: job_id=${String(active.job_id)} state=${active.state}. \`prsctl sequence status\`로 진행을 본다.`);
    return 1;
  }
  const jobId = await jobRepo.enqueueJob(deps.pool, REPROJECT_JOB, target.label, requestedBy, {
    expected_epoch: expectedEpoch,
    aliases: [...aliases],
    repository_id: target.repository.repository_id,
    base_branch: target.baseBranch,
  });
  await auditRepo.recordAudit(deps.pool, { userId: requestedBy, action: 'job.run', target: `${REPROJECT_JOB}:${target.label}`, resultCode: 'created', correlationId });
  deps.out(`재투영 잡을 만들었다: job_id=${String(jobId)} ${target.label} @${String(expectedEpoch)} 별칭 ${aliases.join(', ')} (requested_by ${requestedBy})`);
  deps.out('worker-sequence의 JOB-SEQ-006 러너가 durable project(full) work를 예약하고 완료를 기다린다. 에폭·서수·M 번호는 바뀌지 않는다.');

  const waitSeconds = positiveInt(optionText(args, 'wait-seconds')) ?? 1_800;
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? ((): Date => new Date());
  const deadline = now().getTime() + waitSeconds * 1_000;
  let lastLine = '';
  for (;;) {
    const job = await jobRepo.findJobById(deps.pool, jobId);
    if (job === undefined) {
      deps.err('잡 행이 사라졌다.');
      return 1;
    }
    const progress = job.progress as Record<string, unknown>;
    const line = `job ${String(jobId)} ${job.state} projection=${String(progress['projection'] ?? 'queued')} work=${String(progress['work_state'] ?? '-')} cursor_seq=${String(progress['cursor_seq'] ?? 0)} pending_docs=${String(progress['pending_documents'] ?? '-')} counts=${JSON.stringify(progress['counts'] ?? {})}`;
    if (line !== lastLine) {
      deps.out(line);
      lastLine = line;
    }
    if (job.state === 'completed') {
      deps.out('재투영이 끝났다. 새 검색 요청으로 정렬·seq 범위를 확인한다 — 기존 cursor/PIT는 이전 스냅숏을 유지한다.');
      return 0;
    }
    if (job.state === 'failed' || job.state === 'cancelled') {
      deps.err(`재투영 잡이 ${job.state}로 끝났다: ${job.error ?? '(사유 없음)'}`);
      return 1;
    }
    if (now().getTime() >= deadline) {
      deps.err(`${String(waitSeconds)}초 안에 끝나지 않았다 — 잡 ${String(jobId)}과 durable work는 계속 돈다. \`prsctl sequence status\`로 본다.`);
      return 2;
    }
    await sleep(2_000);
  }
}

async function status(args: ParsedArgs, deps: ReprojectCommandDeps): Promise<ReprojectCommandExit> {
  const target = await resolveTarget(args, deps);
  if (target === undefined) return 2;
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, target.repository.repository_id, target.baseBranch);
  if (space === undefined) {
    deps.out(`${target.label}: 채번된 적 없는 시퀀스 공간이다.`);
    return 0;
  }
  deps.out(`${target.label}: seq_epoch=${String(space.seq_epoch)} head_seq=${String(space.head_seq)} head_sha=${space.head_sha ?? '-'} state=${space.state}`);
  const jobs = (await jobRepo.listJobs(deps.pool, { type: REPROJECT_JOB, limit: 50 })).filter((job) => job.target === target.label).slice(0, 5);
  deps.out(jobs.length === 0 ? '최근 재투영 잡 없음' : '최근 재투영 잡:');
  for (const job of jobs) {
    const progress = job.progress as Record<string, unknown>;
    deps.out(`  job ${String(job.job_id)} ${job.state} epoch=${String(progress['expected_epoch'] ?? '-')} projection=${String(progress['projection'] ?? '-')} pending_docs=${String(progress['pending_documents'] ?? '-')} error=${job.error ?? '-'}`);
  }
  const works = (await sequenceWorkRepo.listWorkForSpace(deps.pool, target.repository.repository_id, target.baseBranch, ['project'])).filter((row) => row.seq_epoch === space.seq_epoch);
  deps.out(works.length === 0 ? '이 에폭의 project work 없음' : `이 에폭의 project work ${String(works.length)}건:`);
  for (const row of works.slice(0, 50)) {
    const progress = row.progress as Record<string, unknown>;
    deps.out(`  ${row.work_key} ${row.state} gen=${String(row.completed_generation)}/${String(row.requested_generation)} attempts=${String(row.attempt_count)} cursor_seq=${String(progress['cursor_seq'] ?? '-')} reason=${row.last_reason ?? '-'}`);
  }
  return 0;
}
