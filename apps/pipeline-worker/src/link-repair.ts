/**
 * PR 연결 전체 대조와 복구 (WP-101 / CR-116, FR-SRCH-002 AC-6).
 *
 * ## 왜 새 이벤트만으로는 부족한가
 *
 * 채택 경로는 **이번 관측의 old → new 차이**만 본다. 사내 pilot.17에서 PR #2355는
 * 이미 `source_commit_shas`가 2건으로 줄어 있었고, 잘못 남은 110건은 그 차이 어디에도
 * 나타나지 않았다. 차이가 아니라 **전체를 맞대어야** 그 110건이 보인다.
 *
 * ## 세 단계를 섞지 않는다
 *
 * | 단계 | 하는 일 | 쓰는 곳 |
 * | --- | --- | --- |
 * | `refetch` | 완전성 근거가 없는 PR만 GHE에서 다시 읽어 관측을 갱신한다 | PostgreSQL(관계·관측) |
 * | `plan` (기본) | 정본과 색인을 맞대어 **무엇을 바꾸게 될지**만 센다 | 아무 데도 쓰지 않는다 |
 * | `apply` | 바뀔 커밋에만 투영 의도를 만든다. 색인은 러너가 쓴다 | PostgreSQL(작업 큐) |
 *
 * 근거 수집과 계획을 한 명령에 묶지 않는 이유는, 그러면 **dry-run이 원격을 읽고
 * PostgreSQL을 고치게** 되기 때문이다. "무변경"이라고 적힌 것이 무변경이어야 한다.
 *
 * ## 색인의 값은 정답이 아니라 후보다
 *
 * `prs-commits`에 있는 PR 번호는 **검증 대상**이다. 정본에 없다고 곧바로 지우지
 * 않는다 — 그 번호를 만든 PR의 관측이 `verified`일 때만 지울 수 있고, 아니면
 * `blocked`로 보고한다. 스냅숏 부재·페이지 누락·권한 차단은 **삭제의 증거가 아니다.**
 *
 * ## 체인 규칙으로 빠지는 번호는 근거가 다르다 (CR-117 / FR-SRCH-002 AC-7)
 *
 * 피처 브랜치가 `git merge dev`로 받아 온 dev 체인 커밋의 번호는 원시 관측에 **있다** — GitHub이
 * 그 PR의 커밋 목록에 실었기 때문이다. 그 번호를 빼는 근거는 「목록이 전부였다」가 아니라 「그
 * 커밋은 이미 다른 PR로 체인에 올랐다」는 PostgreSQL의 사실이므로, 관측 확정 여부와 무관하게
 * 지운다. 같은 이유로 PR 투영이 `source_commit`으로 덮은 체인 커밋의 역할도 여기서 되돌린다.
 */

import type { Client } from '@elastic/elasticsearch';
import { mergeSequenceRepo, prCommitLinkRepo, withReindexWrite, withTransaction, type Pool, type RepositoryRow } from '@prs/db';
import { commitDocId, derivePullRequestState } from '@prs/domain';
import { restoreChainCommitRole, type ChainCommitRole } from '@prs/es';
import type { GitHubClient } from '@prs/github';
import { toEnrichedPullRequest } from './enriched-payload.js';

const COMMIT_ALIAS = 'prs-commits' as const;
const SCAN_PAGE = 500;

export interface LinkRepairFilter {
  /** 이 PR 번호들만 본다. 비면 전부. */
  readonly prNumbers?: readonly number[];
}

/** 한 커밋을 맞댄 결과. */
export interface LinkDifference {
  readonly commitSha: string;
  /** 색인에 있던 집합. */
  readonly indexed: readonly number[];
  /** 정본이 말하는 집합. */
  readonly canonical: readonly number[];
  readonly added: readonly number[];
  readonly removed: readonly number[];
  /**
   * `removed` 가운데 **체인 규칙**으로 빠지는 번호 (CR-117). 원시 관측에는 있지만 그 커밋이 이미
   * 다른 PR로 체인에 올라 유효 연결이 아니다. 관측 확정 여부와 무관하게 지운다.
   */
  readonly chainExcluded: readonly number[];
  /** 지워야 하지만 근거가 없어 남겨 둔 번호. */
  readonly withheld: readonly number[];
}

