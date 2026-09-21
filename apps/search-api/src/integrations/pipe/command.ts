/**
 * PIPE 연동 운영 명령 (CR-112 / 지시서 6·7절, PSI-B09).
 *
 * ## 사람이 검증한 매핑만 넣는다
 *
 * identity binding은 이 명령으로만 바뀐다. 검색 grant로 매핑을 바꾸는 HTTP 경로는 없다. 변경 명령은
 * **기본이 dry-run**이다 — 계획만 출력하고, `--apply`가 있어야 쓴다. 충돌이 하나라도 있으면
 * `--apply`여도 **아무것도 쓰지 않는다** (전부 아니면 전무). 기존 매핑을 자동으로 덮어쓰지 않는다.
 *
 * 가져오기가 확인하는 것:
 * - 파일 안의 중복(같은 subject, 같은 사용자, 같은 GHE 계정)
 * - 배포 GHE 호스트와 같은가 (같은 숫자 ID라도 다른 호스트의 계정은 다른 사람이다, PSI-B06)
 * - `app_user`가 있고 그 `github_user_id`가 적힌 숫자 ID와 같은가 (PSI-B05·B07)
 * - 같은 subject가 다른 사용자에 묶여 있지 않은가, 같은 사용자·GHE 계정이 다른 subject에 활성으로
 *   묶여 있지 않은가 (역방향 충돌)
 *
 * 행위 주체는 `prsctl:<호스트 사용자>`이며 모든 변경이 연동 이벤트로 남는다.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { authRepo, pipeIntegrationRepo, withTransaction, type CredentialKind, type IdentityBindingRow, type Pool } from '@prs/db';
import { gheHostOf, normalizeSha256 } from './config.js';

export const PIPE_COMMAND_ACTOR_PREFIX = 'prsctl:';
const ACTOR_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SUBJECT = /^[\x21-\x7E]{1,256}$/;
const USER_ID = /^[\x21-\x7E]{1,256}$/;
const CLIENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface PipeCommandDeps {
  readonly pool: Pool;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** 배포의 GHE 기준 URL (`GHE_BASE_URL`). binding의 호스트를 이것과 대조한다. */
  readonly gheBaseUrl: string | null;
  readonly now?: () => Date;
  readonly readFile?: (path: string) => string;
}

export type PipeCommandExit = 0 | 2;

const USAGE = [
  '사용법 (변경 명령은 기본이 dry-run이다. --apply가 있어야 쓴다):',
  '  pipe-integration bindings list [--issuer <issuer>] [--status active|disabled|pending|conflict]',
  '  pipe-integration bindings import --file <json> --actor <호스트 사용자> [--apply]',
  '  pipe-integration bindings disable --issuer <issuer> --subject <subject> --reason <사유> --actor <호스트 사용자> [--apply]',
  '  pipe-integration credentials list',
  '  pipe-integration credentials revoke --client-id <id> --kind client|signing_key|certificate --id <값> --reason <사유> --actor <호스트 사용자> [--apply]',
  '  pipe-integration purge --actor <호스트 사용자> [--grant-retention-hours 24] [--context-retention-days 30] [--apply]',
].join('\n');

interface Parsed {
  readonly positional: string[];
  readonly flags: Map<string, string>;
  readonly apply: boolean;
}

function parseArgs(argv: readonly string[]): Parsed | null {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--') || flags.has(arg)) return null;
      flags.set(arg, value);
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags, apply };
}

function actorOf(parsed: Parsed, deps: PipeCommandDeps): string | null {
  const actor = parsed.flags.get('--actor');
  if (actor === undefined || !ACTOR_PATTERN.test(actor)) {
    deps.err('--actor <호스트 사용자>가 필요하다 (영문·숫자·`._-` 1~64자). 변경 기록의 "누가"를 비워 두지 않는다.');
    return null;
  }
  return `${PIPE_COMMAND_ACTOR_PREFIX}${actor}`;
}

function reasonOf(parsed: Parsed, deps: PipeCommandDeps): string | null {
  const reason = parsed.flags.get('--reason');
  if (reason === undefined || reason.trim() === '' || reason.length > 500) {
    deps.err('--reason <사유>가 필요하다 (1~500자).');
    return null;
  }
  return reason.trim();
}

