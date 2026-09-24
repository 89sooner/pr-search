/**
 * 정규화 문서 생성 (WP-008, FR-ING-005, ENT-CORE-002·ENT-CORE-003).
 *
 * **이 파일이 필드 화이트리스트다.** 문서에 들어가는 값은 전부 여기서 이름을
 * 직접 적어 만든다. 웹훅 payload든 보강 결과든 객체를 통째로 펼쳐 넣는 곳이
 * 하나도 없다 — 그래야 GHE가 새 필드를 보내기 시작한 날 소스 코드나 개인정보가
 * 조용히 색인되지 않는다 (NFR-005, THR-010). 매핑의 `dynamic: strict`는 이
 * 규율이 깨졌을 때 울리는 두 번째 방어선이지 첫 번째가 아니다.
 *
 * 순수 함수만 둔다. Elasticsearch도 PostgreSQL도 모른다 — 그래야 문서 모양을
 * 실제 클러스터 없이 시험할 수 있다.
 */

import {
  commitDocId,
  derivePullRequestState,
  pullRequestDocId,
  type CommitRole,
  type EnrichedReview,
  type IngestionEnriched,
} from '@prs/domain';
import type { RepositoryRow } from '@prs/db';
import type { UpsertRequest } from '@prs/es';

/**
 * 투영이 만들 수 있는 역할 둘 (FR-SRCH-002 AC-1~AC-3).
 *
 * `direct_push`는 투영이 판정할 수 없다 — first-parent 체인 소속을 모르기
 * 때문이다(CR-038, DEV-207). 그 판정은 커밋 보강이 한다. 어휘 자체는
 * `@prs/domain`이 소유하고 여기서는 **좁힌다** (CR-039, DEV-225).
 */
type ProjectedCommitRole = Extract<CommitRole, 'merge_commit' | 'source_commit'>;

/**
 * 작성자 소속 팀의 세 상태 중 둘 (WP-069 / CR-058, DEV-486·487).
 *
 * **이 타입을 순수 계층이 소유한다.** 판정의 재료(조직 동기화 시각, 소속 표)는
 * PostgreSQL에 있지만 **판정의 결과**는 문서 모양을 정하는 값이라, 여기 두어야
 * 실제 데이터베이스 없이 문서를 시험할 수 있다.
 *
 * `known`의 빈 배열은 **사실의 진술**이다 — 그 조직에서 이 작성자는 어느 팀에도
 * 속하지 않는다. `unknown`은 그것과 다르며 필드를 쓰지 않는 것으로 표현한다.
 */
export type AuthorTeamResolution =
  | { readonly kind: 'known'; readonly teamIds: readonly number[] }
  | { readonly kind: 'unknown' };

export interface ProjectionSource {
  readonly enriched: IngestionEnriched;
  /** 접근 범위 필드의 유일한 출처다. 미등록 저장소면 애초에 투영하지 않는다. */
  readonly repository: RepositoryRow;
  /**
   * 문서 버전 (FR-ING-005 AC-1).
   *
   * **웹훅 수신 시각의 밀리초 epoch다.** 보강 시각이 아니다 — 두 웹훅이 순서를
   * 바꿔 보강되어도 나중에 일어난 사실이 이겨야 하고, 그 순서는 수신 시각만 안다.
   */
  readonly documentVersion: number;
  readonly indexedAt: Date;
  /**
   * 이 PR 작성자의 소속 팀 (WP-069 / CR-058).
   *
   * **선택 항목이 아니다.** 기본값을 두면 호출부가 빠뜨렸을 때 그 사실이 드러나지
   * 않고, 모름과 앎의 경계가 조용히 한쪽으로 기운다. 부르는 쪽이 언제나 판정한다.
   *
   * 범위는 **이 PR 저장소의 조직**이다 (DEV-481). 등록된 모든 조직으로 넓히면
   * 한 조직의 동기화 실패가 모든 문서를 모름으로 만든다.
   */
  readonly authorTeams: AuthorTeamResolution;
  /**
   * 이 PR의 원본 커밋 목록 가운데 **추적 브랜치의 현재 체인에 이미 오른** SHA (CR-117 /
   * FR-SRCH-002 AC-7). 소문자 40자다.
   *
   * **선택 항목이 아니다** (`authorTeams`와 같은 이유). 부르는 쪽이
   * `mergeSequenceRepo.findCurrentChainLanders`로 채운다. 빈 집합을 기본값으로 두면 호출부가
   * 빠뜨렸을 때 체인 커밋의 역할이 다시 `source_commit`으로 덮이고, 그 사실은 화면에서야 드러난다.
   */
  readonly chainShas: ReadonlySet<string>;
}

