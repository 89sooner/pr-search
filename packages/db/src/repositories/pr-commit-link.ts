/**
 * PR↔커밋 관계 정본 (WP-101 / CR-116, FR-SRCH-002, ADR-004).
 *
 * ## 왜 이 계층이 있나
 *
 * 커밋 문서의 `pull_request_numbers`는 "이 커밋이 어느 PR에 속하는가"를 답한다.
 * 그 답은 **현재 유효한 연결**이어야 하는데, Elasticsearch 업서트의 합집합 필드는
 * 한 번 더해진 번호를 영영 빼지 못했다 (CR-011, DEV-019). 대입으로 바꾸는 것만으로도
 * 안 된다 — 커밋 하나가 여러 PR에 속하므로 한 PR의 투영이 전체 배열을 쓰면 다른
 * PR의 번호를 지운다.
 *
 * 그래서 관계의 정본을 여기 둔다. PR마다 자기 관계만 갱신하고, 커밋마다 **그
 * 커밋을 소유하는 PR 전부**를 다시 세어 배열을 만든다. 두 일이 서로를 덮지 않는다.
 *
 * ## 이 계층이 지키는 규율 셋
 *
 * 1. **불완전한 목록으로 지우지 않는다.** 목록에 없다는 사실이 소속이 아니라는
 *    뜻이 되려면 그 목록이 원격의 전부여야 한다. 증명하지 못한 관측은 관계를
 *    더할 수는 있어도 뺄 수는 없다.
 * 2. **관계 변경과 투영 의도는 한 트랜잭션이다.** 색인 쓰기가 실패하거나 직후에
 *    프로세스가 죽어도 제거의 근거와 할 일이 PostgreSQL에 남는다.
 * 3. **소유자는 `(repository_id, pr_number)`다.** 같은 SHA·같은 번호라도 저장소가
 *    다르면 다른 관계이고, base 변경이나 seq_epoch 변경은 소유권을 바꾸지 않는다.
 */

import type { Pool, PoolClient } from 'pg';
import { advisoryXactLock, pullRequestLinkLockKey } from '../advisory-lock.js';

type Queryable = Pool | PoolClient;

/** 관계의 근거. 키의 일부라 한쪽이 사라져도 다른 쪽은 남는다. */
export type LinkEvidence = 'source' | 'merge';

export type LinkVerificationState = 'verified' | 'unverified' | 'conflict' | 'pending_refetch';

export type CommitLinkWorkState = 'ready' | 'leased' | 'retry' | 'parked' | 'done';

export interface PullRequestCommitLinkRow {
  readonly repository_id: string;
  readonly pr_number: number;
  readonly commit_sha: string;
  readonly evidence: LinkEvidence;
  readonly observed_version: string;
}

export interface LinkObservationRow {
  readonly repository_id: string;
  readonly pr_number: number;
  readonly observed_version: string;
  readonly head_sha: string | null;
  readonly base_sha: string | null;
  readonly base_branch: string | null;
  readonly pr_state: string | null;
  readonly commits_complete: boolean;
  readonly commits_error_kind: string | null;
  readonly api_commit_count: number | null;
  readonly fetched_count: number;
  readonly source_commits_truncated: boolean;
  readonly verification_state: LinkVerificationState;
  readonly refetch_requested_at: Date | null;
  readonly refetch_attempts: number;
  readonly last_verified_at: Date | null;
  readonly last_reason: string | null;
}

export interface CommitLinkStateRow {
  readonly repository_id: string;
  readonly commit_sha: string;
  readonly generation: string;
  readonly projected_generation: string;
  readonly projected_numbers: number[] | null;
  readonly state: CommitLinkWorkState;
  readonly lease_token: string | null;
  readonly attempt_count: number;
  readonly last_reason: string | null;
  readonly conflict_at: Date | null;
}

/**
 * 한 PR을 관측한 결과.
 *
 * **`commitsComplete`가 이 구조의 전부다.** 나머지 필드는 그 판정의 근거를
 * 남기려고 있다 — 나중에 "왜 지우지 못했나"를 답할 수 있어야 운영자가 다음 수를
 * 고른다.
 */
export interface LinkObservationInput {
  readonly repositoryId: number;
  readonly prNumber: number;
  /** 채택 판정의 기준. PR 문서의 `document_version`과 같은 값이다. */
  readonly observedVersion: number;
  /** 원본 커밋 목록. 소문자 40자 16진수만 받는다. */
  readonly sourceShas: readonly string[];
  /**
   * **실제로 병합된** 머지 커밋. 미병합 PR의 시험용 SHA는 `null`이다 —
   * GitHub이 만드는 그 임시 커밋은 병합의 근거가 아니다.
   */
  readonly mergeSha: string | null;
  /** 원본 목록이 원격의 전부임을 증명했는가. 거짓이면 삭제 권한이 없다. */
  readonly commitsComplete: boolean;
  /**
   * PR 본문을 원격에서 직접 읽었는가.
   *
   * 거짓이면 `merge` 근거를 **지우지 않는다.** 웹훅 사본만으로 "이 PR은 이제
   * 병합되지 않았다"를 단정할 수 없기 때문이다.
   */
  readonly pullRequestAuthoritative: boolean;
  readonly commitsErrorKind: string | null;
  readonly apiCommitCount: number | null;
  readonly sourceCommitsTruncated: boolean;
  readonly headSha: string | null;
  readonly baseSha: string | null;
  readonly baseBranch: string | null;
  readonly prState: string | null;
  readonly reason: string | null;
}

