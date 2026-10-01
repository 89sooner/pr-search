/**
 * `source-complete.mjs`의 타입 (CR-138). 응답 본문의 모양은 `pipe-integration-v1.openapi.yaml`의 SourceFile·SourceTree·
 * SourcePaths·SourceHistory·SourceComparison이 정본이다 — 여기서는 참고 구현이 읽는 키만 적는다.
 */

/** private 리스너에 mTLS·grant로 GET한 결과. `path`는 연동 prefix 뒤의 경로다. */
export type SourceRequest = (path: string) => Promise<{ readonly status: number; readonly headers?: Readonly<Record<string, string | undefined>>; readonly body: unknown }>;

/**
 * 멈춘 읽기의 이어 읽기 상태 — 그때까지 받은 부분과 멈춘 위치다. 안의 모양은 함수마다 다르고 정하지 않는다: 오류에서 받은
 * 값을 그 오류를 낸 함수의 `options.resume`에 그대로 넘긴다. 메모리 안의 값이다.
 */
export interface SourceResume { readonly [key: string]: unknown }

export interface ReadOptions {
  /** 한도·일시 장애(429·502·503, 보내지 못한 요청)에 한 요청을 부르는 최대 횟수. 기본 4. */
  readonly attempts?: number;
  /** 한 번 기다리는 최대 시간(ms). `Retry-After`가 이보다 길면 기다리지 않고 멈춘다. 기본 60000. */
  readonly maxWaitMs?: number;
  /** 기다림 — 시험이 시간을 건너뛸 때 바꾼다. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 같은 함수가 앞서 멈추며 준 `SourceReadError.resume`. 받은 부분을 다시 받지 않고 멈춘 위치부터 잇는다. */
  readonly resume?: SourceResume;
}

export declare class SourceReadError extends Error {
  /** 마지막 응답의 상태. 요청을 보내지 못했으면 0이다. */
  readonly status: number;
  readonly body: unknown;
  /** 이어 읽기 상태 — 같은 함수의 `options.resume`에 넘긴다. 스냅숏이 바뀌었거나 응답이 나아가지 않았으면 `null`(처음부터). */
  readonly resume: SourceResume | null;
}

export interface SourceEntryLike { readonly path: string; readonly name: string; readonly sha: string; readonly kind: string; readonly size: number | null }
export interface SourceChangeLike { readonly path: string; readonly previous_path: string | null; readonly status: string; readonly additions: number | null; readonly deletions: number | null }
export interface SourceCommitLike { readonly sha: string; readonly parents: readonly string[]; readonly message: string; readonly author: string; readonly date: string | null; readonly pull_request_numbers: readonly number[] | null }

export declare function getCompleteFile(request: SourceRequest, input: { repository: string; revision: string; path: string; offset?: number }, options?: ReadOptions): Promise<{ status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null; windows: number }>;
export declare function getCompleteTree(request: SourceRequest, input: { repository: string; ref?: string; revision?: string; treeSha?: string; path?: string; offset?: number }, options?: ReadOptions): Promise<{ revision: string; tree_sha: string; entries: SourceEntryLike[]; truncated: boolean }>;
export declare function getAllPaths(request: SourceRequest, input: { repository: string; revision: string; after?: string | null }, options?: ReadOptions): Promise<{ revision: string; paths: { path: string; kind: 'file' | 'symlink' }[]; incomplete: boolean }>;
export declare function getCompleteHistory(request: SourceRequest, input: { repository: string; path?: string; ref?: string; page?: number }, options?: ReadOptions): Promise<{ revision: string; commits: SourceCommitLike[]; pull_requests_unavailable: boolean }>;
export declare function getCompleteDiffFiles(request: SourceRequest, input: { repository: string; pr?: number; commit?: string }, options?: ReadOptions): Promise<{ base: string | null; head: string; files: SourceChangeLike[]; listing: 'rest' | 'rest+tree'; incomplete: boolean }>;
