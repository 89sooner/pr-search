/**
 * 두 Git 트리를 디렉터리 단위로 나란히 비교해 바뀐 경로를 페이지로 돌려준다 (CR-132).
 *
 * GitHub는 PR(`pulls/{n}/files`)과 커밋(`commits/{sha}`)의 변경 파일을 3,000개까지만
 * 나열한다. 그보다 큰 변경은 Trees API(비재귀, 호출당 디렉터리 하나)로 기준·대상 트리를
 * 직접 비교한다. 이 방식으로는 추가·삭제 줄 수와 이름 변경을 알 수 없다.
 *
 * - 순서: `compareTreePaths`(경로 조각 단위). 조상이 자손보다 앞선다.
 * - 이어 읽기: `after`(직전 페이지의 마지막 경로)보다 뒤의 변경만 내보낸다.
 * - 가지치기: SHA·종류·모드가 같은 항목과, 커서 앞에 통째로 놓인 하위 트리는 가져오지 않는다.
 */

export interface TreeDiffEntry { readonly name: string; readonly type: 'blob' | 'tree' | 'commit'; readonly mode: string; readonly sha: string }
export interface TreeDiffListing { readonly entries: readonly TreeDiffEntry[]; readonly truncated: boolean }
/** Reads one directory (non-recursive). Called with a tree SHA. */
export interface TreeDiffProvider { tree(sha: string, signal?: AbortSignal): Promise<TreeDiffListing> }
export interface TreeDiffChange { readonly path: string; readonly status: 'added' | 'removed' | 'modified' }
export interface TreeDiffPage {
  readonly changes: readonly TreeDiffChange[];
  /** Last emitted path when more changes follow; null when the diff is complete. */
  readonly after: string | null;
  /** True when any directory listing on the walked path came back truncated from GitHub — the list may miss entries. */
  readonly incomplete: boolean;
  /** Number of provider.tree calls made for this page (for tests/diagnostics). */
  readonly treeCalls: number;
}

const SLASH = 0x2f;

/** Tree order: compare path segments (split on '/') one by one with plain string comparison; an ancestor sorts before its descendants. */
export function compareTreePaths(a: string, b: string): number {
  // 조각별 비교와 같은 결과다: '/'를 다른 모든 UTF-16 코드 단위보다 작게 보고 한 번에 훑는다.
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.charCodeAt(index);
    const right = b.charCodeAt(index);
    if (left === right) continue;
    if (left === SLASH) return -1;
    if (right === SLASH) return 1;
    return left < right ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// blob과 commit(서브모듈)은 잎이다. 트리만 내려간다.
function leafStatus(base: TreeDiffEntry | undefined, head: TreeDiffEntry | undefined): TreeDiffChange['status'] | null {
  const baseLeaf = base !== undefined && base.type !== 'tree';
  const headLeaf = head !== undefined && head.type !== 'tree';
  if (baseLeaf && headLeaf) return 'modified';
  if (baseLeaf) return 'removed';
  if (headLeaf) return 'added';
  return null;
}

function subtree(entry: TreeDiffEntry | undefined): string | null {
  return entry?.type === 'tree' ? entry.sha : null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal === undefined || !signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

export async function walkTreeDiff(
  provider: TreeDiffProvider,
  baseTree: string | null, // null = empty tree (e.g. root commit)
  headTree: string,
  options: { readonly after: string | null; readonly limit: number; readonly signal?: AbortSignal },
): Promise<TreeDiffPage> {
  const { after, limit, signal } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`Tree diff limit must be a positive integer: ${limit}`);
  const changes: TreeDiffChange[] = [];
  let incomplete = false;
  let treeCalls = 0;

  const list = async (sha: string | null): Promise<ReadonlyMap<string, TreeDiffEntry>> => {
    const entries = new Map<string, TreeDiffEntry>();
    if (sha === null) return entries;
    throwIfAborted(signal);
    treeCalls += 1;
    const listing = await provider.tree(sha, signal);
    if (listing.truncated) incomplete = true;
    for (const entry of listing.entries) entries.set(entry.name, entry);
    return entries;
  };

  // true면 한도 뒤의 변경 하나를 더 찾아서 멈췄다 (그 변경은 담지 않는다).
  const walk = async (prefix: string, baseSha: string | null, headSha: string | null): Promise<boolean> => {
    if (baseSha === headSha) return false; // 같은 트리 SHA면 내용도 같다
    const [base, head] = await Promise.all([list(baseSha), list(headSha)]);
    const names = [...new Set([...base.keys(), ...head.keys()])].sort(compareNames);
    for (const name of names) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      const baseEntry = base.get(name);
      const headEntry = head.get(name);
      if (baseEntry !== undefined && headEntry !== undefined && baseEntry.sha === headEntry.sha
        && baseEntry.type === headEntry.type && baseEntry.mode === headEntry.mode) continue;
      let emit = true;
      if (after !== null) {
        const order = compareTreePaths(path, after);
        // 커서 앞의 항목은 커서가 그 아래에 있을 때만 내려간다. 커서와 같은 경로는 다시 내보내지 않지만,
        // 그 아래 경로는 모두 커서 뒤이므로 내려간다 (파일↔디렉터리 전환이 페이지 경계에 걸린 경우).
        if (order < 0 && !after.startsWith(`${path}/`)) continue;
        emit = order > 0;
      }
      const status = emit ? leafStatus(baseEntry, headEntry) : null;
      if (status !== null) {
        if (changes.length === limit) return true;
        changes.push({ path, status });
      }
      const baseChild = subtree(baseEntry);
      const headChild = subtree(headEntry);
      if ((baseChild !== null || headChild !== null) && (await walk(path, baseChild, headChild))) return true;
    }
    return false;
  };

  const more = await walk('', baseTree, headTree);
  const last = changes.at(-1);
  return { changes, after: more && last !== undefined ? last.path : null, incomplete, treeCalls };
}