export interface LinkRepairPlan {
  readonly repository: string;
  /** 색인에서 훑은 커밋 문서 수. */
  readonly scanned: number;
  /** 바뀔 **고유 커밋** 수. 간선 수와 다른 값이다. */
  readonly commitsChanged: number;
  /** 바뀔 **관계 간선** 수 (커밋×PR). */
  readonly edgesAdded: number;
  readonly edgesRemoved: number;
  /**
   * `edgesRemoved` 가운데 체인 규칙으로 빠지는 간선과 그 고유 커밋 수 (CR-117 / FR-SRCH-002 AC-7).
   * `git merge dev`로 받아 온 dev 체인 커밋에서 그 PR 번호가 빠지는 몫이다.
   */
  readonly edgesChainExcluded: number;
  readonly chainExcludedCommits: number;
  /**
   * 체인 위에 있는데 색인 역할이 `source_commit`인 커밋 수 (CR-117). `apply`가 체인이 정한 역할로
   * 되돌린다. `--pr`로 좁힌 실행은 저장소 단위인 이 대조를 하지 않으며 그때 `null`이다.
   */
  readonly roleMismatches: number | null;
  readonly unchanged: number;
  /**
   * 삭제 후보가 있으나 그 PR의 관측이 확정이 아니라 **이 명령이 삭제로 예약하지 않은**
   * 커밋 수.
   *
   * **「그 번호가 색인에 남는다」는 보장이 아니다** (독립 검토 지적 D). 러너는 정본의
   * 전체 집합을 대입하므로, 같은 커밋이 다른 이유로 재투영되면(공동 소유 PR의 변경 등)
   * 정본에 없는 번호는 그때 함께 사라진다. 정본에서 지우지 않는다는 규율은
   * `adoptLinkObservation`이 지키는 것이고, 이 수는 **이번 실행의 계획**을 말한다.
   * 남은 번호를 확실히 붙잡아 두려면 `refetch`로 근거를 먼저 세워야 한다.
   */
  readonly blocked: number;
  /** 대조 자체가 실패한 커밋 수. */
  readonly failed: number;
  /** 완전성 근거가 없는 PR 수. `refetch`가 줄여야 하는 값이다. */
  readonly unverifiedPullRequests: number;
  /**
   * **지우려면 근거가 필요한 PR 번호들.** `blocked`를 실제로 풀 수 있는 목록이다.
   *
   * 수만 알려 주면 운영자는 `refetch`를 저장소 전체에 돌릴 수밖에 없고, 그것은 확정되지
   * 않은 모든 PR을 PR당 세 번의 GHE 호출로 읽는다는 뜻이다 — 사내 규모에서는 수천 번이다.
   * 이 목록이 있으면 `--pr`로 좁힐 수 있다.
   */
  readonly blockingPullRequests: readonly number[];
  /** 보고용 표본. 전량을 싣지 않는다 — 수만 건이면 출력이 증거가 아니라 소음이 된다. */
  readonly samples: readonly LinkDifference[];
}

export interface LinkRepairDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly log?: (entry: Readonly<Record<string, unknown>>) => void;
  /** 표본 상한. 기본 20. */
  readonly sampleLimit?: number;
}

