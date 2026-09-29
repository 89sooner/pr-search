import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compareTreePaths,
  walkTreeDiff,
  type TreeDiffChange,
  type TreeDiffEntry,
  type TreeDiffListing,
  type TreeDiffPage,
  type TreeDiffProvider,
} from './tree-diff.js';

// ── 가짜 Git 저장소 ────────────────────────────────────────────────────────────

type FileMode = '100644' | '100755' | '120000';
type Leaf =
  | { readonly kind: 'file'; readonly content: string; readonly mode: FileMode }
  | { readonly kind: 'submodule'; readonly commit: string };
/** 경로 → 잎(파일·심볼릭 링크·서브모듈). 디렉터리는 경로에서 나온다. */
type Snapshot = ReadonlyMap<string, Leaf>;
type Dir = Map<string, Dir | Leaf>;

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');
const file = (content: string, mode: FileMode = '100644'): Leaf => ({ kind: 'file', content, mode });
const submodule = (commit: string): Leaf => ({ kind: 'submodule', commit });

function snapshot(spec: Readonly<Record<string, string | Leaf>>): Snapshot {
  return new Map(Object.entries(spec).map(([path, leaf]): [string, Leaf] => [path, typeof leaf === 'string' ? file(leaf) : leaf]));
}

function ancestorsOf(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/** 내용 주소 방식: 같은 내용의 blob·트리는 같은 SHA다. 목록은 GitHub처럼 Git 순서로 돌려준다. */
class FakeGitStore {
  private readonly trees = new Map<string, readonly TreeDiffEntry[]>();
  private inFlight = 0;
  readonly calls: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  readonly truncated = new Set<string>();
  beforeCall: (sha: string) => void = () => undefined;
  peakInFlight = 0;

  write(files: Snapshot): string {
    const root: Dir = new Map();
    for (const [path, leaf] of files) {
      const segments = path.split('/');
      const name = segments.pop()!;
      let dir = root;
      for (const segment of segments) {
        const next = dir.get(segment) ?? new Map<string, Dir | Leaf>();
        if (!(next instanceof Map)) throw new Error(`${path}: a file is in the way`);
        dir.set(segment, next);
        dir = next;
      }
      if (dir.has(name)) throw new Error(`${path}: already present`);
      dir.set(name, leaf);
    }
    return this.writeDir(root);
  }

  private writeDir(dir: Dir): string {
    const entries = [...dir].map(([name, node]): TreeDiffEntry => {
      if (node instanceof Map) return { name, type: 'tree', mode: '040000', sha: this.writeDir(node) };
      if (node.kind === 'submodule') return { name, type: 'commit', mode: '160000', sha: node.commit };
      return { name, type: 'blob', mode: node.mode, sha: sha1(`blob ${node.content}`) };
    });
    // Git 순서: 트리 이름 뒤에 '/'를 붙여 비교한다 (그래서 a-b, a.c, a/ 순이 된다).
    const gitKey = (entry: TreeDiffEntry): string => (entry.type === 'tree' ? `${entry.name}/` : entry.name);
    entries.sort((x, y) => (gitKey(x) < gitKey(y) ? -1 : gitKey(x) > gitKey(y) ? 1 : 0));
    const sha = sha1(`tree ${entries.map(entry => `${entry.mode} ${entry.type} ${entry.sha} ${entry.name}`).join('\n')}`);
    this.trees.set(sha, entries);
    return sha;
  }

  provider(): TreeDiffProvider {
    return {
      tree: async (sha, signal) => {
        this.calls.push(sha);
        this.signals.push(signal);
        this.beforeCall(sha);
        this.inFlight += 1;
        this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
        await Promise.resolve();
        this.inFlight -= 1;
        return this.listing(sha);
      },
    };
  }

  /** 호출 기록에 남지 않는 직접 조회. */
  listing(sha: string): TreeDiffListing {
    const entries = this.trees.get(sha);
    if (entries === undefined) throw new Error(`unknown tree ${sha}`);
    return { entries, truncated: this.truncated.has(sha) };
  }

  shaAt(root: string, path: string): string {
    let sha = root;
    for (const name of path === '' ? [] : path.split('/')) {
      const entry = this.listing(sha).entries.find(candidate => candidate.name === name && candidate.type === 'tree');
      if (entry === undefined) throw new Error(`no directory ${path}`);
      sha = entry.sha;
    }
    return sha;
  }

  /** 디렉터리 경로('' = 루트) → 트리 SHA. */
  directories(root: string, prefix = '', into = new Map<string, string>()): Map<string, string> {
    into.set(prefix, root);
    for (const entry of this.listing(root).entries) {
      if (entry.type === 'tree') this.directories(entry.sha, prefix === '' ? entry.name : `${prefix}/${entry.name}`, into);
    }
    return into;
  }
}

// ── 기준 비교 (트리 구성 코드를 거치지 않는다) ─────────────────────────────────

/** 명세 그대로의 비교: '/'로 나눈 조각을 차례로 평문 비교한다. */
function naiveCompare(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const x = left[index]!;
    const y = right[index]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return Math.sign(left.length - right.length);
}

const leafKey = (leaf: Leaf): string => (leaf.kind === 'submodule' ? `commit 160000 ${leaf.commit}` : `blob ${leaf.mode} ${leaf.content}`);

/** 양쪽 잎을 경로로 평평하게 펼쳐 맞댄다. 한쪽 잎·다른 쪽 디렉터리인 경로는 잎만 removed/added가 된다. */
function referenceDiff(base: Snapshot, head: Snapshot): TreeDiffChange[] {
  const changes: TreeDiffChange[] = [];
  for (const [path, leaf] of base) {
    const other = head.get(path);
    if (other === undefined) changes.push({ path, status: 'removed' });
    else if (leafKey(other) !== leafKey(leaf)) changes.push({ path, status: 'modified' });
  }
  for (const path of head.keys()) if (!base.has(path)) changes.push({ path, status: 'added' });
  return changes.sort((x, y) => naiveCompare(x.path, y.path));
}

/** 전체를 한 번에 걸을 때 필요한 목록 호출 수: 양쪽 SHA가 다른 디렉터리만, 있는 쪽만큼. */
function changedListings(store: FakeGitStore, baseRoot: string | null, headRoot: string): number {
  const baseDirs = baseRoot === null ? new Map<string, string>() : store.directories(baseRoot);
  const headDirs = store.directories(headRoot);
  let listings = 0;
  for (const dir of new Set([...baseDirs.keys(), ...headDirs.keys()])) {
    const before = baseDirs.get(dir);
    const after = headDirs.get(dir);
    if (before !== after) listings += (before === undefined ? 0 : 1) + (after === undefined ? 0 : 1);
  }
  return listings;
}

function repo(base: Snapshot | null, head: Snapshot) {
  const store = new FakeGitStore();
  const baseRoot = base === null ? null : store.write(base);
  const headRoot = store.write(head);
  return { store, provider: store.provider(), baseRoot, headRoot, reference: referenceDiff(base ?? new Map(), head) };
}

async function readAllPages(provider: TreeDiffProvider, baseRoot: string | null, headRoot: string, limit: number): Promise<TreeDiffPage[]> {
  const pages: TreeDiffPage[] = [];
  let after: string | null = null;
  do {
    const page: TreeDiffPage = await walkTreeDiff(provider, baseRoot, headRoot, { after, limit });
    pages.push(page);
    after = page.after;
  } while (after !== null && pages.length <= 100_000);
  return pages;
}

/** 이어 붙이면 기준과 같고, 페이지 수는 ceil(N/limit)(미리 보기 덕분에 빈 마지막 페이지가 없다), after는 마지막 페이지에서만 null. */
function expectPaging(pages: readonly TreeDiffPage[], reference: readonly TreeDiffChange[], limit: number, label = ''): void {
  const count = Math.max(1, Math.ceil(reference.length / limit));
  const expected = Array.from({ length: count }, (_, index) => index === count - 1
    ? { size: reference.length - limit * index, after: null }
    : { size: limit, after: reference[limit * (index + 1) - 1]!.path });
  expect({ label, limit, pages: pages.map(page => ({ size: page.changes.length, after: page.after })) }).toEqual({ label, limit, pages: expected });
  const flat = pages.flatMap(page => page.changes);
  expect({ label, limit, changes: flat }).toEqual({ label, limit, changes: reference });
  const outOfOrder = flat.filter((change, index) => index > 0 && compareTreePaths(flat[index - 1]!.path, change.path) >= 0);
  expect(outOfOrder).toEqual([]);
}

// ── 시드 고정 난수 저장소 ─────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('empty choice');
  return item;
}

