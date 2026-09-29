/** FR-SRC-001~004 / WP-085: transient, repository-authorized source browsing. */
export interface SourceEntry { path: string; name: string; sha: string; kind: 'directory' | 'file' | 'symlink' | 'submodule'; size: number | null }
/**
 * `offset`을 보낸 요청(CR-132)에만 `tree_sha`·`offset`·`next_offset`·`total`이 있다 — 정렬한 목록의 한 페이지이고,
 * `truncated`는 GitHub가 목록을 잘랐다는 뜻뿐이다. 보내지 않으면 예전처럼 앞 5,000개(정렬 전)에서 자른다.
 */
export interface SourceTree { repository: string; ref: string; revision: string; path: string; entries: SourceEntry[]; truncated: boolean; tree_sha?: string; offset?: number; next_offset?: number | null; total?: number }
export interface SourceCommit { sha: string; parents: string[]; message: string; author: string; date: string | null }
/** History 행 전용 (CR-107). `pull_request_numbers`는 배열(빈 배열 포함)이면 확정, `null`이면 아직 미확정이다. */
export interface SourceHistoryCommit extends SourceCommit { pull_request_numbers: number[] | null }
export interface SourceHistory { repository: string; revision: string; path: string; commits: SourceHistoryCommit[]; next_page: number | null; pull_requests_unavailable?: boolean }
/** `offset`을 보낸 요청(CR-132)은 본문의 한 창(`text`)과 다음 창의 바이트 위치(`next_offset`, 끝이면 `null`)를 받는다. */
export interface SourceFile { repository: string; revision: string; path: string; status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null; offset?: number; next_offset?: number | null }
/** 트리 비교 목록(`listing=tree`, CR-132)은 줄 수를 모른다 — `additions`·`deletions`가 `null`이다. */
export interface SourceChange { path: string; previous_path: string | null; status: string; additions: number | null; deletions: number | null }
export interface SourcePullRequest { number: number; title: string; body: string | null }
/**
 * `listing=tree`(CR-132)는 두 커밋의 트리를 직접 비교한 목록이다: `listing: 'tree'`, 이어 읽기는 `next_after`, `truncated`는
 * GitHub가 디렉터리 목록을 잘랐다는 뜻, `pull_requests`는 늘 비어 있다(관련 PR은 일반 비교 응답의 것이다).
 */
export interface SourceComparison { repository: string; base: string | null; head: string; commit: SourceCommit; files: SourceChange[]; next_page: number | null; truncated: boolean; pull_requests: SourcePullRequest[]; pull_requests_unavailable?: boolean; listing?: 'tree'; next_after?: string | null }