interface ScannedCommit {
  readonly commit_sha?: string;
  readonly pull_request_numbers?: readonly number[];
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * 체인 커밋의 역할. PR 대응이 있거나 **병합 근거**가 있으면 머지 커밋이고, 아니면 직접 푸시다.
 *
 * 체인 행만 보는 `rebuildCommits`·커밋 보강의 규칙에 병합 근거를 더한 것이다 — 채번이 PR 문서보다
 * 먼저 돌면 체인 행의 PR이 `NULL`로 남는데(DEV-207), 그 커밋을 직접 푸시로 「되돌리면」 틀린 역할을
 * 하나 더 만든다. 병합 근거는 그 커밋이 어느 PR의 머지 커밋이라는 정본의 사실이다.
 */
function chainRoleOf(landers: readonly (number | null)[], hasMergeEvidence: boolean): ChainCommitRole {
  return hasMergeEvidence || landers.some((number) => number !== null) ? 'merge_commit' : 'direct_push';
}

/**
 * 체인 위에 있는데 색인 역할이 `source_commit`인 커밋을 훑는다 (CR-117 / FR-SRCH-002 AC-7).
 *
 * PR 투영이 피처 브랜치의 원본 목록에 섞인 dev 체인 커밋을 `source_commit`으로 덮어 온 자리다.
 * 색인에서 `source_commit` 문서를 페이지로 읽고, 페이지마다 **한 문장으로** 현재 체인 소속을
 * 묻는다. 체인 밖 문서는 정상적인 원본 커밋이므로 건드리지 않는다.
 */
async function forEachChainRoleMismatch(
  deps: LinkRepairDeps,
  repositoryId: number,
  visit: (commitSha: string, role: ChainCommitRole) => Promise<void>,
): Promise<void> {
  let after: readonly unknown[] | undefined;
  for (;;) {
    const response = await deps.es.search<ScannedCommit>({
      index: COMMIT_ALIAS,
      routing: String(repositoryId),
      size: SCAN_PAGE,
      _source: ['commit_sha'],
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }, { term: { role: 'source_commit' } }] } },
      sort: [{ commit_sha: 'asc' }],
      ...(after === undefined ? {} : { search_after: [...after] }),
    });
    const hits = response.hits.hits;
    if (hits.length === 0) break;
    const shas = hits
      .map((hit) => hit._source?.commit_sha)
      .filter((sha): sha is string => typeof sha === 'string' && sha !== '');
    const landers = await mergeSequenceRepo.findCurrentChainLanders(deps.pool, repositoryId, shas);
    const merged = await prCommitLinkRepo.listCommitsWithMergeEvidence(deps.pool, repositoryId, [...landers.keys()]);
    for (const sha of shas) {
      const key = sha.toLowerCase();
      const onChain = landers.get(key);
      if (onChain !== undefined) await visit(key, chainRoleOf(onChain, merged.has(key)));
    }
    const last = hits[hits.length - 1]?.sort;
    if (last === undefined || hits.length < SCAN_PAGE) break;
    after = last;
  }
}

/**
 * 정본과 색인을 맞댄다. **아무 데도 쓰지 않는다.**
 *
 * 색인 쪽과 정본 쪽을 **양방향으로** 본다. 색인에만 있는 번호(지워야 할 것)와
 * 정본에만 있는 번호(더해야 할 것)가 둘 다 결함이며, 한쪽만 보면 재색인 뒤
 * "누락은 없지만 잉여가 남은" 인덱스를 통과시킨다.
 */