/** 채택 결과. 호출 측이 무엇이 실제로 바뀌었는지 알아야 투영 의도를 남긴다. */
export interface AdoptionResult {
  /** 관계가 실제로 바뀌었는가. `false`여도 실패가 아니다. */
  readonly changed: boolean;
  readonly outcome: 'adopted' | 'stale' | 'idempotent' | 'conflict';
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** old ∪ new. 투영을 다시 해야 하는 커밋 전부다. */
  readonly affected: readonly string[];
  readonly verificationState: LinkVerificationState;
  /** 불완전해서 지우지 못하고 남겨 둔 SHA. 운영 보고의 `blocked`가 된다. */
  readonly withheld: readonly string[];
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * 링크 행 `l`의 커밋이 **추적 브랜치의 현재 체인**에 있는 행 (CR-117 / FR-SRCH-002 AC-7).
 *
 * 저장소가 **지금 추적하는** 브랜치(`repository.sequence_branches`)의 **현재 에폭**만 본다.
 * 추적을 끈 브랜치의 공간 행은 지워지지 않고 남아 더는 갱신되지 않는다 — 그것으로 판정하면
 * 낡은 체인이 살아 있는 연결을 가린다. 탐색은 `sequence_space` → `merge_sequence`의
 * `(repository_id, base_branch, seq_epoch, commit_sha)` 유일 인덱스 순서다.
 */
const CHAIN_ROWS_OF_LINK = `
  SELECT 1
    FROM repository r
    JOIN sequence_space ss
      ON ss.repository_id = r.repository_id AND ss.base_branch = ANY (r.sequence_branches)
    JOIN merge_sequence ms
      ON ms.repository_id = ss.repository_id AND ms.base_branch = ss.base_branch AND ms.seq_epoch = ss.seq_epoch
   WHERE r.repository_id = l.repository_id AND ms.commit_sha = l.commit_sha`;

/**
 * **유효 연결 술어** (CR-117 / FR-SRCH-002 AC-7, OD-016). `l`은 `pull_request_commit_link`의 별칭이다.
 *
 * 원본 커밋은 **그 PR이 새로 가져온 커밋**이다. 추적 브랜치의 현재 체인에 이미 오른 커밋은
 * 그 커밋을 체인에 올린 PR에만 속하므로, 다른 PR의 `source` 근거는 연결로 세지 않는다 —
 * 피처 브랜치가 `git merge dev`로 받아 온 dev 체인 커밋이 GitHub의 PR 커밋 목록에 섞여 오는
 * 자리다. 체인 행의 PR이 `NULL`(직접 푸시이거나 아직 모름)이어도 어느 쪽이든 그 PR이 올린
 * 것은 아니므로 뺀다. `= l.pr_number` 절은 fast-forward로 자기 커밋을 체인에 올린 PR을 위한
 * 안전장치이고 squash-only에서는 발동하지 않는다. `merge` 근거는 이 규칙과 무관하다.
 *
 * **원시 관측은 지우지 않는다.** 이 술어는 읽는 자리에만 선다 — 체인이 바뀌면(강제 푸시로
 * 체인에서 빠진 커밋) GitHub을 다시 읽지 않고 재투영만으로 연결이 되살아나야 하기 때문이다.
 * 관계를 읽는 모든 질의가 이 문자열 하나를 쓴다. 한 곳이라도 원시 행을 직접 세면 두 화면이
 * 다른 답을 한다.
 */
export const EFFECTIVE_LINK_SQL = `(
  l.evidence = 'merge'
  OR NOT EXISTS (${CHAIN_ROWS_OF_LINK})
  OR EXISTS (${CHAIN_ROWS_OF_LINK} AND ms.pull_request_number = l.pr_number)
)`;

function normalizeShas(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const sha = value.toLowerCase();
    if (SHA.test(sha)) out.add(sha);
  }
  return [...out];
}

function normalizeSha(value: string | null): string | null {
  if (value === null) return null;
  const sha = value.toLowerCase();
  return SHA.test(sha) ? sha : null;
}

/** 한 PR이 지금 소유한 관계 전부. 근거별로 따로 온다. */
async function currentLinks(
  db: Queryable,
  repositoryId: number,
  prNumber: number,
): Promise<{ source: Set<string>; merge: Set<string> }> {
  const result = await db.query<{ commit_sha: string; evidence: LinkEvidence }>(
    `SELECT commit_sha, evidence FROM pull_request_commit_link
      WHERE repository_id = $1 AND pr_number = $2`,
    [repositoryId, prNumber],
  );
  const source = new Set<string>();
  const merge = new Set<string>();
  for (const row of result.rows) (row.evidence === 'merge' ? merge : source).add(row.commit_sha);
  return { source, merge };
}

/**
 * 관측 하나를 채택한다. **호출 측이 트랜잭션을 연다.**
 *
 * ## 세 갈래
 *
 * - 저장된 관측보다 **오래된** 버전 → 아무것도 하지 않는다 (`stale`). 늦게 도착한
 *   옛 이벤트가 이미 지워진 번호를 되살리는 경로가 여기서 막힌다.
 * - **같은** 버전 → 집합이 같으면 멱등(`idempotent`), 다르면 충돌(`conflict`)이다.
 *   충돌에서는 **관계를 바꾸지 않고** 재수집을 예약한다. 같은 버전의 두 관측 중
 *   어느 쪽이 사실인지 우리는 모르고, 모르는 채로 지우는 것이 가장 나쁘다.
 * - 더 **새로운** 버전 → 채택한다. 추가는 언제나 하고, 삭제는 완전성 근거가 있을
 *   때만 한다.
 *
 * `received_at`이나 `Date.now()`로 신선함을 판정하지 않는다 — 그것은 우리가 언제
 * 받았는지이지 원격에서 언제 일어났는지가 아니다. 버전 비교만이 순서를 말한다.
 */
