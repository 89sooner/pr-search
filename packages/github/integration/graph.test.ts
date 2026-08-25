/**
 * 커밋 그래프 접근 계층 (WP-020 / CR-023, ADR-005, FR-SEQ-001, FR-REL-005).
 *
 * **실제 git을 쓴다.** 이 WP의 DoD가 "우리 결과가 `git rev-list --first-parent
 * --reverse`와 같은가"이므로, 비교 대상이 진짜 git이 아니면 아무것도 증명하지
 * 못한다. Elasticsearch도 PostgreSQL도 필요 없다 — 로컬에서 판정된다.
 *
 * 검증: `pnpm test:integration graph`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiCommitGraph,
  CommitGraphError,
  FallbackCommitGraph,
  MirrorCommitGraph,
  MirrorSync,
  selectCommitGraph,
  type CommitGraph,
  type GitHubClient,
  type RepoRef,
} from '../src/index.js';
import {
  createOriginRepo,
  expectedFirstParent,
  git,
  makeTempDir,
  objectTypeCounts,
  removeDir,
  run,
  type OriginRepo,
} from './fixtures.js';

const REPOSITORY_ID = 4021;
const REF: RepoRef = { owner: 'acme', repo: 'payments' };

let origin: OriginRepo;
let root: string;
let sync: MirrorSync;
let mirror: MirrorCommitGraph;

function makeSync(overrides: Partial<ConstructorParameters<typeof MirrorSync>[0]> = {}): MirrorSync {
  return new MirrorSync({ root, remoteUrl: () => origin.url, ...overrides });
}

function makeMirror(overrides: Partial<ConstructorParameters<typeof MirrorCommitGraph>[0]> = {}): MirrorCommitGraph {
  return new MirrorCommitGraph({ root, repositoryIdOf: () => REPOSITORY_ID, ...overrides });
}

beforeAll(async () => {
  origin = await createOriginRepo();
  root = await makeTempDir('prs-mirrors-');
  sync = makeSync();
  await sync.sync(REF, REPOSITORY_ID);
  mirror = makeMirror();
}, 120_000);

afterAll(async () => {
  await removeDir(origin.dir);
  await removeDir(root);
});

describe('DoD 1: first-parent 체인이 git과 같다 (FR-SEQ-001 AC-2)', () => {
  it('**전 구간이 `git rev-list --first-parent --reverse`와 정확히 같다**', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    expect(head).not.toBeNull();

    const ours = await mirror.firstParentRevList(REF, { from: null, to: head! });
    const theirs = await expectedFirstParent(origin.dir, 'main');

    expect(ours).toEqual(theirs);
  });

  it('**병합 커밋 안의 원본 커밋을 세지 않는다** — 두 번째 부모를 따라가면 여기서 어긋난다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const ours = await mirror.firstParentRevList(REF, { from: null, to: head! });

    // 픽스처의 main은 first-parent로 4개다 (root, direct, merge, after).
    expect(ours).toHaveLength(4);
    // feature 브랜치의 f1·f2는 체인에 없다.
    const all = (await run(origin.dir, ['rev-list', 'main'])).split('\n').filter((l) => l.trim() !== '');
    expect(all.length).toBeGreaterThan(ours.length);
  });

  it('부분 구간도 git과 같다 — 증분 채번이 이것을 쓴다 (AC-5)', async () => {
    const all = await expectedFirstParent(origin.dir, 'main');
    const from = all[0]!;
    const to = all[all.length - 1]!;

    expect(await mirror.firstParentRevList(REF, { from, to })).toEqual(
      await expectedFirstParent(origin.dir, `${from}..${to}`),
    );
  });

  it('빈 구간은 빈 배열이다 — 채번할 것이 없다는 뜻이지 오류가 아니다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    expect(await mirror.firstParentRevList(REF, { from: head!, to: head! })).toEqual([]);
  });

  it('없는 브랜치는 `null`이다 — 아직 만들어지지 않은 대상 브랜치는 오류가 아니다', async () => {
    expect(await mirror.resolveHead(REF, 'no-such-branch')).toBeNull();
  });
});

describe('firstParentCommits: SHA와 시각을 한 번에 (CR-025, DEV-115)', () => {
  it('**SHA 순서가 `firstParentRevList`와 같다** — 같은 체인의 다른 표현일 뿐이다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const withDates = await mirror.firstParentCommits(REF, { from: null, to: head! });
    const shasOnly = await mirror.firstParentRevList(REF, { from: null, to: head! });

    expect(withDates.map((c) => c.sha)).toEqual(shasOnly);
  });

  it('**커밋 시각이 git이 말하는 값과 같다**', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const ours = await mirror.firstParentCommits(REF, { from: null, to: head! });

    // 정답은 우리 구현이 아니라 origin 저장소의 git이 낸다.
    const expected = (await run(origin.dir, ['log', '--first-parent', '--reverse', '--format=%H %cI', 'main']))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [sha, at] = line.trim().split(' ');
        return { sha: sha!, committedAt: at! };
      });

    expect(ours).toEqual(expected);
  });

  it('시각이 파싱 가능한 순간이다 — `merge_sequence.committed_at`이 이 값을 받는다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const ours = await mirror.firstParentCommits(REF, { from: null, to: head! });

    expect(ours.length).toBeGreaterThan(0);
    for (const commit of ours) {
      expect(Number.isNaN(Date.parse(commit.committedAt))).toBe(false);
      // 오프셋이 있어야 실행 환경 시간대에 좌우되지 않는다.
      expect(commit.committedAt).toMatch(/([Zz]|[+-]\d{2}:?\d{2})$/);
    }
  });

  it('부분 구간도 git과 같다 — 증분 채번이 쓰는 경로다 (AC-5)', async () => {
    const all = await expectedFirstParent(origin.dir, 'main');
    const from = all[0]!;
    const to = all[all.length - 1]!;

    const ours = await mirror.firstParentCommits(REF, { from, to });
    expect(ours.map((c) => c.sha)).toEqual(await expectedFirstParent(origin.dir, `${from}..${to}`));
  });

  it('빈 구간은 빈 배열이다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    expect(await mirror.firstParentCommits(REF, { from: head!, to: head! })).toEqual([]);
  });

  it('**blob을 인출하지 않는다** — 커밋 객체만 읽으므로 THR-015가 그대로 성립한다', async () => {
    const dir = await mirror.dirFor(REF);
    const before = await objectTypeCounts(dir);

    const head = await mirror.resolveHead(REF, 'main');
    await mirror.firstParentCommits(REF, { from: null, to: head! });

    const after = await objectTypeCounts(dir);
    expect(after['blob'] ?? 0).toBe(before['blob'] ?? 0);
    expect(after['blob'] ?? 0).toBe(0);
  });
});

describe('DoD 3: blobless 클론에 파일 blob이 없다 (THR-015)', () => {
  it('**커밋과 트리는 있고 blob은 0이다**', async () => {
    const counts = await objectTypeCounts(sync.dirFor(REPOSITORY_ID));

    expect(counts['commit']).toBeGreaterThan(0);
    expect(counts['tree']).toBeGreaterThan(0);
    expect(counts['blob'] ?? 0).toBe(0);
  });

  it('픽스처가 실제로 부분 클론이다 — 필터가 무시됐으면 이 시험은 아무것도 검증하지 못한다', async () => {
    const dir = sync.dirFor(REPOSITORY_ID);
    expect((await run(dir, ['config', '--get', 'remote.origin.promisor'])).trim()).toBe('true');
    expect((await run(dir, ['config', '--get', 'remote.origin.partialclonefilter'])).trim()).toBe('blob:none');
  });

  it('**그래프 연산은 blob 없이 전부 동작한다** — 지연 인출이 막혀 있어도 채번은 선다', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const all = await expectedFirstParent(origin.dir, 'main');

    expect(await mirror.isAncestor(REF, all[0]!, head!)).toBe(true);
    expect(await mirror.mergeBase(REF, all[0]!, head!)).toBe(all[0]);
    expect(await mirror.firstParentRevList(REF, { from: null, to: head! })).toHaveLength(4);

    // 그리고 그 사이 blob이 볼륨에 생기지 않았다.
    expect((await objectTypeCounts(sync.dirFor(REPOSITORY_ID)))['blob'] ?? 0).toBe(0);
  });
});

describe('DoD 4: patch-id를 낼 수 없으면 사유를 밝힌다 (FR-REL-005 AC-5)', () => {
  it('**미러가 있어도 blob 인출이 막혀 있으면 `blob_fetch_disabled`다** (CR-023, DEV-111)', async () => {
    const head = await mirror.resolveHead(REF, 'main');
    const result = await mirror.patchId(REF, head!);

    expect(result.patchId).toBeNull();
    expect(result.unavailable).toBe('blob_fetch_disabled');
    // 실패했는데도 볼륨에 blob이 남지 않았다 — 그것이 이 기본값의 목적이다.
    expect((await objectTypeCounts(sync.dirFor(REPOSITORY_ID)))['blob'] ?? 0).toBe(0);
  });

  it('미러를 쓰지 않는 저장소는 `no_mirror`다', async () => {
    const api = new ApiCommitGraph({ client: {} as unknown as GitHubClient });
    const result = await api.patchId(REF, 'a'.repeat(40));

    expect(result.patchId).toBeNull();
    expect(result.unavailable).toBe('no_mirror');
  });

  it('**켜면 patch-id가 나오지만 blob이 볼륨에 남는다** — 그 대가를 시험이 직접 보여 준다', async () => {
    // 별도 미러에서 확인한다. 앞의 시험들이 보는 볼륨을 오염시키지 않는다.
    const separateRoot = await makeTempDir('prs-mirrors-blob-');
    try {
      const otherSync = makeSync({ root: separateRoot });
      await otherSync.sync(REF, REPOSITORY_ID);
      const eager = makeMirror({ root: separateRoot, allowBlobFetch: true });

      const head = await eager.resolveHead(REF, 'main');
      const result = await eager.patchId(REF, head!);

      expect(result.patchId).toMatch(/^[0-9a-f]{40}$/);
      // **여기가 DEV-111의 증거다.** blobless였던 볼륨에 파일 내용이 생겼다.
      expect((await objectTypeCounts(otherSync.dirFor(REPOSITORY_ID)))['blob'] ?? 0).toBeGreaterThan(0);
    } finally {
      await removeDir(separateRoot);
    }
  }, 120_000);
});

describe('DoD 2: API 폴백이 같은 체인을 만든다 (ADR-005)', () => {
  /** 픽스처의 실제 git 데이터로 답하는 클라이언트. 목이지만 **답은 진짜 git이 낸 것**이다. */
  async function fixtureClient(): Promise<GitHubClient> {
    const head = (await run(origin.dir, ['rev-parse', 'main'])).trim();
    const shas = (await run(origin.dir, ['rev-list', 'main'])).split('\n').filter((l) => l.trim() !== '');
    const commits = await Promise.all(
      shas.map(async (sha) => {
        const parents = (await run(origin.dir, ['rev-list', '--parents', '-n', '1', sha]))
          .trim()
          .split(/\s+/)
          .slice(1);
        return { sha, parents: parents.map((p) => ({ sha: p })), commit: { message: '' } };
      }),
    );
    return {
      getBranchHead: async () => Promise.resolve(head),
      listCommitsPaged: async () => Promise.resolve({ items: commits, truncated: false, maxItems: 5000 }),
      compareCommits: async (_ref: RepoRef, base: string, target: string) => {
        const merged = (await run(origin.dir, ['merge-base', base, target])).trim();
        const ancestor = (await git(origin.dir, ['merge-base', '--is-ancestor', base, target])).code === 0;
        return {
          merge_base_commit: { sha: merged },
          status: base === target ? 'identical' : ancestor ? 'ahead' : 'diverged',
        };
      },
    } as unknown as GitHubClient;
  }

  it('**미러와 API가 같은 픽스처에서 같은 체인을 낸다**', async () => {
    const api = new ApiCommitGraph({ client: await fixtureClient() });
    const head = await api.resolveHead(REF, 'main');

    const viaApi = await api.firstParentRevList(REF, { from: null, to: head! });
    const viaMirror = await mirror.firstParentRevList(REF, { from: null, to: head! });

    expect(viaApi).toEqual(viaMirror);
    expect(viaApi).toEqual(await expectedFirstParent(origin.dir, 'main'));
  });

  it('부분 구간도 일치한다', async () => {
    const api = new ApiCommitGraph({ client: await fixtureClient() });
    const all = await expectedFirstParent(origin.dir, 'main');
    const range = { from: all[0]!, to: all[all.length - 1]! };

    expect(await api.firstParentRevList(REF, range)).toEqual(await mirror.firstParentRevList(REF, range));
  });

  it('조상 판정도 미러와 같다', async () => {
    const api = new ApiCommitGraph({ client: await fixtureClient() });
    const all = await expectedFirstParent(origin.dir, 'main');

    expect(await api.isAncestor(REF, all[0]!, all[3]!)).toBe(await mirror.isAncestor(REF, all[0]!, all[3]!));
    expect(await api.isAncestor(REF, all[3]!, all[0]!)).toBe(await mirror.isAncestor(REF, all[3]!, all[0]!));
  });

  it('**목록이 잘렸으면 던진다** — 잘린 체인으로 채번하면 서수가 전부 밀린다', async () => {
    const truncating = {
      listCommitsPaged: async () => Promise.resolve({ items: [], truncated: true, maxItems: 1 }),
    } as unknown as GitHubClient;
    const api = new ApiCommitGraph({ client: truncating, maxCommits: 1 });

    await expect(api.firstParentRevList(REF, { from: null, to: 'a'.repeat(40) })).rejects.toThrow(/상한/);
  });
});