export async function planLinkRepair(
  deps: LinkRepairDeps,
  repository: RepositoryRow,
  filter: LinkRepairFilter = {},
): Promise<LinkRepairPlan> {
  const repositoryId = Number(repository.repository_id);
  const prFilter = filter.prNumbers === undefined || filter.prNumbers.length === 0 ? null : new Set(filter.prNumbers);
  const sampleLimit = deps.sampleLimit ?? 20;

  const samples: LinkDifference[] = [];
  /** 표본 상한과 무관하게 **전부** 모은다 — 이것으로 `refetch --pr`를 좁힌다. */
  const blocking = new Set<number>();
  let scanned = 0;
  let commitsChanged = 0;
  let edgesAdded = 0;
  let edgesRemoved = 0;
  let edgesChainExcluded = 0;
  let chainExcludedCommits = 0;
  let unchanged = 0;
  let blocked = 0;
  let failed = 0;

  /** 관측이 `verified`인 PR만 삭제 권한을 준다. 한 번 읽어 두고 재사용한다. */
  const verified = new Map<number, boolean>();
  const isVerified = async (prNumber: number): Promise<boolean> => {
    const cached = verified.get(prNumber);
    if (cached !== undefined) return cached;
    const observation = await prCommitLinkRepo.findLinkObservation(deps.pool, repositoryId, prNumber);
    const value = observation?.verification_state === 'verified';
    verified.set(prNumber, value);
    return value;
  };

  const consider = async (sha: string, indexed: readonly number[]): Promise<void> => {
    // 유효 연결과 체인 규칙으로 빠진 번호를 **한 문장으로** 읽는다 (CR-117).
    const sets = await prCommitLinkRepo.readCommitLinkSets(deps.pool, repositoryId, sha);
    const canonicalNumbers = sets.effective;
    const chainExcludedSet = new Set(sets.chainExcluded);
    const indexedSet = new Set(indexed);
    const canonicalSet = new Set(canonicalNumbers);

    const added = canonicalNumbers.filter((n) => !indexedSet.has(n) && (prFilter === null || prFilter.has(n)));
    const removalCandidates = indexed.filter((n) => !canonicalSet.has(n) && (prFilter === null || prFilter.has(n)));

    const removed: number[] = [];
    const chainExcluded: number[] = [];
    const withheld: number[] = [];
    for (const number of removalCandidates) {
      /*
       * 체인 규칙으로 빠지는 번호는 **관측 확정을 묻지 않는다** (CR-117). 그 번호는 원시 관측에
       * 있고, 빼는 근거는 목록의 완전성이 아니라 체인 소속이다 — PostgreSQL이 이미 아는 사실이다.
       */
      if (chainExcludedSet.has(number)) {
        removed.push(number);
        chainExcluded.push(number);
      } else if (await isVerified(number)) removed.push(number);
      else {
        withheld.push(number);
        blocking.add(number);
      }
    }

    if (added.length === 0 && removed.length === 0) {
      if (withheld.length > 0) blocked += 1;
      else unchanged += 1;
      return;
    }
    commitsChanged += 1;
    edgesAdded += added.length;
    edgesRemoved += removed.length;
    edgesChainExcluded += chainExcluded.length;
    if (chainExcluded.length > 0) chainExcludedCommits += 1;
    if (withheld.length > 0) blocked += 1;
    if (samples.length < sampleLimit) {
      samples.push({
        commitSha: sha,
        indexed: sortedUnique([...indexed]),
        canonical: canonicalNumbers,
        added: sortedUnique(added),
        removed: sortedUnique(removed),
        chainExcluded: sortedUnique(chainExcluded),
        withheld: sortedUnique(withheld),
      });
    }
  };

  /*
   * 1) 색인을 훑는다. **색인에만 있는 잉여**가 이 CR이 고치려는 결함이므로 이쪽이
   *    먼저다. `search_after`로 커서를 고정한다 — scroll은 전환 중에 옛 인덱스를
   *    붙잡고, 그 사이 전환이 일어나면 무엇을 본 것인지 알 수 없게 된다.
   */
  let after: readonly unknown[] | undefined;
  const seen = new Set<string>();
  for (;;) {
    const response = await deps.es.search<ScannedCommit>({
      index: COMMIT_ALIAS,
      routing: String(repositoryId),
      size: SCAN_PAGE,
      _source: ['commit_sha', 'pull_request_numbers'],
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }, { exists: { field: 'pull_request_numbers' } }] } },
      sort: [{ commit_sha: 'asc' }],
      ...(after === undefined ? {} : { search_after: [...after] }),
    });
    const hits = response.hits.hits;
    if (hits.length === 0) break;
    for (const hit of hits) {
      const sha = hit._source?.commit_sha;
      if (typeof sha !== 'string' || sha === '') {
        failed += 1;
        continue;
      }
      scanned += 1;
      seen.add(sha);
      try {
        await consider(sha, hit._source?.pull_request_numbers ?? []);
      } catch (error) {
        failed += 1;
        deps.log?.({ level: 'warn', message: '커밋 대조가 실패했다', commit_sha: sha, reason: String(error).slice(0, 200) });
      }
    }
    const last = hits[hits.length - 1]?.sort;
    if (last === undefined || hits.length < SCAN_PAGE) break;
    after = last;
  }

  /*
   * 2) 정본에만 있는 커밋. 색인에 `pull_request_numbers` 필드가 아예 없는 문서는
   *    위 `exists` 질의가 잡지 못한다 — 재색인 직후의 새 인덱스가 정확히 그 모양이다.
   */
  let cursor = '';
  for (;;) {
    const rows = await prCommitLinkRepo.listCommitLinksAfter(deps.pool, repositoryId, cursor, SCAN_PAGE);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.commit_sha;
      if (seen.has(row.commit_sha)) continue;
      scanned += 1;
      try {
        await consider(row.commit_sha, []);
      } catch (error) {
        failed += 1;
        deps.log?.({ level: 'warn', message: '정본 커밋 대조가 실패했다', commit_sha: row.commit_sha, reason: String(error).slice(0, 200) });
      }
    }
    if (rows.length < SCAN_PAGE) break;
  }

  let unverifiedPullRequests = 0;
  let prCursor = 0;
  for (;;) {
    const rows = await prCommitLinkRepo.listPullRequestsNeedingRefetch(deps.pool, repositoryId, prCursor, SCAN_PAGE);
    if (rows.length === 0) break;
    unverifiedPullRequests += rows.filter((row) => prFilter === null || prFilter.has(row.pr_number)).length;
    prCursor = rows[rows.length - 1]?.pr_number ?? prCursor;
    if (rows.length < SCAN_PAGE) break;
  }

  /*
   * 3) 덮인 체인 커밋 역할 (CR-117). 역할은 PR 단위가 아니라 커밋 단위라 `--pr`로 좁힌 실행에서는
   *    대조하지 않는다 — 좁혀 달라고 한 운영자에게 저장소 전체를 바꾸는 일을 끼워 넣지 않는다.
   */
  let roleMismatches: number | null = null;
  if (prFilter === null) {
    let count = 0;
    await forEachChainRoleMismatch(deps, repositoryId, async () => {
      count += 1;
    });
    roleMismatches = count;
  }

  return {
    repository: `${repository.owner}/${repository.name}`,
    scanned,
    commitsChanged,
    edgesAdded,
    edgesRemoved,
    edgesChainExcluded,
    chainExcludedCommits,
    roleMismatches,
    unchanged,
    blocked,
    failed,
    unverifiedPullRequests,
    blockingPullRequests: [...blocking].sort((a, b) => a - b),
    samples,
  };
}