export async function adoptLinkObservation(
  client: PoolClient,
  input: LinkObservationInput,
): Promise<AdoptionResult> {
  const sourceShas = new Set(normalizeShas(input.sourceShas));
  const mergeSha = normalizeSha(input.mergeSha);

  /*
   * 같은 PR의 채택을 **직렬화한다.**
   *
   * 아래 `FOR UPDATE`만으로는 부족하다 — **행이 없으면 잠글 것이 없다.** 그 PR의
   * 첫 두 이벤트가 동시에 들어오면 둘 다 "기존 관계 없음"을 읽고, 둘 다 삭제할
   * 것이 없다고 판단한 뒤, 둘 다 자기 목록을 더한다. 결과는 두 관측의 합집합이고
   * 그것이 바로 이 CR이 없애려는 모양이다. advisory lock은 행이 없어도 잡히므로
   * 그 창을 닫는다.
   *
   * 기다리는 락을 쓴다. 관계 채택은 재큐할 곳이 없고(스냅숏 트랜잭션 안이다)
   * 경합은 같은 PR의 이벤트끼리만 일어나 짧다.
   *
   * 획득 뒤 `lock_timeout`을 되돌린다. `advisoryXactLock`은 `SET LOCAL`로 그 값을
   * 세우는데 그것은 **트랜잭션 끝까지 남는다** — 그대로 두면 같은 트랜잭션의 뒤
   * 작업(스냅숏 upsert, 시퀀스 work 요청)까지 이 예산 안에서 돌게 되고, 관계 채택이
   * 정한 값이 남의 경합 정책을 조용히 바꾼다.
   */
  await advisoryXactLock(client, pullRequestLinkLockKey(input.repositoryId, input.prNumber));
  await client.query('SET LOCAL lock_timeout = DEFAULT');

  const existingResult = await client.query<LinkObservationRow>(
    `SELECT * FROM pull_request_link_observation
      WHERE repository_id = $1 AND pr_number = $2
      FOR UPDATE`,
    [input.repositoryId, input.prNumber],
  );
  const existing = existingResult.rows[0];
  const storedVersion = existing === undefined ? null : Number(existing.observed_version);

  const links = await currentLinks(client, input.repositoryId, input.prNumber);

  if (storedVersion !== null && storedVersion > input.observedVersion) {
    return {
      changed: false,
      outcome: 'stale',
      added: [],
      removed: [],
      affected: [],
      verificationState: existing?.verification_state ?? 'unverified',
      withheld: [],
    };
  }

  if (existing !== undefined && storedVersion !== null && storedVersion === input.observedVersion) {
    const sameSource =
      links.source.size === sourceShas.size && [...sourceShas].every((sha) => links.source.has(sha));
    const sameMerge =
      mergeSha === null ? links.merge.size === 0 : links.merge.size === 1 && links.merge.has(mergeSha);
    if (sameSource && sameMerge) {
      return {
        changed: false,
        outcome: 'idempotent',
        added: [],
        removed: [],
        affected: [],
        verificationState: existing.verification_state,
        withheld: [],
      };
    }
    /*
     * **같은 버전, 다른 내용** (CR-116 / DEV-746).
     *
     * PostgreSQL 스냅숏은 같은 버전도 교체하지만(`document_version <=`), 관계는
     * 그럴 수 없다 — 교체는 삭제를 포함하고 삭제에는 근거가 필요하다. 어느 쪽이
     * 사실인지 모르므로 **둘 다 보존하고** 재수집을 예약한다. 구버전 writer가
     * 아직 돌고 있거나 옛 웹훅이 재처리된 신호이기도 하다.
     */
    await client.query(
      `UPDATE pull_request_link_observation
          SET verification_state   = 'conflict',
              refetch_requested_at = now(),
              last_reason          = $3,
              updated_at           = clock_timestamp()
        WHERE repository_id = $1 AND pr_number = $2`,
      [input.repositoryId, input.prNumber, 'same_version_different_set'],
    );
    return {
      changed: false,
      outcome: 'conflict',
      added: [],
      removed: [],
      affected: [],
      verificationState: 'conflict',
      withheld: [...links.source, ...links.merge],
    };
  }

  // --- 채택 ---
  const added: string[] = [];
  const removed: string[] = [];
  const withheld: string[] = [];

  const addSource = [...sourceShas].filter((sha) => !links.source.has(sha));
  if (addSource.length > 0) {
    await client.query(
      `INSERT INTO pull_request_commit_link (repository_id, pr_number, commit_sha, evidence, observed_version)
       SELECT $1, $2, sha, 'source', $4 FROM unnest($3::text[]) AS sha
       ON CONFLICT (repository_id, pr_number, commit_sha, evidence)
       DO UPDATE SET observed_version = EXCLUDED.observed_version, updated_at = clock_timestamp()`,
      [input.repositoryId, input.prNumber, addSource, input.observedVersion],
    );
    added.push(...addSource);
  }

  const dropSource = [...links.source].filter((sha) => !sourceShas.has(sha));
  if (dropSource.length > 0) {
    if (input.commitsComplete) {
      await client.query(
        `DELETE FROM pull_request_commit_link
          WHERE repository_id = $1 AND pr_number = $2 AND evidence = 'source' AND commit_sha = ANY($3::text[])`,
        [input.repositoryId, input.prNumber, dropSource],
      );
      removed.push(...dropSource);
    } else {
      /*
       * **불완전한 목록으로 지우지 않는다.** 여기가 그 규율이 실제로 서는 자리다.
       * 조회가 실패했거나, 우리 상한에 걸렸거나, 원격이 말한 수와 다르거나, 읽는
       * 동안 PR이 바뀌었다 — 어느 경우든 "목록에 없다"가 "속하지 않는다"를 뜻하지
       * 않는다. 마지막 정상 관측의 관계를 그대로 두고 근거만 남긴다.
       */
      withheld.push(...dropSource);
    }
  }

  /*
   * `merge` 근거는 **PR 본문을 직접 읽었을 때만** 손댄다. 웹훅 사본은 발생 시점의
   * 스냅숏이라 "이제 병합이 아니다"를 단정할 수 없다.
   */
  if (input.pullRequestAuthoritative) {
    if (mergeSha !== null && !links.merge.has(mergeSha)) {
      await client.query(
        `INSERT INTO pull_request_commit_link (repository_id, pr_number, commit_sha, evidence, observed_version)
         VALUES ($1, $2, $3, 'merge', $4)
         ON CONFLICT (repository_id, pr_number, commit_sha, evidence)
         DO UPDATE SET observed_version = EXCLUDED.observed_version, updated_at = clock_timestamp()`,
        [input.repositoryId, input.prNumber, mergeSha, input.observedVersion],
      );
      added.push(mergeSha);
    }
    const dropMerge = [...links.merge].filter((sha) => sha !== mergeSha);
    if (dropMerge.length > 0) {
      await client.query(
        `DELETE FROM pull_request_commit_link
          WHERE repository_id = $1 AND pr_number = $2 AND evidence = 'merge' AND commit_sha = ANY($3::text[])`,
        [input.repositoryId, input.prNumber, dropMerge],
      );
      removed.push(...dropMerge);
    }
  } else if (mergeSha !== null && !links.merge.has(mergeSha)) {
    // 추가는 안전하다 — 웹훅이 병합을 말했다면 병합은 일어난 것이다.
    await client.query(
      `INSERT INTO pull_request_commit_link (repository_id, pr_number, commit_sha, evidence, observed_version)
       VALUES ($1, $2, $3, 'merge', $4)
       ON CONFLICT (repository_id, pr_number, commit_sha, evidence)
       DO UPDATE SET observed_version = EXCLUDED.observed_version, updated_at = clock_timestamp()`,
      [input.repositoryId, input.prNumber, mergeSha, input.observedVersion],
    );
    added.push(mergeSha);
  }

  /*
   * 완전하면 `verified`, 아니면 `pending_refetch`다. **소급해서 `verified`로
   * 만들지 않는다** — 이번 관측이 불완전하면 다음 완전한 관측까지 미확정이다.
   */
  const verificationState: LinkVerificationState = input.commitsComplete ? 'verified' : 'pending_refetch';

  /*
   * 관측 자체에도 버전 가드를 건다 (독립 검토 지적 C).
   *
   * 위 advisory lock이 같은 PR의 채택을 직렬화하므로 정상 경로에서는 여기 닿는 관측이
   * 언제나 더 새롭다. 그래도 `WHERE`를 두는 이유는, **가드가 한 곳에만 있으면 그곳을
   * 지나지 않는 경로가 생기는 날 버전이 뒤로 찍히기 때문**이다 — 뒤로 찍힌 버전은
   * 그 사이의 진짜 오래된 이벤트를 신선한 것으로 만든다.
   */
  await client.query(
    `INSERT INTO pull_request_link_observation (
       repository_id, pr_number, observed_version, head_sha, base_sha, base_branch, pr_state,
       commits_complete, commits_error_kind, api_commit_count, fetched_count, source_commits_truncated,
       verification_state, refetch_requested_at, last_verified_at, last_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               CASE WHEN $13 = 'pending_refetch' THEN now() ELSE NULL END,
               CASE WHEN $8 THEN now() ELSE NULL END, $14)
     ON CONFLICT (repository_id, pr_number) DO UPDATE SET
       observed_version         = EXCLUDED.observed_version,
       head_sha                 = EXCLUDED.head_sha,
       base_sha                 = EXCLUDED.base_sha,
       base_branch              = EXCLUDED.base_branch,
       pr_state                 = EXCLUDED.pr_state,
       commits_complete         = EXCLUDED.commits_complete,
       commits_error_kind       = EXCLUDED.commits_error_kind,
       api_commit_count         = EXCLUDED.api_commit_count,
       fetched_count            = EXCLUDED.fetched_count,
       source_commits_truncated = EXCLUDED.source_commits_truncated,
       verification_state       = EXCLUDED.verification_state,
       refetch_requested_at     = EXCLUDED.refetch_requested_at,
       -- 확정한 적이 있으면 그 시각을 잃지 않는다. 마지막 정상 관측의 흔적이다.
       last_verified_at         = COALESCE(EXCLUDED.last_verified_at, pull_request_link_observation.last_verified_at),
       refetch_attempts         = CASE WHEN EXCLUDED.verification_state = 'pending_refetch'
                                       THEN pull_request_link_observation.refetch_attempts + 1 ELSE 0 END,
       last_reason              = EXCLUDED.last_reason,
       updated_at               = clock_timestamp()
     WHERE pull_request_link_observation.observed_version <= EXCLUDED.observed_version`,
    [
      input.repositoryId,
      input.prNumber,
      input.observedVersion,
      normalizeSha(input.headSha),
      normalizeSha(input.baseSha),
      input.baseBranch,
      input.prState,
      input.commitsComplete,
      input.commitsErrorKind,
      input.apiCommitCount,
      sourceShas.size,
      input.sourceCommitsTruncated,
      verificationState,
      input.reason === null ? null : input.reason.slice(0, 200),
    ],
  );

  const affected = [...new Set([...added, ...removed])];
  return {
    changed: affected.length > 0,
    outcome: 'adopted',
    added,
    removed,
    affected,
    verificationState,
    withheld,
  };
}