type Fields = Record<string, unknown>;

/** `undefined`인 값은 문서에 넣지 않는다. 모르는 것과 비어 있는 것은 다르다. */
function put(fields: Fields, key: string, value: unknown): void {
  if (value !== undefined) fields[key] = value;
}

function seconds(from: string | null | undefined, to: string | null | undefined): number | undefined {
  if (from === null || from === undefined || to === null || to === undefined) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  const delta = Math.round((end - start) / 1_000);
  // 음수 리드 타임은 시계 문제이지 사실이 아니다. 값을 비워 두는 편이 낫다.
  return delta < 0 ? undefined : delta;
}

/**
 * 가장 이른 리뷰 제출 시각. 제출되지 않은 리뷰(`submitted_at: null`)는 세지 않는다.
 *
 * **작성자 본인의 리뷰는 첫 리뷰가 아니다** (FR-STAT-004 AC-3, CR-053 DEV-387).
 * 자기 PR에 스스로 남긴 코멘트를 첫 리뷰로 세면 `first_review_wait_seconds`가
 * 실제보다 짧아지고, 그 값은 **색인 시점에 저장되므로 API도 화면도 고칠 수
 * 없다.** 재료(`reviewer`와 작성자)는 처음부터 같은 호출부에 있었다.
 *
 * @param author PR 작성자. 모르면 `undefined` — 그때는 거를 수 없으므로 전부
 *   센다. **없는 값을 지어내 거르지 않는다.**
 */
export function firstReviewAt(
  reviews: readonly EnrichedReview[],
  author?: string | null,
): string | undefined {
  let earliest: string | undefined;
  for (const review of reviews) {
    const submitted = review.submitted_at;
    if (submitted === null) continue;
    // 작성자를 아는 경우에만 거른다. `reviewer`가 `null`이면 누구인지 모르므로
    // 본인이라고 단정하지 않는다.
    if (author != null && review.reviewer === author) continue;
    if (earliest === undefined || Date.parse(submitted) < Date.parse(earliest)) earliest = submitted;
  }
  return earliest;
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value !== ''))];
}

/**
 * 접근 범위 필드의 **유일한 출처** (ADR-008).
 *
 * 네 투영이 모두 이것을 부른다 — 각자 계산하면 한 색인만 팀을 놓치는 날이 오고,
 * 그때 그 색인의 `team:` 질의만 조용히 비어 온다 (WP-068 / CR-035, DEV-114).
 */
/**
 * **레지스트리가 소유한** 접근 통제·등록 상태 필드 (PR #52 리뷰 P1).
 *
 * 이 값들의 정본은 PostgreSQL `repository` 행이고, 색인에는 소급 갱신으로
 * 반영된다 (`markRepositoryArchived`·`applyRepositoryTeams`). **그 갱신은
 * `pull_request_snapshot`에 되쓰이지 않는다** — 스냅숏은 투영 시점의 사본이다.
 *
 * 그래서 정본 재구축이 스냅숏 문서를 그대로 쓰면 **회수된 팀이 다시 보이게
 * 된다.** 재구축은 반드시 이 함수로 덮어야 한다 (`reindex.ts`).
 */
export function registryOwnedFields(repository: RepositoryRow): Readonly<Record<string, unknown>> {
  return {
    repository_id: repository.repository_id,
    repository: `${repository.owner}/${repository.name}`,
    org_id: repository.org_id,
    visibility: repository.visibility,
    allowed_team_ids: [...repository.allowed_team_ids],
    repository_archived: repository.status === 'archived',
  };
}

function repositoryScope(repository: RepositoryRow): Fields {
  return {
    repository_id: repository.repository_id,
    repository: `${repository.owner}/${repository.name}`,
    org_id: repository.org_id,
    visibility: repository.visibility,
    // 레지스트리가 소유한 값을 그대로 싣는다. 이벤트에는 없다 (CR-024).
    allowed_team_ids: [...repository.allowed_team_ids],

  };
}