export interface LinkRepairApplyResult {
  /** 투영 의도를 만든 커밋 수. */
  readonly scheduled: number;
  /** 이미 큐에 있어 다시 세우지 않은 커밋 수. */
  readonly skippedStale: number;
  readonly blocked: number;
  /**
   * 체인이 정한 역할로 되돌린 커밋 수 (CR-117). `--pr`로 좁힌 실행은 이 일을 하지 않으며 그때
   * `null`이다. 되돌리는 사이 문서가 사라졌으면 세지 않는다.
   */
  readonly rolesRestored: number | null;
}

/**
 * 계획을 실행한다. **색인에 직접 쓰지 않는다.**
 *
 * 투영 의도만 만들고 실제 쓰기는 러너가 한다 — CLI만의 투영 구현을 두면 그 경로의
 * 세대 규율·충돌 판정이 러너와 갈라진다 (CR-113의 `reproject`와 같은 규율).
 *
 * **실행 직전에 정본을 다시 읽는다.** 계획과 실행 사이에 새 웹훅이 들어왔을 수
 * 있고, 그때 계획의 결론은 이미 낡았다. 정본이 계획과 달라진 커밋은 건드리지
 * 않는다 — 러너가 그 변경을 이미 큐에 갖고 있다.
 *
 * 반복 실행은 멱등이다. `ensureCommitLinkStates`가 있는 행의 세대를 올리지 않으므로,
 * 같은 명령을 두 번 돌려도 색인 쓰기가 두 번 일어나지 않는다.
 */