/**
 * 영향받은 커밋의 재투영 의도를 남긴다. **관계 변경과 같은 트랜잭션이어야 한다.**
 *
 * 세대만 올리고 값은 싣지 않는다 — 러너가 실행 시점에 **현재 정본**을 다시 읽는다.
 * payload에 배열을 실으면 그 사이에 일어난 변경을 옛 값으로 되돌린다.
 *
 * 이미 `leased`인 행은 상태를 바꾸지 않고 세대만 올린다. 실행 중인 러너가 완료를
 * ack할 때 자기가 본 세대와 비교해 **스스로 다시 `ready`가 된다.**
 */
export async function bumpCommitLinkGenerations(
  client: PoolClient,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<number> {
  const shas = normalizeShas(commitShas);
  if (shas.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT $1, sha, 1, 0, 'ready' FROM unnest($2::text[]) AS sha
     ON CONFLICT (repository_id, commit_sha) DO UPDATE SET
       generation   = commit_link_state.generation + 1,
       state        = CASE WHEN commit_link_state.state = 'leased' THEN 'leased' ELSE 'ready' END,
       available_at = CASE WHEN commit_link_state.state = 'leased' THEN commit_link_state.available_at ELSE now() END,
       -- 새 요청은 재시도 예산을 되돌린다. 앞 회차의 실패가 다음 사실을 막지 않는다.
       attempt_count = CASE WHEN commit_link_state.state = 'leased' THEN commit_link_state.attempt_count ELSE 0 END,
       updated_at   = clock_timestamp()`,
    [repositoryId, shas],
  );
  return result.rowCount ?? 0;
}

/**
 * 커밋 하나의 **현재 유효한 PR 번호 전부** (FR-SRCH-002 AC-6·AC-7).
 *
 * 근거 종류를 묻지 않는다 — `source`든 `merge`든 소속은 소속이다. 다만 체인 규칙을
 * 통과한 것만 센다(`EFFECTIVE_LINK_SQL`). 중복을 접고 오름차순으로 고정한다: 같은 관계가
 * 늘 같은 배열이어야 투영이 바뀌지 않은 문서를 멱등으로 접는다.
 */
export async function listLinkedPullRequestNumbers(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<number[]> {
  const sha = normalizeSha(commitSha);
  if (sha === null) return [];
  const result = await db.query<{ pr_number: number }>(
    `SELECT DISTINCT l.pr_number FROM pull_request_commit_link l
      WHERE l.repository_id = $1 AND l.commit_sha = $2 AND ${EFFECTIVE_LINK_SQL}
      ORDER BY l.pr_number`,
    [repositoryId, sha],
  );
  return result.rows.map((row) => row.pr_number);
}

/** 여러 커밋을 한 번에. 러너가 배치로 읽어 왕복을 줄인다. 규칙은 단건과 같다. */
export async function listLinkedPullRequestNumbersBatch(
  db: Queryable,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<ReadonlyMap<string, number[]>> {
  const shas = normalizeShas(commitShas);
  const out = new Map<string, number[]>();
  for (const sha of shas) out.set(sha, []);
  if (shas.length === 0) return out;
  const result = await db.query<{ commit_sha: string; pr_number: number }>(
    `SELECT DISTINCT l.commit_sha, l.pr_number FROM pull_request_commit_link l
      WHERE l.repository_id = $1 AND l.commit_sha = ANY($2::text[]) AND ${EFFECTIVE_LINK_SQL}
      ORDER BY l.commit_sha, l.pr_number`,
    [repositoryId, shas],
  );
  for (const row of result.rows) out.get(row.commit_sha)?.push(row.pr_number);
  return out;
}

/**
 * 커밋 하나의 유효 연결과 **체인 규칙으로 빠진** 번호 (CR-117 / WP-102).
 *
 * 복구 대조가 쓴다. 색인에만 있는 번호를 지우려면 CR-116은 그 PR의 관측이 확정이어야 한다고
 * 정했다 — 목록에 없다는 사실이 소속이 아님을 뜻하려면 목록이 전부여야 하기 때문이다. 체인
 * 규칙으로 빠지는 번호는 근거가 다르다: 원시 관측에 **있지만** 그 커밋이 이미 다른 PR로 체인에
 * 올랐다는 PostgreSQL의 사실이 근거이므로, 관측 확정 여부와 무관하게 뺄 수 있다. 두 경우를
 * 가르려면 원시 번호와 유효 번호를 함께 읽어야 한다 — 한 문장이라 같은 스냅숏이다.
 */
export async function readCommitLinkSets(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<{ readonly effective: number[]; readonly chainExcluded: number[] }> {
  const sha = normalizeSha(commitSha);
  if (sha === null) return { effective: [], chainExcluded: [] };
  const result = await db.query<{ effective: number[] | null; raw: number[] | null }>(
    `SELECT (SELECT array_agg(DISTINCT l.pr_number ORDER BY l.pr_number)
               FROM pull_request_commit_link l
              WHERE l.repository_id = $1 AND l.commit_sha = $2 AND ${EFFECTIVE_LINK_SQL}) AS effective,
            (SELECT array_agg(DISTINCT l.pr_number ORDER BY l.pr_number)
               FROM pull_request_commit_link l
              WHERE l.repository_id = $1 AND l.commit_sha = $2) AS raw`,
    [repositoryId, sha],
  );
  const effective = result.rows[0]?.effective ?? [];
  const kept = new Set(effective);
  const chainExcluded = (result.rows[0]?.raw ?? []).filter((n) => !kept.has(n));
  return { effective, chainExcluded };
}

/**
 * 주어진 커밋 가운데 **병합 근거**(`merge`)가 있는 것 (CR-117 / WP-102).
 *
 * 체인 커밋의 역할을 되돌릴 때 쓴다. 체인 행의 PR 대응(`merge_sequence.pull_request_number`)은
 * 채번이 PR 문서보다 먼저 돌면 `NULL`로 남는다(DEV-207 — 「모름」이지 「PR 없음」이 아니다). 그때
 * 그 커밋을 직접 푸시로 되돌리면 틀린 역할을 하나 더 만든다. 병합 근거는 그 커밋이 어느 PR의
 * 머지 커밋이라는 정본의 사실이므로 역할 판정에 함께 쓴다.
 */
export async function listCommitsWithMergeEvidence(
  db: Queryable,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<ReadonlySet<string>> {
  const shas = normalizeShas(commitShas);
  if (shas.length === 0) return new Set();
  const result = await db.query<{ commit_sha: string }>(
    `SELECT DISTINCT commit_sha FROM pull_request_commit_link
      WHERE repository_id = $1 AND evidence = 'merge' AND commit_sha = ANY($2::text[])`,
    [repositoryId, shas],
  );
  return new Set(result.rows.map((row) => row.commit_sha));
}

/**
 * 체인 소속이 바뀐 커밋의 관계를 다시 비추게 한다 (CR-117 / FR-SRCH-002 AC-7).
 *
 * **호출 측 트랜잭션 안에서 부른다** — 머지 시퀀스를 쓴 트랜잭션과 같아야 채번이 커밋되고
 * 이 의도가 사라지는 창이 없다. 유효 연결은 체인 소속에 따라 바뀌므로, 새로 체인에 오른 커밋
 * (정상 채번)과 체인에서 빠지거나 PR 대응이 바뀐 커밋(강제 푸시 재채번·복구 재채번)이 대상이다.
 *
 * `source` 근거가 있는 커밋만 올린다. 판정이 바뀔 수 있는 것은 그 근거뿐이고(`merge`는 규칙과
 * 무관하다), 그러지 않으면 체인에 오르는 커밋마다 관계 상태 행이 생겨 투영 큐가 채번량만큼
 * 불어난다. 세대 규칙은 `bumpCommitLinkGenerations`와 같다.
 *
 * @returns 세대가 오르거나 새로 만들어진 커밋 수.
 */
export async function requeueChainChangedCommitLinks(
  client: PoolClient,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<number> {
  const shas = normalizeShas(commitShas);
  if (shas.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT DISTINCT $1::bigint, l.commit_sha, 1::bigint, 0::bigint, 'ready'::text
       FROM pull_request_commit_link l
      WHERE l.repository_id = $1 AND l.evidence = 'source' AND l.commit_sha = ANY($2::text[])
     ON CONFLICT (repository_id, commit_sha) DO UPDATE SET
       generation    = commit_link_state.generation + 1,
       state         = CASE WHEN commit_link_state.state = 'leased' THEN 'leased' ELSE 'ready' END,
       available_at  = CASE WHEN commit_link_state.state = 'leased' THEN commit_link_state.available_at ELSE now() END,
       attempt_count = CASE WHEN commit_link_state.state = 'leased' THEN commit_link_state.attempt_count ELSE 0 END,
       updated_at    = clock_timestamp()`,
    [repositoryId, shas],
  );
  return result.rowCount ?? 0;
}

export interface ClaimCommitLinkOptions {
  readonly limit: number;
  readonly leaseMs: number;
  /** 한 저장소로 좁힌다. 복구 잡이 쓴다. 운영 러너는 생략해 전량을 본다. */
  readonly repositoryId?: number;
}

/**
 * 투영할 커밋을 집는다 (짧은 트랜잭션, `FOR UPDATE SKIP LOCKED`).
 *
 * 한 문장으로 끝낸다 — 고르는 것과 lease를 세우는 것이 갈라지면 그 사이에 다른
 * 워커가 같은 행을 본다. `sequence_work`와 같은 양식이되 키가 다르다: 관계의
 * 정체성은 base 브랜치에도 에폭에도 속하지 않는다.
 */
export async function claimDueCommitLinks(
  db: Queryable,
  options: ClaimCommitLinkOptions,
): Promise<CommitLinkStateRow[]> {
  if (options.limit < 1) return [];
  const result = await db.query<CommitLinkStateRow>(
    `UPDATE commit_link_state AS c
        SET state         = 'leased',
            lease_until   = now() + ($2::int * interval '1 millisecond'),
            lease_token   = gen_random_uuid(),
            attempt_count = c.attempt_count + 1,
            updated_at    = clock_timestamp()
      WHERE (c.repository_id, c.commit_sha) IN (
        SELECT repository_id, commit_sha FROM commit_link_state
         WHERE state IN ('ready', 'retry')
           AND available_at <= now()
           AND projected_generation < generation
           AND ($3::bigint IS NULL OR repository_id = $3::bigint)
         ORDER BY available_at, repository_id, commit_sha
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      RETURNING c.*`,
    [options.limit, Math.trunc(options.leaseMs), options.repositoryId ?? null],
  );
  return result.rows;
}

export interface CommitLinkLease {
  readonly repositoryId: number;
  readonly commitSha: string;
  readonly leaseToken: string;
}

/**
 * 완료 ack. `generation`은 claim 시점에 본 값이다.
 *
 * 그 사이 세대가 올랐으면 `done`이 아니라 다시 `ready`다 — **실행 중에 들어온 새
 * 관계 변경을 완료로 덮지 않는다.** 이것이 없으면 마지막 변경이 조용히 색인에
 * 반영되지 않은 채 큐에서 사라진다.
 */
export async function completeCommitLink(
  db: Queryable,
  lease: CommitLinkLease,
  generation: number,
  projectedNumbers: readonly number[],
): Promise<boolean> {
  const result = await db.query(
    `UPDATE commit_link_state
        SET projected_generation = GREATEST(projected_generation, $4),
            projected_numbers    = $5::int[],
            state        = CASE WHEN generation > $4 THEN 'ready' ELSE 'done' END,
            lease_until  = NULL,
            lease_token  = NULL,
            available_at = now(),
            last_reason  = NULL,
            attempt_count = 0,
            updated_at   = clock_timestamp()
      WHERE repository_id = $1 AND commit_sha = $2 AND lease_token = $3 AND state = 'leased'`,
    [lease.repositoryId, lease.commitSha, lease.leaseToken, generation, [...projectedNumbers]],
  );
  return (result.rowCount ?? 0) > 0;
}

export type CommitLinkRelease = 'retry' | 'parked' | 'ready';

/**
 * lease를 놓고 상태를 정한다. **완료로 숨기지 않는다** — 문서 미생성·429·타임아웃·
 * 충돌·벌크 부분 실패는 전부 여기로 오고, 반복 실패는 `parked`로 눈에 남는다.
 */
export async function releaseCommitLink(
  db: Queryable,
  lease: CommitLinkLease,
  next: { readonly state: CommitLinkRelease; readonly availableAt: Date; readonly reason: string | null; readonly conflict?: boolean },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE commit_link_state
        SET state        = $4,
            available_at = $5,
            last_reason  = $6,
            conflict_at  = CASE WHEN $7 THEN now() ELSE conflict_at END,
            lease_until  = NULL,
            lease_token  = NULL,
            updated_at   = clock_timestamp()
      WHERE repository_id = $1 AND commit_sha = $2 AND lease_token = $3 AND state = 'leased'`,
    [
      lease.repositoryId,
      lease.commitSha,
      lease.leaseToken,
      next.state,
      next.availableAt,
      next.reason === null ? null : next.reason.slice(0, 200),
      next.conflict === true,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 만료된 lease를 회수한다. 죽은 워커의 몫은 `retry`로 돌아온다. */
export async function reclaimExpiredCommitLinkLeases(db: Queryable): Promise<number> {
  const result = await db.query(
    `UPDATE commit_link_state
        SET state = 'retry', lease_until = NULL, lease_token = NULL, available_at = now(),
            last_reason = 'lease_expired', updated_at = clock_timestamp()
      WHERE state = 'leased' AND lease_until < now()`,
  );
  return result.rowCount ?? 0;
}

/** 한 커밋의 투영 상태. 시험과 운영 조회가 쓴다. */
export async function findCommitLinkState(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<CommitLinkStateRow | undefined> {
  const sha = normalizeSha(commitSha);
  if (sha === null) return undefined;
  const result = await db.query<CommitLinkStateRow>(
    'SELECT * FROM commit_link_state WHERE repository_id = $1 AND commit_sha = $2',
    [repositoryId, sha],
  );
  return result.rows[0];
}

/** 한 PR의 관측. 복구 경로가 완전성 근거를 읽는다. */
export async function findLinkObservation(
  db: Queryable,
  repositoryId: number,
  prNumber: number,
): Promise<LinkObservationRow | undefined> {
  const result = await db.query<LinkObservationRow>(
    'SELECT * FROM pull_request_link_observation WHERE repository_id = $1 AND pr_number = $2',
    [repositoryId, prNumber],
  );
  return result.rows[0];
}

/**
 * 재수집이 필요한 PR (커서 방식).
 *
 * **새 webhook을 기다리지 않는다.** 불완전한 관측은 여기 남고 복구 러너가 집어
 * 간다. `pr_number` 오름차순 커서라 스캔 중 갱신된 항목이 페이지를 건너뛰지 않는다.
 */
export async function listPullRequestsNeedingRefetch(
  db: Queryable,
  repositoryId: number,
  afterPrNumber: number,
  limit: number,
): Promise<readonly LinkObservationRow[]> {
  const result = await db.query<LinkObservationRow>(
    `SELECT * FROM pull_request_link_observation
      WHERE repository_id = $1 AND pr_number > $2 AND verification_state <> 'verified'
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, afterPrNumber, limit],
  );
  return result.rows;
}