/**
 * PR 문서 (ENT-CORE-002).
 *
 * 보강이 PR을 못 가져왔으면(`pull_request: null`) 아는 것만 담는다. 그것이
 * FR-ING-004 AC-3이 말하는 부분 문서이고, `enrichment_pending`이 그 사실을 알린다.
 */
export function buildPullRequestDocument(source: ProjectionSource): UpsertRequest {
  const { enriched, repository } = source;
  const pr = enriched.pull_request;
  const files = enriched.changed_files;
  const reviewedAt = firstReviewAt(enriched.reviews, pr?.author);
  /**
   * 파일 보강이 실패했는가 (CR-056, DEV-450 / PR #95 리뷰 P2).
   *
   * 실패했으면 `changed_files`가 비어 있어도 그것은 **0이 아니라 모름**이다.
   * 성공했다면 빈 목록은 사실이다.
   */
  const filesUnknown = enriched.enrichment_errors.some((error) => error.component === 'files');
  /**
   * **작성자를 모르면 소속도 모름이다** (CR-058, DEV-487).
   *
   * 보강이 PR을 가져오지 못하면 문서에 `author` 자체가 없다. 그것은 "소속을 읽지
   * 못한 것"과 다른 사실이지만 답은 같다 — 없는 작성자의 팀을 지어내지 않는다.
   * 판정을 여기서 한 번 더 거는 이유는 **재료가 이미 이 함수 안에 있기 때문**이며,
   * 호출부가 빠뜨려도 문서가 거짓을 말하지 않는다.
   */
  const authorTeams: AuthorTeamResolution =
    pr?.author == null || pr.author === '' ? { kind: 'unknown' } : source.authorTeams;

  const doc: Fields = {
    document_version: source.documentVersion,
    ...repositoryScope(repository),
    pr_number: enriched.pr_number,

    source_commit_shas: enriched.source_commit_shas.map((sha) => sha.toLowerCase()),
    source_commits_truncated: enriched.source_commits_truncated,

    /*
     * **보강이 끝나지 않았으면 변경 규모 넷을 쓰지 않는다** (CR-056, DEV-450).
     *
     * 빈 파일 목록을 세어 0을 쓰면 그 값이 **사실의 진술**이 되고,
     * `FR-STAT-005` AC-5가 가르라고 한 모름과 0이 같은 구간에 들어간다.
     * 집계의 `unknown`은 이 필드들의 **부재**를 세므로 판정 재료가 한 곳에만
     * 있다 — 0으로 채운 뒤 `enrichment_pending`을 다시 읽어 되돌리는 방식은
     * 같은 판정을 두 곳에 두는 일이고, 그 둘이 어긋나는 날 화면이 조용히
     * 거짓을 말한다.
     *
     * **판정 재료는 파일 보강의 결과다** (PR #95 리뷰 P2). `enrichment_pending`은
     * 네 구성 요소(PR 본문·커밋·파일·리뷰) 중 **하나라도** 실패하면 참이므로,
     * 그것으로 판정하면 리뷰 조회만 실패한 PR의 **진짜 빈 목록**까지 모름으로
     * 버린다. `enrichment_errors`가 실패한 구성 요소를 그대로 담고 있으니
     * 파일 쪽만 본다.
     *
     * 보강이 끝난 문서의 0은 그대로 쓴다. **파일을 하나도 바꾸지 않은 PR은
     * 실재하고, 그것은 모르는 것이 아니다.**
     *
     * 절삭됐다면 이 수는 "가져온 만큼"이다. `files_truncated`가 그 사실을 말한다.
     */
    ...(filesUnknown
      ? {}
      : {
          changed_files_count: files.length,
          additions: files.reduce((sum, file) => sum + file.additions, 0),
          deletions: files.reduce((sum, file) => sum + file.deletions, 0),
          /*
           * `additions + deletions` (CR-053, DEV-386).
           *
           * **여기서 더한다.** 조회 시점에 더하면 `script`가 필요하고 데이터
           * 모델 6장이 그것을 금지한다. 위 둘을 다시 세지 않고 같은 순회의
           * 결과를 쓴다.
           */
          changed_lines: files.reduce((sum, file) => sum + file.additions + file.deletions, 0),
        }),
    changed_paths: files.map((file) => file.filename),
    files_truncated: enriched.files_truncated,

    reviewers: uniqueStrings(enriched.reviews.map((review) => review.reviewer)),
    approved_by: uniqueStrings(
      enriched.reviews
        .filter((review) => review.state.toUpperCase() === 'APPROVED')
        .map((review) => review.reviewer),
    ),

    enrichment_pending: enriched.enrichment_pending,
    repository_archived: repository.status === 'archived',
    last_delivery_id: enriched.delivery_id,
    indexed_at: source.indexedAt.toISOString(),
  };

  put(doc, 'first_review_at', reviewedAt);

  /*
   * **작성자 소속 팀** (WP-069 / CR-058, FR-STAT-006 · FR-SRCH-005).
   *
   * `allowed_team_ids`와 **다른 값이다** — 그쪽은 이 저장소를 볼 수 있는 팀이고
   * 이것은 작성자가 속한 팀이다. 하나로 합치면 **접근 권한을 성과로 읽게 된다**
   * (CR-053, DEV-382).
   *
   * **빈 배열을 그대로 쓴다.** 동기화가 신선한데 어느 팀에도 없다면 그것은 사실의
   * 진술이며, 모름은 위에서 `unknown`이 되어 여기 오지 않는다 (DEV-486).
   *
   * 중복을 접고 오름차순으로 고정한다. 제품 의미는 아니지만 **같은 소속이 늘 같은
   * 배열이어야** 조건부 업서트가 바뀌지 않은 문서를 `noop`으로 접는다.
   */
  if (authorTeams.kind === 'known') {
    doc['author_team_ids'] = [...new Set(authorTeams.teamIds)].sort((a, b) => a - b);
  }

  if (pr !== null) {
    put(doc, 'title', pr.title);
    put(doc, 'body', pr.body);
    /*
     * **병합은 파생 상태다** (CR-101 / DEV-718). GitHub은 병합된 PR도 `state: closed`로 주고 `merged`·
     * `merged_at`이 따로 말한다. 문서 계약(ENT-CORE-002)·`is:merged`·화면 배지·M 번호 조회는 전부
     * `merged`를 전제하므로 여기서 한 번 파생한다. 이미 저장된 스냅숏은 마이그레이션 032가 같은 규칙이다.
     */
    put(doc, 'state', derivePullRequestState(pr));
    put(doc, 'draft', pr.draft);
    put(doc, 'labels', [...pr.labels]);
    put(doc, 'author', pr.author);
    put(doc, 'base_branch', pr.base_ref);
    put(doc, 'head_branch', pr.head_ref);
    put(doc, 'base_sha', pr.base_sha);
    put(doc, 'head_sha', pr.head_sha);
    put(doc, 'merge_commit_sha', pr.merge_commit_sha);
    put(doc, 'created_at', pr.created_at);
    put(doc, 'updated_at', pr.updated_at);
    put(doc, 'merged_at', pr.merged_at);
    put(doc, 'closed_at', pr.closed_at);
    put(doc, 'lead_time_seconds', seconds(pr.created_at, pr.merged_at));
    put(doc, 'first_review_wait_seconds', seconds(pr.created_at, reviewedAt));
  }

  const removed = [
    ...(filesUnknown ? ['changed_files_count', 'additions', 'deletions', 'changed_lines'] : []),
    ...(authorTeams.kind === 'unknown' ? ['author_team_ids'] : []),
  ];

  return {
    alias: 'prs-pull-requests',
    id: pullRequestDocId(repository.repository_id, enriched.pr_number),
    routing: String(repository.repository_id),
    doc: doc as Fields & { document_version: number },
    /*
     * 모르게 됐으면 **옛 값을 지운다** (PR #95 리뷰 P1).
     *
     * 필드를 싣지 않는 것만으로는 부족하다 — 조건부 대입은 실린 키만 건드리므로
     * 이미 색인된 수가 그대로 남고, 그 PR은 계속 숫자 구간에 머문다. **부재로
     * 판정하는 필드는 부재를 실제로 만들 수 있어야 한다.**
     */
    /*
     * 모르게 됐으면 **옛 값을 지운다** (PR #95 리뷰 P1 / CR-058 DEV-484).
     *
     * 두 판정이 같은 규율을 따르고 지우는 이름만 다르다. `author_team_ids`는
     * 작성자가 팀을 옮기거나 조직 동기화가 낡으면 부재가 되어야 하는데, 필드를
     * 싣지 않는 것만으로는 이미 색인된 팀 ID가 남아 **떠난 팀의 버킷이 계속
     * 답한다.**
     */
    ...(removed.length > 0 ? { remove: removed } : {}),
    createOnly: {
      // 관계 파생은 WP-029의 일이다. 투영은 "아직"이라고만 적고 값은 건드리지
      // 않는다 — `doc`에 넣으면 투영이 돌 때마다 WP-029의 결과를 되돌린다.
      links_pending: true,
      link_summary: {
        has_revert: false,
        is_reverted: false,
        has_cherry_pick: false,
        has_stack: false,
        reference_count: 0,
      },
    },
  };
}

