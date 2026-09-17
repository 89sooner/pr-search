/**
 * `prsctl mnumber attest|revoke|list`의 규칙 (CR-100 / WP-088, FR-SEQ-008 AC-15, ENT-SEQ-008).
 *
 * ## 무엇을 하는가
 *
 * | 명령 | 하는 일 |
 * | --- | --- |
 * | `attest` | (저장소, 브랜치, 에폭)에 확인서를 만들고, 감사 기록을 남기고, 채번 회차(`reconcile`)를 요청한다 — 한 트랜잭션 |
 * | `revoke` | 활성 확인서를 철회하고 감사 기록을 남긴다. 이미 지나간 근거는 그대로다 (AC-3) |
 * | `list` | 확인서를 보여 준다. 기본은 활성만, `--all`이면 철회된 것까지 |
 *
 * ## 왜 에폭을 손으로 받는가
 *
 * 확인서는 에폭에 묶인다(ADR-007). 「지금 에폭」을 기본값으로 채우면 force-push 직후에 운영자가
 * 모르는 새 에폭에 확인서를 남길 수 있다. 값을 받아 현재 에폭과 대조하고, 다르면 거절하며 현재
 * 값을 알려 준다.
 *
 * ## 행위 주체
 *
 * `prsctl`이 호스트 사용자 이름을 `--actor`로 넘긴다 (`prsctl role`과 같다). 감사 기록에는
 * `prsctl:<사용자>`로 남는다. 이름 없이는 만들지 않는다 — 행위자 없는 결정은 기록이 아니다.
 */

import { randomUUID } from 'node:crypto';
import {
  auditRepo,
  mnumberAttestationRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  type AttestationRow,
  type Pool,
} from '@prs/db';
import { DEFAULT_ATTESTATION_GRACE_SECONDS, MAX_ATTESTATION_GRACE_SECONDS } from './mnumber-attestation.js';

export const ATTEST_COMMAND_ACTOR_PREFIX = 'prsctl:';
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const REASON_MAX = 500;

export type AttestCommandExit = 0 | 1 | 2;

export interface AttestCommandDeps {
  readonly pool: Pool;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now?: () => Date;
}

const USAGE = [
  '사용법:',
  '  prsctl mnumber attest --repository-id <id> --base-branch <이름> --seq-epoch <에폭> --reason "<사유>" [--through-seq <서수>] [--grace-hours <시간>]',
  '  prsctl mnumber revoke --id <확인서 ID> --reason "<사유>"',
  '  prsctl mnumber list [--repository-id <id>] [--all]',
  '',
  '확인서는 PR 근거가 끝내 나오지 않은 항목(negative_evidence_unavailable)과 squash 프로파일 밖 항목',
  '(unsupported_merge_profile)을 번호 없이 지나가게 한다. 유예(기본 24시간)는 커밋이 브랜치에 오른',
  '시각부터 세며, 일시 실패·부분 열거·충돌은 확인서가 덮지 않는다.',
];

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options.set(key, true);
    } else {
      options.set(key, next);
      i += 1;
    }
  }
  return { positional, options };
}

