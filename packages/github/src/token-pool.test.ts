/**
 * 토큰 풀의 격리와 lease (CR-139 판정, DEV-812).
 *
 * 사내 보고는 "rate limit 때문에 `tokenFor`가 `null`을 돌려주어 git이 인증 없이 돈다"고
 * 적었다. 워커의 `tokenFor`는 `lease`가 던질 때만 `null`로 바꾼다(`apps/pipeline-worker/src/index.ts`).
 * 이 파일은 **격리가 `lease`를 막지 않는다**는 것과 **`null`의 원인은 발급 실패**라는 것을
 * 실행 가능한 사실로 남긴다.
 *
 * 격리가 lease를 막지 않는 것은 의도다 — REST 한도 격리는 REST 요청을 보내기 전에 막는
 * 장치이고(`GitHubTransport`), 미러의 git 전송은 REST 예산을 쓰지 않는다. 격리 중에 git
 * 자격을 끊으면 사설 저장소의 fetch가 익명으로 돌아 실패할 뿐이다.
 */

import { describe, expect, it } from 'vitest';
import { TokenPool } from './token-pool.js';
import type { InstallationTokenProvider } from './token-provider.js';

const NOW = new Date('2026-10-01T00:00:00Z');

function provider(outcome: 'ok' | 'fail'): { readonly provider: InstallationTokenProvider; readonly calls: number[] } {
  const calls: number[] = [];
  const fake = {
    getToken: async (installationId: number) => {
      calls.push(installationId);
      if (outcome === 'fail') throw new Error('발급 실패 (시험)');
      return Promise.resolve({ token: 'fake-installation-token', expiresAt: new Date(NOW.getTime() + 3_600_000) });
    },
    invalidate: () => undefined,
  } as unknown as InstallationTokenProvider;
  return { provider: fake, calls };
}

function pool(outcome: 'ok' | 'fail'): { readonly pool: TokenPool; readonly calls: number[] } {
  const made = provider(outcome);
  return {
    pool: new TokenPool(made.provider, { installations: [{ org: 'acme', installationId: 7 }], quarantineThreshold: 0.1, now: () => NOW }),
    calls: made.calls,
  };
}

describe('CR-139 판정: REST 한도 격리는 git 자격 증명을 끊지 않는다 (DEV-812)', () => {
  it('**잔량이 임계 아래로 떨어져 격리돼도 lease는 토큰을 준다** — 격리 때문에 tokenFor가 null이 되지 않는다', async () => {
    const { pool: tokens } = pool('ok');
    tokens.observeResponse(7, { limit: 5_000, remaining: 10, resetAt: new Date(NOW.getTime() + 600_000), observedAt: NOW });

    expect(tokens.isAvailable('acme')).toBe(false);
    expect(tokens.availableAt('acme')).toEqual(new Date(NOW.getTime() + 600_000));
    expect((await tokens.lease('acme')).token.token).toBe('fake-installation-token');
  });

  it('**발급이 실패하면 lease가 던진다** — 워커의 tokenFor가 null로 바꾸는 것은 이 경우와 조직 미등록뿐이다', async () => {
    const failing = pool('fail');
    await expect(failing.pool.lease('acme')).rejects.toThrow('발급 실패');
    await expect(failing.pool.lease('other-org')).rejects.toThrow(/등록되지 않은 조직/);
    // 조직 미등록은 발급을 시도하지도 않는다.
    expect(failing.calls).toEqual([7]);
  });
});
