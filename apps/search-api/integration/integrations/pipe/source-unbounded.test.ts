/**
 * CR-138 / FR-INT-001·FR-SRC-001~004 — PIPE도 source를 끝까지 읽는다. 옛 총량 상한 때문에 거절하지 않는다.
 *
 * 127.0.0.1의 실제 mTLS 리스너 → grant 판정 → 접근 범위 → search-api의 source 실행 → **실제 `GitHubTransport`** → GHE
 * 대역(`mock-source`, GitHub 규칙: 바이트 범위 없는 원시 본문, 1MB 넘는 Contents는 object·raw만, 100MB 넘는 blob은 주지
 * 않음, 변경 목록 3,000개). 반복 호출은 handoff의 참고 구현(`reference/source-complete.mjs`)을 그대로 쓴다 — PIPE에 넘기는
 * 코드가 실제 리스너에서 끝까지 읽는지 여기서 확인한다. 같은 요청의 일반 API(세션) 응답과 본문이 같은지도 본다.
 */

import { GitHubSourceReader, GitHubTransport, InstallationTokenProvider, RequestScheduler, TokenPool } from '@prs/github';
import type { SourceComparison, SourceFile, SourceTree } from '@prs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTestKeyPair, startMockGhe, type MockGhe } from '../../../../../packages/github/testing/mock-ghe.js';
import { buildMockSource, type MockSourceRepository } from '../../../../../packages/github/testing/mock-source.js';
import { SourceReadError, getAllPaths, getCompleteDiffFiles, getCompleteFile, getCompleteHistory, getCompleteTree } from '../../../../../handoff/pipe-search-integration/v1/reference/source-complete.mjs';
import { BILLING, PAYMENTS, USER_A, startHarness, type Harness } from './fixtures.js';

const keys = generateTestKeyPair();
const MIB = 1024 * 1024;
const KIB300 = Array.from({ length: 3072 }, (_, i) => `${String(i).padStart(5, '0')} ${'x'.repeat(93)}\n`).join('');
const LINES4001 = Array.from({ length: 4001 }, (_, i) => `line ${String(i)}\n`).join('');
const LINES100K = Array.from({ length: 100_000 }, (_, i) => `${String(i).padStart(6, '0')} 결제 재시도\n`).join('');
const BIG = Array.from({ length: 200_000 }, (_, i) => `${String(i).padStart(6, '0')} 결제 재시도 ${'abcdef'.slice(0, i % 7)}\n`).join('');
const ONE_LINE = '가나다라'.repeat(220_000);
const LATE_BINARY = Buffer.concat([Buffer.from(Array.from({ length: 12_000 }, () => `${'t'.repeat(99)}\n`).join(''), 'utf8'), Buffer.from([0x00, 0x01, 0x02, 0x0a])]);
const HUGE_BYTES = 150 * MIB;
const HISTORY = 130;
const D5001 = Array.from({ length: 5001 }, (_, i) => `f${String(i).padStart(5, '0')}.c`);
const D12000 = Array.from({ length: 12_000 }, (_, i) => `e${String(i).padStart(5, '0')}.h`);