function optionText(args: ParsedArgs, key: string): string | undefined {
  const value = args.options.get(key);
  return typeof value === 'string' ? value : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

function actorOf(args: ParsedArgs, deps: AttestCommandDeps): string | undefined {
  const actor = optionText(args, 'actor');
  if (actor === undefined || !ACTOR_PATTERN.test(actor)) {
    deps.err('--actor <호스트 사용자>가 필요하다 (영문·숫자·`._-` 1~64자). `prsctl mnumber`는 이 값을 스스로 채운다.');
    return undefined;
  }
  return actor;
}

function reasonOf(args: ParsedArgs, deps: AttestCommandDeps): string | undefined {
  const reason = optionText(args, 'reason')?.trim();
  if (reason === undefined || reason.length === 0 || reason.length > REASON_MAX) {
    deps.err(`--reason "<사유>"가 필요하다 (1~${String(REASON_MAX)}자). 감사 기록과 확인서에 그대로 남는다.`);
    return undefined;
  }
  return reason;
}

function describe(row: AttestationRow, repositoryLabel: string): string {
  const scope = row.through_seq === null ? '에폭 전체' : `서수 ${String(row.through_seq)}까지`;
  const grace = `${String(row.grace_seconds / 3_600)}시간`;
  return `#${String(row.attestation_id)} ${repositoryLabel} ${row.base_branch} @${String(row.seq_epoch)} · 범위 ${scope} · 유예 ${grace} · 행위자 ${row.actor}`;
}

export async function runMergeNumberAttestCommand(argv: readonly string[], deps: AttestCommandDeps): Promise<AttestCommandExit> {
  const args = parseArgs(argv);
  const command = args.positional[0];
  if (command === 'attest') return attest(args, deps);
  if (command === 'revoke') return revoke(args, deps);
  if (command === 'list') return list(args, deps);
  for (const line of USAGE) deps.err(line);
  return 2;
}

async function attest(args: ParsedArgs, deps: AttestCommandDeps): Promise<AttestCommandExit> {
  const repositoryId = positiveInt(optionText(args, 'repository-id'));
  const baseBranch = optionText(args, 'base-branch')?.trim();
  const seqEpoch = positiveInt(optionText(args, 'seq-epoch'));
  if (repositoryId === undefined || baseBranch === undefined || baseBranch.length === 0 || seqEpoch === undefined) {
    deps.err('--repository-id <양의 정수> --base-branch <이름> --seq-epoch <양의 정수>가 모두 필요하다.');
    return 2;
  }
  const throughRaw = optionText(args, 'through-seq');
  const throughSeq = throughRaw === undefined ? null : positiveInt(throughRaw);
  if (throughSeq === undefined) {
    deps.err('--through-seq는 양의 정수여야 한다 (그 서수까지 포함해 덮는다). 생략하면 에폭 전체다.');
    return 2;
  }
  const graceRaw = optionText(args, 'grace-hours');
  const graceHours = graceRaw === undefined ? DEFAULT_ATTESTATION_GRACE_SECONDS / 3_600 : Number(graceRaw);
  if (graceRaw !== undefined && (!/^[0-9]+(\.[0-9]+)?$/.test(graceRaw) || !Number.isFinite(graceHours))) {
    deps.err('--grace-hours는 0 이상의 숫자여야 한다 (기본 24).');
    return 2;
  }
  const graceSeconds = Math.round(graceHours * 3_600);
  if (graceSeconds > MAX_ATTESTATION_GRACE_SECONDS) {
    deps.err(`--grace-hours 상한은 ${String(MAX_ATTESTATION_GRACE_SECONDS / 3_600)}(30일)이다.`);
    return 2;
  }
  const reason = reasonOf(args, deps);
  if (reason === undefined) return 2;
  const actor = actorOf(args, deps);
  if (actor === undefined) return 2;

  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  if (repository === undefined) {
    deps.err(`저장소 ${String(repositoryId)}는 등록돼 있지 않다.`);
    return 2;
  }
  const label = `${repository.owner}/${repository.name}`;
  if (repository.status !== 'active') {
    deps.err(`저장소 ${label}는 활성 상태가 아니다 (${repository.status}). 확인서를 만들지 않는다.`);
    return 2;
  }
  if (!repository.sequence_branches.includes(baseBranch)) {
    deps.err(`${label}의 시퀀스 대상 브랜치는 [${repository.sequence_branches.join(', ')}]이다 — ${baseBranch}는 아니다.`);
    return 2;
  }
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
  if (space === undefined) {
    deps.err(`${label} ${baseBranch}의 시퀀스 공간이 아직 없다. 첫 채번이 끝난 뒤에 확인서를 만든다.`);
    return 2;
  }
  if (space.seq_epoch !== seqEpoch) {
    deps.err(`${label} ${baseBranch}의 현재 에폭은 ${String(space.seq_epoch)}이다 — ${String(seqEpoch)}에는 확인서를 만들지 않는다. 확인서는 에폭에 묶인다 (ADR-007).`);
    return 2;
  }
  if (throughSeq !== null && space.mnumber_blocked_seq !== null && throughSeq < Number(space.mnumber_blocked_seq)) {
    // 만들기는 하되 말해 준다 — 지금 멈춘 자리를 덮지 못하는 확인서는 「만들었다」 뒤에도 채번을 움직이지 않는다.
    deps.err(`경고: 지금 멈춘 서수는 ${String(space.mnumber_blocked_seq)}인데 --through-seq ${String(throughSeq)}는 그 앞까지만 덮는다. 이 확인서로는 채번이 다시 나아가지 않는다 — 범위를 넓히려면 revoke 뒤 다시 만든다.`);
  }
  // 감사 기록과 그 결과인 채번 회차(EVT-SEQ-004까지)를 한 상관 ID로 잇는다 (DEV-594의 규율).
  const correlationId = randomUUID();

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    let row: AttestationRow;
    try {
      row = await mnumberAttestationRepo.createAttestation(client, {
        repositoryId,
        baseBranch,
        seqEpoch,
        throughSeq,
        graceSeconds,
        actor: `${ATTEST_COMMAND_ACTOR_PREFIX}${actor}`,
        reason,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
        const active = await mnumberAttestationRepo.findActiveAttestation(deps.pool, repositoryId, baseBranch, seqEpoch);
        deps.err(`이미 활성 확인서가 있다: ${active === undefined ? '(조회 실패)' : describe(active, label)}. 범위나 유예를 바꾸려면 먼저 revoke한다.`);
        return 2;
      }
      throw error;
    }
    await auditRepo.recordAudit(client, {
      userId: row.actor,
      action: 'mnumber_attestation.create',
      target: `${label}/${baseBranch}@${String(seqEpoch)}#${String(row.attestation_id)}`,
      query: reason,
      resultCode: 'created',
      correlationId,
    });
    // 멈춰 있던 공간을 깨운다. 확인서 없이는 `negative_evidence_unavailable`이 work를 done으로 닫아 두므로 새 push가 올 때까지 아무것도 돌지 않는다.
    await sequenceWorkRepo.requestWork(client, {
      kind: 'reconcile',
      repositoryId,
      baseBranch,
      seqEpoch,
      payload: { trigger_kind: 'attestation', attestation_id: row.attestation_id, correlation_id: correlationId },
    });
    await client.query('COMMIT');
    deps.out(`확인서를 만들었다: ${describe(row, label)}`);
    deps.out('채번 회차를 요청했다. 결과는 worker-sequence 로그의 「M 채번 회차 완료」에서 attested·blocked_reason으로 본다.');
    deps.out('유예가 지나지 않은 항목은 그 시각에 다시 본다. 이미 부여된 번호는 바뀌지 않는다.');
    return 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revoke(args: ParsedArgs, deps: AttestCommandDeps): Promise<AttestCommandExit> {
  const id = positiveInt(optionText(args, 'id'));
  if (id === undefined) {
    deps.err('--id <확인서 ID>가 필요하다. `prsctl mnumber list`로 본다.');
    return 2;
  }
  const reason = reasonOf(args, deps);
  if (reason === undefined) return 2;
  const actor = actorOf(args, deps);
  if (actor === undefined) return 2;

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const row = await mnumberAttestationRepo.revokeAttestation(client, id, { actor: `${ATTEST_COMMAND_ACTOR_PREFIX}${actor}`, reason });
    if (row === undefined) {
      await client.query('ROLLBACK');
      const existing = await mnumberAttestationRepo.findAttestation(deps.pool, id);
      deps.err(existing === undefined ? `확인서 #${String(id)}는 없다.` : `확인서 #${String(id)}는 이미 ${existing.revoked_at?.toISOString() ?? ''}에 철회됐다. 바꾼 것이 없다.`);
      return 2;
    }
    const repository = await repositoryRepo.findRepositoryById(client, row.repository_id);
    const label = repository === undefined ? String(row.repository_id) : `${repository.owner}/${repository.name}`;
    await auditRepo.recordAudit(client, {
      userId: `${ATTEST_COMMAND_ACTOR_PREFIX}${actor}`,
      action: 'mnumber_attestation.revoke',
      target: `${label}/${row.base_branch}@${String(row.seq_epoch)}#${String(row.attestation_id)}`,
      query: reason,
      resultCode: 'revoked',
      correlationId: randomUUID(),
    });
    await client.query('COMMIT');
    deps.out(`확인서를 철회했다: ${describe(row, label)}`);
    deps.out('이 확인서로 이미 지나간 항목의 근거와 그 뒤에 부여된 번호는 그대로다 (AC-3). 다음 회차부터 적용하지 않는다.');
    return 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function list(args: ParsedArgs, deps: AttestCommandDeps): Promise<AttestCommandExit> {
  const repositoryRaw = optionText(args, 'repository-id');
  const repositoryId = repositoryRaw === undefined ? undefined : positiveInt(repositoryRaw);
  if (repositoryRaw !== undefined && repositoryId === undefined) {
    deps.err('--repository-id는 양의 정수여야 한다.');
    return 2;
  }
  const rows = await mnumberAttestationRepo.listAttestations(deps.pool, {
    ...(repositoryId === undefined ? {} : { repositoryId }),
    includeRevoked: args.options.get('all') === true,
  });
  if (rows.length === 0) {
    deps.out(args.options.get('all') === true ? '확인서가 없다.' : '활성 확인서가 없다. 철회된 것까지 보려면 --all.');
    return 0;
  }
  deps.out('id\trepository_id\tbase_branch\tseq_epoch\tthrough_seq\tgrace_hours\tactor\tcreated_at\trevoked_at\treason');
  for (const row of rows) {
    deps.out(
      [
        String(row.attestation_id),
        String(row.repository_id),
        row.base_branch,
        String(row.seq_epoch),
        row.through_seq === null ? '-' : String(row.through_seq),
        String(row.grace_seconds / 3_600),
        row.actor,
        row.created_at.toISOString(),
        row.revoked_at === null ? '-' : row.revoked_at.toISOString(),
        row.reason.replace(/\s+/g, ' '),
      ].join('\t'),
    );
  }
  return 0;
}
