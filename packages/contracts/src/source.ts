/** FR-SRC-001~004 / WP-085: transient, repository-authorized source browsing. */
export interface SourceEntry { path: string; name: string; sha: string; kind: 'directory' | 'file' | 'symlink' | 'submodule'; size: number | null }
export interface SourceTree { repository: string; ref: string; revision: string; path: string; entries: SourceEntry[]; truncated: boolean }
export interface SourceCommit { sha: string; parents: string[]; message: string; author: string; date: string | null }
/** History 행 전용 (CR-107). `pull_request_numbers`는 배열(빈 배열 포함)이면 확정, `null`이면 아직 미확정이다. */
export interface SourceHistoryCommit extends SourceCommit { pull_request_numbers: number[] | null }
export interface SourceHistory { repository: string; revision: string; path: string; commits: SourceHistoryCommit[]; next_page: number | null; pull_requests_unavailable?: boolean }
export interface SourceFile { repository: string; revision: string; path: string; status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null }
export interface SourceChange { path: string; previous_path: string | null; status: string; additions: number; deletions: number }
export interface SourcePullRequest { number: number; title: string; body: string | null }
export interface SourceComparison { repository: string; base: string | null; head: string; commit: SourceCommit; files: SourceChange[]; next_page: number | null; truncated: boolean; pull_requests: SourcePullRequest[]; pull_requests_unavailable?: boolean }