/**
 * 저장소의 **유효** 관계를 커밋 순서로 열거한다. 전체 대조가 쓴다.
 *
 * 체인 규칙으로 전부 빠진 커밋은 열거되지 않는다 — 더할 번호가 없으므로 대조의 「정본에만
 * 있는 커밋」 갈래에 올 이유가 없다. 색인에 그 번호가 남아 있으면 색인 쪽 훑기가 잡는다.
 */
export async function listCommitLinksAfter(
  db: Queryable,
  repositoryId: number,
  afterSha: string,
  limit: number,
): Promise<readonly { commit_sha: string; pr_numbers: number[] }[]> {
  const result = await db.query<{ commit_sha: string; pr_numbers: number[] }>(
    `SELECT l.commit_sha, array_agg(DISTINCT l.pr_number ORDER BY l.pr_number) AS pr_numbers
       FROM pull_request_commit_link l
      WHERE l.repository_id = $1 AND l.commit_sha > $2 AND ${EFFECTIVE_LINK_SQL}
      GROUP BY l.commit_sha
      ORDER BY l.commit_sha ASC
      LIMIT $3`,
    [repositoryId, afterSha, limit],
  );
  return result.rows;
}

/** 저장소의 관계 통계. 고유 커밋 수와 간선 수는 **다른 값이다.** */
export async function countCommitLinks(
  db: Queryable,
  repositoryId: number,
): Promise<{ readonly commits: number; readonly edges: number }> {
  const result = await db.query<{ commits: string; edges: string }>(
    `SELECT count(DISTINCT commit_sha)::text AS commits, count(*)::text AS edges
       FROM pull_request_commit_link WHERE repository_id = $1`,
    [repositoryId],
  );
  return { commits: Number(result.rows[0]?.commits ?? 0), edges: Number(result.rows[0]?.edges ?? 0) };
}

