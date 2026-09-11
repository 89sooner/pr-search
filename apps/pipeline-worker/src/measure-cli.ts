#!/usr/bin/env node
/**
 * `prs-measure-sequence-latency` — 사내 읽기 전용 지연 측정 (WP-074 / FR-SEQ-008 AC-14).
 *
 * 이 진입점은 **아무것도 쓰지 않는다.** 모든 DB 트랜잭션이 `READ ONLY`이고,
 * `watch`는 기존 인증 세션으로 조회 API를 읽기만 한다. 비밀은 argv에 두지 않으며
 * DSN·세션·HTTP 헤더를 출력하지 않는다 (측정 가이드 4·5절).
 *
 * 오프라인 번들에서는 pnpm 없이 워커 이미지 안에서 실행한다:
 *
 * ```
 * docker compose run --rm --no-deps \
 *   -e MEASURE_DATABASE_URL=... worker-sequence node dist/measure-cli.js baseline --window 7d
 * ```
 */

import { createPool } from '@prs/db';
import { ArgumentError, USAGE, parseArgs, type MeasureArgs } from './measure/args.js';
import { readSessionCookie, runMeasure, type ResolveClient } from './measure/index.js';

/**
 * 인증된 해석 API 클라이언트.
 *
 * **origin 밖 리다이렉트를 따라가지 않는다** — 세션 쿠키가 다른 호스트로 나가면
 * 그것이 곧 자격 유출이다. 익명 fallback도 없다.
 */
function createResolveClient(baseUrl: string, cookie: string): ResolveClient {
  const origin = new URL(baseUrl).origin;
  return {
    async resolve(input) {
      const url = new URL('/api/v1/merge-numbers/resolve', baseUrl);
      url.searchParams.set('repository', input.repository);
      url.searchParams.set('base_branch', input.baseBranch);
      url.searchParams.set('pr_number', String(input.prNumber));
      if (input.seqEpoch !== null) url.searchParams.set('seq_epoch', String(input.seqEpoch));
      if (url.origin !== origin) throw new Error('요청 주소가 기준 origin을 벗어났다');

      const response = await fetch(url, {
        method: 'GET',
        headers: { cookie, accept: 'application/json' },
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error('리다이렉트를 따라가지 않는다');
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: response.status, body };
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  let args: MeasureArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof ArgumentError ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const databaseUrl = (process.env['MEASURE_DATABASE_URL'] ?? '').trim();
  if (databaseUrl === '') {
    process.stderr.write('MEASURE_DATABASE_URL이 필요하다 (읽기 전용 계정)\n');
    process.exitCode = 2;
    return;
  }

  let resolveClient: ResolveClient | undefined;
  if (args.mode === 'watch') {
    const baseUrl = (process.env['MEASURE_API_BASE_URL'] ?? '').trim();
    const sessionFile = (process.env['MEASURE_SESSION_FILE'] ?? '').trim();
    if (baseUrl === '' || sessionFile === '') {
      process.stderr.write('watch에는 MEASURE_API_BASE_URL과 MEASURE_SESSION_FILE이 필요하다\n');
      process.exitCode = 2;
      return;
    }
    try {
      const session = await readSessionCookie(sessionFile);
      if (session.warning !== null) process.stderr.write(`${session.warning}\n`);
      resolveClient = createResolveClient(baseUrl, session.cookie);
    } catch {
      // 파일 경로·내용을 되풀이하지 않는다 — 그 자체가 자격의 위치를 알린다.
      process.stderr.write('세션 파일을 읽을 수 없다 (한 줄의 cookie 헤더, chmod 600)\n');
      process.exitCode = 1;
      return;
    }
  }

  const pool = createPool({ connectionString: databaseUrl, application_name: 'prs-sequence-measure' });
  try {
    const result = await runMeasure(args, { pool, ...(resolveClient === undefined ? {} : { resolveClient }) });
    if (result.stdout !== '') process.stdout.write(result.stdout);
    if (result.stderr !== '') process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // 스택에 접속 문자열이 실릴 수 있다. 종류만 남긴다.
  process.stderr.write(`측정이 실패했다 (${error instanceof Error ? error.name : 'Error'})\n`);
  process.exit(1);
});