interface RepoShape {
  readonly files: number;
  readonly operations: number;
  readonly depths: readonly number[];
  readonly dirNames: readonly string[];
  readonly fileNames: readonly string[];
}

// 'a'·'a-b'·'a.b'처럼 조각 순서와 평문 순서가 갈리는 이름, 파일·디렉터리가 겹치는 이름을 일부러 섞는다.
const BIG: RepoShape = {
  files: 4000,
  operations: 4000,
  depths: [0, 1, 1, 2, 2, 2, 3, 3, 4],
  dirNames: ['a', 'a-b', 'a.b', 'a_b', 'B', 'b', 'lib', 'src', 'x', 'd1', 'd2', 'd10'],
  fileNames: ['a', 'a-b', 'a.txt', 'b.md', 'B', 'index.ts', 'lib', 'x', 'x.y', 'Z', ...Array.from({ length: 120 }, (_, index) => `f${index}${['', '.ts', '-x', '.md'][index % 4]}`)],
};
const SMALL: RepoShape = { files: 24, operations: 14, depths: [0, 1, 1, 2, 2, 3], dirNames: ['a', 'a-b', 'b'], fileNames: ['a', 'a-b', 'a.c', 'b', 'c'] };

function randomPath(rng: () => number, shape: RepoShape): string {
  const dirs = Array.from({ length: pick(rng, shape.depths) }, () => pick(rng, shape.dirNames));
  return [...dirs, pick(rng, shape.fileNames)].join('/');
}

function randomLeaf(rng: () => number): Leaf {
  const roll = rng();
  const content = `content ${Math.floor(rng() * 1e9)}`;
  if (roll < 0.03) return submodule(sha1(content));
  if (roll < 0.06) return file(content, '120000');
  if (roll < 0.1) return file(content, '100755');
  return file(content);
}

