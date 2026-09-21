import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client.js';
import { GitHubApiError } from './errors.js';
import type { GitHubTransport } from './transport.js';

/**
 * `getUser` (CR-112) — PIPE 연동이 발급 때 login의 현재 숫자 ID를 대조한다.
 *
 * 404만 "없다"로 옮기고, 권한·서버 오류는 던진다. 둘을 섞으면 조회 실패가 "그런 사용자 없음"으로
 * 읽혀 신원 대조가 조용히 통과하거나 틀린 충돌로 바뀐다.
 */
describe('GitHubClient.getUser (CR-112)', () => {
  it('login을 경로 조각으로 인코딩하고 id·login만 돌려준다', async () => {
    const get = vi.fn().mockResolvedValue({ id: 1001, login: 'alice', site_admin: false, email: 'x@example.com' });
    const client = new GitHubClient({ get } as unknown as GitHubTransport);
    await expect(client.getUser('al ice', 'acme')).resolves.toEqual({ id: 1001, login: 'alice' });
    expect(get).toHaveBeenCalledWith({ org: 'acme', path: '/users/al%20ice' });
  });

  it('404는 null이다 — 없는 login은 답이다', async () => {
    const get = vi.fn().mockRejectedValue(new GitHubApiError('not_found', 'Not Found', { status: 404 }));
    const client = new GitHubClient({ get } as unknown as GitHubTransport);
    await expect(client.getUser('ghost', 'acme')).resolves.toBeNull();
  });

  it('권한·서버 오류는 던진다 — 모르는 것과 없는 것을 섞지 않는다', async () => {
    const get = vi.fn().mockRejectedValue(new GitHubApiError('auth', 'Forbidden', { status: 403 }));
    const client = new GitHubClient({ get } as unknown as GitHubTransport);
    await expect(client.getUser('alice', 'acme')).rejects.toBeInstanceOf(GitHubApiError);
  });
});