export async function runPipeIntegrationCommand(argv: readonly string[], deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const parsed = parseArgs(argv);
  if (parsed === null) {
    deps.err(USAGE);
    return 2;
  }
  const [group, command] = parsed.positional;
  if (parsed.positional.length === 2 && group === 'bindings' && command === 'list') return listBindings(parsed, deps);
  if (parsed.positional.length === 2 && group === 'bindings' && command === 'import') return importBindings(parsed, deps);
  if (parsed.positional.length === 2 && group === 'bindings' && command === 'disable') return disableBinding(parsed, deps);
  if (parsed.positional.length === 2 && group === 'credentials' && command === 'list') return listCredentials(deps);
  if (parsed.positional.length === 2 && group === 'credentials' && command === 'revoke') return revokeCredential(parsed, deps);
  if (parsed.positional.length === 1 && group === 'purge') return purge(parsed, deps);
  deps.err(USAGE);
  return 2;
}

// ---------------------------------------------------------------- bindings list

function bindingLine(row: IdentityBindingRow): string {
  return [
    row.issuer,
    row.subject,
    row.prs_user_id,
    `${row.ghe_host}#${String(row.ghe_user_id)}`,
    row.status,
    `v${String(row.binding_version)}`,
    row.verified_by,
    row.verified_at.toISOString(),
    row.verification_reference,
  ].join('\t');
}

async function listBindings(parsed: Parsed, deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const status = parsed.flags.get('--status');
  if (status !== undefined && !['active', 'disabled', 'pending', 'conflict'].includes(status)) {
    deps.err('--status는 active·disabled·pending·conflict 중 하나다.');
    return 2;
  }
  const issuer = parsed.flags.get('--issuer');
  const rows = await pipeIntegrationRepo.listBindings(deps.pool, {
    ...(issuer === undefined ? {} : { issuer }),
    ...(status === undefined ? {} : { status: status as IdentityBindingRow['status'] }),
  });
  deps.out('issuer\tsubject\tprs_user_id\tghe\tstatus\tversion\tverified_by\tverified_at\treference');
  for (const row of rows) deps.out(bindingLine(row));
  if (rows.length === 0) deps.out('(binding이 없다)');
  return 0;
}

// ---------------------------------------------------------------- bindings import

interface ImportEntry {
  readonly issuer: string;
  readonly subject: string;
  readonly prsUserId: string;
  readonly gheHost: string;
  readonly gheUserId: number;
  readonly verificationReference: string;
}

export type PlanAction = 'create' | 'reactivate' | 'unchanged' | 'conflict';

export interface PlanLine {
  readonly index: number;
  readonly entry: ImportEntry | null;
  readonly action: PlanAction;
  readonly reason: string | null;
}

const ENTRY_KEYS = ['issuer', 'subject', 'prs_user_id', 'ghe_host', 'ghe_user_id', 'verification_reference'];

function parseEntry(raw: unknown): ImportEntry | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'entry_not_object';
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!ENTRY_KEYS.includes(key)) return `unknown_key_${key.slice(0, 32)}`;
  const issuer = value['issuer'];
  const subject = value['subject'];
  const prsUserId = value['prs_user_id'];
  const gheHost = value['ghe_host'];
  const gheUserId = value['ghe_user_id'];
  const reference = value['verification_reference'];
  if (typeof issuer !== 'string' || !SUBJECT.test(issuer)) return 'issuer_format';
  if (typeof subject !== 'string' || !SUBJECT.test(subject)) return 'subject_format';
  if (typeof prsUserId !== 'string' || !USER_ID.test(prsUserId)) return 'prs_user_id_format';
  if (typeof gheHost !== 'string' || gheHost === '' || gheHost.length > 253 || gheHost !== gheHost.toLowerCase()) {
    return 'ghe_host_format';
  }
  if (typeof gheUserId !== 'number' || !Number.isSafeInteger(gheUserId) || gheUserId < 1) return 'ghe_user_id_format';
  if (typeof reference !== 'string' || reference.trim() === '' || reference.length > 500) return 'verification_reference_format';
  return { issuer, subject, prsUserId, gheHost, gheUserId, verificationReference: reference.trim() };
}

/**
 * 가져오기 계획을 세운다. **쓰지 않는다.** 시험이 파일 없이 부를 수 있게 따로 둔다.
 */
