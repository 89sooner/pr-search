/**
 * 측정 CLI의 세 모드 (WP-074 FR-SEQ-008 AC-14 / 측정 가이드 4절).
 *
 * ## 종료 코드가 사실을 말한다
 *
 * | 코드 | 뜻 |
 * | --- | --- |
 * | 0 | 정상 완전 측정 |
 * | 1 | 조회·권한 실패 |
 * | 2 | 잘못된 인자 |
 * | 3 | 자료 부족·timeout·부분·시계 이상·에폭 이동 |
 *
 * **코드 3은 서비스 실패를 단정하지 않는다** — `reason`을 읽어야 한다. 예를 들어
 * 025 이전 스키마의 `baseline`은 잴 수 있는 구간만 있는 정상 상태다.
 */

import { readFile, stat } from 'node:fs/promises';
import type { Pool } from '@prs/db';
import { formatMergeNumber, repositoryCodeOf } from '@prs/domain';
import type { MeasureArgs, WatchArgs } from './args.js';
import {
  MeasureQueryError,
  readCapability,
  readCommitToAssign,
  readPending,
  readSamples,
  withReadOnly,
  type SampleRowRaw,
} from './db.js';
import { render, SCHEMA_VERSION, TARGET_P95_MS, TARGET_P99_MS, spacesOf, type ReportDocument } from './output.js';
import { STAGES, summarizeStage } from './stats.js';

export interface RunResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

/** watch가 부르는 해석 API. 시험이 대역을 넣는다. */
export interface ResolveClient {
  resolve(input: {
    readonly repository: string;
    readonly baseBranch: string;
    readonly prNumber: number;
    readonly seqEpoch: number | null;
  }): Promise<{
    readonly status: number;
    readonly body: Record<string, unknown>;
  }>;
}

export interface RunDeps {
  readonly pool: Pool;
  readonly now?: () => Date;
  readonly resolveClient?: ResolveClient;
  readonly sleep?: (ms: number) => Promise<void>;
}

function windowOf(now: Date, windowMs: number): { from: string; to: string } {
  return { from: new Date(now.getTime() - windowMs).toISOString(), to: now.toISOString() };
}

/**
 * `baseline` — 024·025 어느 스키마에서도 돈다.
 *
 * 025가 없으면 **잴 수 있는 구간만** 답하고 그 사실을 명시한다. "0"으로 답하지
 * 않는다 — 없는 것과 0은 다른 사실이다.
 */
export async function runBaseline(args: Extract<MeasureArgs, { mode: 'baseline' }>, deps: RunDeps): Promise<RunResult> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const { capability, baseline, pending } = await withReadOnly(deps.pool, async (client) => {
    const cap = await readCapability(client);
    const base = await readCommitToAssign(client, args.windowMs);
    const pend = cap.hasCheckpoint ? await readPending(client) : null;
    return { capability: cap, baseline: base, pending: pend };
  });

  const notes = [
    '이 값은 커밋 작성 → 채번 간격이며 웹훅 수신 지연이 아니다.',
    '`6시간 스윕`은 코드의 보정 주기이지 운영 지연 상한이 아니다.',
  ];
  if (!capability.hasSamples) notes.push('025가 적용되지 않아 수신→미러·M·검색 구간은 측정할 수 없다 (unavailable).');

  const document: ReportDocument = {
    schema_version: SCHEMA_VERSION,
    mode: 'baseline',
    window: windowOf(now, args.windowMs),
    baseline,
    ...(pending === null ? {} : { pending }),
    capability,
    notes,
  };
  return {
    // 잴 수 없는 구간이 있으면 완전 측정이 아니다 — 사실을 코드로도 말한다.
    exitCode: capability.hasSamples ? 0 : 3,
    stdout: render(document, args.format),
    stderr: '',
  };
}

/** cohort별로 나눠 센다 — `all`에서도 전체 평균으로 다른 모집단을 합치지 않는다. */
function groupByCohort(rows: readonly SampleRowRaw[]): Map<string, SampleRowRaw[]> {
  const out = new Map<string, SampleRowRaw[]>();
  for (const row of rows) out.set(row.cohort, [...(out.get(row.cohort) ?? []), row]);
  return out;
}