/** 하네스의 등록 저장소 `acme/payments`와 같은 이름. 이력 커밋을 먼저 두고(트리가 작을 때) 큰 변경을 뒤에 둔다. */
const CHANGES: Record<string, string | null>[] = [];
function source(): MockSourceRepository {
  const commits = Array.from({ length: HISTORY }, (_, i) => ({ message: `history ${String(i)}`, changes: { 'hist/app.c': `rev ${String(i)}\n` } as Record<string, string | { oversized: number } | Buffer | null> }));
  const big: Record<string, string | Buffer | { oversized: number } | null> = {
    'kib300.txt': KIB300, 'lines4001.txt': LINES4001, 'lines100k.txt': LINES100K, 'big.txt': BIG, 'one-line.txt': ONE_LINE, 'late-binary.dat': LATE_BINARY, 'huge.bin': { oversized: HUGE_BYTES },
  };
  for (const name of D5001) big[`d5001/${name}`] = `${name}\n`;
  for (const name of D12000) big[`d12000/${name}`] = `${name}\n`;
  for (let i = 0; i < 10; i += 1) big[`keep/k${String(i)}.c`] = `keep ${String(i)}\n`;
  const c1: Record<string, string | null> = { 'keep/k1.c': 'changed\n', 'keep/k2.c': null };
  for (let i = 0; i < 2999; i += 1) c1[`a/m${String(i % 40).padStart(2, '0')}/f${String(i).padStart(4, '0')}.c`] = `a${String(i)}\n`;
  const c2: Record<string, string | null> = {};
  for (let i = 0; i < 200; i += 1) c2[`a/m${String(i % 40).padStart(2, '0')}/f${String(i).padStart(4, '0')}.c`] = `a${String(i)} edited\n`;
  for (let i = 0; i < 5000; i += 1) c2[`b/n${String(i % 50).padStart(2, '0')}/g${String(i).padStart(4, '0')}.c`] = `b${String(i)}\n`;
  const c3: Record<string, string | null> = {};
  for (let i = 0; i < 3000; i += 1) c3[`b/n${String(i % 50).padStart(2, '0')}/g${String(i).padStart(4, '0')}.c`] = `b${String(i)} edited\n`;
  CHANGES.push(c1, c2, c3);
  const at = HISTORY;
  return buildMockSource({
    owner: 'acme', repo: 'payments',
    commits: [...commits, { message: 'big files', changes: big }, { message: '3,001 changes', changes: c1 }, { message: '5,200 changes', changes: c2 }, { message: 'exactly 3,000', changes: c3 }],
    pulls: [{ number: 931, title: '3,001 files', base: at, head: at + 1 }, { number: 932, title: '5,200 files', base: at + 1, head: at + 2 }, { number: 933, title: 'exactly 3,000', base: at + 2, head: at + 3 }],
  });
}

let h: Harness;
let ghe: MockGhe;
/** 하네스가 요청마다 쓰는 리더. §24 시험이 실패를 주입하는 GHE 대역의 리더로 잠시 바꾼다. */
let active: GitHubSourceReader;
let normal: GitHubSourceReader;
let repo: MockSourceRepository;
/** 큰 파일·디렉터리가 들어온 커밋. */
let files: string;

function readerOf(mock: MockGhe): GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13898', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: 'acme', installationId: 13_898 }], quarantineThreshold: 0.1 });
  return new GitHubSourceReader(new GitHubTransport({ apiUrl: mock.apiUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) }));
}

/** 참고 구현이 부르는 PIPE 요청 — 실제 mTLS 리스너로 grant를 붙여 보낸다. 모든 요청을 기록한다. */
function pipe(grant: string, log: string[] = []) {
  return async (path: string) => {
    log.push(path);
    const response = await h.get(path, grant);
    return { status: response.status, headers: response.headers as Record<string, string>, body: response.body === '' ? null : JSON.parse(response.body) as unknown };
  };
}

beforeAll(async () => {
  repo = source();
  files = repo.commitShas[HISTORY]!;
  ghe = await startMockGhe({ source: { repositories: [repo], rawChunkBytes: 100_003 } });
  normal = readerOf(ghe);
  active = normal;
  h = await startHarness({ sourceReader: () => active });
  h.scopes.set(USER_A.userId, [PAYMENTS, BILLING]);
  await h.resetScopeCache();
}, 240_000);

afterAll(async () => {
  await h?.close();
  await ghe?.close();
});

/** §24 시험용: `mock`의 리더로 잠시 바꿔 `work`를 돌리고, 끝나면 되돌리고 대역을 닫는다. */
async function withGhe<T>(mock: MockGhe, work: () => Promise<T>): Promise<T> {
  active = readerOf(mock);
  try { return await work(); } finally { active = normal; await mock.close(); }
}
/** 원시 본문 읽기(`/git/blobs/…`, raw 미디어 타입)만 센다. 파일 메타(Contents)는 세지 않는다. */
const rawBlob = (request: { path: string; accept: string }): boolean => request.path.startsWith('/git/blobs/') && request.accept.includes('raw');

