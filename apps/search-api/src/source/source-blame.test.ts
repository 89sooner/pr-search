/**
 * CR-135 / FR-SRC-005: 고정 revision의 파일 blame(API-SRC-006) — 서비스와 경로.
 *
 * 대역 리더로 기능 게이트·입력·접근 순서·응답 모양·오류 매핑·감사를 본다. 실제 HTTP(GHE 대역의 `POST /api/graphql`)를
 * 거치는 귀속 계산과 오류 주입은 통합 시험(`integration/source/source-blame.test.ts`)이 본다.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { UnauthenticatedError } from '@prs/authz';
import { GitHubApiError, SourceBlameUnsupportedError, type GitHubSourceReader, type SourceBlame as GitHubBlame } from '@prs/github';
import type { SourceBlame } from '@prs/contracts';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { registerSourceRoutes } from './routes.js';
import { sourceBlame } from './service.js';

vi.mock('../auth/principal.js', () => ({ authenticateSession: vi.fn() }));
vi.mock('../sequence/space.js', () => ({ resolveRepository: vi.fn() }));
vi.mock('../audit/recorder.js', () => ({ recordAuditBestEffort: vi.fn() }));

const SHA = 'a'.repeat(40); const ALICE = 'b'.repeat(40); const CAROL = 'c'.repeat(40); const BOT = 'd'.repeat(40); const TREE = 'e'.repeat(40);
const repo = { owner: 'acme', repo: 'app' };
const PATH = 'src/pay.ts';
const HEADLINE = 'init: secret-headline';

/**
 * 리더가 돌려준 blame (GitHub 순서 그대로). 둘째 구간의 작성자는 이메일과 맞는 GHE 계정이 없고(login `null`), 셋째 구간은
 * GitHub가 작성자를 주지 않았다(이름·login 모두 `null`). age는 일부러 단조롭지 않다 — 순서를 다시 매기면 드러난다.
 */
const BLAME: GitHubBlame = {
  revision: SHA,
  path: PATH,
  ranges: [
    { startLine: 1, endLine: 2, age: 10, commit: { sha: ALICE, messageHeadline: HEADLINE, authorName: 'Alice Kim', authorLogin: 'alice', authoredAt: '2026-01-01T00:00:00Z', committedAt: '2026-01-02T00:00:00Z' } },
    { startLine: 3, endLine: 3, age: 1, commit: { sha: CAROL, messageHeadline: 'feat: tail', authorName: 'carol', authorLogin: null, authoredAt: '2026-01-03T00:00:00Z', committedAt: '2026-01-04T00:00:00Z' } },
    { startLine: 4, endLine: 7, age: 5, commit: { sha: BOT, messageHeadline: 'chore: generated', authorName: null, authorLogin: null, authoredAt: '2026-01-05T00:00:00Z', committedAt: '2026-01-05T00:00:00Z' } },
  ],
};
const DTO: SourceBlame = {
  repository: 'acme/app',
  revision: SHA,
  path: PATH,
  provider: 'github_graphql',
  ranges: [
    { start_line: 1, end_line: 2, age: 10, commit: { sha: ALICE, message_headline: HEADLINE, author_name: 'Alice Kim', author_login: 'alice', authored_at: '2026-01-01T00:00:00Z', committed_at: '2026-01-02T00:00:00Z' } },
    { start_line: 3, end_line: 3, age: 1, commit: { sha: CAROL, message_headline: 'feat: tail', author_name: 'carol', author_login: null, authored_at: '2026-01-03T00:00:00Z', committed_at: '2026-01-04T00:00:00Z' } },
    { start_line: 4, end_line: 7, age: 5, commit: { sha: BOT, message_headline: 'chore: generated', author_name: null, author_login: null, authored_at: '2026-01-05T00:00:00Z', committed_at: '2026-01-05T00:00:00Z' } },
  ],
};

const blameUrl = (query: string, repository = 'acme%2Fapp') => `/api/v1/source/${repository}/blame${query === '' ? '' : `?${query}`}`;
const VALID = `path=${encodeURIComponent(PATH)}&revision=${SHA}`;
const lastAudit = () => vi.mocked(recordAuditBestEffort).mock.calls.at(-1)?.[1];

interface RequestOptions { readonly blameEnabled?: boolean; readonly blame?: Mock; readonly deadlineMs?: number }