export async function runReport(args: Extract<MeasureArgs, { mode: 'report' }>, deps: RunDeps): Promise<RunResult> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const { capability, rows, pending } = await withReadOnly(deps.pool, async (client) => {
    const cap = await readCapability(client);
    if (!cap.hasSamples) return { capability: cap, rows: [] as readonly SampleRowRaw[], pending: null };
    return { capability: cap, rows: await readSamples(client, args.windowMs, args.cohort), pending: await readPending(client) };
  });

  if (!capability.hasSamples) {
    return {
      exitCode: 3,
      stdout: render(
        {
          schema_version: SCHEMA_VERSION,
          mode: 'report',
          window: windowOf(now, args.windowMs),
          cohort: args.cohort,
          capability,
          notes: ['025가 적용되지 않아 report를 낼 수 없다. baseline을 쓴다.'],
        },
        args.format,
      ),
      stderr: '',
    };
  }

  const groups = args.cohort === 'all' ? groupByCohort(rows) : new Map([[args.cohort, [...rows]]]);
  const sections: ReportDocument[] = [];
  let anomalies = 0;
  let incomplete = 0;
  for (const [cohort, group] of groups) {
    const stages = STAGES.map((stage) => summarizeStage(stage, group));
    for (const stage of stages) {
      anomalies += stage.clock_anomaly_count;
      incomplete += stage.missing + stage.failed + stage.pending;
    }
    sections.push({
      schema_version: SCHEMA_VERSION,
      mode: 'report',
      window: windowOf(now, args.windowMs),
      cohort,
      spaces: spacesOf(group, args.detailed),
      requests: group.length,
      stages,
    });
  }

  // cohort가 하나면 구간 표를 그대로 싣고, `all`이면 아래 `notes`가 cohort별로 나눈다.
  const onlyStages = sections.length === 1 ? sections[0]?.stages : undefined;
  const document: ReportDocument = {
    schema_version: SCHEMA_VERSION,
    mode: 'report',
    window: windowOf(now, args.windowMs),
    cohort: args.cohort,
    requests: rows.length,
    ...(onlyStages === undefined ? {} : { stages: onlyStages }),
    spaces: spacesOf(rows, args.detailed),
    ...(pending === null ? {} : { pending }),
    comparison: {
      target_p95_ms: TARGET_P95_MS,
      target_p99_ms: TARGET_P99_MS,
      // 이 도구는 사내 운영을 검증하지 않는다 — 외부 측정으로 사내 검증을 대체하지 않는다.
      production_verified: false,
    },
    ...(sections.length > 1 ? { notes: sections.map((one) => `${one.cohort ?? '?'}: ${JSON.stringify(one.stages)}`) } : {}),
  };

  /*
   * 자료가 비었거나, 끝나지 않은 표본이 있거나, 시계가 어긋났으면 **완전 측정이
   * 아니다.** p95만 좋게 보이는 보고를 0으로 내보내지 않는다 (가이드 3절).
   */
  const exitCode = rows.length === 0 || incomplete > 0 || anomalies > 0 ? 3 : 0;
  return { exitCode, stdout: render(document, args.format), stderr: '' };
}

/** 세션 파일을 읽는다. 내용은 **어디에도 출력하지 않는다**. */
export async function readSessionCookie(path: string): Promise<{ cookie: string; warning: string | null }> {
  const info = await stat(path);
  const warning = (info.mode & 0o077) === 0 ? null : '세션 파일 권한이 600이 아니다';
  const raw = await readFile(path, 'utf8');
  const cookie = raw.replace(/\n$/, '');
  /*
   * 제어 문자가 섞인 값은 거절한다 — 헤더에 그대로 실으면 헤더가 갈라진다.
   * `no-control-regex`는 **실수로** 들어간 제어 문자를 잡는 규칙이고 여기서는
   * 그 문자들이 검사 대상 자체이므로, 이 줄에서만 끈다.
   */
  // eslint-disable-next-line no-control-regex
  if (cookie === '' || /[\u0000-\u001f\u007f]/.test(cookie)) {
    throw new MeasureQueryError('세션 파일이 한 줄의 cookie 헤더가 아니다');
  }
  return { cookie, warning };
}

/**
 * `watch` — 한 PR의 M이 **실제 검색에서** 보이는 시점을 관측한다.
 *
 * 에폭은 첫 성공 read에서 고정한다. 그 뒤 에폭이 움직이면 `epoch_changed`로
 * 종료하며 **자동으로 새 에폭을 다시 조회하지 않는다** (ADR-007 규칙 5).
 * `merge_number_state=assigned`만으로 끝내지 않는다 — `projection_state=in_sync`
 * 까지 확인해야 검색 반영이다 (상세 설계 7절).
 */