/** 투영이 밀린 커밋 수. 운영 watch가 수렴을 판정한다. */
export async function countPendingCommitLinks(
  db: Queryable,
  repositoryId?: number,
): Promise<Readonly<Record<string, number>>> {
  const result = await db.query<{ state: string; count: string }>(
    `SELECT state, count(*)::text AS count FROM commit_link_state
      WHERE projected_generation < generation
        AND ($1::bigint IS NULL OR repository_id = $1::bigint)
      GROUP BY state`,
    [repositoryId ?? null],
  );
  const out: Record<string, number> = {};
  for (const row of result.rows) out[row.state] = Number(row.count);
  return out;
}

/**
 * 투영에 필요한 것 전부를 **한 문장으로** 읽는다 (CR-116 / WP-101).
 *
 * 세대와 집합을 따로 읽으면 그 사이의 변경이 **옛 집합을 새 세대로** 쓰게 만든다.
 * 그러면 색인은 새 세대라고 표시되지만 내용은 뒤처지고, 다음 회차는 세대가 같아
 * 멱등으로 접는다 — 마지막 변경이 조용히 사라진다. 한 문장은 PostgreSQL의 단일
 * 스냅숏에서 읽으므로 그 창이 없다.
 *
 * `state`는 **지금 연결된 PR들의 관측이 전부 확정인가**를 말한다. "이 커밋에
 * 다른 PR이 더 있을 수 있는가"를 말하지 않는다 — 그것을 답하려면 저장소의 모든
 * PR이 확정이어야 하고, 그 기준은 어떤 배포에서도 참이 되지 않는다. 한계를
 * 숨기지 않고 좁은 뜻으로 쓴다.
 *
 * **두 부분 질의가 같은 유효 연결 술어를 쓴다** (CR-117). 미확정 계수만 원시 행을 세면, 체인
 * 규칙으로 빠진 미확정 PR 하나가 그 PR과 무관한 커밋을 `partial`로 만든다.
 */
