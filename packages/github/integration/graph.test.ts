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
