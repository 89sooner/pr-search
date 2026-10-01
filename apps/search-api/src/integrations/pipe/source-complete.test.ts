/**
 * CR-138 / FR-INT-001: PIPE에 넘기는 반복 호출 참고 구현(`handoff/.../reference/source-complete.mjs`)의 재시도·이어 읽기.
 *
 * 가짜 `request`로 상태를 지어 낸다 — 429(`Retry-After`)·502·503은 같은 위치에서 다시 부르고, 권한 부족(503
 * `SOURCE_PERMISSION_REQUIRED`)과 그 밖의 오류는 바로 멈추며, 끝내 실패하면 받은 부분과 멈춘 위치를 오류에 실어 같은 함수가
 * 거기서부터 잇는다. 실제 리스너·전송을 거치는 경로는 통합 시험(`integration/integrations/pipe/source-unbounded.test.ts`)이 본다.
 */

import { describe, expect, it } from 'vitest';
import {
  SourceReadError, getAllPaths, getCompleteDiffFiles, getCompleteFile, getCompleteHistory, getCompleteTree, type SourceRequest, type SourceResume,
} from '../../../../../handoff/pipe-search-integration/v1/reference/source-complete.mjs';

type Reply = { status: number; headers?: Record<string, string>; body: unknown };
const SHA = 'a'.repeat(40);
const TEXT = Array.from({ length: 40 }, (_, i) => `line ${String(i).padStart(2, '0')}\n`).join('');
const WINDOW = 64;

/** `TEXT`를 64바이트 창으로 나눠 주는 파일 조회. */
function fileWindow(offset: number): Reply {
  const end = Math.min(TEXT.length, offset + WINDOW);
  return { status: 200, body: { status: 'text', text: TEXT.slice(offset, end), size: TEXT.length, sha: SHA, reason: null, offset, next_offset: end < TEXT.length ? end : null } };
}
const offsetOf = (path: string): number => Number(new URLSearchParams(path.split('?')[1]).get('offset'));

/** 요청을 기록하고, `fail`이 응답을 주면 그것을, 아니면 `serve`를 돌려준다. */
function fake(serve: (path: string) => Reply, fail: (path: string, count: number) => Reply | Error | undefined = () => undefined) {
  const log: string[] = [];
  const request: SourceRequest = async (path) => {
    log.push(path);
    const failure = fail(path, log.length);
    if (failure instanceof Error) throw failure;
    return failure ?? serve(path);
  };
  return { request, log };
}
function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}
const failed = async (work: Promise<unknown>): Promise<SourceReadError> => {
  const error = await work.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SourceReadError);
  return error as SourceReadError;
};

describe('CR-138 FR-INT-001 참고 구현의 재시도 — 한도·일시 장애는 같은 위치에서 다시 부른다', () => {
  it('CR-138 FR-SRC-003 429는 Retry-After만큼, 502·503은 짧은 지수 대기 뒤 같은 창을 다시 부르고 본문은 원문과 같다', async () => {
    const seen = new Map<number, number>();
    const { request, log } = fake((path) => fileWindow(offsetOf(path)), (path) => {
      const offset = offsetOf(path); const times = (seen.get(offset) ?? 0) + 1; seen.set(offset, times);
      if (offset === WINDOW && times === 1) return { status: 429, headers: { 'retry-after': '2' }, body: { error: { code: 'SOURCE_RATE_LIMITED' } } };
      if (offset === 2 * WINDOW && times <= 2) return { status: times === 1 ? 502 : 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } };
      return undefined;
    });
    const { waits, sleep } = sleeper();
    const file = await getCompleteFile(request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep });
    expect(file.text).toBe(TEXT);
    expect(waits).toEqual([2000, 500, 1000]);
    // 실패한 창만 다시 불렀다 — 앞 창을 다시 읽거나 건너뛰지 않았다.
    expect(log.map(offsetOf)).toEqual([0, WINDOW, WINDOW, 2 * WINDOW, 2 * WINDOW, 2 * WINDOW, ...Array.from({ length: Math.ceil(TEXT.length / WINDOW) - 3 }, (_, i) => (i + 3) * WINDOW)]);
  });

  it('CR-138 FR-SRC-003 GitHub App 권한 부족(503 SOURCE_PERMISSION_REQUIRED)과 400·404는 다시 부르지 않는다', async () => {
    for (const reply of [{ status: 503, body: { error: { code: 'SOURCE_PERMISSION_REQUIRED' } } }, { status: 400, body: { error: { code: 'INVALID_PARAMETER' } } }, { status: 404, body: { error: { code: 'NOT_FOUND' } } }]) {
      const { request, log } = fake(() => reply);
      const { waits, sleep } = sleeper();
      const error = await failed(getCompleteFile(request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep }));
      expect({ status: error.status, calls: log.length, waits }).toEqual({ status: reply.status, calls: 1, waits: [] });
    }
  });

  it('CR-138 FR-SRC-003 Retry-After가 maxWaitMs보다 길면 기다리지 않고 멈춘다 — 받은 부분은 resume에 남는다', async () => {
    const { request } = fake((path) => fileWindow(offsetOf(path)), (path) => (offsetOf(path) === WINDOW ? { status: 429, headers: { 'retry-after': '120' }, body: null } : undefined));
    const { waits, sleep } = sleeper();
    const error = await failed(getCompleteFile(request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep }));
    expect(error.status).toBe(429);
    expect(waits).toEqual([]);
    expect(error.resume).toMatchObject({ offset: WINDOW, parts: [TEXT.slice(0, WINDOW)] });
  });

  it('CR-138 FR-SRC-003 보내지 못한 요청(연결 실패)도 다시 부르고, 호출자의 취소(AbortError)는 그대로 올린다', async () => {
    let first = true;
    const flaky = fake((path) => fileWindow(offsetOf(path)), () => { if (first) { first = false; return new TypeError('fetch failed'); } return undefined; });
    const { waits, sleep } = sleeper();
    expect((await getCompleteFile(flaky.request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep })).text).toBe(TEXT);
    expect(waits).toEqual([500]);
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const cancelled = fake((path) => fileWindow(offsetOf(path)), (path) => (offsetOf(path) === WINDOW ? abort : undefined));
    await expect(getCompleteFile(cancelled.request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep })).rejects.toBe(abort);
    expect(cancelled.log).toHaveLength(2);
  });
});