export async function readCommitLinkProjection(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<{ readonly generation: number; readonly numbers: number[]; readonly verified: boolean } | undefined> {
  const sha = normalizeSha(commitSha);
  if (sha === null) return undefined;
  const result = await db.query<{ generation: string; pr_numbers: number[] | null; unverified: string }>(
    `SELECT c.generation,
            (SELECT array_agg(DISTINCT l.pr_number ORDER BY l.pr_number)
               FROM pull_request_commit_link l
              WHERE l.repository_id = c.repository_id AND l.commit_sha = c.commit_sha
                AND ${EFFECTIVE_LINK_SQL}) AS pr_numbers,
            (SELECT count(*)::text
               FROM pull_request_commit_link l
               LEFT JOIN pull_request_link_observation o
                 ON o.repository_id = l.repository_id AND o.pr_number = l.pr_number
              WHERE l.repository_id = c.repository_id AND l.commit_sha = c.commit_sha
                AND ${EFFECTIVE_LINK_SQL}
                AND (o.verification_state IS NULL OR o.verification_state <> 'verified')) AS unverified
       FROM commit_link_state c
      WHERE c.repository_id = $1 AND c.commit_sha = $2`,
    [repositoryId, sha],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    generation: Number(row.generation),
    numbers: row.pr_numbers ?? [],
    verified: Number(row.unverified) === 0,
  };
}

/**
 * 재구축용 열거 (CR-116 / WP-101).
 *
 * 재색인은 **세대가 밀렸는지 묻지 않는다.** 새 인덱스에는 아무것도 없으므로 모든
 * 행을 다시 비춰야 하고, `projected_generation`은 옛 인덱스에 대한 사실이라
 * 새 대상의 완료로 재사용하면 안 된다 (FR-ING-008).
 */
export async function listCommitLinkStatesAfter(
  db: Queryable,
  repositoryId: number,
  afterSha: string,
  limit: number,
): Promise<readonly { commit_sha: string; generation: string; pr_numbers: number[] | null; unverified: string }[]> {
  /*
   * **두 표를 합쳐 훑는다.**
   *
   * `commit_link_state`만 보면 관계는 있는데 상태 행이 없는 커밋을 놓치고, 그
   * 커밋의 PR 연결이 새 인덱스에서 통째로 사라진다. `pull_request_commit_link`만
   * 보면 연결이 0개가 된 커밋(tombstone)을 놓치고, 그 문서는 `[]`(사실) 대신
   * 필드 없음(아직 모름)으로 전환된다 — 뜻이 다른 상태다.
   *
   * 상태 행이 없는 커밋의 세대는 1이다. 정상 경로에서는 마이그레이션 036의 seed와
   * `bumpCommitLinkGenerations`가 언제나 행을 만들므로 이 갈래는 비정상이며, 그때는
   * 조용히 건너뛰는 것보다 1로 비추고 다음 변경에서 충돌로 드러나는 편이 낫다.
   */
  /*
   * 열거는 원시 행으로 하고 **값은 유효 연결로** 채운다 (CR-117). 체인 규칙으로 연결이 전부
   * 빠진 커밋도 열거되어야 새 인덱스에 `[]`(검증한 범위에서 연결 없음)가 복원된다 — 열거에서
   * 빠지면 그 문서는 필드 없음(아직 모름)으로 전환된다.
   */
  const result = await db.query<{ commit_sha: string; generation: string; pr_numbers: number[] | null; unverified: string }>(
    `SELECT s.commit_sha,
            COALESCE(c.generation, 1) AS generation,
            (SELECT array_agg(DISTINCT l.pr_number ORDER BY l.pr_number)
               FROM pull_request_commit_link l
              WHERE l.repository_id = $1 AND l.commit_sha = s.commit_sha
                AND ${EFFECTIVE_LINK_SQL}) AS pr_numbers,
            (SELECT count(*)::text
               FROM pull_request_commit_link l
               LEFT JOIN pull_request_link_observation o
                 ON o.repository_id = l.repository_id AND o.pr_number = l.pr_number
              WHERE l.repository_id = $1 AND l.commit_sha = s.commit_sha
                AND ${EFFECTIVE_LINK_SQL}
                AND (o.verification_state IS NULL OR o.verification_state <> 'verified')) AS unverified
       FROM (
              SELECT commit_sha FROM commit_link_state
               WHERE repository_id = $1 AND commit_sha > $2
              UNION
              SELECT DISTINCT commit_sha FROM pull_request_commit_link
               WHERE repository_id = $1 AND commit_sha > $2
            ) AS s
       LEFT JOIN commit_link_state c
              ON c.repository_id = $1 AND c.commit_sha = s.commit_sha
      ORDER BY s.commit_sha ASC
      LIMIT $3`,
    [repositoryId, afterSha, limit],
  );
  return result.rows;
}

/**
 * PR마다 지금 **유효한 `source` 연결**의 커밋 (CR-119 / FR-ING-008 AC-10).
 *
 * 재구축이 원본 커밋 문서를 만들 근거는 PR 스냅숏의 원본 목록만이 아니다. 관측이 불완전하면
 * (조회 실패, 250건 절삭, 읽는 동안 head/base 변경) 목록에서 빠진 커밋의 `source` 행을 지우지
 * 않고 남긴다(CR-116 — 「목록에 없다」가 「속하지 않는다」를 뜻하지 않는다). 그 커밋은 스냅숏의
 * 최신 목록에는 없지만 정본은 여전히 그 PR에 속한다고 말하고, 서비스 인덱스에는 그 문서가 있다.
 * 재구축이 그 문서를 만들지 않으면 관계 replay가 그 커밋을 「문서를 만들지 못했다」로 읽고
 * 재색인이 실패한다 — 250건을 넘는 PR은 완전성을 영영 증명할 수 없어 그 실패가 풀리지 않는다.
 *
 * 값은 유효 연결 술어를 지난 것만 돌려준다 — 추적 브랜치 체인에 이미 오른 다른 PR의 커밋은
 * 이 PR의 원본 커밋이 아니다(CR-117).
 */
export async function listEffectiveSourceShas(
  db: Queryable,
  repositoryId: number,
  prNumbers: readonly number[],
): Promise<ReadonlyMap<number, readonly string[]>> {
  const out = new Map<number, string[]>();
  const numbers = [...new Set(prNumbers)];
  if (numbers.length === 0) return out;
  const result = await db.query<{ pr_number: number; commit_sha: string }>(
    `SELECT l.pr_number, l.commit_sha
       FROM pull_request_commit_link l
      WHERE l.repository_id = $1 AND l.pr_number = ANY($2::int[]) AND l.evidence = 'source'
        AND ${EFFECTIVE_LINK_SQL}
      ORDER BY l.pr_number, l.commit_sha`,
    [repositoryId, numbers],
  );
  for (const row of result.rows) {
    const list = out.get(Number(row.pr_number)) ?? [];
    list.push(row.commit_sha.toLowerCase());
    out.set(Number(row.pr_number), list);
  }
  return out;
}

/**
 * 관계가 있는 커밋에 투영 의도를 만든다 (복구·재색인 경로).
 *
 * 이미 있는 행의 세대는 **올리지 않는다** — 복구가 세대를 올리면 진행 중이던
 * 정상 쓰기가 충돌로 보이고, 반복 실행마다 색인 쓰기가 다시 일어난다. 없는 행만
 * 만들어 "아직 한 번도 비추지 않은 관계"를 큐에 넣는다.
 */
export async function ensureCommitLinkStates(
  db: Queryable,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<number> {
  const shas = normalizeShas(commitShas);
  if (shas.length === 0) return 0;
  const result = await db.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT $1, sha, 1, 0, 'ready' FROM unnest($2::text[]) AS sha
     ON CONFLICT (repository_id, commit_sha) DO NOTHING`,
    [repositoryId, shas],
  );
  return result.rowCount ?? 0;
}

/**
 * 복구가 커밋을 다시 큐에 넣는다 (CR-116 / WP-101).
 *
 * `ensureCommitLinkStates`만으로는 부족하다. 색인이 정본과 다른데 그 행이 이미
 * **반영 완료**(`projected_generation = generation`)로 표시돼 있으면 새 행도 아니고
 * 밀린 행도 아니라 **아무도 그것을 집지 않는다.** 충돌로 보류된 행, 색인 쓰기를
 * 잃은 행이 정확히 그 모양이며, 그것이 이 CR이 고치려는 오염이 남는 자리다.
 *
 * 그래서 세 갈래로 나눈다.
 *
 * - 행이 없다 → 만든다.
 * - 큐에 밀려 있다(`ready`·`retry`·`leased`이고 `projected_generation < generation`)
 *   → **건드리지 않는다.** 러너가 곧 집고, 세대를 올리면 진행 중인 정상 쓰기가
 *   충돌로 보인다.
 * - 반영 완료인데 불일치가 남았다 → 세대를 올려 다시 평가하게 한다.
 * - **보류(`parked`)** → 세대를 올리고 `ready`로 되돌린다 (독립 검토 지적 A).
 *
 * 마지막 갈래가 없으면 이 명령은 **오염이 가장 확실하게 남는 행들에 아무 일도 하지
 * 않는다.** `parked`는 언제나 `projected_generation < generation`이다(러너가 그 조건으로
 * 집었고 `releaseCommitLink`는 두 세대를 건드리지 않는다). 그래서 「반영 완료」 조건만
 * 보면 절대 매치되지 않고, 러너도 `ready`·`retry`만 집으므로 그 행은 영영 멈춘다 —
 * 구버전 writer와의 충돌로 보류된 커밋이 정확히 그 모양이고, 그것이 이 CR이 지우려던
 * 오염 그 자체다.
 *
 * 색인이 정본과 같으면 호출부가 애초에 그 커밋을 넘기지 않으므로, 같은 명령을
 * 두 번 돌려도 두 번째에는 올릴 세대가 없다 — 그것이 이 경로의 멱등이다.
 *
 * @returns 실제로 큐에 들어간(만들어졌거나 세대가 오른) 커밋 수.
 */
export async function requeueCommitLinks(
  db: Queryable,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<{ readonly created: number; readonly bumped: number; readonly alreadyQueued: number }> {
  const shas = normalizeShas(commitShas);
  if (shas.length === 0) return { created: 0, bumped: 0, alreadyQueued: 0 };

  /*
   * **`parked`는 「이미 큐에 있다」가 아니다.** 러너가 집지 않는 상태이므로 여기서
   * 세지 않고 아래 bump가 깨운다. 섞어 세면 보고의 `skippedStale`이 「곧 처리된다」를
   * 뜻하는 것처럼 보이는데 실제로는 아무도 집지 않는다.
   */
  const behind = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM commit_link_state
      WHERE repository_id = $1 AND commit_sha = ANY($2::text[])
        AND projected_generation < generation
        AND state IN ('ready', 'retry', 'leased')`,
    [repositoryId, shas],
  );

  const created = await db.query(
    `INSERT INTO commit_link_state (repository_id, commit_sha, generation, projected_generation, state)
     SELECT $1, sha, 1, 0, 'ready' FROM unnest($2::text[]) AS sha
     ON CONFLICT (repository_id, commit_sha) DO NOTHING`,
    [repositoryId, shas],
  );

  const bumped = await db.query(
    `UPDATE commit_link_state
        SET generation    = generation + 1,
            state         = CASE WHEN state = 'leased' THEN 'leased' ELSE 'ready' END,
            available_at  = CASE WHEN state = 'leased' THEN available_at ELSE now() END,
            attempt_count = CASE WHEN state = 'leased' THEN attempt_count ELSE 0 END,
            last_reason   = CASE WHEN state = 'leased' THEN last_reason ELSE 'repair_requeue' END,
            updated_at    = clock_timestamp()
      WHERE repository_id = $1 AND commit_sha = ANY($2::text[])
        AND (projected_generation >= generation OR state = 'parked')`,
    [repositoryId, shas],
  );

  return {
    created: created.rowCount ?? 0,
    bumped: bumped.rowCount ?? 0,
    alreadyQueued: Number(behind.rows[0]?.count ?? 0),
  };
}