/**
 * 커밋 문서 (ENT-CORE-003).
 *
 * EVT-ING-002는 커밋 SHA만 나른다 — 메시지·작성자·부모는 없다. 그래도 문서를
 * 만드는 이유는 **SHA → PR 해석**이 이 제품의 핵심이기 때문이다 (FR-SRCH-002).
 * 나머지 필드는 미러 기반 WP가 채우며, 조건부 업서트가 키 단위로 대입하므로
 * 여기서 비워 둔 필드는 나중에 채워져도 지워지지 않는다.
 */
export function buildCommitDocuments(source: ProjectionSource): readonly UpsertRequest[] {
  const { enriched, repository } = source;
  const pr = enriched.pull_request;

  // SHA 하나에 문서 하나다. 머지 커밋이 원본 목록에도 있으면 머지 커밋이 이긴다.
  const roles = new Map<string, ProjectedCommitRole>();
  for (const sha of enriched.source_commit_shas) {
    const normalized = sha.toLowerCase();
    if (normalized === '') continue;
    /*
     * **체인 커밋은 원본 커밋 문서로 쓰지 않는다** (CR-117 / FR-SRCH-002 AC-7).
     *
     * 피처 브랜치가 `git merge dev`로 받아 온 dev 체인 커밋이 GitHub의 PR 커밋 목록에 섞여
     * 온다. 그 SHA에 `role: source_commit` 문서를 쓰면 조건부 업서트가 더 큰 버전(이 PR의
     * 웹훅 수신 시각)으로 체인이 정한 `merge_commit`·`direct_push`와 `base_branch`를 덮고,
     * 커밋 보강은 체인 밖 경로에서 `role`을 싣지 않아 되돌리지 못한다. 그 문서는 체인 경로
     * (커밋 보강·재구축)가 만들고 소유한다. 관계는 여기서 쓰지 않으므로(DEV-745) 이 건너뛰기가
     * 연결을 잃게 하지 않는다 — 연결은 관계 투영기가 유효 연결 술어로 따로 계산한다.
     *
     * 이 집합과 관계 투영기의 술어는 서로 다른 순간을 본다. 그 사이에 채번이 끼면 원본 커밋
     * 문서가 하나 생길 수 있다. 대개는 그 채번이 부른 커밋 보강(`COMMIT_METADATA_SCRIPT`)이
     * 버전과 무관하게 역할을 다시 대입해 아물고, 보강보다 이 쓰기가 늦게 닿는 드문 순서는
     * 복구 명령(`prsctl links apply`)의 역할 되돌리기가 잡는다.
     */
    if (source.chainShas.has(normalized)) continue;
    roles.set(normalized, 'source_commit');
  }
  /*
   * **병합 판정은 파생 상태를 쓴다** (CR-116 / DEV-753, CR-101의 `derivePullRequestState`).
   *
   * `pr.merged`만 보면 백필의 목록 끝점(`GET /pulls`)이 그 필드를 주지 않아 **병합된 PR의
   * 머지 커밋 문서가 만들어지지 않는다.** 그런데 관계 채택은 같은 PR에 `merge` 근거를
   * 세우므로, 정본은 연결을 말하는데 그 문서가 없어 관계 투영기가 `document_missing`으로
   * 재시도하다 보류된다. PR 문서의 `state`·관계 채택·재색인이 모두 같은 판정을 쓴다.
   */
  const mergeSha = pr !== null && derivePullRequestState(pr) === 'merged' ? pr.merge_commit_sha : null;
  if (mergeSha !== null && mergeSha !== undefined && mergeSha !== '') {
    roles.set(mergeSha.toLowerCase(), 'merge_commit');
  }

  const requests: UpsertRequest[] = [];
  for (const [sha, role] of roles) {
    requests.push(
      buildProjectedCommitDocument({
        repository,
        commitSha: sha,
        role,
        pullRequestNumber: enriched.pr_number,
        baseBranch: pr?.base_ref,
        documentVersion: source.documentVersion,
        enrichmentPending: enriched.enrichment_pending,
        lastDeliveryId: enriched.delivery_id,
        indexedAt: source.indexedAt.toISOString(),
      }),
    );
  }
  return requests;
}