/** 파일과 디렉터리가 같은 경로에 겹치지 않게 막는 편집용 스냅숏. */
class MutableSnapshot {
  readonly files = new Map<string, Leaf>();
  private readonly dirs = new Map<string, number>(); // 디렉터리 → 그 아래 파일 수

  put(path: string, leaf: Leaf): void {
    if (!this.files.has(path)) {
      const ancestors = ancestorsOf(path);
      if (this.dirs.has(path) || ancestors.some(dir => this.files.has(dir))) return;
      for (const dir of ancestors) this.dirs.set(dir, (this.dirs.get(dir) ?? 0) + 1);
    }
    this.files.set(path, leaf);
  }

  delete(path: string): void {
    if (!this.files.delete(path)) return;
    for (const dir of ancestorsOf(path)) {
      const count = (this.dirs.get(dir) ?? 0) - 1;
      if (count > 0) this.dirs.set(dir, count);
      else this.dirs.delete(dir);
    }
  }

  filesUnder(dir: string): string[] {
    return [...this.files.keys()].filter(path => path.startsWith(`${dir}/`));
  }
}

function mutate(rng: () => number, tree: MutableSnapshot, shape: RepoShape): void {
  const roll = rng();
  const paths = [...tree.files.keys()];
  if (roll < 0.25 || paths.length === 0) {
    tree.put(randomPath(rng, shape), randomLeaf(rng)); // 추가(이미 있으면 덮어쓰기)
    return;
  }
  const path = pick(rng, paths);
  const leaf = tree.files.get(path)!;
  if (roll < 0.5) {
    tree.put(path, leaf.kind === 'file' ? file(`${leaf.content}*`, leaf.mode) : submodule(sha1(leaf.commit)));
  } else if (roll < 0.68) {
    tree.delete(path);
  } else if (roll < 0.74) {
    if (leaf.kind === 'file') tree.put(path, file(leaf.content, leaf.mode === '100644' ? '100755' : '100644')); // 모드만
  } else if (roll < 0.77) {
    if (leaf.kind === 'file') tree.put(path, file(leaf.content, '120000')); // 같은 blob의 심볼릭 링크
  } else if (roll < 0.8) {
    tree.put(path, submodule(sha1(`${path} ${rng()}`)));
  } else if (roll < 0.9) {
    tree.delete(path); // 파일 → 디렉터리
    const count = 1 + Math.floor(rng() * 3);
    for (let index = 0; index < count; index += 1) tree.put(`${path}/${pick(rng, shape.fileNames)}`, randomLeaf(rng));
  } else {
    const dir = ancestorsOf(path).at(-1); // 작은 디렉터리 → 파일, 또는 통째 삭제
    if (dir === undefined) return;
    const doomed = tree.filesUnder(dir);
    if (doomed.length > 8) return;
    for (const victim of doomed) tree.delete(victim);
    if (rng() < 0.6) tree.put(dir, randomLeaf(rng));
  }
}

function randomRepository(seed: number, shape: RepoShape): { readonly base: Snapshot; readonly head: Snapshot } {
  const rng = mulberry32(seed);
  const tree = new MutableSnapshot();
  for (let attempt = 0; tree.files.size < shape.files && attempt < shape.files * 50; attempt += 1) {
    const path = randomPath(rng, shape);
    if (!tree.files.has(path)) tree.put(path, randomLeaf(rng));
  }
  const base = new Map(tree.files);
  for (let step = 0; step < shape.operations; step += 1) mutate(rng, tree, shape);
  return { base, head: new Map(tree.files) };
}

// ── 시험 ──────────────────────────────────────────────────────────────────────