export async function applyLinkRepair(
  deps: LinkRepairDeps,
  repository: RepositoryRow,
  filter: LinkRepairFilter = {},
): Promise<LinkRepairApplyResult> {
  const repositoryId = Number(repository.repository_id);
  const prFilter = filter.prNumbers === undefined || filter.prNumbers.length === 0 ? null : new Set(filter.prNumbers);

  let scheduled = 0;
  let skippedStale = 0;
  let blocked = 0;

  const needsWork: string[] = [];
  let after: readonly unknown[] | undefined;
  const seen = new Set<string>();

  const check = async (sha: string, indexed: readonly number[]): Promise<void> => {
    const sets = await prCommitLinkRepo.readCommitLinkSets(deps.pool, repositoryId, sha);
    const canonical = sets.effective;
    const chainExcludedSet = new Set(sets.chainExcluded);
    const indexedSet = new Set(indexed);
    const canonicalSet = new Set(canonical);
    const added = canonical.filter((n) => !indexedSet.has(n) && (prFilter === null || prFilter.has(n)));
    const removalCandidates = indexed.filter((n) => !canonicalSet.has(n) && (prFilter === null || prFilter.has(n)));

    let removable = 0;
    let withheld = 0;
    for (const number of removalCandidates) {
      // 체인 규칙으로 빠지는 번호는 관측 확정을 묻지 않는다 — 계획과 같은 판정이다 (CR-117).
      if (chainExcludedSet.has(number)) {
        removable += 1;
        continue;
      }
      const observation = await prCommitLinkRepo.findLinkObservation(deps.pool, repositoryId, number);
      if (observation?.verification_state === 'verified') removable += 1;
      else withheld += 1;
    }
    /*
     * **계획과 같은 단위로 센다** — 커밋 수다. `planLinkRepair`는 커밋을 세는데 여기서
     * 간선을 세면 같은 이름의 두 수가 다른 것을 뜻하고, 운영자는 그 둘을 비교한다.
     */
    if (withheld > 0) blocked += 1;
    if (added.length === 0 && removable === 0) return;
    needsWork.push(sha);
  };

  for (;;) {
    const response = await deps.es.search<ScannedCommit>({
      index: COMMIT_ALIAS,
      routing: String(repositoryId),
      size: SCAN_PAGE,
      _source: ['commit_sha', 'pull_request_numbers'],
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }, { exists: { field: 'pull_request_numbers' } }] } },
      sort: [{ commit_sha: 'asc' }],
      ...(after === undefined ? {} : { search_after: [...after] }),
    });
    const hits = response.hits.hits;
    if (hits.length === 0) break;
    for (const hit of hits) {
      const sha = hit._source?.commit_sha;
      if (typeof sha !== 'string' || sha === '') continue;
      seen.add(sha);
      await check(sha, hit._source?.pull_request_numbers ?? []);
    }
    const last = hits[hits.length - 1]?.sort;
    if (last === undefined || hits.length < SCAN_PAGE) break;
    after = last;
  }

  let cursor = '';
  for (;;) {
    const rows = await prCommitLinkRepo.listCommitLinksAfter(deps.pool, repositoryId, cursor, SCAN_PAGE);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.commit_sha;
      if (seen.has(row.commit_sha)) continue;
      await check(row.commit_sha, []);
    }
    if (rows.length < SCAN_PAGE) break;
  }

  if (needsWork.length > 0) {
    /*
     * 만들거나(새 커밋), 세대를 올리거나(반영 완료로 표시됐지만 불일치가 남은
     * 커밋), 그냥 둔다(이미 큐에 밀려 있는 커밋). 마지막 갈래를 건드리면 진행
     * 중인 정상 쓰기가 충돌로 보인다.
     */
    const queued = await prCommitLinkRepo.requeueCommitLinks(deps.pool, repositoryId, needsWork);
    scheduled = queued.created + queued.bumped;
    skippedStale = queued.alreadyQueued;
  }

  /*
   * 덮인 체인 커밋 역할을 되돌린다 (CR-117 / FR-SRCH-002 AC-7). **이 명령이 색인에 직접 쓰는
   * 유일한 자리다** — 관계 러너는 `role`을 비추지 않아 갈라질 두 번째 경로가 없고, 값은 체인
   * 행에서 결정론적으로 나오며, 쓰기는 `source_commit`일 때만 바꾸는 단방향·멱등이다
   * (`restoreChainCommitRole`). 재색인 울타리 안에서 쓴다 — 진행 중인 재색인의 shadow도 같은
   * 값을 받는다. 계획처럼 `--pr`로 좁힌 실행에서는 하지 않는다.
   */
  let rolesRestored: number | null = null;
  if (prFilter === null) {
    let restored = 0;
    await forEachChainRoleMismatch(deps, repositoryId, async (commitSha, role) => {
      const outcome = await withReindexWrite(deps.pool, (targets) =>
        restoreChainCommitRole(deps.es, { repositoryId, docId: commitDocId(repositoryId, commitSha), role }, targets),
      );
      if (outcome === 'restored') restored += 1;
    });
    rolesRestored = restored;
  }

  return { scheduled, skippedStale, blocked, rolesRestored };
}