/** PR 투영이 만드는 커밋 문서 하나에 필요한 것. */
export interface ProjectedCommitInput {
  readonly repository: RepositoryRow;
  readonly commitSha: string;
  readonly role: ProjectedCommitRole;
  readonly pullRequestNumber: number;
  readonly baseBranch?: string | undefined;
  readonly documentVersion: number;
  readonly enrichmentPending: boolean;
  /**
   * 운영 추적용 전달 식별자. **재구축에는 없다** — 정본이 아니라 그 회차의
   * 흔적이므로, 없는 것을 지어내지 않고 필드를 두지 않는다.
   */
  readonly lastDeliveryId?: string | undefined;
  readonly indexedAt: string;
}

/**
 * PR 유래 커밋 문서 하나 (ENT-CORE-003).
 *
 * **투영과 정본 재구축이 같은 함수를 쓴다** (PR #52 리뷰 P1). 재구축이 필요한
 * 재료는 전부 `pull_request_snapshot.document`에 있다 — `source_commit_shas` ·
 * `pr_number` · `base_branch` · `merge_commit_sha` · `enrichment_pending`.
 * 따로 만들면 재구축 결과와 평시 결과가 갈라진다.
 */
export function buildProjectedCommitDocument(input: ProjectedCommitInput): UpsertRequest {
  const doc: Fields = {
    document_version: input.documentVersion,
    ...repositoryScope(input.repository),
    commit_sha: input.commitSha,
    role: input.role,
    enrichment_pending: input.enrichmentPending,
    // PR 문서와 같은 값이다. 커밋 문서는 FR-SRCH-002(SHA → PR)의 결과로
    // 직접 나가므로, 표식이 없으면 해제된 저장소가 살아 있는 것처럼 보인다
    // (CR-013, DEV-028).
    repository_archived: input.repository.status === 'archived',
    indexed_at: input.indexedAt,
  };
  put(doc, 'base_branch', input.baseBranch);
  put(doc, 'last_delivery_id', input.lastDeliveryId);

  return {
    alias: 'prs-commits',
    id: commitDocId(input.repository.repository_id, input.commitSha),
    routing: String(input.repository.repository_id),
    doc: doc as Fields & { document_version: number },
    /*
     * **`pull_request_numbers`를 여기서 쓰지 않는다** (CR-116 / WP-101, DEV-745).
     *
     * 전에는 `union: { pull_request_numbers: [prNumber] }`였다. 합집합은 N:M에서 다른
     * PR의 번호를 지키려던 선택이었지만(CR-011, DEV-019), **한 번 더해진 번호를 영영
     * 빼지 못한다.** PR이 rebase되어 원본 목록에서 빠진 커밋에 그 번호가 남았다.
     *
     * 대입으로 바꾸는 것만으로도 안 된다 — 한 PR의 `[prNumber]`로 전체 배열을 덮으면
     * 같은 커밋의 다른 PR 연결이 사라진다. 그래서 이 필드의 소유자는 **커밋별 전용
     * 투영기**이고(`@prs/es`의 `applyCommitLinks`), 그 입력은 PostgreSQL의 관계
     * 정본이다. 여기서는 역할·범위·버전만 쓴다.
     */
    createOnly: {
      link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false },
    },
  };
}

/** 한 이벤트가 만드는 문서 전부. 벌크 1건으로 나간다 (FR-ING-005 AC-2). */
export function buildUpsertRequests(source: ProjectionSource): readonly UpsertRequest[] {
  return [buildPullRequestDocument(source), ...buildCommitDocuments(source)];
}