describe('DoD 5: 미러가 실패하면 API로 넘어간다', () => {
  it('**미러 디렉터리가 없어도 조회가 성립한다** — 폴백이 답한다', async () => {
    const emptyRoot = await makeTempDir('prs-mirrors-empty-');
    try {
      const broken = makeMirror({ root: emptyRoot });
      const stub = {
        resolveHead: async () => Promise.resolve('f'.repeat(40)),
      } as unknown as CommitGraph;

      const fallbacks: unknown[] = [];
      const graph = new FallbackCommitGraph(broken, stub, (error) => fallbacks.push(error));

      expect(await graph.resolveHead(REF, 'main')).toBe('f'.repeat(40));
      // **조용히 넘어가지 않는다.** 폴백은 정상 동작이 아니라 성능·정확도가 떨어진 상태다.
      expect(fallbacks).toHaveLength(1);
    } finally {
      await removeDir(emptyRoot);
    }
  });

  it('미러가 답하면 폴백을 부르지 않는다', async () => {
    let called = 0;
    const stub = {
      resolveHead: async () => {
        called += 1;
        return Promise.resolve('f'.repeat(40));
      },
    } as unknown as CommitGraph;
    const graph = new FallbackCommitGraph(mirror, stub);

    expect(await graph.resolveHead(REF, 'main')).not.toBe('f'.repeat(40));
    expect(called).toBe(0);
  });

  it('`mirror_enabled`가 경로를 고른다 (FR-ING-009 AC-1)', () => {
    const api = new ApiCommitGraph({ client: {} as unknown as GitHubClient });
    expect(selectCommitGraph({ mirror_enabled: true }, { mirror, api }).kind).toBe('mirror');
    expect(selectCommitGraph({ mirror_enabled: false }, { mirror, api }).kind).toBe('api');
  });
});