/* ------------------------------------------------------------------------- */
/* 근거 재수집 (CR-116 / WP-101)                                               */
/* ------------------------------------------------------------------------- */

export interface LinkRefetchDeps extends LinkRepairDeps {
  readonly client: GitHubClient;
  readonly now?: () => Date;
}

export interface LinkRefetchResult {
  /** 다시 읽은 PR 수. */
  readonly attempted: number;
  /** 완전한 관측을 얻어 `verified`가 된 PR 수. */
  readonly verified: number;
  /** 다시 읽었지만 여전히 완전하지 않은 PR 수. 사유는 관측 행에 남는다. */
  readonly stillIncomplete: number;
  /** 원격 조회 자체가 실패한 PR 수. */
  readonly failed: number;
  /** 관계가 실제로 바뀐 커밋 수. */
  readonly affectedCommits: number;
}

/**
 * 완전성 근거가 없는 PR만 **기존 읽기 전용 GHE 경로로** 다시 읽는다.
 *
 * ## 왜 전수조회가 아닌가
 *
 * 재색인이 GHE 전수조회에 의존하면 그 순간 이 제품은 GHE의 rate limit 안에 갇힌다.
 * 정본에서 재구축할 수 있어야 한다는 ADR-004가 바로 그것을 막으려는 규칙이다.
 * 그래서 **필요한 항목만** 읽는다 — `verification_state <> 'verified'`인 PR이다.
 *
 * ## 무엇을 확인하는가
 *
 * 보강 워커와 **같은 네 조건**이다: 커밋 조회 성공, 우리 상한 미달, 원격이 말한
 * 커밋 수와 일치, 읽기 전후 head/base 동일. 규칙을 두 곳에 각자 적으면 언젠가
 * 어긋나고, 그 날 한쪽만 삭제 권한을 잘못 준다.
 *
 * 실패는 **삭제의 근거가 아니다.** 권한 차단(403)·삭제된 PR(404)·rate limit 모두
 * 관측을 갱신하지 않고 사유만 남긴다.
 */
export async function refetchLinkEvidence(
  deps: LinkRefetchDeps,
  repository: RepositoryRow,
  filter: LinkRepairFilter & { readonly limit?: number } = {},
): Promise<LinkRefetchResult> {
  const repositoryId = Number(repository.repository_id);
  const ref = { owner: repository.owner, repo: repository.name };
  const prFilter = filter.prNumbers === undefined || filter.prNumbers.length === 0 ? null : new Set(filter.prNumbers);
  const limit = filter.limit ?? Number.MAX_SAFE_INTEGER;

  let attempted = 0;
  let verified = 0;
  let stillIncomplete = 0;
  let failed = 0;
  let affectedCommits = 0;

  let cursor = 0;
  outer: for (;;) {
    const rows = await prCommitLinkRepo.listPullRequestsNeedingRefetch(deps.pool, repositoryId, cursor, SCAN_PAGE);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.pr_number;
      if (prFilter !== null && !prFilter.has(row.pr_number)) continue;
      if (attempted >= limit) break outer;
      attempted += 1;

      const observation = await observePullRequestLinks(deps, ref, row.pr_number);
      if (observation === null) {
        failed += 1;
        continue;
      }
      const adoption = await withTransaction(deps.pool, async (client) => {
        const result = await prCommitLinkRepo.adoptLinkObservation(client, {
          repositoryId,
          prNumber: row.pr_number,
          ...observation,
        });
        if (result.affected.length > 0) {
          await prCommitLinkRepo.bumpCommitLinkGenerations(client, repositoryId, result.affected);
        }
        return result;
      });
      affectedCommits += adoption.affected.length;
      /*
       * **채택된 관측만 센다** (독립 검토 지적).
       *
       * `commitsComplete`만 보면 채택이 `stale`·`conflict`로 접혀 **관측이 그대로여도**
       * 「N건 확정」이 올라간다. 운영자는 그 수를 보고 다음 단계로 넘어가는데 정본에는
       * 아무 일도 일어나지 않았다 — 숫자가 사실이 아니게 된다.
       */
      if (adoption.outcome === 'adopted' && observation.commitsComplete) verified += 1;
      else stillIncomplete += 1;
    }
    if (rows.length < SCAN_PAGE) break;
  }

  return { attempted, verified, stillIncomplete, failed, affectedCommits };
}

