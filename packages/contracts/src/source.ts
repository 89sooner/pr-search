/** FR-SRC-001~004 / WP-085: transient, repository-authorized source browsing. */
export interface SourceEntry { path: string; name: string; sha: string; kind: 'directory' | 'file' | 'symlink' | 'submodule'; size: number | null }
export interface SourceTree { repository: string; ref: string; revision: string; path: string; entries: SourceEntry[]; truncated: boolean }
export interface SourceCommit { sha: string; parents: string[]; message: string; author: string; date: string | null }
export interface SourceHistory { repository: string; revision: string; path: string; commits: SourceCommit[]; next_page: number | null }
export interface SourceFile { repository: string; revision: string; path: string; status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null }
export interface SourceChange { path: string; previous_path: string | null; status: string; additions: number; deletions: number }
export interface SourcePullRequest { number: number; title: string; body: string | null }
export interface SourceComparison { repository: string; base: string | null; head: string; commit: SourceCommit; files: SourceChange[]; next_page: number | null; truncated: boolean; pull_requests: SourcePullRequest[]; pull_requests_unavailable?: boolean }