describe('CR-138 PIPE §24 — 한도·일시 장애·연결 끊김에서도 받은 것을 버리지 않고 끝까지 (실제 mTLS → 실제 전송 → GHE 대역)', () => {
  it('CR-138 FR-SRC-003 GHE가 창 읽기 도중 429(Retry-After)와 502를 주면 PIPE 응답도 429·502이고, 참고 구현은 그 창만 다시 불러 원문과 같은 본문을 얻는다', async () => {
    let raw = 0;
    const faulty = await startMockGhe({ source: { repositories: [repo], rawChunkBytes: 100_003, fail: (request) => {
      if (!rawBlob(request)) return undefined;
      raw += 1;
      if (raw === 2) return { status: 429, headers: { 'retry-after': '1' } };
      if (raw === 4) return { status: 502 };
      return undefined;
    } } });
    await withGhe(faulty, async () => {
      const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-retry-0001' });
      const seen: { path: string; status: number; retryAfter: string | undefined }[] = [];
      const request = async (path: string) => {
        const response = await h.get(path, grant);
        seen.push({ path, status: response.status, retryAfter: response.headers['retry-after'] as string | undefined });
        return { status: response.status, headers: response.headers as Record<string, string>, body: response.body === '' ? null : JSON.parse(response.body) as unknown };
      };
      const waits: number[] = [];
      const whole = await getCompleteFile(request, { repository: 'acme/payments', revision: files, path: 'big.txt' }, { sleep: async (ms) => { waits.push(ms); await new Promise((resolve) => setTimeout(resolve, ms)); } });
      expect(whole.status).toBe('text');
      expect(whole.text === BIG).toBe(true);
      const failures = seen.filter((one) => one.status !== 200);
      expect(failures.map((one) => one.status)).toEqual([429, 502]);
      expect(Number(failures[0]!.retryAfter)).toBeGreaterThanOrEqual(1);
      expect(waits[0]).toBeGreaterThanOrEqual(1000);
      // 실패한 창만 같은 위치에서 다시 불렀다 — 앞 창을 다시 읽지 않았다.
      for (const failure of failures) expect(seen.filter((one) => one.path === failure.path).map((one) => one.status)).toEqual([failure.status, 200]);
      expect(new Set(seen.map((one) => one.path)).size).toBe(whole.windows);
    });
  });

  it('CR-138 FR-SRC-003 장애가 이어져 멈춰도 받은 창은 오류의 resume에 남고, 그것으로 멈춘 창부터 이어 원문과 같은 본문을 얻는다', async () => {
    let raw = 0;
    let down = true;
    const faulty = await startMockGhe({ source: { repositories: [repo], rawChunkBytes: 100_003, fail: (request) => {
      if (!rawBlob(request)) return undefined;
      raw += 1;
      return down && raw >= 3 ? { status: 503 } : undefined;
    } } });
    await withGhe(faulty, async () => {
      const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-retry-0002' });
      const log: string[] = [];
      const error = await getCompleteFile(pipe(grant, log), { repository: 'acme/payments', revision: files, path: 'big.txt' }, { attempts: 2, sleep: async () => undefined }).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(SourceReadError);
      const stopped = error as SourceReadError;
      expect(stopped.status).toBe(502);
      const resume = stopped.resume as { offset: number; parts: string[] };
      expect(resume.parts).toHaveLength(2);
      expect(resume.offset).toBe(Buffer.byteLength(resume.parts.join('')));
      expect(BIG.startsWith(resume.parts.join(''))).toBe(true);
      down = false;
      const before = log.length;
      const whole = await getCompleteFile(pipe(grant, log), { repository: 'acme/payments', revision: files, path: 'big.txt' }, { resume: stopped.resume! });
      expect(whole.text === BIG).toBe(true);
      expect(log[before]).toContain(`offset=${String(resume.offset)}`);
      expect(log.slice(before).some((path) => path.includes('offset=0&') || path.endsWith('offset=0'))).toBe(false);
    });
  });

  it('CR-138 FR-SRC-003 PIPE 클라이언트가 창을 받는 도중 연결을 끊으면 search-api가 GHE 원시 전송도 끊는다', async () => {
    const slow = await startMockGhe({ source: { repositories: [repo], rawChunkBytes: 65_536, rawDelayMs: 40 } });
    await withGhe(slow, async () => {
      const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-cancel-0001' });
      const client = new AbortController();
      const pending = h.get(`/read/source/acme%2Fpayments/file?path=big.txt&revision=${files}&offset=${String(2 * MIB)}`, grant, { signal: client.signal }).then(() => 'answered', (error: unknown) => (error instanceof Error ? error.name : 'failed'));
      for (let i = 0; i < 150 && !slow.rawReads().some((read) => read.bytesSent > 0); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => setTimeout(resolve, 200));
      client.abort();
      expect(await pending).toBe('AbortError');
      const read = slow.rawReads().at(-1)!;
      for (let i = 0; i < 150 && !read.closedEarly; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(read).toMatchObject({ closedEarly: true, finished: false });
      // 2 MiB 위치의 창은 앞 3 MiB를 받아야 끝난다 — 그 전에 끊겼다.
      expect(read.bytesSent).toBeLessThan(3 * MIB);
    });
  });
});

describe('CR-138 PIPE read.source.file — 크기·줄 수로 거절하지 않고 끝까지 (실제 mTLS → 실제 전송 → GHE 대역)', () => {
  it('CR-138 FR-INT-001 FR-SRC-003 300 KiB·4,001줄·10만 줄·5 MiB·한 줄 2.5 MB — 참고 구현으로 이으면 원문과 같고, offset 없는 PIPE 응답은 일반 API와 같다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-file-0001' });
    const log: string[] = [];
    const request = pipe(grant, log);
    for (const [path, text] of [['kib300.txt', KIB300], ['lines4001.txt', LINES4001], ['lines100k.txt', LINES100K], ['big.txt', BIG], ['one-line.txt', ONE_LINE]] as const) {
      const whole = await getCompleteFile(request, { repository: 'acme/payments', revision: files, path });
      expect({ path, status: whole.status }).toEqual({ path, status: 'text' });
      expect(whole.text === text).toBe(true);
      expect(whole.size).toBe(Buffer.byteLength(text));
    }
    // 1 MiB에 드는 파일은 한 번, 넘는 파일은 창마다 한 번이다.
    expect(log.filter((path) => path.includes('kib300.txt'))).toHaveLength(1);
    expect(log.filter((path) => path.includes('big.txt')).length).toBeGreaterThanOrEqual(5);
    // offset 없는 예전 호출: 300 KiB는 완전한 본문, 2.4 MB는 첫 창 — 둘 다 일반 API(세션)와 본문이 같다.
    for (const path of ['kib300.txt', 'lines100k.txt']) {
      const query = `path=${path}&revision=${files}`;
      const viaPipe = await h.get(`/read/source/acme%2Fpayments/file?${query}`, grant);
      const viaSession = await h.publicGet(`/api/v1/source/acme%2Fpayments/file?${query}`, USER_A);
      expect(viaPipe.status).toBe(200);
      expect(viaSession.status).toBe(200);
      expect(viaPipe.json<SourceFile>()).toEqual(viaSession.json<SourceFile>());
      expect(viaPipe.json<SourceFile>().status).toBe('text');
    }
    expect((await h.get(`/read/source/acme%2Fpayments/file?path=lines100k.txt&revision=${files}`, grant)).json<SourceFile>().next_offset).toBeGreaterThan(0);
  });

  it('CR-138 FR-SRC-003 남은 제한은 원천 한계와 텍스트 여부뿐이다 — 100MB 초과는 too_large, 뒤 창의 NUL은 파일 전체를 binary로 만든다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-file-0002' });
    const huge = await getCompleteFile(pipe(grant), { repository: 'acme/payments', revision: files, path: 'huge.bin' });
    expect(huge).toMatchObject({ status: 'too_large', text: null, size: HUGE_BYTES });
    const late = await getCompleteFile(pipe(grant), { repository: 'acme/payments', revision: files, path: 'late-binary.dat' });
    expect(late).toMatchObject({ status: 'binary', text: null });
    expect(late.windows).toBe(2);
  });
});