describe('CR-138 FR-INT-001 참고 구현의 이어 읽기 — 끝내 실패해도 받은 부분을 버리지 않는다', () => {
  it('CR-138 FR-SRC-003 파일: 멈춘 창부터 잇고, 앞 창을 다시 받지 않으며, 이은 본문은 원문과 같다', async () => {
    let down = true;
    const { request, log } = fake((path) => fileWindow(offsetOf(path)), (path) => (down && offsetOf(path) >= 3 * WINDOW ? { status: 502, body: null } : undefined));
    const { sleep } = sleeper();
    const error = await failed(getCompleteFile(request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep, attempts: 2 }));
    expect(error.status).toBe(502);
    expect(error.resume).toMatchObject({ offset: 3 * WINDOW, parts: [TEXT.slice(0, WINDOW), TEXT.slice(WINDOW, 2 * WINDOW), TEXT.slice(2 * WINDOW, 3 * WINDOW)] });
    down = false;
    log.length = 0;
    const file = await getCompleteFile(request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }, { sleep, resume: error.resume! });
    expect(file.text).toBe(TEXT);
    expect(offsetOf(log[0]!)).toBe(3 * WINDOW);
    expect(file.windows).toBe(Math.ceil(TEXT.length / WINDOW));
  });

  it('CR-138 FR-SRC-003 스냅숏이 바뀌거나 응답이 나아가지 않으면 resume은 null이다 — 다른 판의 조각을 잇지 않는다', async () => {
    const swapped = fake((path) => { const reply = fileWindow(offsetOf(path)); if (offsetOf(path) === WINDOW) (reply.body as { sha: string }).sha = 'b'.repeat(40); return reply; });
    expect(await failed(getCompleteFile(swapped.request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }))).toMatchObject({ status: 409, resume: null });
    const stuck = fake((path) => { const reply = fileWindow(offsetOf(path)); (reply.body as { next_offset: number }).next_offset = offsetOf(path); return reply; });
    expect(await failed(getCompleteFile(stuck.request, { repository: 'acme/payments', revision: SHA, path: 'a.c' }))).toMatchObject({ status: 200, resume: null });
  });

  it('CR-138 FR-SRC-001·002 디렉터리·경로 목록·이력도 멈춘 페이지부터 잇고 결과는 끊김 없이 읽은 것과 같다', async () => {
    const { sleep } = sleeper();
    const entries = Array.from({ length: 7 }, (_, i) => ({ path: `d/e${String(i)}`, name: `e${String(i)}`, sha: SHA, kind: 'file', size: 1 }));
    const tree = (path: string): Reply => { const offset = offsetOf(path); return { status: 200, body: { revision: SHA, tree_sha: SHA, entries: entries.slice(offset, offset + 3), truncated: false, offset, next_offset: offset + 3 < entries.length ? offset + 3 : null } }; };
    const paths = (path: string): Reply => { const after = new URLSearchParams(path.split('?')[1]).get('after'); const start = after === null ? 0 : Number(after.slice(1)) + 1; return { status: 200, body: { revision: SHA, paths: [start, start + 1].filter((i) => i < 5).map((i) => ({ path: `p${String(i)}`, kind: 'file' })), incomplete: false, next_after: start + 2 < 5 ? `p${String(start + 1)}` : null } }; };
    const history = (path: string): Reply => { const page = Number(new URLSearchParams(path.split('?')[1]).get('page')); return { status: 200, body: { revision: SHA, commits: [{ sha: `${String(page)}`.padStart(40, '0'), parents: [], message: 'm', author: 'a', date: null, pull_request_numbers: null }], pull_requests_unavailable: false, next_page: page < 4 ? page + 1 : null } }; };
    const cases = [
      { serve: tree, nth: (path: string) => offsetOf(path) === 3, read: (request: SourceRequest, resume?: SourceResume) => getCompleteTree(request, { repository: 'acme/payments', ref: 'main' }, { sleep, attempts: 1, ...(resume ? { resume } : {}) }) },
      { serve: paths, nth: (path: string) => path.includes('after=p1'), read: (request: SourceRequest, resume?: SourceResume) => getAllPaths(request, { repository: 'acme/payments', revision: SHA }, { sleep, attempts: 1, ...(resume ? { resume } : {}) }) },
      { serve: history, nth: (path: string) => path.includes('page=3'), read: (request: SourceRequest, resume?: SourceResume) => getCompleteHistory(request, { repository: 'acme/payments', path: 'a.c', ref: 'main' }, { sleep, attempts: 1, ...(resume ? { resume } : {}) }) },
    ];
    for (const one of cases) {
      const whole = await one.read(fake(one.serve).request);
      let down = true;
      const { request, log } = fake(one.serve, (path) => (down && one.nth(path) ? { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } } : undefined));
      const error = await failed(one.read(request));
      expect(error.resume).not.toBeNull();
      down = false;
      const before = log.length;
      expect(await one.read(request, error.resume!)).toEqual(whole);
      expect(one.nth(log[before]!)).toBe(true);
    }
  });

  it('CR-138 FR-SRC-003 변경 목록: 트리 비교 도중 멈춰도 GitHub 목록을 다시 읽지 않고 트리 비교의 멈춘 위치부터 잇는다', async () => {
    const listed = Array.from({ length: 5 }, (_, i) => ({ path: `r${String(i)}`, previous_path: null, status: 'modified', additions: 1, deletions: 1 }));
    const compared = Array.from({ length: 9 }, (_, i) => ({ path: i < 5 ? `r${String(i)}` : `t${String(i)}`, previous_path: null, status: 'added', additions: null, deletions: null }));
    const serve = (path: string): Reply => {
      const query = new URLSearchParams(path.split('?')[1]);
      if (query.get('listing') === 'tree') {
        const after = query.get('after'); const start = after === null ? 0 : compared.findIndex((file) => file.path === after) + 1;
        const end = Math.min(compared.length, start + 3);
        return { status: 200, body: { base: SHA, head: SHA, files: compared.slice(start, end), truncated: false, next_after: end < compared.length ? compared[end - 1]!.path : null } };
      }
      const page = Number(query.get('page'));
      return { status: 200, body: { base: SHA, head: SHA, files: listed.slice((page - 1) * 2, page * 2), truncated: page === 3, next_page: page < 3 ? page + 1 : null } };
    };
    const whole = await getCompleteDiffFiles(fake(serve).request, { repository: 'acme/payments', commit: SHA });
    expect(whole.listing).toBe('rest+tree');
    expect(whole.files.map((file) => file.path)).toEqual([...listed.map((file) => file.path), 't5', 't6', 't7', 't8']);
    let down = true;
    const { request, log } = fake(serve, (path) => (down && path.includes('listing=tree') && path.includes('after=t5') ? { status: 502, body: null } : undefined));
    const error = await failed(getCompleteDiffFiles(request, { repository: 'acme/payments', commit: SHA }, { attempts: 1 }));
    expect(error.resume).toMatchObject({ phase: 'tree', after: 't5' });
    down = false;
    const before = log.length;
    expect(await getCompleteDiffFiles(request, { repository: 'acme/payments', commit: SHA }, { resume: error.resume! })).toEqual(whole);
    // 이어 읽기는 트리 비교의 멈춘 위치에서 시작한다 — GitHub 목록(page=…)을 다시 부르지 않았다.
    expect(log.slice(before).every((path) => path.includes('listing=tree'))).toBe(true);
    expect(log[before]).toContain('after=t5');
  });

  it('CR-138 FR-SRC-003 변경 목록의 GitHub 페이지가 앞으로 나아가지 않으면 멈춘다 — 같은 페이지를 끝없이 부르지 않는다', async () => {
    const { request, log } = fake(() => ({ status: 200, body: { base: SHA, head: SHA, files: [], truncated: false, next_page: 1 } }));
    expect(await failed(getCompleteDiffFiles(request, { repository: 'acme/payments', pr: 7 }))).toMatchObject({ status: 200, resume: null });
    expect(log).toHaveLength(1);
  });
});