/** 경로 하나를 세운다. 리더에는 blame과(게이트가 blame만 막는지 보려고) tree·file이 쓰는 메서드가 있다. */
async function request(url: string, options: RequestOptions = {}) {
  const methods = {
    blame: options.blame ?? vi.fn().mockResolvedValue(BLAME),
    repository: vi.fn().mockResolvedValue({ default_branch: 'main' }),
    branch: vi.fn().mockResolvedValue({ commit: { sha: SHA } }),
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
    tree: vi.fn().mockResolvedValue({ sha: TREE, tree: [] }),
    content: vi.fn().mockResolvedValue({ type: 'file', size: 3, sha: SHA, encoding: 'base64', content: Buffer.from('ok\n').toString('base64') }),
  };
  const readerFactory = vi.fn(() => methods as unknown as GitHubSourceReader);
  const scopes = { resolve: vi.fn().mockResolvedValue({ kind: 'explicit', repositoryIds: [1] }) };
  const app = Fastify();
  registerSourceRoutes(app, {
    pool: {} as Pool, auth: { sessions: {}, scopes } as unknown as AuthContext, loginPath: '/auth/login', reader: readerFactory,
    ...(options.blameEnabled === undefined ? {} : { blameEnabled: options.blameEnabled }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  try { return { response: await app.inject({ method: 'GET', url }), methods, readerFactory, scopes }; } finally { await app.close(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateSession).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof authenticateSession>>);
  vi.mocked(resolveRepository).mockResolvedValue({ kind: 'ok', repository: {} } as Awaited<ReturnType<typeof resolveRepository>>);
});

describe('CR-135 FR-SRC-005 blame 서비스 — GitHub가 계산한 귀속을 그대로 옮긴다', () => {
  it('CR-135 FR-SRC-005 줄 구간을 GitHub 순서 그대로 DTO로 옮기고, 없는 작성자 이름·계정을 채우지 않는다(null 그대로)', async () => {
    const blame = vi.fn().mockResolvedValue(BLAME);
    const signal = new AbortController().signal;
    const result = await sourceBlame({ blame } as unknown as GitHubSourceReader, repo, { revision: SHA, path: PATH }, { signal });
    expect(result).toEqual(DTO);
    expect(blame).toHaveBeenCalledWith(repo, SHA, PATH, { signal });
    // 계정이 없는 작성자의 login을 이름으로 짐작하지 않는다.
    expect(result.ranges.map(range => range.commit.author_login)).toEqual(['alice', null, null]);
  });

  it('CR-135 FR-SRC-005 revision은 GitHub가 확인한 커밋 SHA다 — 대문자로 청해도 응답은 GitHub가 준 소문자 SHA다', async () => {
    const blame = vi.fn().mockResolvedValue(BLAME);
    const result = await sourceBlame({ blame } as unknown as GitHubSourceReader, repo, { revision: SHA.toUpperCase(), path: PATH });
    expect(blame).toHaveBeenCalledWith(repo, SHA.toUpperCase(), PATH, {});
    expect(result.revision).toBe(SHA);
  });

  it('CR-135 FR-SRC-005 빈 파일은 구간이 없는 blame이다', async () => {
    const blame = vi.fn().mockResolvedValue({ revision: SHA, path: 'empty.txt', ranges: [] });
    expect(await sourceBlame({ blame } as unknown as GitHubSourceReader, repo, { revision: SHA, path: 'empty.txt' })).toEqual({ repository: 'acme/app', revision: SHA, path: 'empty.txt', provider: 'github_graphql', ranges: [] });
  });
});

describe('CR-135 FR-SRC-005 blame 기능 게이트 — 꺼진 배포(기본)', () => {
  const DISABLED = { error: { code: 'NOT_FOUND', message: 'Blame is not enabled on this deployment.', detail: { reason: 'feature_disabled' } }, correlation_id: expect.any(String) };

  it.each([
    ['부재(기본)', undefined],
    ['false', false],
  ] as const)('CR-135 FR-SRC-005 게이트가 %s이면 형식이 틀린 요청까지 모두 같은 404 feature_disabled이고 범위·리더를 보지 않는다', async (_label, blameEnabled) => {
    for (const url of [
      blameUrl(VALID), blameUrl(VALID, 'acme'), blameUrl(VALID, 'other%2Fsecret'), blameUrl(`path=${PATH}&revision=abc1234`),
      blameUrl(`${VALID}&ref=main`), blameUrl(''), blameUrl(`path=..%2Fx&revision=${SHA}`),
    ]) {
      const { response, readerFactory, scopes } = await request(url, blameEnabled === undefined ? {} : { blameEnabled });
      expect({ url, status: response.statusCode }).toEqual({ url, status: 404 });
      expect(response.json()).toEqual(DISABLED);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(readerFactory).not.toHaveBeenCalled();
      expect(scopes.resolve).not.toHaveBeenCalled();
    }
    expect(resolveRepository).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: 'entity.view', target: 'source:blame:acme/app', resultCode: 'NOT_FOUND' });
  });

  it('CR-135 FR-SRC-005 게이트가 꺼져 있어도 세션 확인이 먼저다 — 세션이 없으면 401이다', async () => {
    vi.mocked(authenticateSession).mockRejectedValueOnce(new UnauthenticatedError('missing'));
    const { response, readerFactory } = await request(blameUrl(VALID));
    expect(response.statusCode).toBe(401);
    expect(response.json().error.detail?.reason).not.toBe('feature_disabled');
    expect(readerFactory).not.toHaveBeenCalled();
  });

  it('CR-135 FR-SRC-005 게이트는 blame만 막는다 — 같은 배포의 tree·file 조회는 그대로 200이다', async () => {
    expect((await request('/api/v1/source/acme%2Fapp/tree?ref=main')).response.statusCode).toBe(200);
    const file = await request(`/api/v1/source/acme%2Fapp/file?path=a.txt&revision=${SHA}`);
    expect(file.response.statusCode).toBe(200);
    expect(file.response.json().text).toBe('ok\n');
  });
});