export async function planImport(
  pool: Pool,
  rawEntries: unknown,
  deploymentGheHost: string,
): Promise<PlanLine[]> {
  if (!Array.isArray(rawEntries)) return [{ index: -1, entry: null, action: 'conflict', reason: 'file_not_array' }];
  const lines: PlanLine[] = [];
  const seenSubject = new Set<string>();
  const seenUser = new Set<string>();
  const seenGhe = new Set<string>();

  for (const [index, raw] of rawEntries.entries()) {
    const parsed = parseEntry(raw);
    if (typeof parsed === 'string') {
      lines.push({ index, entry: null, action: 'conflict', reason: parsed });
      continue;
    }
    const entry = parsed;
    const conflict = (reason: string): void => {
      lines.push({ index, entry, action: 'conflict', reason });
    };

    const subjectKey = `${entry.issuer}\n${entry.subject}`;
    const userKey = `${entry.issuer}\n${entry.prsUserId}`;
    const gheKey = `${entry.issuer}\n${entry.gheHost}\n${String(entry.gheUserId)}`;
    // 키를 먼저 전부 기록한다 — 앞 항목이 다른 사유로 충돌했어도 뒤 항목의 중복을 정확한 사유로 보고한다.
    const duplicateSubject = seenSubject.has(subjectKey);
    const duplicateUser = seenUser.has(userKey);
    const duplicateGhe = seenGhe.has(gheKey);
    seenSubject.add(subjectKey);
    seenUser.add(userKey);
    seenGhe.add(gheKey);
    if (duplicateSubject) { conflict('duplicate_subject_in_file'); continue; }
    if (duplicateUser) { conflict('duplicate_user_in_file'); continue; }
    if (duplicateGhe) { conflict('duplicate_ghe_account_in_file'); continue; }

    if (entry.gheHost !== deploymentGheHost) { conflict('ghe_host_mismatch'); continue; }

    const user = await authRepo.findUserById(pool, entry.prsUserId);
    if (user === null) { conflict('canonical_user_missing'); continue; }
    if (user.github_user_id === null) { conflict('ghe_user_id_unverified'); continue; }
    if (user.github_user_id !== entry.gheUserId) { conflict('ghe_user_id_mismatch'); continue; }

    const existing = await pipeIntegrationRepo.findBindingBySubject(pool, entry.issuer, entry.subject);
    if (existing !== null) {
      const same =
        existing.prs_user_id === entry.prsUserId &&
        existing.ghe_host === entry.gheHost &&
        existing.ghe_user_id === entry.gheUserId;
      if (!same) { conflict('subject_bound_to_other_user'); continue; }
      if (existing.status === 'active') {
        lines.push({ index, entry, action: 'unchanged', reason: null });
        continue;
      }
    }

    const byUser = await pipeIntegrationRepo.findActiveBindingByUser(pool, entry.issuer, entry.prsUserId);
    if (byUser !== null && byUser.subject !== entry.subject) { conflict('user_already_bound'); continue; }
    const byGhe = await pipeIntegrationRepo.findActiveBindingByGhe(pool, entry.issuer, entry.gheHost, entry.gheUserId);
    if (byGhe !== null && byGhe.subject !== entry.subject) { conflict('ghe_account_already_bound'); continue; }

    lines.push({ index, entry, action: existing === null ? 'create' : 'reactivate', reason: null });
  }
  return lines;
}