describe('CR-138 PIPE read.source.tree·paths·history — 5,000개·50개 페이지를 넘어 끝까지', () => {
  const dir = (name: string) => {
    const root = repo.trees.get(repo.commits.get(files)!.tree)!;
    return root.find((item) => item.name === name)!;
  };

  it('CR-138 FR-INT-001 FR-SRC-001 5,001개·12,000개 디렉터리 — offset 없는 첫 응답은 next_offset이 있고 truncated가 아니다, 끝까지 이으면 전부다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-tree-0001' });
    const d5001 = await getCompleteTree(pipe(grant), { repository: 'acme/payments', revision: files, treeSha: dir('d5001').sha, path: 'd5001' });
    expect(d5001.truncated).toBe(false);
    expect(d5001.entries.map((entry: { name: string }) => entry.name).sort()).toEqual([...D5001].sort());
    const d12000 = await getCompleteTree(pipe(grant), { repository: 'acme/payments', revision: files, treeSha: dir('d12000').sha, path: 'd12000' });
    expect(new Set(d12000.entries.map((entry: { name: string }) => entry.name))).toEqual(new Set(D12000));
    expect(d12000.entries).toHaveLength(12_000);
    const query = `revision=${files}&tree_sha=${dir('d5001').sha}&path=d5001`;
    const viaPipe = await h.get(`/read/source/acme%2Fpayments/tree?${query}`, grant);
    const viaSession = await h.publicGet(`/api/v1/source/acme%2Fpayments/tree?${query}`, USER_A);
    expect(viaPipe.json<SourceTree>()).toEqual(viaSession.json<SourceTree>());
    expect(viaPipe.json<SourceTree>()).toMatchObject({ truncated: false, offset: 0, next_offset: 5000, total: 5001 });
  });

  it('CR-138 FR-INT-001 FR-SRC-001 경로 목록은 같은 이름·많은 파일도 전부이고, 이력은 50개 페이지를 넘어 130개 전부다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-tree-0002' });
    const head = repo.commitShas.at(-1)!;
    const listed = await getAllPaths(pipe(grant), { repository: 'acme/payments', revision: head });
    expect(listed.incomplete).toBe(false);
    const paths = new Set(listed.paths.map((entry: { path: string }) => entry.path));
    expect(paths.size).toBe(listed.paths.length);
    for (const name of D12000) expect(paths.has(`d12000/${name}`)).toBe(true);
    expect(paths.has('keep/k2.c')).toBe(false);
    const history = await getCompleteHistory(pipe(grant), { repository: 'acme/payments', path: 'hist/app.c', ref: head });
    expect(history.commits).toHaveLength(HISTORY);
    expect(new Set(history.commits.map((commit: { sha: string }) => commit.sha)).size).toBe(HISTORY);
    expect(history.commits[0]?.sha).toBe(repo.commitShas[HISTORY - 1]);
  });
});