/**
 * PR 하나를 원격에서 관측한다. 보강 워커와 **같은 완전성 규칙**을 쓴다.
 *
 * @returns 원격 조회가 실패했으면 `null` — 실패는 관측이 아니다. 관측을 만들어
 *   저장하면 그 빈 목록이 "이 PR에는 커밋이 없다"라는 사실 주장이 된다.
 */
async function observePullRequestLinks(
  deps: LinkRefetchDeps,
  ref: { readonly owner: string; readonly repo: string },
  prNumber: number,
): Promise<Omit<Parameters<typeof prCommitLinkRepo.adoptLinkObservation>[1], 'repositoryId' | 'prNumber'> | null> {
  const options = { priority: 'backfill' } as const;
  let before;
  try {
    before = toEnrichedPullRequest(await deps.client.getPullRequest(ref, prNumber, options));
  } catch (error) {
    deps.log?.({ level: 'warn', message: 'PR 상세를 읽지 못했다', pr_number: prNumber, reason: String(error).slice(0, 200) });
    return null;
  }

  let shas: readonly string[];
  let truncated: boolean;
  try {
    const page = await deps.client.listPullRequestCommitsPaged(ref, prNumber, options);
    shas = page.items.map((commit) => commit.sha);
    truncated = page.truncated;
  } catch (error) {
    deps.log?.({ level: 'warn', message: 'PR 커밋 목록을 읽지 못했다', pr_number: prNumber, reason: String(error).slice(0, 200) });
    return null;
  }

  /*
   * 완전성 판정 넷. 세 번째가 **API 자체 상한의 방어선**이다 —
   * `GET /pulls/{n}/commits`는 250건에서 GitHub이 자르고 그 응답에는 `rel="next"`가
   * 없어 `truncated`가 거짓이 된다. 이 대조가 없으면 400 커밋 PR이 "250건이 전부"로
   * 읽히고, 읽지 못한 150건에서 PR 번호가 지워진다.
   */
  let complete =
    !truncated && before.commits_count !== null && before.commits_count === shas.length;
  if (complete) {
    try {
      const after = toEnrichedPullRequest(await deps.client.getPullRequest(ref, prNumber, options));
      complete = after.head_sha === before.head_sha && after.base_sha === before.base_sha;
    } catch {
      complete = false;
    }
  }

  return {
    /*
     * **순서 기준은 지금 시각이다** (CR-116 / DEV-749).
     *
     * `updated_at`을 쓰면 안 된다. seed된 관측의 버전은 웹훅 수신 시각(ms)이고
     * PR의 `updated_at`은 그보다 이르다 — 마지막 웹훅 이후 바뀌지 않은 PR은
     * 전부 그렇다. 그러면 재수집이 언제나 `stale`로 접히고, **재수집이 필요한
     * 바로 그 PR들에게 아무 일도 일어나지 않는다.**
     *
     * 이 값은 **순서를 정하는 키이지 신선함의 증명이 아니다.** 신선함은 목록을
     * 읽기 전후로 head/base를 두 번 읽어 증명했고(`complete`), 시각은 "이 관측이
     * 그 웹훅들보다 뒤에 일어났다"만 말한다. 방금 원격을 읽었으므로 그것은 참이다.
     */
    observedVersion: (deps.now ?? ((): Date => new Date()))().getTime(),
    sourceShas: shas,
    mergeSha: derivePullRequestState(before) === 'merged' ? before.merge_commit_sha : null,
    commitsComplete: complete,
    pullRequestAuthoritative: true,
    commitsErrorKind: null,
    apiCommitCount: before.commits_count,
    sourceCommitsTruncated: truncated,
    headSha: before.head_sha,
    baseSha: before.base_sha,
    baseBranch: before.base_ref,
    prState: derivePullRequestState(before),
    reason: complete ? null : 'refetch_incomplete',
  };
}