describe('JOB-MIR-001 미러 동기화', () => {
  it('없으면 클론하고 있으면 fetch한다', async () => {
    const freshRoot = await makeTempDir('prs-mirrors-fresh-');
    try {
      const fresh = makeSync({ root: freshRoot });
      expect((await fresh.sync(REF, REPOSITORY_ID)).action).toBe('cloned');
      expect((await fresh.sync(REF, REPOSITORY_ID)).action).toBe('fetched');
    } finally {
      await removeDir(freshRoot);
    }
  }, 120_000);

  it('**새 커밋이 fetch로 들어온다** — 그래야 채번이 새 head를 본다', async () => {
    const liveRoot = await makeTempDir('prs-mirrors-live-');
    try {
      const live = makeSync({ root: liveRoot });
      await live.sync(REF, REPOSITORY_ID);
      const graph = makeMirror({ root: liveRoot });
      const before = await graph.resolveHead(REF, 'main');

      await run(origin.dir, ['commit', '-q', '--allow-empty', '-m', 'c5 new']);
      await live.sync(REF, REPOSITORY_ID);

      const after = await graph.resolveHead(REF, 'main');
      expect(after).not.toBe(before);
      expect(after).toBe((await run(origin.dir, ['rev-parse', 'main'])).trim());
    } finally {
      await removeDir(liveRoot);
    }
  }, 120_000);

  it('원격이 없으면 실패를 감춘다 — 던져야 잡이 재시도한다', async () => {
    const badRoot = await makeTempDir('prs-mirrors-bad-');
    try {
      const bad = makeSync({ root: badRoot, remoteUrl: () => 'file:///nonexistent-repo-xyz' });
      await expect(bad.sync(REF, REPOSITORY_ID)).rejects.toThrow();
    } finally {
      await removeDir(badRoot);
    }
  }, 120_000);

  it('**미러에 push 경로가 없다** — ADR-005가 못박은 것이고 THR-015의 전제다', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/mirror-sync.ts', import.meta.url), 'utf8');
    const graphSource = await readFile(new URL('../src/mirror-graph.ts', import.meta.url), 'utf8');

    for (const body of [source, graphSource]) {
      expect(body).not.toMatch(/'push'/);
      expect(body).not.toMatch(/'commit'/);
      expect(body).not.toMatch(/'update-ref'/);
    }
  });
});

