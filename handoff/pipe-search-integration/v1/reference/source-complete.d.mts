/**
 * `source-complete.mjs`의 타입 (CR-138). 응답 본문의 모양은 `pipe-integration-v1.openapi.yaml`의 SourceFile·SourceTree·
 * SourcePaths·SourceHistory·SourceComparison이 정본이다 — 여기서는 참고 구현이 읽는 키만 적는다.
 */

/** private 리스너에 mTLS·grant로 GET한 결과. `path`는 연동 prefix 뒤의 경로다. */
export type SourceRequest = (path: string) => Promise<{ readonly status: number; readonly headers?: Readonly<Record<string, string | undefined>>; readonly body: unknown }>;

export interface ReadOptions {
  /** 한도·일시 장애(429·502·503)에 한 요청을 부르는 최대 횟수. 기본 4. */
  readonly attempts?: number;
  /** 한 번 기다리는 최대 시간(ms). `Retry-After`가 이보다 길면 기다리지 않고 멈춘다. 기본 60000. */
  readonly maxWaitMs?: number;
  /** 기다림 — 시험이 시간을 건너뛸 때 바꾼다. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export declare class SourceReadError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** 다시 시작할 위치 — 같은 함수에 넘기면 이어서 읽는다. */
  readonly resume: Record<string, unknown> | null;
}

export interface SourceEntryLike { readonly path: string; readonly name: string; readonly sha: string; readonly kind: string; readonly size: number | null }
export interface SourceChangeLike { readonly path: string; readonly previous_path: string | null; readonly status: string; readonly additions: number | null; readonly deletions: number | null }
export interface SourceCommitLike { readonly sha: string; readonly parents: readonly string[]; readonly message: string; readonly author: string; readonly date: string | null; readonly pull_request_numbers: readonly number[] | null }

export declare function getCompleteFile(request: SourceRequest, input: { repository: string; revision: string; path: string; offset?: number }, options?: ReadOptions): Promise<{ status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null; windows: number }>;
export declare function getCompleteTree(request: SourceRequest, input: { repository: string; ref?: string; revision?: string; treeSha?: string; path?: string; offset?: number }, options?: ReadOptions): Promise<{ revision: string; tree_sha: string; entries: SourceEntryLike[]; truncated: boolean }>;
export declare function getAllPaths(request: SourceRequest, input: { repository: string; revision: string; after?: string | null }, options?: ReadOptions): Promise<{ revision: string; paths: { path: string; kind: 'file' | 'symlink' }[]; incomplete: boolean }>;
export declare function getCompleteHistory(request: SourceRequest, input: { repository: string; path?: string; ref?: string; page?: number }, options?: ReadOptions): Promise<{ revision: string; commits: SourceCommitLike[]; pull_requests_unavailable: boolean }>;
export declare function getCompleteDiffFiles(request: SourceRequest, input: { repository: string; pr?: number; commit?: string }, options?: ReadOptions): Promise<{ base: string | null; head: string; files: SourceChangeLike[]; listing: 'rest' | 'rest+tree'; incomplete: boolean }>;
