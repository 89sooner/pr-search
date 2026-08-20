/**
 * 실제 GitHub Enterprise 대상 읽기 전용 smoke (선택 실행).
 *
 * **자격 증명이 있을 때만 돈다.** 없으면 건너뛴다 — 목 서버 계약 시험이
 * 통과했다고 실제 GHE 검증까지 했다고 보고할 수는 없기 때문에, 실제 검증은
 * 별도 시험으로 분리해 실행 여부가 결과에 그대로 드러나게 한다.
 *
 * 필요한 환경 변수:
 *   GHE_BASE_URL, GHE_APP_ID, GHE_APP_PRIVATE_KEY,
 *   GHE_SMOKE_INSTALLATION_ID, GHE_SMOKE_REPO (`owner/repo`)
 *
 * Data App은 읽기 전용이다 (ADR-013). 이 시험은 쓰기 작업을 하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import {
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
  hasAppCredentials,
  resolveGitHubConfig,
} from '../src/index.js';

const config = resolveGitHubConfig();
const installationId = Number(process.env['GHE_SMOKE_INSTALLATION_ID'] ?? '');
const repoSlug = process.env['GHE_SMOKE_REPO'] ?? '';
const [owner = '', repo = ''] = repoSlug.split('/');

const runnable =
  hasAppCredentials(config) && Number.isInteger(installationId) && owner !== '' && repo !== '';

describe.skipIf(!runnable)('실제 GHE 읽기 전용 smoke (자격 증명이 있을 때만)', () => {
  it('설치 토큰을 발급하고 저장소를 조회하며 rate limit 헤더를 확인한다', async () => {
    const provider = new InstallationTokenProvider({
      apiUrl: config.apiUrl,
      appId: config.appId,
      privateKey: config.privateKey,
      refreshLeadMs: config.tokenRefreshLeadMs,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    const pool = new TokenPool(provider, {
      installations: [{ org: owner, installationId }],
      quarantineThreshold: config.quarantineThreshold,
    });
    const seen: { remaining: number | undefined; status: number }[] = [];
    const client = new GitHubClient(
      new GitHubTransport({
        apiUrl: config.apiUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        pool,
        scheduler: new RequestScheduler({ maxConcurrent: 2 }),
        onResponse: (event) => seen.push({ remaining: event.remaining, status: event.status }),
      }),
    );

    const token = await provider.getToken(installationId);
    expect(token.token).not.toBe('');
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const repository = await client.getRepository({ owner, repo });
    expect(repository.full_name.toLowerCase()).toBe(`${owner}/${repo}`.toLowerCase());

    // x-ratelimit-* 헤더가 실제로 오는지 확인한다.
    expect(seen.at(-1)?.status).toBe(200);
    expect(seen.at(-1)?.remaining).toBeTypeOf('number');

    // 토큰 값이 어디에도 새지 않는다.
    expect(JSON.stringify(seen)).not.toContain(token.token);
  }, 30_000);
});

if (!runnable) {
  // 건너뛴 사실을 조용히 넘기지 않는다. 실행 로그에 남긴다.
  process.stdout.write(
    '[smoke] 실제 GHE 자격 증명이 없어 read-only smoke를 건너뛴다 ' +
      '(GHE_APP_ID / GHE_APP_PRIVATE_KEY / GHE_SMOKE_INSTALLATION_ID / GHE_SMOKE_REPO)\n',
  );
}