async function importBindings(parsed: Parsed, deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const actor = actorOf(parsed, deps);
  if (actor === null) return 2;
  const file = parsed.flags.get('--file');
  if (file === undefined) {
    deps.err('--file <json>이 필요하다. 형식: [{"issuer","subject","prs_user_id","ghe_host","ghe_user_id","verification_reference"}]');
    return 2;
  }
  const gheHost = gheHostOf(deps.gheBaseUrl);
  if (gheHost === null) {
    deps.err('GHE_BASE_URL이 없다 — binding의 GHE 호스트를 대조할 기준이 없다.');
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse((deps.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(file));
  } catch {
    deps.err('가져오기 파일을 JSON으로 읽을 수 없다.');
    return 2;
  }

  const plan = await planImport(deps.pool, raw, gheHost);
  deps.out('index\taction\tissuer\tsubject\tprs_user_id\tghe\treason');
  for (const line of plan) {
    const entry = line.entry;
    deps.out(
      [
        String(line.index),
        line.action,
        entry?.issuer ?? '-',
        entry?.subject ?? '-',
        entry?.prsUserId ?? '-',
        entry === null ? '-' : `${entry.gheHost}#${String(entry.gheUserId)}`,
        line.reason ?? '-',
      ].join('\t'),
    );
  }
  const conflicts = plan.filter((line) => line.action === 'conflict').length;
  const changes = plan.filter((line) => line.action === 'create' || line.action === 'reactivate');
  deps.out(`계획: 만들기 ${String(plan.filter((l) => l.action === 'create').length)}, 다시 켜기 ${String(plan.filter((l) => l.action === 'reactivate').length)}, 그대로 ${String(plan.filter((l) => l.action === 'unchanged').length)}, 충돌 ${String(conflicts)}`);

  if (conflicts > 0) {
    deps.err('충돌이 있어 아무것도 쓰지 않는다. 사람이 정리한 뒤 다시 실행한다 — 기존 매핑을 자동으로 덮어쓰지 않는다.');
    return 2;
  }
  if (!parsed.apply) {
    deps.out('dry-run이다. 쓰려면 --apply를 붙인다.');
    return 0;
  }

  const now = (deps.now ?? (() => new Date()))();
  const correlationId = randomUUID();
  await withTransaction(deps.pool, async (client) => {
    for (const line of changes) {
      const entry = line.entry;
      if (entry === null) continue;
      const input = {
        issuer: entry.issuer,
        subject: entry.subject,
        prsUserId: entry.prsUserId,
        gheHost: entry.gheHost,
        gheUserId: entry.gheUserId,
        verifiedBy: actor,
        verifiedAt: now,
        verificationReference: entry.verificationReference,
      };
      const row =
        line.action === 'create'
          ? await pipeIntegrationRepo.insertBinding(client, input)
          : await pipeIntegrationRepo.reactivateBinding(client, input);
      if (row === null) throw new Error('다시 켤 binding이 그 사이에 바뀌었다 — 다시 실행한다');
      await pipeIntegrationRepo.recordEvent(client, {
        eventType: 'binding.import',
        resultCode: line.action,
        issuer: row.issuer,
        subject: row.subject,
        prsUserId: row.prs_user_id,
        bindingVersion: row.binding_version,
        correlationId,
        actor,
        occurredAt: now,
      });
    }
  });
  deps.out(`적용했다: ${String(changes.length)}건 (correlation ${correlationId}).`);
  return 0;
}

// ---------------------------------------------------------------- bindings disable

async function disableBinding(parsed: Parsed, deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const actor = actorOf(parsed, deps);
  if (actor === null) return 2;
  const reason = reasonOf(parsed, deps);
  if (reason === null) return 2;
  const issuer = parsed.flags.get('--issuer');
  const subject = parsed.flags.get('--subject');
  if (issuer === undefined || subject === undefined) {
    deps.err('--issuer와 --subject가 필요하다.');
    return 2;
  }
  const existing = await pipeIntegrationRepo.findBindingBySubject(deps.pool, issuer, subject);
  if (existing === null) {
    deps.err('그 binding이 없다.');
    return 2;
  }
  deps.out(bindingLine(existing));
  if (existing.status === 'disabled') {
    deps.out('이미 꺼져 있다. 바꿀 것이 없다.');
    return 0;
  }
  if (!parsed.apply) {
    deps.out(`dry-run이다: 상태 ${existing.status} → disabled, 버전 v${String(existing.binding_version)} → v${String(existing.binding_version + 1)}. 쓰려면 --apply를 붙인다.`);
    return 0;
  }
  const now = (deps.now ?? (() => new Date()))();
  const correlationId = randomUUID();
  const row = await withTransaction(deps.pool, async (client) => {
    const changed = await pipeIntegrationRepo.disableBinding(client, { issuer, subject, now });
    if (changed !== null) {
      await pipeIntegrationRepo.recordEvent(client, {
        eventType: 'binding.disable',
        resultCode: 'disabled',
        issuer,
        subject,
        prsUserId: changed.prs_user_id,
        bindingVersion: changed.binding_version,
        correlationId,
        actor,
        detail: { reason: reason.slice(0, 200) },
        occurredAt: now,
      });
    }
    return changed;
  });
  deps.out(row === null ? '그 사이에 이미 꺼졌다.' : `껐다: v${String(row.binding_version)}. 이 binding의 grant는 다음 요청부터 거절된다.`);
  return 0;
}

// ---------------------------------------------------------------- credentials

async function listCredentials(deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const rows = await pipeIntegrationRepo.listCredentialRevocations(deps.pool);
  deps.out('client_id\tkind\tid\trevoked_by\trevoked_at\treason');
  for (const row of rows) {
    deps.out([row.client_id, row.credential_kind, row.credential_id, row.revoked_by, row.revoked_at.toISOString(), row.reason].join('\t'));
  }
  if (rows.length === 0) deps.out('(긴급 회수된 자격이 없다)');
  return 0;
}

async function revokeCredential(parsed: Parsed, deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const actor = actorOf(parsed, deps);
  if (actor === null) return 2;
  const reason = reasonOf(parsed, deps);
  if (reason === null) return 2;
  const clientId = parsed.flags.get('--client-id');
  const kind = parsed.flags.get('--kind');
  let id = parsed.flags.get('--id');
  if (clientId === undefined || !CLIENT_ID.test(clientId)) {
    deps.err('--client-id가 필요하다 (소문자·숫자·._- 1~64자).');
    return 2;
  }
  if (kind !== 'client' && kind !== 'signing_key' && kind !== 'certificate') {
    deps.err('--kind는 client·signing_key·certificate 중 하나다.');
    return 2;
  }
  if (kind === 'client') id ??= clientId;
  if (id === undefined) {
    deps.err('--id가 필요하다 (signing_key는 kid, certificate는 SHA-256 지문).');
    return 2;
  }
  if (kind === 'client' && id !== clientId) {
    deps.err('client 회수의 --id는 --client-id와 같아야 한다.');
    return 2;
  }
  if (kind === 'signing_key' && !KID.test(id)) {
    deps.err('kid 형식이 틀렸다.');
    return 2;
  }
  if (kind === 'certificate') {
    const normalized = normalizeSha256(id);
    if (normalized === null) {
      deps.err('인증서 SHA-256 지문 형식이 틀렸다.');
      return 2;
    }
    id = normalized;
  }
  deps.out(`대상: ${clientId}\t${kind}\t${id}`);
  deps.out('효력: 이 자격으로 발급된 grant가 남은 수명과 무관하게 다음 요청부터 거절되고, 새 발급도 막힌다. 되돌리지 않는다 — 새 키·인증서·client로 교체한다.');
  if (!parsed.apply) {
    deps.out('dry-run이다. 쓰려면 --apply를 붙인다.');
    return 0;
  }
  const now = (deps.now ?? (() => new Date()))();
  const correlationId = randomUUID();
  const credentialKind: CredentialKind = kind;
  const outcome = await withTransaction(deps.pool, async (client) => {
    const result = await pipeIntegrationRepo.insertCredentialRevocation(client, {
      clientId,
      kind: credentialKind,
      credentialId: id,
      reason,
      revokedBy: actor,
      now,
    });
    if (result === 'created') {
      await pipeIntegrationRepo.recordEvent(client, {
        eventType: 'credential.revoke',
        resultCode: credentialKind,
        clientId,
        correlationId,
        actor,
        detail: { credential_kind: credentialKind, credential_id: id.slice(0, 128), reason: reason.slice(0, 200) },
        occurredAt: now,
      });
    }
    return result;
  });
  deps.out(outcome === 'created' ? `회수했다 (correlation ${correlationId}).` : '이미 회수되어 있다. 바꿀 것이 없다.');
  return 0;
}

// ---------------------------------------------------------------- purge

function positiveNumberFlag(parsed: Parsed, name: string, fallback: number, min: number): number | null {
  const raw = parsed.flags.get(name);
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

async function purge(parsed: Parsed, deps: PipeCommandDeps): Promise<PipeCommandExit> {
  const actor = actorOf(parsed, deps);
  if (actor === null) return 2;
  const grantHours = positiveNumberFlag(parsed, '--grant-retention-hours', 24, 1);
  // 회수 표식은 원 로그인 자격 만료 뒤에도 보존 기간을 둔다 — 최소 1일.
  const contextDays = positiveNumberFlag(parsed, '--context-retention-days', 30, 1);
  if (grantHours === null || contextDays === null) {
    deps.err('보존 기간은 양의 정수다 (grant 1시간 이상, 문맥 1일 이상).');
    return 2;
  }
  const now = (deps.now ?? (() => new Date()))();
  const result = await pipeIntegrationRepo.purgeExpired(deps.pool, {
    grantsExpiredBefore: new Date(now.getTime() - grantHours * 3_600_000),
    contextsIdleBefore: new Date(now.getTime() - contextDays * 86_400_000),
    dryRun: !parsed.apply,
  });
  deps.out(`${parsed.apply ? '지웠다' : 'dry-run — 지울 대상'}: grant ${String(result.grants)}건, 로그인 문맥 ${String(result.contexts)}건`);
  if (parsed.apply) {
    await pipeIntegrationRepo.recordEvent(deps.pool, {
      eventType: 'maintenance.purge',
      resultCode: 'purged',
      correlationId: randomUUID(),
      actor,
      detail: { grants: result.grants, contexts: result.contexts, grant_retention_hours: grantHours, context_retention_days: contextDays },
      occurredAt: now,
    });
  } else {
    deps.out('쓰려면 --apply를 붙인다.');
  }
  return 0;
}
