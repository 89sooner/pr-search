#!/usr/bin/env node
/**
 * `prs-annotate-preview` — 표기를 켜기 전에 무엇이 바뀌는지 먼저 본다 (WP-075 안전성 보강).
 *
 * ## 이 진입점은 아무것도 바꾸지 않는다
 *
 * DB 트랜잭션이 `READ ONLY`이고, **GHE에는 요청을 한 건도 보내지 않는다.** 표기 상태를
 * 바꾸거나 권한 차단을 풀거나 `PATCH`를 보내는 경로가 이 파일에 없다.
 *
 * 쓰기 권한을 여기서 미리 확인해 주지 않는 이유는 **확인할 방법이 없기 때문이다** —
 * 조회가 200을 주는 것은 읽을 수 있다는 뜻일 뿐이고, 공식 API는 읽기와 쓰기를 다른
 * 권한으로 나눈다. 그래서 「확인하지 못한 것」 목록에 그 사실을 적어 낸다.
 *
 * ## 여기서 본 것이 실행을 보장하지 않는다
 *
 * 이 출력은 **측정 시각의 사진**이다. 승인 토큰이 아니며, 실제 쓰기 때 잡은 다시
 * 정본을 읽고 현재 상태로 판정한다. 사이에 새 PR이 병합되면 대상이 늘고, 재채번이
 * 들어오면 번호가 바뀐다.
 *
 * ## 왜 워커에 두는가
 *
 * 전역 스위치(`MNUMBER_ANNOTATE_ENABLED`)와 표기 전용 자격은 **표기 역할의 환경에만**
 * 있다. 조회 서비스에서 같은 이름의 변수를 읽으면 「그 값이 워커에도 같다」는 가정이
 * 필요하고, 그 가정이 틀리면 사전 점검이 거짓을 말한다. 이 명령은 그 환경 안에서 돈다:
 *
 * ```
 * docker compose run --rm --no-deps worker-annotate \
 *   node dist/annotate-preview-cli.js --repository acme/smp1900
 * ```
 */

import { createPool, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import { hasAnnotateCredentials, resolveAnnotateConfig, resolveAnnotationTarget } from '@prs/github-annotate';

interface PreviewArgs {
  readonly owner: string;
  readonly name: string;
  readonly branch: string | undefined;
  readonly json: boolean;
}

const USAGE = `사용법: annotate-preview-cli --repository <owner>/<name> [--branch <base>] [--json]

표기를 켜기 전에 무엇이 몇 건 바뀌는지 읽기 전용으로 확인한다. 아무것도 쓰지 않는다.`;

export class ArgumentError extends Error {}

export function parsePreviewArgs(argv: readonly string[]): PreviewArgs {
  let repository: string | undefined;
  let branch: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') {
      json = true;
      continue;
    }
    const value = argv[index + 1];
    if (flag === '--repository') {
      if (value === undefined) throw new ArgumentError('--repository에 값이 없다');
      repository = value;
      index += 1;
      continue;
    }
    if (flag === '--branch') {
      if (value === undefined) throw new ArgumentError('--branch에 값이 없다');
      branch = value;
      index += 1;
      continue;
    }
    throw new ArgumentError(`알 수 없는 인자다: ${String(flag)}`);
  }
  if (repository === undefined) throw new ArgumentError('--repository는 필수다');
  const parts = repository.split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new ArgumentError('--repository는 <owner>/<name> 형식이어야 한다');
  }
  return { owner: parts[0] as string, name: parts[1] as string, branch, json };
}

export interface PreviewReport {
  readonly measured_at: string;
  readonly repository: string;
  readonly repository_id: number;
  readonly spaces: readonly { readonly base_branch: string; readonly seq_epoch: number; readonly state: string }[];
  readonly counts: mergeSequenceRepo.AnnotateReadiness;
  /** 지금 회차가 실제로 집을 행 수. 상한(`sweepLimit`)까지만 센다. */
  readonly next_pass_targets: number;
  /** 그중 저장소 코드를 정할 수 없어 요청조차 나가지 않을 행. */
  readonly code_unavailable: number;
  readonly policy: {
    readonly global_switch: boolean;
    readonly repository_enabled: boolean;
    readonly blocked_at: string | null;
    readonly blocked_reason: string | null;
    readonly credentials_present: boolean;
    readonly installation_covers_owner: boolean;
  };
  /** 확인하지 못한 것. 비어 있지 않으면 「준비 완료」라고 말하지 않는다. */
  readonly unverified: readonly string[];
}