describe('안전하지 않은 입력', () => {
  it('SHA가 아닌 값을 git에 넘기지 않는다', async () => {
    await expect(mirror.isAncestor(REF, 'HEAD', 'a'.repeat(40))).rejects.toThrow(CommitGraphError);
    await expect(mirror.patchId(REF, '--all')).rejects.toThrow(CommitGraphError);
  });

  it('저장소를 모르면 추측한 경로에서 git을 돌리지 않는다', async () => {
    const unknown = makeMirror({ repositoryIdOf: () => undefined });
    await expect(unknown.resolveHead(REF, 'main')).rejects.toThrow(/repository_id/);
  });
});

/**
 * 커밋 메타데이터 읽기 (WP-067 / CR-038, DEV-208).
 *
 * DoD 1은 "미러 경로와 API 폴백 경로가 **같은 픽스처에서 같은 메타데이터**를 낸다"이다.
 * 그래서 두 경로를 **같은 커밋에 대해 나란히 세우고 값을 직접 비교한다.**
 */
describe('WP-067 DoD 1·2: 커밋 메타데이터와 변경 경로', () => {
  /** 같은 커밋을 API가 답하는 모양으로 바꾼 대역. 실제 git이 정답지다. */
  async function apiGraphFor(sha: string): Promise<CommitGraph> {
    const format = ['%H', '%P', '%an', '%ae', '%cn', '%ce', '%aI', '%cI'].join('%x00');
    const raw = await run(origin.dir, ['show', '--no-patch', `--format=${format}%x00%B`, sha]);
    const parts = raw.split('\u0000');
    const files = (await run(origin.dir, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha]))
      .split('\n')
      .filter((line) => line.trim() !== '');

    const client = {
      getCommitDetail: () =>
        Promise.resolve({
          sha: parts[0],
          parents: (parts[1] ?? '').trim() === '' ? [] : (parts[1] ?? '').trim().split(/\s+/).map((p) => ({ sha: p })),
          commit: {
            message: parts.slice(8).join('\u0000').replace(/\n+$/, ''),
            author: { name: parts[2], email: parts[3], date: parts[6] },
            committer: { name: parts[4], email: parts[5], date: parts[7] },
          },
          files: files.map((filename) => ({ filename })),
        }),
    } as unknown as GitHubClient;
    return new ApiCommitGraph({ client });
  }

  it('**미러와 API 폴백이 같은 커밋에서 같은 메타데이터를 낸다** (DoD 1)', async () => {
    const chain = await mirror.firstParentRevList(REF, { from: null, to: await headSha() });
    const sha = chain.at(-1) ?? '';
    expect(sha).not.toBe('');

    const fromMirror = await mirror.readCommit(REF, sha);
    const fromApi = await (await apiGraphFor(sha)).readCommit(REF, sha);

    expect(fromMirror).not.toBeNull();
    expect(fromApi).toEqual(fromMirror);
  });

  it('부모 SHA·시각·작성자를 실제 git과 대조한다', async () => {
    const sha = (await mirror.firstParentRevList(REF, { from: null, to: await headSha() })).at(-1) ?? '';
    const meta = await mirror.readCommit(REF, sha);
    expect(meta).not.toBeNull();
    if (meta === null) return;

    const expectedParents = (await run(origin.dir, ['rev-list', '--parents', '-n', '1', sha])).trim().split(/\s+/).slice(1);
    expect(meta.parentShas).toEqual(expectedParents);
    expect(meta.committedAt).toBe((await run(origin.dir, ['show', '-s', '--format=%cI', sha])).trim());
    expect(meta.author).toBe((await run(origin.dir, ['show', '-s', '--format=%an', sha])).trim());
    // 메시지가 여러 줄이어도 잘리지 않는다 — 구분자가 NUL이고 %B가 맨 뒤다.
    expect(meta.message).toBe((await run(origin.dir, ['show', '-s', '--format=%B', sha])).replace(/\n+$/, ''));
  });

  it('없는 커밋은 **던지지 않고** `null`이다 — 아직 도착하지 않은 것은 오류가 아니다', async () => {
    expect(await mirror.readCommit(REF, 'b'.repeat(40))).toBeNull();
  });

  it('**변경 경로를 얻은 뒤에도 blob 수가 0이다** (DoD 2 / THR-015)', async () => {
    const dir = `${root}/${String(REPOSITORY_ID)}.git`;
    const before = await objectTypeCounts(dir);
    const chain = await mirror.firstParentRevList(REF, { from: null, to: await headSha() });

    let total = 0;
    for (const sha of chain) {
      const changed = await mirror.changedPaths(REF, sha);
      total += changed.paths.length;
    }
    expect(total).toBeGreaterThan(0);

    const after = await objectTypeCounts(dir);
    // `--name-only`는 트리만 읽는다. `patchId`가 blob을 요구하는 것과 다르다.
    expect(after['blob'] ?? 0).toBe(before['blob'] ?? 0);
    expect(after['blob'] ?? 0).toBe(0);
  });

  it('미러와 API 폴백이 같은 변경 경로를 낸다 (DoD 1)', async () => {
    const sha = (await mirror.firstParentRevList(REF, { from: null, to: await headSha() })).at(-1) ?? '';
    const fromMirror = await mirror.changedPaths(REF, sha);
    const fromApi = await (await apiGraphFor(sha)).changedPaths(REF, sha);
    expect([...fromApi.paths].sort()).toEqual([...fromMirror.paths].sort());
  });

  it('루트 커밋의 변경 경로가 비지 않는다 — 첫 커밋을 "변경 없음"으로 적지 않는다', async () => {
    const chain = await mirror.firstParentRevList(REF, { from: null, to: await headSha() });
    const root0 = chain[0] ?? '';
    expect(root0).not.toBe('');
    const changed = await mirror.changedPaths(REF, root0);
    expect(changed.paths.length).toBeGreaterThan(0);
  });

  it('상한을 넘으면 자르고 **`truncated`로 알린다** — 조용히 자르지 않는다', async () => {
    const sha = (await mirror.firstParentRevList(REF, { from: null, to: await headSha() })).at(-1) ?? '';
    const full = await mirror.changedPaths(REF, sha);
    const capped = await mirror.changedPaths(REF, sha, 1);
    expect(capped.paths).toHaveLength(Math.min(1, full.paths.length));
    expect(capped.truncated).toBe(full.paths.length > 1);
  });
});

/**
 * **미러가 아는 head**를 쓴다.
 *
 * origin의 `HEAD`를 읽으면 앞선 시험이 origin에 붙인 커밋까지 가리키는데, 미러는
 * 그 시점에 동기화되지 않았을 수 있다 — blobless 미러에서 없는 객체를 물으면
 * `bad object`로 죽는다. 정답지가 필요한 자리에서는 origin을 읽되, **그래프에
 * 물을 대상**은 미러가 실제로 가진 것이어야 한다.
 */
async function headSha(): Promise<string> {
  const head = await mirror.resolveHead(REF, 'main');
  expect(head).not.toBeNull();
  return head ?? '';
}