describe('CR-135 FR-SRC-005 blame 경로 — 게이트 켜짐', () => {
  it('CR-135 FR-SRC-005 파일 경로와 고정 revision으로 blame을 no-store로 주고, 감사에는 경로·revision만 남긴다(구간은 남기지 않는다)', async () => {
    const { response, methods } = await request(blameUrl(VALID), { blameEnabled: true });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual(DTO);
    expect(methods.blame).toHaveBeenCalledTimes(1);
    expect(methods.blame).toHaveBeenCalledWith(repo, SHA, PATH, { signal: expect.any(AbortSignal) });
    const audit = lastAudit();
    expect(audit).toMatchObject({ action: 'entity.view', target: 'source:blame:acme/app', resultCode: 'OK' });
    expect(JSON.parse(String(audit?.query))).toEqual({ path: PATH, revision: SHA, observed_revision: SHA });
    expect(String(audit?.query)).not.toContain(HEADLINE);
    expect(String(audit?.query)).not.toContain(ALICE);
  });

  it('CR-135 FR-SRC-005 path와 revision 말고는 받지 않는다 — 다른 키·짧은 SHA·빈 path·잘못된 경로는 400이고 GitHub를 부르지 않는다', async () => {
    for (const query of [
      '', `path=${PATH}`, `revision=${SHA}`, `path=&revision=${SHA}`, `path=${PATH}&revision=abc1234`, `path=${PATH}&revision=${'g'.repeat(40)}`,
      `path=..%2Fx&revision=${SHA}`, `path=%2Fsrc%2Fpay.ts&revision=${SHA}`, `path=src%2F&revision=${SHA}`, `path=a&path=b&revision=${SHA}`, `${VALID}&revision=${SHA}`,
      `${VALID}&ref=main`, `${VALID}&page=2`, `${VALID}&page=1`, `${VALID}&foo=1`, `${VALID}&after=x`, `${VALID}&offset=0`, `${VALID}&start_line=1`,
      `${VALID}&end_line=10`, `${VALID}&first=10`, `${VALID}&listing=tree`, `${VALID}&tree_sha=${SHA}`, `${VALID}&commit=${SHA}`,
    ]) {
      const { response, methods } = await request(blameUrl(query), { blameEnabled: true });
      expect({ query, status: response.statusCode, code: response.json().error?.code }).toEqual({ query, status: 400, code: 'INVALID_PARAMETER' });
      expect(methods.blame).not.toHaveBeenCalled();
    }
  });

  it('CR-135 FR-SRC-005 세션과 저장소 범위를 GitHub보다 먼저 본다 — 범위 밖은 등록 안 된 저장소와 같은 404이고 리더를 만들지 않는다', async () => {
    vi.mocked(authenticateSession).mockRejectedValueOnce(new UnauthenticatedError('missing'));
    const anonymous = await request(blameUrl(VALID), { blameEnabled: true });
    expect(anonymous.response.statusCode).toBe(401);
    expect(anonymous.readerFactory).not.toHaveBeenCalled();
    const bodies: unknown[] = [];
    for (const kind of ['forbidden', 'not_found'] as const) {
      vi.mocked(resolveRepository).mockResolvedValueOnce({ kind, message: 'do not expose' } as Awaited<ReturnType<typeof resolveRepository>>);
      const hidden = await request(blameUrl(VALID), { blameEnabled: true });
      expect(hidden.response.statusCode).toBe(404);
      bodies.push(hidden.response.json().error);
      expect(hidden.readerFactory).not.toHaveBeenCalled();
    }
    expect(bodies).toEqual([{ code: 'NOT_FOUND', message: 'Repository not found.' }, { code: 'NOT_FOUND', message: 'Repository not found.' }]);
  });

  const REMOTE = 'REMOTE-TEXT-must-not-leak';
  it.each([
    ['미지원 GHES', 501, 'SOURCE_BLAME_UNSUPPORTED', 'This GitHub Enterprise Server does not provide blame through its API.', new SourceBlameUnsupportedError()],
    ['없는 저장소·리비전·경로', 404, 'NOT_FOUND', 'The requested repository object was not found.', new GitHubApiError('not_found', REMOTE)],
    ['권한 부족', 503, 'SOURCE_PERMISSION_REQUIRED', 'The configured GitHub App requires repository Contents read permission.', new GitHubApiError('auth', REMOTE)],
    ['일부 결과·알 수 없는 오류', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', new GitHubApiError('server', REMOTE, { status: 200 })],
    ['호출 기한', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', new GitHubApiError('timeout', REMOTE)],
    ['네트워크', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', new GitHubApiError('network', REMOTE)],
    ['그 밖의 오류', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', new Error(REMOTE)],
  ] as const)('CR-135 FR-SRC-005 %s → %i %s — 원격 문구를 싣지 않고 감사에 결과 코드를 남긴다', async (_label, status, code, message, error) => {
    const { response } = await request(blameUrl(VALID), { blameEnabled: true, blame: vi.fn().mockRejectedValue(error) });
    expect(response.statusCode).toBe(status);
    expect(response.json().error).toEqual({ code, message });
    expect(response.body).not.toContain(REMOTE);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(lastAudit()).toMatchObject({ target: 'source:blame:acme/app', resultCode: code });
  });

  it.each([
    ['rate_limited', 30],
    ['secondary_rate_limited', 60],
  ] as const)('CR-135 FR-SRC-005 GitHub 한도(%s)는 429 SOURCE_RATE_LIMITED와 Retry-After(초)다', async (kind, seconds) => {
    const retryAt = new Date(Date.now() + seconds * 1000);
    const { response } = await request(blameUrl(VALID), { blameEnabled: true, blame: vi.fn().mockRejectedValue(new GitHubApiError(kind, 'limited', { status: 200, retryAt })) });
    expect(response.statusCode).toBe(429);
    expect(response.json().error).toEqual({ code: 'SOURCE_RATE_LIMITED', message: 'GitHub is rate limited. Try again later.' });
    const header = Number(response.headers['retry-after']);
    expect(header).toBeGreaterThanOrEqual(seconds - 1);
    expect(header).toBeLessThanOrEqual(seconds);
    expect(lastAudit()).toMatchObject({ target: 'source:blame:acme/app', resultCode: 'SOURCE_RATE_LIMITED' });
  });

  it('CR-135 FR-SRC-005 요청 기한이 지나면 blame 호출에 준 신호가 끊기고 502로 답한다', async () => {
    let seen: AbortSignal | undefined;
    const stuck = vi.fn((_ref: unknown, _revision: string, _path: string, options: { signal?: AbortSignal }) => {
      seen = options.signal;
      return new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => { reject(new GitHubApiError('timeout', 'deadline')); }); });
    });
    const { response } = await request(blameUrl(VALID), { blameEnabled: true, blame: stuck, deadlineMs: 50 });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toEqual({ code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be loaded from GitHub in time. Please retry.' });
    expect(seen?.aborted).toBe(true);
    expect(lastAudit()).toMatchObject({ target: 'source:blame:acme/app', resultCode: 'SOURCE_UNAVAILABLE' });
  });
});