describe('CR-138 PIPE read.source.diff — GitHub의 3,000개 뒤도 참고 구현이 트리 비교로 잇는다', () => {
  const expected = (index: number) => new Set(Object.keys(CHANGES[index]!));

  it('CR-138 FR-INT-001 FR-SRC-003 3,001개·5,200개 PR — GitHub 목록의 줄 수는 그대로, 뒤는 트리 비교로 null, 합하면 실제 차이 전부다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-diff-0001' });
    const pr = await getCompleteDiffFiles(pipe(grant), { repository: 'acme/payments', pr: 931 });
    expect(pr.listing).toBe('rest+tree');
    expect(pr.incomplete).toBe(false);
    expect(pr.files).toHaveLength(3001);
    expect(new Set(pr.files.map((file: { path: string }) => file.path))).toEqual(expected(0));
    const counted = pr.files.filter((file: { additions: number | null }) => file.additions !== null);
    expect(counted).toHaveLength(3000);
    const bigger = await getCompleteDiffFiles(pipe(grant), { repository: 'acme/payments', pr: 932 });
    expect(bigger.files).toHaveLength(5200);
    expect(new Set(bigger.files.map((file: { path: string }) => file.path))).toEqual(expected(1));
  });

  it('CR-138 FR-SRC-003 정확히 3,000개 — GitHub 목록의 30쪽이 가득 차 PR·커밋 모두 트리 비교로 한 번 더 확인하고, 더해지는 파일 없이 같은 3,000개다', async () => {
    const grant = await h.grantFor(USER_A, { contextId: 'ctx-cr138-diff-0002' });
    const pr = await getCompleteDiffFiles(pipe(grant), { repository: 'acme/payments', pr: 933 });
    expect(pr.listing).toBe('rest+tree');
    expect(pr.files).toHaveLength(3000);
    expect(pr.files.every((file: { additions: number | null }) => file.additions !== null)).toBe(true);
    expect(new Set(pr.files.map((file: { path: string }) => file.path))).toEqual(expected(2));
    const commit = await getCompleteDiffFiles(pipe(grant), { repository: 'acme/payments', commit: repo.commitShas.at(-1)! });
    expect(commit.listing).toBe('rest+tree');
    expect(commit.files).toHaveLength(3000);
    expect(new Set(commit.files.map((file: { path: string }) => file.path))).toEqual(expected(2));
    // 30번째 페이지는 PIPE와 일반 API가 같은 본문이다.
    const query = `pr=931&page=30`;
    const viaPipe = await h.get(`/read/source/acme%2Fpayments/diff?${query}`, grant);
    const viaSession = await h.publicGet(`/api/v1/source/acme%2Fpayments/diff?${query}`, USER_A);
    expect(viaPipe.json<SourceComparison>()).toEqual(viaSession.json<SourceComparison>());
    expect(viaPipe.json<SourceComparison>()).toMatchObject({ truncated: true, next_page: null });
  });
});
