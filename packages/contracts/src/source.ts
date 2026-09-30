/** FR-SRC-001~004 / WP-085: transient, repository-authorized source browsing. */
export interface SourceEntry { path: string; name: string; sha: string; kind: 'directory' | 'file' | 'symlink' | 'submodule'; size: number | null }
/**
 * 정렬한 목록(디렉터리 먼저, 이름 순)의 한 페이지다(CR-132). CR-138부터 `offset`을 보내지 않은 요청도 첫 페이지이며 네 키가
 * 늘 있다 — `entries`는 `next_offset`이 `null`일 때만 목록의 끝까지다. 다음 페이지는 `revision`·`tree_sha`로 고정해 청한다.
 * `truncated`는 GitHub가 목록을 잘랐다는 뜻뿐이다(제품이 자르지 않는다).
 */
export interface SourceTree { repository: string; ref: string; revision: string; path: string; entries: SourceEntry[]; truncated: boolean; tree_sha: string; offset: number; next_offset: number | null; total: number }
export interface SourceCommit { sha: string; parents: string[]; message: string; author: string; date: string | null }
/** History 행 전용 (CR-107). `pull_request_numbers`는 배열(빈 배열 포함)이면 확정, `null`이면 아직 미확정이다. */
export interface SourceHistoryCommit extends SourceCommit { pull_request_numbers: number[] | null }
export interface SourceHistory { repository: string; revision: string; path: string; commits: SourceHistoryCommit[]; next_page: number | null; pull_requests_unavailable?: boolean }
/**
 * 본문의 한 창(`text`, 최대 1 MiB)과 다음 창의 바이트 위치(`next_offset`, 끝이면 `null`)다(CR-132). CR-138부터 `offset`을 보내지
 * 않은 요청도 offset 0의 창이며 두 키가 늘 있다 — `text`는 `next_offset`이 `null`일 때만 파일 끝까지다. `too_large`는 GitHub
 * API가 본문을 주지 않는 100MB 초과뿐이다(원천 한계, 제품 상한 아님).
 */
export interface SourceFile { repository: string; revision: string; path: string; status: 'text' | 'missing' | 'binary' | 'too_large' | 'unsupported'; text: string | null; size: number | null; sha: string | null; reason: string | null; offset: number; next_offset: number | null }
/** 트리 비교 목록(`listing=tree`, CR-132)은 줄 수를 모른다 — `additions`·`deletions`가 `null`이다. */
export interface SourceChange { path: string; previous_path: string | null; status: string; additions: number | null; deletions: number | null }
export interface SourcePullRequest { number: number; title: string; body: string | null }
/**
 * 고정 revision의 파일 경로 목록 (CR-133, API-SRC-005 — Files & folders 검색). 본문은 없다. 잎만 싣는다(파일·심볼릭 링크,
 * 서브모듈과 디렉터리는 뺀다). `next_after`가 있으면 그 경로 뒤를 이어 읽는다 — `paths`가 적거나 비어도 끝이 아니다(걷기
 * 페이지는 디렉터리 수로도 끝나고, 서브모듈만 지난 페이지는 `paths`가 비고 `next_after`가 그 서브모듈 경로다). 끝은
 * `next_after: null`뿐이다. `incomplete`는 GitHub가 디렉터리 목록을 잘라 빠진 경로가 있을 수 있다는 뜻이다.
 */
export interface SourcePathEntry { path: string; kind: 'file' | 'symlink' }
export interface SourcePaths { repository: string; revision: string; paths: SourcePathEntry[]; next_after: string | null; incomplete: boolean }
/**
 * blame의 한 줄 구간 (CR-135, API-SRC-006 — FR-SRC-005). 줄 번호는 1부터이고 `end_line`을 포함한다. `age`는 GitHub의 최근성
 * 등급(1 최신 ~ 10 오래됨)이다. `commit`은 그 줄들을 마지막으로 바꾼 커밋이다 — `author_name`은 Git 커밋의 작성자 이름,
 * `author_login`은 작성자 이메일과 맞는 GHE 계정이고, GitHub가 주지 않으면 `null`이다(지어내지 않는다). 이메일은 싣지 않는다.
 */
export interface SourceBlameRange { start_line: number; end_line: number; age: number; commit: { sha: string; message_headline: string; author_name: string | null; author_login: string | null; authored_at: string; committed_at: string } }
/**
 * 고정 revision의 파일 blame (CR-135, API-SRC-006 — FR-SRC-005). GitHub GraphQL `Commit.blame`이 계산한 귀속을 옮길 뿐이다 —
 * Time-lapse(관측한 라인 이력의 추정)가 아니다. `revision`은 GitHub가 확인한 커밋 SHA, `ranges`는 GitHub 순서 그대로(시작 줄
 * 오름차순, 겹치지 않음)이며 빈 파일이면 빈 배열이다. 본문은 없다 — 같은 revision의 `/file`로 읽는다.
 */
export interface SourceBlame { repository: string; revision: string; path: string; provider: 'github_graphql'; ranges: SourceBlameRange[] }
/**
 * `listing=tree`(CR-132)는 두 커밋의 트리를 직접 비교한 목록이다: `listing: 'tree'`, 이어 읽기는 `next_after`, `truncated`는
 * GitHub가 디렉터리 목록을 잘랐다는 뜻, `pull_requests`는 늘 비어 있다(관련 PR은 일반 비교 응답의 것이다).
 */
export interface SourceComparison { repository: string; base: string | null; head: string; commit: SourceCommit; files: SourceChange[]; next_page: number | null; truncated: boolean; pull_requests: SourcePullRequest[]; pull_requests_unavailable?: boolean; listing?: 'tree'; next_after?: string | null }
