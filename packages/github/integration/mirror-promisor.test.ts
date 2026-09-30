/**
 * blobless promisor 미러의 커밋 메타데이터 읽기 (CR-139 / DEV-810·811, WP-120).
 *
 * ## 무엇을 증명하는가
 *
 * `MirrorCommitGraph.readCommit`은 **커밋 객체만** 읽는다. 로컬 미러에 이미 있는 커밋의
 * 메타데이터를 얻으려고 promisor 원격을 부르지 않고, 그래서 API 폴백도 부르지 않는다.
 *
 * **원격 요청은 원격 쪽에서 센다** (`smart-http.ts`). 실제 `git upload-pack`을 HTTP로
 * 서빙하고, 미러는 `MirrorSync`가 그 URL에서 `--mirror --filter=blob:none`으로 만든다 —
 * 운영과 같은 명령·같은 인증 헤더 경로다. stderr 문자열로 "원격에 갔다"를 판정하지 않는다.
 *
 * ## 옛 결함 (DEV-810)
 *
 * `git show --no-patch`는 diff **출력**을 끌 뿐 diff **계산**을 끄지 않는다. 계산에는 이름
 * 변경 감지(`diff.renames` 기본 켜짐)와 병합의 결합 diff가 들어 있고, diff에 추가와 삭제가
 * 함께 있으면 유사도를 재려고 blob을 읽는다. blobless 미러에는 그 blob이 없다:
 *
 * - 지연 인출 차단(`GIT_NO_LAZY_FETCH=1`, 운영 기본) — 원격 요청 없이 `could not fetch …
 *   from promisor remote`로 실패하고 `readCommit`이 `null` → `FallbackCommitGraph`가 API로 간다.
 * - 지연 인출 허용(`MIRROR_ALLOW_BLOB_FETCH=true`) — promisor 원격에서 blob을 받아 볼륨에 남긴다.
 *
 * `git log -1`은 diff를 요청받지 않으면 계산하지 않는다.
 *
 * 검증: `pnpm exec vitest run --config vitest.integration.config.ts packages/github/integration/mirror-promisor`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CommitGraphError,
  FallbackCommitGraph,
  MirrorCommitGraph,
  MirrorSync,
  type CommitGraph,
  type RepoRef,
} from '../src/index.js';
import type { CommitMetadata } from '../src/commit-graph.js';
import { makeTempDir, objectTypeCounts, removeDir, run } from './fixtures.js';
import {
  AUTHOR_NE_COMMITTER,
  KOREAN_MESSAGE,
  METADATA_FORMAT,
  MULTILINE_MESSAGE,
  PROMISOR_CASES,
  RENAME_CANDIDATE_CASES,
  createMailmapOrigin,
  createPromisorOrigin,
  type PromisorOrigin,
} from './promisor-fixture.js';
import { basicAuthorization, startCountingRemote, type CountingRemote } from './smart-http.js';

const REPOSITORY_ID = 1391;
const MAILMAP_REPOSITORY_ID = 1392;
const REF: RepoRef = { owner: 'acme', repo: 'example' };
const MAILMAP_REF: RepoRef = { owner: 'acme', repo: 'mailmap' };
/** 시험 전용 가짜 토큰. 원격은 이 값과 같은지만 세고 기록하지 않는다. */
const FAKE_TOKEN = 'fake-installation-token-cr139';
const PLAIN_ENV = { HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1' };

let origin: PromisorOrigin;
let mailmapOrigin: { readonly dir: string; readonly gitDir: string };
let remote: CountingRemote;
/** 운영 기본 미러 볼륨 (지연 인출 차단). */
let root: string;
/** 지연 인출을 허용한 미러 볼륨 — 시험마다 다시 만든다. */
const extraRoots: string[] = [];
let cloneCounters: ReturnType<CountingRemote['counters']>;

const repositoryIdOf = (ref: RepoRef): number => (ref.repo === 'mailmap' ? MAILMAP_REPOSITORY_ID : REPOSITORY_ID);

function makeSync(volume: string): MirrorSync {
  return new MirrorSync({
    root: volume,
    remoteUrl: (ref) => remote.url(ref.owner, ref.repo),
    tokenFor: async () => Promise.resolve(FAKE_TOKEN),
  });
}

function makeMirror(volume: string, options: { readonly allowBlobFetch?: boolean } = {}): MirrorCommitGraph {
  return new MirrorCommitGraph({
    root: volume,
    repositoryIdOf,
    tokenFor: async () => Promise.resolve(FAKE_TOKEN),
    ...(options.allowBlobFetch === undefined ? {} : { allowBlobFetch: options.allowBlobFetch }),
  });
}

async function freshVolume(ref: RepoRef = REF): Promise<string> {
  const volume = await makeTempDir('prs-cr139-mirrors-');
  extraRoots.push(volume);
  await makeSync(volume).sync(ref, repositoryIdOf(ref));
  return volume;
}

/**
 * 정답지: **모든 blob을 가진 원본**에서 옛 명령(`git show --no-patch`)이 낸 값을 같은
 * 규칙으로 해석한 것. "명령을 바꿔도 의미가 바뀌지 않았다"를 이것과 대조한다.
 */
async function truthOf(sha: string): Promise<CommitMetadata> {
  const raw = await run(origin.dir, ['show', '--no-patch', METADATA_FORMAT, sha, '--'], PLAIN_ENV);
  const parts = raw.split('\u0000');
  const [full, parents, author, authorEmail, committer, committerEmail, authoredAt, committedAt] = parts;
  const orNull = (value: string | undefined): string | null => (value === undefined || value === '' ? null : value);
  return {
    sha: full ?? '',
    parentShas: (parents ?? '').trim() === '' ? [] : (parents ?? '').trim().split(/\s+/),
    message: parts.slice(8).join('\u0000').replace(/\n+$/, ''),
    author: orNull(author),
    authorEmail: orNull(authorEmail),
    committer: orNull(committer),
    committerEmail: orNull(committerEmail),
    authoredAt: authoredAt ?? '',
    committedAt: committedAt ?? '',
  };
}

/** 미러 볼륨의 blob 수. 0이 아니면 무언가가 promisor 원격에서 blob을 받아 왔다. */
async function blobs(volume: string, repositoryId = REPOSITORY_ID): Promise<number> {
  return (await objectTypeCounts(`${volume}/${String(repositoryId)}.git`))['blob'] ?? 0;
}

/** 호출 수를 세는 API 그래프 대역. 답은 원본 git이 낸 정답지다. */
function countingApi(): { readonly graph: CommitGraph; readonly calls: string[] } {
  const calls: string[] = [];
  const graph = {
    kind: 'api',
    readCommit: async (_ref: RepoRef, sha: string) => {
      calls.push(sha);
      return truthOf(sha);
    },
  } as unknown as CommitGraph;
  return { graph, calls };
}

beforeAll(async () => {
  // CI와 로컬의 git 버전이 다를 수 있다 — 기록해 두어야 전후 비교가 버전에 묶인다.
  process.stdout.write(`[CR-139] ${(await run(process.cwd(), ['--version'])).trim()}\n`);
  origin = await createPromisorOrigin();
  mailmapOrigin = await createMailmapOrigin(origin);
  remote = await startCountingRemote({
    repos: { '/acme/example.git': origin.gitDir, '/acme/mailmap.git': mailmapOrigin.gitDir },
    expectedAuthorization: basicAuthorization(FAKE_TOKEN),
  });
  root = await makeTempDir('prs-cr139-mirrors-');
  remote.reset();
  await makeSync(root).sync(REF, REPOSITORY_ID);
  cloneCounters = remote.counters();
}, 120_000);

afterAll(async () => {
  await remote.close();
  await removeDir(origin.dir);
  await removeDir(mailmapOrigin.dir);
  await removeDir(root);
  for (const volume of extraRoots) await removeDir(volume);
});

describe('CR-139 픽스처: 실제 blobless promisor 미러', () => {
  it('**promisor=true·partialclonefilter=blob:none이고 커밋·트리는 있으나 blob은 0이다** — 필터가 무시됐으면 이 파일은 아무것도 검증하지 못한다', async () => {
    const dir = `${root}/${String(REPOSITORY_ID)}.git`;
    expect((await run(dir, ['config', '--get', 'remote.origin.promisor'])).trim()).toBe('true');
    expect((await run(dir, ['config', '--get', 'remote.origin.partialclonefilter'])).trim()).toBe('blob:none');
    const counts = await objectTypeCounts(dir);
    expect(counts['commit']).toBeGreaterThan(0);
    expect(counts['tree']).toBeGreaterThan(0);
    expect(counts['blob'] ?? 0).toBe(0);
  });

  it('복제는 HTTP 원격을 실제로 불렀고 **모든 요청이 설치 토큰 헤더를 실었다** — 값은 기록하지 않는다', () => {
    expect(cloneCounters.total).toBeGreaterThan(0);
    expect(cloneCounters.authMatched).toBe(cloneCounters.total);
  });
});

describe('DEV-810: readCommit은 원격을 부르지 않고 커밋 객체만 읽는다', () => {
  it.each(PROMISOR_CASES)('%s — 옛 명령이 원본에서 낸 값과 필드마다 같고 원격 요청은 0이다', async (name) => {
    const mirror = makeMirror(root);
    const sha = origin.shas[name];
    remote.reset();

    const meta = await mirror.readCommit(REF, sha);

    expect(meta).toEqual(await truthOf(sha));
    expect(remote.counters().total).toBe(0);
    expect(await blobs(root)).toBe(0);
  });

  it('손으로 선언한 모양이 그대로 나온다 — 루트·병합·octopus·빈 메시지·한글·여러 줄·작성자≠커미터·시간대 오프셋', async () => {
    const mirror = makeMirror(root);
    const read = async (name: keyof PromisorOrigin['shas']): Promise<CommitMetadata> => {
      const meta = await mirror.readCommit(REF, origin.shas[name]);
      expect(meta).not.toBeNull();
      return meta as CommitMetadata;
    };

    expect((await read('root')).parentShas).toEqual([]);
    expect((await read('mergeAddDelete')).parentShas).toHaveLength(2);
    expect((await read('mergeClean')).parentShas).toHaveLength(2);
    expect((await read('octopus')).parentShas).toHaveLength(3);
    expect((await read('emptyMessage')).message).toBe('');
    expect((await read('korean')).message).toBe(KOREAN_MESSAGE);
    expect((await read('multiline')).message).toBe(MULTILINE_MESSAGE);
    expect(await read('authorNeCommitter')).toMatchObject(AUTHOR_NE_COMMITTER);
    // 요청한 SHA가 곧 답의 SHA다.
    for (const name of PROMISOR_CASES) expect((await read(name)).sha).toBe(origin.shas[name]);
  });

  it('**지연 인출을 허용한 미러에서도 원격 0·blob 0이다** — git이 원격에 갈 수 있는 설정에서도 가지 않는다', async () => {
    const volume = await freshVolume();
    const eager = makeMirror(volume, { allowBlobFetch: true });
    remote.reset();

    for (const name of RENAME_CANDIDATE_CASES) {
      expect(await eager.readCommit(REF, origin.shas[name])).toEqual(await truthOf(origin.shas[name]));
    }

    expect(remote.counters().total).toBe(0);
    expect(await blobs(volume)).toBe(0);
  }, 60_000);

  it('**원격이 모든 요청을 503으로 거절해도 읽는다** — 원격이 실패했는데 결과가 나온 것이 아니라 원격을 부르지 않았다', async () => {
    const volume = await freshVolume();
    const mirrors = [makeMirror(root), makeMirror(volume, { allowBlobFetch: true })];
    remote.reset();
    remote.setMode('reject');
    try {
      for (const mirror of mirrors) {
        for (const name of RENAME_CANDIDATE_CASES) {
          expect(await mirror.readCommit(REF, origin.shas[name])).toEqual(await truthOf(origin.shas[name]));
        }
      }
      expect(remote.counters().total).toBe(0);
    } finally {
      remote.setMode('serve');
    }
  }, 60_000);

  it('같은 커밋을 100번 읽어도 원격 요청이 늘지 않는다', async () => {
    const mirror = makeMirror(root);
    const sha = origin.shas.renameEdit;
    remote.reset();
    let read = 0;
    for (let round = 0; round < 100; round += 1) {
      if ((await mirror.readCommit(REF, sha)) !== null) read += 1;
    }
    expect(read).toBe(100);
    expect(remote.counters().total).toBe(0);
  }, 60_000);

  it('주석 태그 객체의 SHA를 그 태그가 가리키는 커밋으로 바꿔 답하지 않는다', async () => {
    await expect(makeMirror(root).readCommit(REF, origin.annotatedTagObject)).rejects.toThrow(CommitGraphError);
  });
});

describe('DEV-810: API 폴백은 정상 상황에서만 돈다', () => {
  it('**로컬에 있는 커밋은 API로 넘어가지 않는다** — 이름 변경·삭제+추가·병합 모두 graph_fallback 0, API 호출 0', async () => {
    const api = countingApi();
    const fallbacks: unknown[] = [];
    const graph = new FallbackCommitGraph(makeMirror(root), api.graph, (error) => fallbacks.push(error));
    remote.reset();

    for (const name of PROMISOR_CASES) {
      expect(await graph.readCommit(REF, origin.shas[name])).toEqual(await truthOf(origin.shas[name]));
    }

    expect(fallbacks).toEqual([]);
    expect(api.calls).toEqual([]);
    expect(remote.counters().total).toBe(0);
  });

  it('**미러에 아직 없는 커밋은 `null`이고 원격을 부르지 않는다** — 폴백이 한 번 돌아 API가 답한다 (지연 인출 차단이 이것을 지킨다)', async () => {
    const volume = await freshVolume();
    // 미러를 만든 뒤 원본에만 생긴 커밋.
    await run(origin.dir, ['commit', '-q', '--allow-empty', '-m', 'after the mirror clone'], PLAIN_ENV);
    const late = (await run(origin.dir, ['rev-parse', 'HEAD'], PLAIN_ENV)).trim();
    try {
      const mirror = makeMirror(volume);
      remote.reset();
      expect(await mirror.readCommit(REF, late)).toBeNull();
      expect(remote.counters().total).toBe(0);

      const api = countingApi();
      const fallbacks: unknown[] = [];
      const graph = new FallbackCommitGraph(mirror, api.graph, (error) => fallbacks.push(error));
      expect((await graph.readCommit(REF, late))?.sha).toBe(late);
      expect(fallbacks).toHaveLength(1);
      expect(api.calls).toEqual([late]);
      expect(remote.counters().total).toBe(0);
    } finally {
      await run(origin.dir, ['reset', '-q', '--hard', 'HEAD~1'], PLAIN_ENV);
    }
  }, 60_000);

  it('미러가 없는 저장소는 여전히 API로 폴백한다', async () => {
    const empty = await makeTempDir('prs-cr139-empty-');
    extraRoots.push(empty);
    const api = countingApi();
    const fallbacks: unknown[] = [];
    const graph = new FallbackCommitGraph(makeMirror(empty), api.graph, (error) => fallbacks.push(error));

    expect((await graph.readCommit(REF, origin.shas.modifyOnly))?.sha).toBe(origin.shas.modifyOnly);
    expect(fallbacks).toHaveLength(1);
    expect(api.calls).toEqual([origin.shas.modifyOnly]);
  });
});

describe('DEV-811: HEAD의 `.mailmap` blob을 읽지 않는다', () => {
  it('**bare 미러의 HEAD에 `.mailmap`이 있어도 readCommit·firstParentCommits는 blob을 받지 않는다** (지연 인출 허용 조건)', async () => {
    const volume = await freshVolume(MAILMAP_REF);
    const eager = makeMirror(volume, { allowBlobFetch: true });
    remote.reset();

    const meta = await eager.readCommit(MAILMAP_REF, origin.shas.modifyOnly);
    // `%an`은 메일맵을 적용하지 않은 원래 이름이다 — 끄는 것이 값을 바꾸지 않는다.
    expect(meta).toEqual(await truthOf(origin.shas.modifyOnly));
    expect(meta?.author).toBe('fixture');

    const head = await eager.resolveHead(MAILMAP_REF, 'main');
    const chain = await eager.firstParentCommits(MAILMAP_REF, { from: null, to: head ?? '' });
    expect(chain.length).toBeGreaterThan(0);

    expect(remote.counters().total).toBe(0);
    expect(await blobs(volume, MAILMAP_REPOSITORY_ID)).toBe(0);
  }, 60_000);
});

describe('patchId는 여전히 blob을 요구한다 — readCommit과 섞지 않는다 (allowBlobFetch 계약)', () => {
  it('차단이면 `blob_fetch_disabled`이고 원격 0이다', async () => {
    remote.reset();
    const result = await makeMirror(root).patchId(REF, origin.shas.renameEdit);
    expect(result).toEqual({ patchId: null, unavailable: 'blob_fetch_disabled' });
    expect(remote.counters().total).toBe(0);
  });

  it('허용이면 **토큰 헤더를 실은** 원격 요청으로 blob을 받아 patch-id를 낸다', async () => {
    const volume = await freshVolume();
    remote.reset();
    const result = await makeMirror(volume, { allowBlobFetch: true }).patchId(REF, origin.shas.renameEdit);
    expect(result.patchId).toMatch(/^[0-9a-f]{40}$/);
    const counters = remote.counters();
    expect(counters.total).toBeGreaterThan(0);
    expect(counters.authMatched).toBe(counters.total);
    expect(await blobs(volume)).toBeGreaterThan(0);
  }, 60_000);
});