export async function runWatch(args: WatchArgs, deps: RunDeps): Promise<RunResult> {
  const client = deps.resolveClient;
  if (client === undefined) {
    return { exitCode: 1, stdout: '', stderr: 'MEASURE_API_BASE_URL과 MEASURE_SESSION_FILE이 필요하다\n' };
  }
  const now = deps.now ?? ((): Date => new Date());
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); }));
  const startedAt = now().getTime();
  const slug = args.repository.slice(args.repository.indexOf('/') + 1);
  const code = repositoryCodeOf(slug);

  let boundEpoch: number | null = null;
  let lastAbsentAt: string | null = null;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    const response = await client.resolve({
      repository: args.repository,
      baseBranch: args.baseBranch,
      prNumber: args.prNumber,
      seqEpoch: boundEpoch,
    });
    const body = response.body;

    if (response.status === 401) {
      return { exitCode: 1, stdout: '', stderr: '인증에 실패했다. 익명으로 다시 시도하지 않는다.\n' };
    }
    if (response.status >= 500) {
      return { exitCode: 1, stdout: '', stderr: `조회에 실패했다 (HTTP ${String(response.status)}).\n` };
    }
    if (response.status === 200 && body['epoch_stale'] === true) {
      return {
        exitCode: 3,
        stdout: render(
          { schema_version: SCHEMA_VERSION, mode: 'watch', window: windowOf(now(), 0), watch: { reason: 'epoch_changed', attempts } },
          args.format,
        ),
        stderr: '',
      };
    }
    if (response.status !== 200) {
      const reason = String((body['error'] as { detail?: { reason?: unknown } } | undefined)?.detail?.reason ?? 'not_available');
      return {
        exitCode: 3,
        stdout: render(
          { schema_version: SCHEMA_VERSION, mode: 'watch', window: windowOf(now(), 0), watch: { reason, attempts, http_status: response.status } },
          args.format,
        ),
        stderr: '',
      };
    }

    if (boundEpoch === null && typeof body['seq_epoch'] === 'number') boundEpoch = body['seq_epoch'];

    const assigned = body['merge_number_state'] === 'assigned';
    const inSync = body['merge_number_projection_state'] === 'in_sync';
    if (assigned && inSync) {
      const observedAt = now().toISOString();
      const numberText =
        typeof body['merge_number'] === 'string'
          ? body['merge_number']
          : code.kind === 'code'
            ? formatMergeNumber(code.code, 0)
            : null;
      return {
        exitCode: 0,
        stdout: render(
          {
            schema_version: SCHEMA_VERSION,
            mode: 'watch',
            window: { from: new Date(startedAt).toISOString(), to: observedAt },
            watch: {
              outcome: 'visible',
              attempts,
              poll_interval_ms: args.pollMs,
              // poll 관측은 실제 반영보다 늦을 수 있다 — 구간으로 보여 준다 (가이드 5절).
              last_absent_at: lastAbsentAt,
              first_present_at: observedAt,
              elapsed_ms: now().getTime() - startedAt,
              seq_epoch: boundEpoch,
              ...(args.detailed ? { merge_number: numberText, pr_number: args.prNumber } : {}),
            },
          },
          args.format,
        ),
        stderr: '',
      };
    }

    lastAbsentAt = now().toISOString();
    if (now().getTime() - startedAt >= args.timeoutMs) {
      return {
        exitCode: 3,
        stdout: render(
          {
            schema_version: SCHEMA_VERSION,
            mode: 'watch',
            window: { from: new Date(startedAt).toISOString(), to: now().toISOString() },
            watch: {
              outcome: assigned ? 'projection_pending' : 'pending',
              reason: typeof body['merge_number_reason'] === 'string' ? body['merge_number_reason'] : null,
              attempts,
              poll_interval_ms: args.pollMs,
              last_absent_at: lastAbsentAt,
              elapsed_ms: now().getTime() - startedAt,
            },
          },
          args.format,
        ),
        stderr: '',
      };
    }
    await sleep(args.pollMs);
  }
}

export async function runMeasure(args: MeasureArgs, deps: RunDeps): Promise<RunResult> {
  try {
    if (args.mode === 'baseline') return await runBaseline(args, deps);
    if (args.mode === 'report') return await runReport(args, deps);
    return await runWatch(args, deps);
  } catch (error) {
    /*
     * 예외 메시지에 DSN·세션·쿼리 파라미터가 섞일 수 있다. **원문을 그대로 내지
     * 않는다** — 종류와 이름만 남기고 자세한 것은 운영자의 DB 로그에서 본다.
     */
    const name = error instanceof Error ? error.name : 'Error';
    return { exitCode: 1, stdout: '', stderr: `조회에 실패했다 (${name}).\n` };
  }
}