export async function buildPreview(
  pool: Parameters<typeof mergeSequenceRepo.listAnnotateTargets>[0] & { query: unknown },
  args: PreviewArgs,
): Promise<PreviewReport> {
  const config = resolveAnnotateConfig();
  const repository = await repositoryRepo.findRepositoryBySlug(pool as never, args.owner, args.name);
  if (repository === undefined) throw new ArgumentError(`등록되지 않은 저장소다: ${args.owner}/${args.name}`);

  const spaces = await sequenceSpaceRepo.listSpacesForRepositories(pool as never, [repository.repository_id]);
  const counts = await mergeSequenceRepo.countAnnotateReadiness(
    pool as never,
    repository.repository_id,
    args.branch,
  );
  /*
   * **잡이 쓰는 바로 그 질의로 센다.** 비슷한 질의를 새로 쓰면 조건이 갈리고,
   * 갈린 순간 이 출력은 「무엇이 바뀌는가」가 아니라 「무엇이 바뀔 것 같은가」가 된다.
   */
  const targets = await mergeSequenceRepo.listAnnotateTargets(pool as never, {
    limit: config.sweepLimit,
    repositoryId: repository.repository_id,
    ...(args.branch === undefined ? {} : { baseBranch: args.branch }),
    blockedBefore: new Date(Date.now() - config.blockCooldownMs),
  });
  const codeUnavailable = targets.filter(
    (row) => resolveAnnotationTarget(row.name, row.merge_number).kind === 'code_unavailable',
  ).length;

  const installationCovers = config.installations.some(
    (binding) => binding.org.toLowerCase() === args.owner.toLowerCase(),
  );
  const unverified = [
    'GHE가 이 저장소의 제목 수정을 받아들이는지 (쓰기 권한은 실제로 써 보기 전까지 확인할 수 없다)',
    '병합·잠금·아카이브된 PR의 수정 가부 (공식 문서가 보장하지 않는다)',
  ];
  if (!config.enabled) unverified.push('전역 스위치가 꺼져 있어 이 형상에서는 아무것도 쓰지 않는다');
  if (!hasAnnotateCredentials(config)) unverified.push('표기 전용 App 자격이 이 환경에 없다');
  if (!installationCovers) unverified.push(`표기 전용 App의 설치 목록에 ${args.owner} 조직이 없다`);
  if (counts.numbered === 0) {
    unverified.push('확정된 M 번호가 하나도 없다 — 채번(FR-SEQ-008)이 먼저 성립해야 한다');
  }

  return {
    measured_at: new Date().toISOString(),
    repository: `${args.owner}/${args.name}`,
    repository_id: repository.repository_id,
    spaces: spaces
      .filter((space) => args.branch === undefined || space.base_branch === args.branch)
      .map((space) => ({ base_branch: space.base_branch, seq_epoch: space.seq_epoch, state: space.state })),
    counts,
    next_pass_targets: targets.length,
    code_unavailable: codeUnavailable,
    policy: {
      global_switch: config.enabled,
      repository_enabled: repository.annotate_enabled,
      blocked_at: repository.annotate_blocked_at === null ? null : repository.annotate_blocked_at.toISOString(),
      blocked_reason: repository.annotate_blocked_reason,
      credentials_present: hasAnnotateCredentials(config),
      installation_covers_owner: installationCovers,
    },
    unverified,
  };
}

export function renderPreview(report: PreviewReport): string {
  const lines: string[] = [];
  lines.push(`저장소            ${report.repository} (id ${String(report.repository_id)})`);
  lines.push(`측정 시각         ${report.measured_at}`);
  for (const space of report.spaces) {
    lines.push(`시퀀스 공간       ${space.base_branch} · epoch ${String(space.seq_epoch)} · ${space.state}`);
  }
  lines.push('');
  lines.push(`확정 M 번호       ${String(report.counts.numbered)}`);
  lines.push(`번호 없는 PR      ${String(report.counts.unnumbered)}`);
  lines.push(`이미 표기함       ${String(report.counts.done)}`);
  lines.push(`아직 표기 안 함   ${String(report.counts.pending)}`);
  lines.push(`다른 접두라 보류  ${String(report.counts.mismatch)}`);
  lines.push(`본문 불일치 정지  ${String(report.counts.body_changed)}  (운영자 재개가 필요하다)`);
  lines.push(`결과 불명         ${String(report.counts.unknown)}`);
  lines.push(`실패              ${String(report.counts.failed)}`);
  lines.push(`해제로 표시함     ${String(report.counts.disabled)}`);
  lines.push('');
  lines.push(`다음 회차 대상    ${String(report.next_pass_targets)}  ← **켜면 이만큼의 제목이 바뀔 수 있다**`);
  lines.push(`  코드 없어 제외  ${String(report.code_unavailable)}`);
  lines.push('');
  lines.push(`전역 스위치       ${report.policy.global_switch ? '켜짐' : '꺼짐'}`);
  lines.push(`저장소 정책       ${report.policy.repository_enabled ? '허용' : '해제'}`);
  lines.push(`권한 차단         ${report.policy.blocked_at ?? '없음'}${report.policy.blocked_reason === null ? '' : ` (${report.policy.blocked_reason})`}`);
  lines.push(`표기 App 자격     ${report.policy.credentials_present ? '있음' : '없음'}`);
  lines.push(`설치 범위         ${report.policy.installation_covers_owner ? '이 조직 포함' : '이 조직 없음'}`);
  lines.push('');
  lines.push('확인하지 못한 것:');
  for (const item of report.unverified) lines.push(`  - ${item}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  let args: PreviewArgs;
  try {
    args = parsePreviewArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const pool = createPool();
  try {
    /*
     * **읽기 전용 트랜잭션.** 실수로 쓰는 코드가 들어와도 데이터베이스가 거절한다 —
     * 「아무것도 쓰지 않는다」를 주석이 아니라 세션 설정이 지키게 한다.
     */
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const report = await buildPreview(client as never, args);
      await client.query('COMMIT');
      process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderPreview(report)}\n`);
    } finally {
      client.release();
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// 직접 실행할 때만 돈다. 시험이 이 모듈의 함수를 그대로 부를 수 있어야 한다.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  void main();
}
