/**
 * GHE 클라이언트 전 계층 (WP-006 DoD 1~5).
 *
 * 실제 HTTP 서버를 상대로 돈다. fetch를 목으로 바꾸면 이 WP가 검증해야 할 것
 * 대부분(헤더 파싱, 429 반응, 401 후 재발급)을 건너뛰게 된다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GitHubApiError,
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
  resolveVisibility,
} from '../src/index.js';
import { generateTestKeyPair, startMockGhe, type MockGhe, type MockGheOptions } from './mock-ghe.js';

const keys = generateTestKeyPair();
const REPO = { owner: 'acme', repo: 'payments' } as const;

interface Harness {
  readonly ghe: MockGhe;
  readonly client: GitHubClient;
  readonly pool: TokenPool;
  readonly provider: InstallationTokenProvider;
  readonly events: { path: string; status: number; remaining: number | undefined }[];
  readonly setNow: (value: Date) => void;
}

let harness: Harness | undefined;

async function build(options: MockGheOptions = {}, now = new Date()): Promise<Harness> {
  const ghe = await startMockGhe(options);
  let current = now;
  const clock = (): Date => current;

  const provider = new InstallationTokenProvider({
    apiUrl: ghe.apiUrl,
    appId: '12345',
    privateKey: keys.privateKey,
    refreshLeadMs: 60_000,
    requestTimeoutMs: 5_000,
    now: clock,
  });
  const pool = new TokenPool(provider, {
    installations: [{ org: 'acme', installationId: 42 }],
    quarantineThreshold: 0.1,
    now: clock,
  });
  const events: { path: string; status: number; remaining: number | undefined }[] = [];
  const transport = new GitHubTransport({
    apiUrl: ghe.apiUrl,
    requestTimeoutMs: 5_000,
    pool,
    scheduler: new RequestScheduler({ maxConcurrent: 4 }),
    now: clock,
    onResponse: (event) => events.push({ path: event.path, status: event.status, remaining: event.remaining }),
  });

  harness = {
    ghe,
    client: new GitHubClient(transport),
    pool,
    provider,
    events,
    setNow: (value: Date): void => {
      current = value;
    },
  };
  return harness;
}

afterEach(async () => {
  await harness?.ghe.close();
  harness = undefined;
});

describe('오퍼레이션 (SRS 10장)', () => {
  beforeEach(async () => {
    await build();
  });

  it('PR·커밋·파일·리뷰·태그·릴리스·저장소·팀·협업자를 조회한다', async () => {
    const { client } = harness!;
    expect(await client.getPullRequest(REPO, 1234)).toMatchObject({ number: 1234, merged: true });
    expect(await client.listPullRequestCommits(REPO, 1234)).toHaveLength(1);
    expect(await client.listPullRequestFiles(REPO, 1234)).toMatchObject([{ filename: 'src/pay.ts' }]);
    expect(await client.listPullRequestReviews(REPO, 1234)).toMatchObject([{ state: 'APPROVED' }]);
    expect(await client.listTags(REPO)).toMatchObject([{ name: 'v1.2.3' }]);
    expect(await client.listReleases(REPO)).toMatchObject([{ tag_name: 'v1.2.3' }]);
    const repository = await client.getRepository(REPO);
    expect(repository).toMatchObject({ id: 4021, full_name: 'acme/payments' });
    // 등록이 요구하는 두 필드 (DEV-033). ADR-008의 접근 범위 필터가 그 위에 선다.
    expect(repository.owner.id).toBe(77);
    expect(resolveVisibility(repository)).toBe('internal');
    expect(await client.listOrgTeams('acme')).toMatchObject([{ slug: 'payments' }]);
    expect(await client.listCollaborators(REPO)).toMatchObject([{ login: 'dev' }]);
    expect(await client.listCommits(REPO, { sha: 'main' })).toMatchObject([{ sha: 'ddd4' }]);
  });

  it('토큰을 URL이 아니라 Authorization 헤더로만 보낸다', async () => {
    const { client, ghe } = harness!;
    await client.getPullRequest(REPO, 1234);
    const dataRequest = ghe.requests.find((r) => r.path.includes('/pulls/'));
    expect(dataRequest?.authorization).toMatch(/^Bearer ghs_/);
    for (const request of ghe.requests) {
      expect(request.path).not.toContain('ghs_');
      expect(request.path).not.toContain('token=');
    }
  });

  it('설치 토큰을 한 번만 받아 재사용한다', async () => {
    const { client, provider } = harness!;
    await client.getPullRequest(REPO, 1234);
    await client.getRepository(REPO);
    await client.listTags(REPO);
    expect(provider.issueCount).toBe(1);
  });
});

describe('DoD 1: 토큰이 만료되면 자동 갱신된다', () => {
  it('만료가 가까워지면 새로 받는다', async () => {
    // 목 서버가 실제 시계로 `expires_at`을 계산하므로 주입 시계의 기준도
    // 실제 시각이어야 한다. 고정 날짜를 넣으면 첫 토큰이 이미 만료된 상태가 된다.
    const start = new Date();
    // 수명 2분, 갱신 여유 1분 → 1분 뒤에는 갱신 대상이다.
    await build({ tokenTtlMs: 2 * 60 * 1000 }, start);
    const { client, provider } = harness!;

    await client.getPullRequest(REPO, 1234);
    expect(provider.issueCount).toBe(1);

    harness!.setNow(new Date(start.getTime() + 30_000));
    await client.getRepository(REPO);
    expect(provider.issueCount).toBe(1);

    // 남은 수명이 갱신 여유 아래로 내려갔다.
    harness!.setNow(new Date(start.getTime() + 70_000));
    await client.listTags(REPO);
    expect(provider.issueCount).toBe(2);
  });

  it('401을 받으면 캐시를 버려 다음 요청이 새 토큰을 받는다', async () => {
    await build({ unauthorizedTimes: 1 });
    const { client, provider } = harness!;

    await expect(client.getPullRequest(REPO, 1234)).rejects.toBeInstanceOf(GitHubApiError);
    expect(provider.issueCount).toBe(1);

    await client.getPullRequest(REPO, 1234);
    expect(provider.issueCount).toBe(2);
  });

  it('동시 요청이 토큰을 중복 발급하지 않는다', async () => {
    await build();
    const { client, provider } = harness!;
    await Promise.all([
      client.getPullRequest(REPO, 1234),
      client.getRepository(REPO),
      client.listTags(REPO),
      client.listReleases(REPO),
    ]);
    expect(provider.issueCount).toBe(1);
  });
});

describe('DoD 2: 잔여 10% 미만 토큰이 회복 시각까지 풀에서 제외된다', () => {
  it('임계 아래 응답을 받으면 다음 요청이 회복 시각을 담아 거부된다', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const resetAt = Math.floor(now.getTime() / 1000) + 900;
    // 첫 응답 잔여 4,000(정상) → 둘째 400(8%, 임계 아래)
    await build({ rateLimit: { limit: 5000, remaining: [4000, 400], resetAt } }, now);
    const { client, pool } = harness!;

    await client.getPullRequest(REPO, 1234);
    expect(pool.isAvailable('acme')).toBe(true);

    await client.getRepository(REPO);
    expect(pool.isAvailable('acme')).toBe(false);

    const error = await client.listTags(REPO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).kind).toBe('rate_limited');
    expect((error as GitHubApiError).retryAt?.getTime()).toBe(resetAt * 1000);
    // 격리된 뒤로는 서버에 요청이 가지 않는다 — 보내 봐야 한도만 더 깎인다.
    expect(harness!.ghe.requests.filter((r) => r.path.includes('/tags')).length).toBe(0);
  });

  it('회복 시각이 지나면 다시 쓸 수 있다', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const resetAt = Math.floor(now.getTime() / 1000) + 60;
    await build({ rateLimit: { limit: 5000, remaining: [100, 4000], resetAt } }, now);
    const { client, pool } = harness!;

    await client.getPullRequest(REPO, 1234);
    expect(pool.isAvailable('acme')).toBe(false);

    harness!.setNow(new Date((resetAt + 1) * 1000));
    expect(pool.isAvailable('acme')).toBe(true);
    await expect(client.getRepository(REPO)).resolves.toMatchObject({ id: 4021 });
  });

  it('지표용 잔여 값이 노출된다 (github_rate_limit_remaining)', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    await build({ rateLimit: { limit: 5000, remaining: [4321], resetAt: Math.floor(now.getTime() / 1000) + 900 } }, now);
    await harness!.client.getPullRequest(REPO, 1234);
    expect(harness!.pool.remainingByInstallation().get(42)).toBe(4321);
    expect(harness!.events.at(-1)?.remaining).toBe(4321);
  });
});

describe('DoD 3: 429 + retry-after 수신 시 해당 토큰이 지정 시간 격리된다', () => {
  it('retry-after가 지정한 시각까지 격리한다', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    await build({ secondaryLimitTimes: 1, retryAfterSeconds: 45 }, now);
    const { client, pool } = harness!;

    const error = await client.getPullRequest(REPO, 1234).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).kind).toBe('secondary_rate_limited');
    expect((error as GitHubApiError).retryable).toBe(true);
    expect((error as GitHubApiError).retryAt?.getTime()).toBe(now.getTime() + 45_000);

    expect(pool.isAvailable('acme')).toBe(false);
    harness!.setNow(new Date(now.getTime() + 44_000));
    expect(pool.isAvailable('acme')).toBe(false);
    harness!.setNow(new Date(now.getTime() + 46_000));
    expect(pool.isAvailable('acme')).toBe(true);
    await expect(client.getPullRequest(REPO, 1234)).resolves.toMatchObject({ number: 1234 });
  });

  it('retry-after 헤더가 없으면 보수적으로 1분 격리한다', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    await build({ secondaryLimitTimes: 1, omitRetryAfter: true }, now);
    const { client, pool } = harness!;

    const error = await client.getPullRequest(REPO, 1234).catch((e: unknown) => e);
    expect((error as GitHubApiError).kind).toBe('secondary_rate_limited');
    // 헤더가 없다고 즉시 재시도하면 429를 그대로 다시 맞는다.
    expect(pool.isAvailable('acme')).toBe(false);
    expect((error as GitHubApiError).retryAt?.getTime()).toBe(now.getTime() + 60_000);

    harness!.setNow(new Date(now.getTime() + 61_000));
    expect(pool.isAvailable('acme')).toBe(true);
  });
});

describe('DoD 5: 토큰 값이 로그에 남지 않는다 (THR-009)', () => {
  it('서버가 오류 본문에 Authorization을 되비춰도 토큰이 새지 않는다', async () => {
    // 잘못 구성된 프록시가 요청 헤더를 오류 본문에 담아 돌려주는 상황이다.
    // 전송 계층이 그 본문을 오류 메시지에 넣으므로, redaction이 없으면 토큰이
    // 그대로 로그와 예외에 실린다.
    await build({ unauthorizedTimes: 1, echoAuthorizationInError: true });
    const { client, ghe, events } = harness!;

    const error = await client.getPullRequest(REPO, 1234).catch((e: unknown) => e);
    const issued = ghe.issuedTokens();
    expect(issued.length).toBeGreaterThan(0);

    const serialized = [
      (error as Error).message,
      String(error),
      (error as Error).stack ?? '',
      JSON.stringify(events),
    ].join('\n');

    for (const token of issued) {
      expect(serialized).not.toContain(token);
    }
    expect(serialized).not.toContain(keys.privateKey.slice(40, 80));
  });

  it('전송 이벤트에 토큰 필드 자체가 없다', async () => {
    await build();
    await harness!.client.getPullRequest(REPO, 1234);
    const serialized = JSON.stringify(harness!.events);
    expect(serialized).not.toContain('ghs_');
    expect(serialized).not.toContain('authorization');
  });
});

describe('절삭 판정 (FR-ING-004 AC-4, FR-SRCH-003 AC-4)', () => {
  it('상한을 정확히 채운 것은 잘린 것이 아니다', async () => {
    await build({ resources: { files: 3000, commits: 250 } });
    const { client } = harness!;

    const files = await client.listPullRequestFilesPaged(REPO, 1234);
    expect(files.items).toHaveLength(3000);
    expect(files.truncated).toBe(false);

    const commits = await client.listPullRequestCommitsPaged(REPO, 1234);
    expect(commits.items).toHaveLength(250);
    expect(commits.truncated).toBe(false);
  });

  it('상한을 넘으면 잘라 내고 잘렸다고 말한다', async () => {
    await build({ resources: { files: 3001, commits: 251 } });
    const { client } = harness!;

    const files = await client.listPullRequestFilesPaged(REPO, 1234);
    expect(files.items).toHaveLength(3000);
    expect(files.truncated).toBe(true);
    expect(files.maxItems).toBe(3000);

    const commits = await client.listPullRequestCommitsPaged(REPO, 1234);
    expect(commits.items).toHaveLength(250);
    expect(commits.truncated).toBe(true);
  });

  it('길이만 보는 판정과 실제 판정이 갈리는 지점을 고정한다', async () => {
    // 이 시험이 지키는 것: `items.length === 3000`은 절삭의 증거가 아니다.
    await build({ resources: { files: 3000 } });
    const exact = await harness!.client.listPullRequestFilesPaged(REPO, 1234);
    await harness?.ghe.close();

    await build({ resources: { files: 3001 } });
    const cut = await harness!.client.listPullRequestFilesPaged(REPO, 1234);

    expect(exact.items.length).toBe(cut.items.length);
    expect(exact.truncated).not.toBe(cut.truncated);
  });
});