describe('CR-132 FR-SRC-004 compareTreePaths', () => {
  it('puts an ancestor before its descendants and compares segment by segment, not as one string', () => {
    expect(compareTreePaths('a', 'a/b')).toBe(-1);
    expect(compareTreePaths('a/b', 'a')).toBe(1);
    expect(compareTreePaths('a', 'a-b')).toBe(-1);
    expect(compareTreePaths('a/b', 'a-b')).toBe(-1); // 조각 'a' < 'a-b'
    expect('a-b' < 'a/b').toBe(true); // 평문 비교는 반대다
    expect(compareTreePaths('a/b/c', 'a-b')).toBe(-1);
    expect(compareTreePaths('a/b', 'a.b')).toBe(-1);
    expect(compareTreePaths('a-b', 'a/b')).toBe(1);
  });

  it('orders siblings and deep paths, and returns 0 only for equal paths', () => {
    expect(compareTreePaths('src/a.ts', 'src/b.ts')).toBe(-1);
    expect(compareTreePaths('src/b.ts', 'src/a.ts')).toBe(1);
    expect(compareTreePaths('x/y/z/w', 'x/y-z')).toBe(-1);
    expect(compareTreePaths('x/y/z/w', 'x/y/z')).toBe(1);
    expect(compareTreePaths('x/y/z', 'x/y/z')).toBe(0);
    expect(compareTreePaths('', '')).toBe(0);
    expect(compareTreePaths('B', 'a')).toBe(-1); // UTF-16 코드 단위: 대문자가 앞선다
    expect(['a-b', 'a.b', 'a/b', 'a', 'a/b/c', 'B', 'a0', 'a/b-c', 'a/b/c.d'].sort(compareTreePaths))
      .toEqual(['B', 'a', 'a/b', 'a/b/c', 'a/b/c.d', 'a/b-c', 'a-b', 'a.b', 'a0']);
  });

  it('agrees with a naive split-on-slash comparison on 5,000 random pairs, including empty and doubled segments', () => {
    const rng = mulberry32(7);
    const alphabet = ['a', 'b', 'B', '-', '.', '/', '_', '0', ' ', '~', 'é'];
    const text = (): string => Array.from({ length: Math.floor(rng() * 7) }, () => pick(rng, alphabet)).join('');
    const mismatches: string[][] = [];
    for (let round = 0; round < 5000; round += 1) {
      const a = text();
      const b = rng() < 0.5 ? text() : a.slice(0, Math.floor(rng() * (a.length + 1))) + text();
      const expected = naiveCompare(a, b);
      if (compareTreePaths(a, b) !== expected || compareTreePaths(b, a) !== -expected) mismatches.push([a, b]);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff changes', () => {
  it('returns nothing and calls the provider zero times when both roots are the same tree', async () => {
    const files = snapshot({ 'a.txt': 'a', 'src/x.ts': 'x' });
    const { store, provider, baseRoot, headRoot } = repo(files, files);
    expect(baseRoot).toBe(headRoot);
    expect(await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10 }))
      .toEqual({ changes: [], after: null, incomplete: false, treeCalls: 0 });
    expect(store.calls).toEqual([]);
  });

  it('lists only the two roots when different root SHAs hold identical entries', async () => {
    const entries: readonly TreeDiffEntry[] = [
      { name: 'a.txt', type: 'blob', mode: '100644', sha: sha1('a') },
      { name: 'src', type: 'tree', mode: '040000', sha: sha1('src') },
      { name: 'vendor', type: 'commit', mode: '160000', sha: sha1('vendor') },
    ];
    const calls: string[] = [];
    const provider: TreeDiffProvider = { tree: async sha => { calls.push(sha); return { entries, truncated: false }; } };
    expect(await walkTreeDiff(provider, 'root-1', 'root-2', { after: null, limit: 10 }))
      .toEqual({ changes: [], after: null, incomplete: false, treeCalls: 2 });
    expect([...calls].sort()).toEqual(['root-1', 'root-2']);
  });

  it('reports added, removed and modified files and whole added or removed directories in tree order', async () => {
    const base = snapshot({ 'README.md': 'v1', 'keep.txt': 'same', 'gone.txt': 'bye', 'old/a.ts': '1', 'old/deep/b.ts': '2', 'src/app.ts': 'v1', 'src/util.ts': 'same', 'stable/x.ts': 'x' });
    const head = snapshot({ 'README.md': 'v2', 'keep.txt': 'same', 'new/x.ts': 'x', 'new/sub/y.ts': 'y', 'src/app.ts': 'v2', 'src/util.ts': 'same', 'src/added.ts': 'n', 'stable/x.ts': 'x' });
    const { store, provider, baseRoot, headRoot, reference } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 100 });
    expect(page.changes).toEqual([
      { path: 'README.md', status: 'modified' },
      { path: 'gone.txt', status: 'removed' },
      { path: 'new/sub/y.ts', status: 'added' },
      { path: 'new/x.ts', status: 'added' },
      { path: 'old/a.ts', status: 'removed' },
      { path: 'old/deep/b.ts', status: 'removed' },
      { path: 'src/added.ts', status: 'added' },
      { path: 'src/app.ts', status: 'modified' },
    ]);
    expect(page.changes).toEqual(reference);
    expect(page.after).toBeNull();
    // 루트 2, new 1, new/sub 1, old 1, old/deep 1, src 2 — 바뀌지 않은 stable은 가져오지 않는다
    expect(page.treeCalls).toBe(8);
    expect(store.calls).not.toContain(store.shaAt(headRoot, 'stable'));
  });

  it('reports a file replaced by a directory and a directory replaced by a file, the leaf before its subtree', async () => {
    const base = snapshot({ x: 'file', 'y/a': '1', 'y/b/c': '2', z: 'same' });
    const head = snapshot({ 'x/a': '1', 'x/b': '2', y: 'file', z: 'same' });
    const { provider, baseRoot, headRoot, reference } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 100 });
    expect(page.changes).toEqual([
      { path: 'x', status: 'removed' },
      { path: 'x/a', status: 'added' },
      { path: 'x/b', status: 'added' },
      { path: 'y', status: 'added' },
      { path: 'y/a', status: 'removed' },
      { path: 'y/b/c', status: 'removed' },
    ]);
    expect(page.changes).toEqual(reference);
  });

  it('treats a submodule as a leaf: pointer moves, file to submodule, submodule to directory, added and removed', async () => {
    const base = snapshot({ 'lib/core': submodule(sha1('core 1')), 'lib/tool': 'a file', 'old-ext': submodule(sha1('old')), same: submodule(sha1('same')), vendor: submodule(sha1('vendor 1')) });
    const head = snapshot({ ext: submodule(sha1('ext')), 'lib/core': submodule(sha1('core 2')), 'lib/tool': submodule(sha1('tool')), same: submodule(sha1('same')), 'vendor/package.json': '{}' });
    const { provider, baseRoot, headRoot, reference } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 100 });
    expect(page.changes).toEqual([
      { path: 'ext', status: 'added' },
      { path: 'lib/core', status: 'modified' },
      { path: 'lib/tool', status: 'modified' },
      { path: 'old-ext', status: 'removed' },
      { path: 'vendor', status: 'removed' },
      { path: 'vendor/package.json', status: 'added' },
    ]);
    expect(page.changes).toEqual(reference);
  });

  it('reports a mode-only change of the same blob as modified, including a file that becomes a symlink', async () => {
    const base = snapshot({ link: file('target'), plain: file('same', '100755'), 'run.sh': file('echo hi') });
    const head = snapshot({ link: file('target', '120000'), plain: file('same', '100755'), 'run.sh': file('echo hi', '100755') });
    const { store, provider, baseRoot, headRoot, reference } = repo(base, head);
    const blobs = (root: string): string[] => store.listing(root).entries.map(entry => entry.sha);
    expect(blobs(baseRoot!)).toEqual(blobs(headRoot)); // SHA는 같고 모드만 다르다
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 100 });
    expect(page.changes).toEqual([{ path: 'link', status: 'modified' }, { path: 'run.sh', status: 'modified' }]);
    expect(page.changes).toEqual(reference);
  });

  it('lists every file as added when there is no base tree, fetching the head side only', async () => {
    const head = snapshot({ 'a/b/c.txt': '1', 'a/d.txt': '2', 'a-b': '3', e: submodule(sha1('e')), 'e.md': '4' });
    const { provider, headRoot, reference } = repo(null, head);
    const page = await walkTreeDiff(provider, null, headRoot, { after: null, limit: 100 });
    expect(page.changes.map(change => change.path)).toEqual(['a/b/c.txt', 'a/d.txt', 'a-b', 'e', 'e.md']);
    expect(page.changes.every(change => change.status === 'added')).toBe(true);
    expect(page.changes).toEqual(reference);
    expect(page.treeCalls).toBe(3); // 루트, a, a/b
  });

  it('sorts each directory itself instead of trusting the Git listing order', async () => {
    const { store, provider, headRoot } = repo(null, snapshot({ 'a/x': '1', 'a-b': '2', 'a.c': '3' }));
    expect(store.listing(headRoot).entries.map(entry => entry.name)).toEqual(['a-b', 'a.c', 'a']);
    const page = await walkTreeDiff(provider, null, headRoot, { after: null, limit: 10 });
    expect(page.changes.map(change => change.path)).toEqual(['a/x', 'a-b', 'a.c']);
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff paging and cursors', () => {
  // 참조 순서: a.txt M, b.txt R, c/1 R, c/2 M, c/3 A, d R, d/1 A, d/2 A, e A, e/f/g R, e/f/h R,
  //            gone/sub/1 R, gone/sub/2 R, gone/x R, y.txt A (15건)
  const base = snapshot({ 'a.txt': '1', 'b.txt': '2', 'c/1': '3', 'c/2': '4', d: 'file', 'e/f/g': '5', 'e/f/h': '6', 'gone/sub/1': '7', 'gone/sub/2': '8', 'gone/x': '9', z: 'same' });
  const head = snapshot({ 'a.txt': '1*', 'c/2': '4*', 'c/3': 'new', 'd/1': 'x', 'd/2': 'y', e: 'now a file', 'y.txt': 'new', z: 'same' });

  it.each([1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 100])('reads the whole diff in pages of %i', async limit => {
    const { provider, baseRoot, headRoot, reference } = repo(base, head);
    expect(reference).toHaveLength(15);
    expectPaging(await readAllPages(provider, baseRoot, headRoot, limit), reference, limit);
  });

  it('returns after: null on the last page when the total is an exact multiple of the limit', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const pages = await readAllPages(provider, baseRoot, headRoot, 5);
    expect(pages.map(page => [page.changes.length, page.after])).toEqual([[5, 'c/3'], [5, 'e/f/g'], [5, null]]);
  });

  it('resumes after a file that became a directory: the cursor entry is not repeated, its new subtree is walked', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'd', limit: 2 });
    expect(page.changes).toEqual([{ path: 'd/1', status: 'added' }, { path: 'd/2', status: 'added' }]);
    expect(page.after).toBe('d/2');
  });

  it('resumes after a directory that became a file: its removed subtree follows', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'e', limit: 2 });
    expect(page.changes).toEqual([{ path: 'e/f/g', status: 'removed' }, { path: 'e/f/h', status: 'removed' }]);
    expect(page.after).toBe('e/f/h');
  });

  it('resumes after a removed file', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'b.txt', limit: 2 });
    expect(page.changes).toEqual([{ path: 'c/1', status: 'removed' }, { path: 'c/2', status: 'modified' }]);
    expect(page.after).toBe('c/2');
  });

  it('resumes inside a directory removed from head, fetching only the cursor ancestors and what follows', async () => {
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'gone/sub/1', limit: 10 });
    expect(page).toEqual({
      changes: [{ path: 'gone/sub/2', status: 'removed' }, { path: 'gone/x', status: 'removed' }, { path: 'y.txt', status: 'added' }],
      after: null,
      incomplete: false,
      treeCalls: 4, // 루트 2, gone 1, gone/sub 1 (head에는 gone이 없다)
    });
    const skipped = [store.shaAt(baseRoot!, 'c'), store.shaAt(headRoot, 'c'), store.shaAt(headRoot, 'd'), store.shaAt(baseRoot!, 'e'), store.shaAt(baseRoot!, 'e/f')];
    expect(store.calls.filter(sha => skipped.includes(sha))).toEqual([]);
  });

  it('resumes from a cursor that names a path in neither tree', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const between = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'gone/sub/1.5', limit: 10 });
    expect(between.changes.map(change => change.path)).toEqual(['gone/sub/2', 'gone/x', 'y.txt']);
    const nowhere = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'f/zz', limit: 10 });
    expect(nowhere.changes.map(change => change.path)).toEqual(['gone/sub/1', 'gone/sub/2', 'gone/x', 'y.txt']);
    const past = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'zzz', limit: 10 });
    expect(past).toMatchObject({ changes: [], after: null });
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff fetch pruning and diagnostics', () => {
  it('fetches only the directories on the path to a deep change, never an unchanged sibling', async () => {
    const depth = 6;
    const files: Record<string, string> = {};
    let dir = '';
    for (let level = 0; level < depth; level += 1) {
      for (let sibling = 0; sibling < 5; sibling += 1) {
        files[`${dir}s${sibling}/f.txt`] = `sibling ${level}.${sibling}`;
        files[`${dir}s${sibling}/nested/g.txt`] = `nested ${level}.${sibling}`;
        files[`${dir}file${sibling}.txt`] = `file ${level}.${sibling}`;
      }
      dir += `L${level}/`;
    }
    const target = `${dir}target.txt`;
    files[target] = 'before';
    const { store, provider, baseRoot, headRoot } = repo(snapshot(files), snapshot({ ...files, [target]: 'after' }));
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10 });
    expect(page.changes).toEqual([{ path: 'L0/L1/L2/L3/L4/L5/target.txt', status: 'modified' }]);
    expect(page.treeCalls).toBe(2 * (depth + 1)); // 루트와 L0…L5, 양쪽 한 번씩
    const chain = ['', 'L0', 'L0/L1', 'L0/L1/L2', 'L0/L1/L2/L3', 'L0/L1/L2/L3/L4', 'L0/L1/L2/L3/L4/L5'];
    expect(new Set(store.calls)).toEqual(new Set(chain.flatMap(path => [store.shaAt(baseRoot!, path), store.shaAt(headRoot, path)])));
    const siblings = [...store.directories(headRoot)].filter(([path]) => !chain.includes(path)).map(([, sha]) => sha);
    expect(siblings.length).toBeGreaterThan(depth * 5);
    expect(store.calls.filter(sha => siblings.includes(sha))).toEqual([]);
  });

  it('stops walking as soon as the change beyond the limit is found', async () => {
    const base = snapshot({ 'a/1': 'a', 'b/1': 'b', 'c/1': 'c' });
    const head = snapshot({ 'a/1': 'a*', 'b/1': 'b*', 'c/1': 'c*' });
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 1 });
    expect(page).toEqual({ changes: [{ path: 'a/1', status: 'modified' }], after: 'a/1', incomplete: false, treeCalls: 6 });
    expect(store.calls).not.toContain(store.shaAt(baseRoot!, 'c'));
    expect(store.calls).not.toContain(store.shaAt(headRoot, 'c'));
  });

  it('does not descend into a directory whose name is only a string prefix of the cursor (a/ before a-b)', async () => {
    const base = snapshot({ 'a/x': '1', 'a-b': '2', 'a.c': '3' });
    const head = snapshot({ 'a/x': '1*', 'a-b': '2*', 'a.c': '3*' });
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: 'a-b', limit: 10 });
    expect(page).toEqual({ changes: [{ path: 'a.c', status: 'modified' }], after: null, incomplete: false, treeCalls: 2 });
    expect(store.calls).toEqual([baseRoot, headRoot]);
  });

  it('lists the base and head sides of a directory concurrently, one directory at a time, depth first', async () => {
    const base = snapshot({ 'a/1': 'a', 'b/c/1': 'b', d: 'd' });
    const head = snapshot({ 'a/1': 'a*', 'b/c/1': 'b*', d: 'd*' });
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10 });
    expect(store.calls).toEqual(['', 'a', 'b', 'b/c'].flatMap(path => [store.shaAt(baseRoot!, path), store.shaAt(headRoot, path)]));
    expect(store.peakInFlight).toBe(2);
  });

  it('marks the page incomplete when a listing it visits is truncated, and not for listings it never fetches', async () => {
    const base = snapshot({ 'big/1': '1', 'big/2': '2', 'mid/1': 'm', 'same/1': 's', 'small/1': 'x' });
    const head = snapshot({ 'big/1': '1*', 'big/2': '2', 'mid/1': 'm*', 'same/1': 's', 'small/1': 'x*' });
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    store.truncated.add(store.shaAt(headRoot, 'big'));
    store.truncated.add(store.shaAt(headRoot, 'same')); // 바뀌지 않아 가져오지 않는다
    expect(await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10 })).toMatchObject({ incomplete: true, after: null });
    // 커서가 big 뒤에 있으면 big 목록을 가져오지 않는다
    expect(await walkTreeDiff(provider, baseRoot, headRoot, { after: 'mid/1', limit: 10 }))
      .toEqual({ changes: [{ path: 'small/1', status: 'modified' }], after: null, incomplete: false, treeCalls: 6 });
  });

  it('rejects a limit that is not a positive integer before any provider call', async () => {
    const { store, provider, baseRoot, headRoot } = repo(snapshot({ a: '1' }), snapshot({ a: '2' }));
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await expect(walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit })).rejects.toBeInstanceOf(RangeError);
    }
    expect(store.calls).toEqual([]);
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff abort', () => {
  const base = snapshot({ 'a/1': 'a', 'b/1': 'b', 'c/1': 'c' });
  const head = snapshot({ 'a/1': 'a*', 'b/1': 'b*', 'c/1': 'c*' });

  it('rejects with the signal reason before any provider call when already aborted', async () => {
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    const reason = new Error('client went away');
    await expect(walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10, signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    await expect(walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.calls).toEqual([]);
  });

  it('throws an AbortError when an aborted signal carries no reason', async () => {
    const { provider, baseRoot, headRoot } = repo(base, head);
    const signal = { aborted: true, reason: undefined } as unknown as AbortSignal;
    await expect(walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10, signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('makes no further provider call once the signal aborts mid-walk, and passes the signal to every call', async () => {
    const { store, provider, baseRoot, headRoot } = repo(base, head);
    const controller = new AbortController();
    const reason = new Error('deadline');
    store.beforeCall = () => { if (store.calls.length === 3) controller.abort(reason); };
    await expect(walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 10, signal: controller.signal })).rejects.toBe(reason);
    expect(store.calls).toHaveLength(3);
    expect(store.signals.every(signal => signal === controller.signal)).toBe(true);
  });

  it('lets the provider cancel a pending listing through the signal', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const seen: (AbortSignal | undefined)[] = [];
    const provider: TreeDiffProvider = {
      tree: (_sha, signal) => {
        seen.push(signal);
        return new Promise<TreeDiffListing>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    };
    const pending = walkTreeDiff(provider, 'base-root', 'head-root', { after: null, limit: 10, signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff on small random repositories', () => {
  it('matches the reference for every page size and every cursor across 80 seeds', async () => {
    let typeChanges = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const { base, head } = randomRepository(seed, SMALL);
      const { store, provider, baseRoot, headRoot, reference } = repo(base, head);
      for (const limit of [1, 2, 3, 1000]) expectPaging(await readAllPages(provider, baseRoot, headRoot, limit), reference, limit, `seed ${seed}`);
      const full = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: 1000 });
      expect({ seed, treeCalls: full.treeCalls }).toEqual({ seed, treeCalls: changedListings(store, baseRoot, headRoot) });
      const rng = mulberry32(seed);
      const cursors = [...reference.map(change => change.path), '', '/', 'a/', 'a-', 'a/a/zz', ...Array.from({ length: 10 }, () => `${randomPath(rng, SMALL)}${pick(rng, ['', '~', '/0', '-'])}`)];
      for (const after of cursors) {
        const rest = reference.filter(change => naiveCompare(change.path, after) > 0);
        const page = await walkTreeDiff(provider, baseRoot, headRoot, { after, limit: 2 });
        expect({ seed, after, changes: page.changes, next: page.after })
          .toEqual({ seed, after, changes: rest.slice(0, 2), next: rest.length > 2 ? rest[1]!.path : null });
      }
      const dirs = new Set(reference.flatMap(change => ancestorsOf(change.path)));
      typeChanges += reference.filter(change => change.status !== 'modified' && dirs.has(change.path)).length;
    }
    expect(typeChanges).toBeGreaterThan(20); // 파일↔디렉터리 전환이 실제로 섞였다
  });
});

describe('CR-132 FR-SRC-004 walkTreeDiff on a synthetic repository of 4,000 files', () => {
  interface Synthetic {
    readonly store: FakeGitStore;
    readonly provider: TreeDiffProvider;
    readonly base: Snapshot;
    readonly head: Snapshot;
    readonly baseRoot: string;
    readonly headRoot: string;
    readonly reference: readonly TreeDiffChange[];
  }
  let cache: Synthetic | undefined;
  const synthetic = (): Synthetic => {
    if (cache !== undefined) return cache;
    const { base, head } = randomRepository(20260929, BIG);
    // 새 디렉터리 zz-pad/에 추가 파일을 채워 변경 수를 100의 배수로 맞춘다 (나누어떨어지는 페이지 확인용).
    const padded = new Map(head);
    const missing = (100 - (referenceDiff(base, head).length % 100)) % 100;
    for (let index = 0; index < missing; index += 1) padded.set(`zz-pad/p${index}`, file(`pad ${index}`));
    const store = new FakeGitStore();
    cache = { store, provider: store.provider(), base, head: padded, baseRoot: store.write(base), headRoot: store.write(padded), reference: referenceDiff(base, padded) };
    return cache;
  };

  it('builds 4,000 files with thousands of changes of every kind (fixture sanity)', () => {
    const { base, head, reference } = synthetic();
    expect(base.size).toBe(4000);
    expect(reference.length).toBeGreaterThan(3000);
    expect(reference.length % 100).toBe(0);
    expect([...new Set(reference.map(change => change.status))].sort()).toEqual(['added', 'modified', 'removed']);
    const dirs = new Set(reference.flatMap(change => ancestorsOf(change.path)));
    expect(reference.filter(change => change.status !== 'modified' && dirs.has(change.path)).length).toBeGreaterThan(50);
    const modeOnly = reference.filter(change => {
      const before = base.get(change.path);
      const after = head.get(change.path);
      return before?.kind === 'file' && after?.kind === 'file' && before.content === after.content;
    });
    expect(modeOnly.length).toBeGreaterThan(50);
    expect(reference.filter(change => base.get(change.path)?.kind === 'submodule' || head.get(change.path)?.kind === 'submodule').length).toBeGreaterThan(50);
  });

  it.each([7, 100, 1000])('pages the whole diff with limit %i exactly like the reference', async limit => {
    const { provider, baseRoot, headRoot, reference } = synthetic();
    expectPaging(await readAllPages(provider, baseRoot, headRoot, limit), reference, limit);
  });

  it('returns the whole diff in one page with after: null when the limit equals the total, listing only changed directories', async () => {
    const { store, provider, baseRoot, headRoot, reference } = synthetic();
    const page = await walkTreeDiff(provider, baseRoot, headRoot, { after: null, limit: reference.length });
    expect(page.changes).toEqual(reference);
    expect(page.after).toBeNull();
    expect(page.incomplete).toBe(false);
    expect(page.treeCalls).toBe(changedListings(store, baseRoot, headRoot));
  });

  it('resumes from 50 sampled cursors, including paths that exist in neither tree', async () => {
    const { provider, baseRoot, headRoot, reference } = synthetic();
    const rng = mulberry32(99);
    const cursors = [
      ...Array.from({ length: 25 }, () => pick(rng, reference).path),
      ...Array.from({ length: 25 }, () => `${randomPath(rng, BIG)}${pick(rng, ['', '~', '/zz', '-0', '/'])}`),
    ];
    for (const after of cursors) {
      const rest = reference.filter(change => naiveCompare(change.path, after) > 0);
      const page = await walkTreeDiff(provider, baseRoot, headRoot, { after, limit: 40 });
      expect({ after, changes: page.changes, next: page.after })
        .toEqual({ after, changes: rest.slice(0, 40), next: rest.length > 40 ? rest[39]!.path : null });
    }
  });
});

describe('CR-133 FR-SRC-001 walkTreeDiff tree-call budget', () => {
  /** 파일 하나짜리 디렉터리 N개와 깊은 파일 하나 — 작은 디렉터리가 많은 저장소를 빈 기준 트리로 걷는다(파일 목록). */
  function manyDirectories(count: number) {
    const spec: Record<string, string> = { 'a/b/c/d/e/deep.txt': 'deep', 'z.txt': 'z' };
    for (let index = 0; index < count; index += 1) spec[`d${String(index).padStart(3, '0')}/f`] = `content ${index}`;
    return repo(null, snapshot(spec));
  }
  async function budgetPages(provider: TreeDiffProvider, headRoot: string, maxTreeCalls: number): Promise<TreeDiffPage[]> {
    const pages: TreeDiffPage[] = [];
    let after: string | null = null;
    do {
      const page: TreeDiffPage = await walkTreeDiff(provider, null, headRoot, { after, limit: 5000, maxTreeCalls });
      pages.push(page);
      after = page.after;
    } while (after !== null && pages.length <= 10_000);
    return pages;
  }

  it('stops a page at the budget once it has emitted a leaf, and hands back the last emitted path', async () => {
    const { store, provider, headRoot } = manyDirectories(250);
    const page = await walkTreeDiff(provider, null, headRoot, { after: null, limit: 5000, maxTreeCalls: 100 });
    expect(page.treeCalls).toBe(100);
    expect(store.calls).toHaveLength(100);
    expect(page.after).not.toBeNull();
    expect(page.after).toBe(page.changes.at(-1)!.path);
  });

  it('joins the budgeted pages into every leaf exactly once, in tree order', async () => {
    const { provider, headRoot, reference } = manyDirectories(250);
    const pages = await budgetPages(provider, headRoot, 100);
    expect(pages.flatMap(page => page.changes)).toEqual(reference);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.every(page => page.treeCalls <= 100)).toBe(true);
  });

  it('still emits at least one leaf per page with a budget of 1, even when the first leaf is five directories deep', async () => {
    const { provider, headRoot, reference } = manyDirectories(3);
    const pages = await budgetPages(provider, headRoot, 1);
    expect(pages[0]!.changes).toEqual([{ path: 'a/b/c/d/e/deep.txt', status: 'added' }]);
    expect(pages.flatMap(page => page.changes)).toEqual(reference);
    expect(pages.every(page => page.changes.length >= 1)).toBe(true);
  });

  it('leaves pages without a budget as before and rejects a budget that is not a positive integer', async () => {
    const { provider, headRoot, reference } = manyDirectories(250);
    const page = await walkTreeDiff(provider, null, headRoot, { after: null, limit: 5000 });
    expect(page.changes).toEqual(reference);
    expect(page.after).toBeNull();
    for (const maxTreeCalls of [0, -1, 1.5]) {
      await expect(walkTreeDiff(provider, null, headRoot, { after: null, limit: 10, maxTreeCalls })).rejects.toThrow(RangeError);
    }
  });
});
