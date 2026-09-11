/**
 * PR 확정 근거 수집 (WP-074 / FR-SEQ-008 AC-9 · AC-10, CR-079, 상세 설계 5.1 · DEV-581).
 *
 * ## 세 상태, 그리고 production이 만들지 않는 하나
 *
 * | 상태 | 성립 조건 |
 * | --- | --- |
 * | `pr_confirmed` | merged=true, 같은 저장소·같은 base, `merge_commit_sha`가 이 first-parent 커밋, squash 프로파일 |
 * | `direct_confirmed` | **production 판정기는 만들지 않는다** (2.2의 완결 증서가 없다). 격리 시험만 주입한다 |
 * | `unresolved` | 조회 전·부분 응답·빈 결과·불일치·프로파일 불명 — 그 앞에서 채번이 멈춘다 |
 *
 * 반복해서 빈 조회가 와도 부재를 확정하지 않는다. `NULL`, ES 부재, 부모 수, 시간
 * 경과, 일시 실패, 완전성 보장 없는 빈 응답, DEV-207의 교정 가능한 role은 근거가
 * 아니다 (AC-10).
 *
 * ## 무엇을 근거로 쓰는가
 *
 * 1. **PR 상세**(`getPullRequestEvidence`): GHE 자격이 있으면 이것이 정답지다.
 * 2. **검증된 스냅숏**(`verified_snapshot`): GHE 자격이 없는 배포에서만. 스냅숏은
 *    웹훅·백필이 GHE에서 받은 문서 그대로이며, `state=merged`·`merge_commit_sha`·
 *    `base_branch`·`repository_id`가 모두 일치할 때만 확정한다. 문서의 `state`는
 *    투영이 만든 값이므로 GHE 상세를 읽을 수 있을 때는 그쪽을 우선한다.
 * 3. 후보가 없으면 `commits/{sha}/pulls`를 `Link`가 끝날 때까지 읽는다. 최대 100페이지
 *    /회차이고 넘치면 `partial_lookup`으로 cursor를 남긴다.
 *
 * 제목·원본 SHA·`head_sha`는 근거가 아니다. 커밋 메시지의 `(#123)`도 읽지 않는다.
 */

import { createHash } from 'node:crypto';
import { prSnapshotRepo, type EvidenceProof, type EvidenceRow, type EvidenceUpsert, type Pool, type RepositoryRow } from '@prs/db';
import { GitHubApiError, type CommitGraph, type CommitPullRequestsPage, type PullRequestEvidence, type RepoRef } from '@prs/github';
import type { MergeNumberBlockReason } from '@prs/domain';

/** 근거 출처 포트. `GitHubClient`가 구조적으로 만족한다. 시험은 대역을 넣는다. */
export interface PullRequestEvidenceSource {
  getPullRequestEvidence(ref: RepoRef, number: number): Promise<PullRequestEvidence | null>;
  listPullRequestsForCommitPage(ref: RepoRef, sha: string, page: number): Promise<CommitPullRequestsPage>;
}

export interface EvidenceDeps {
  readonly pool: Pool;
  /** GHE 자격이 없는 배포는 `null`. 그때 근거는 검증된 스냅숏뿐이다. */
  readonly source: PullRequestEvidenceSource | null;
  /** 부모 수(프로파일 판정)를 읽는 그래프. 채번과 같은 그래프여야 한다. */
  readonly graphFor: (repository: RepositoryRow) => CommitGraph;
  /** 한 회차에 읽는 후보 페이지 상한 (기본 100). 넘치면 `partial_lookup`. */
  readonly maxPagesPerRound?: number;
  readonly now?: () => Date;
}

export interface EvidenceSubject {
  readonly repository: RepositoryRow;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly mergeSeq: number;
  readonly commitSha: string;
  /** 정본 행의 `pull_request_number` — 후보 힌트다. */
  readonly candidateHint: number | null;
  readonly existing: EvidenceRow | undefined;
}

/** 이번 조회의 판정. 저장은 호출 측(M 트랜잭션)이 한다. */
export type EvidenceDecision =
  | {
      readonly kind: 'pr_confirmed';
      readonly prNumber: number;
      readonly mergedAt: Date;
      readonly upsert: EvidenceUpsert;
    }
  | {
      readonly kind: 'direct_confirmed';
      readonly upsert: null;
    }
  | {
      readonly kind: 'unresolved';
      readonly reason: MergeNumberBlockReason;
      readonly upsert: EvidenceUpsert;
    };

/** 미확정 근거를 다시 조회하기까지 (상세 설계 6.3: pending evidence는 60초 간격). */
export const EVIDENCE_RECHECK_MS = 60_000;
const DEFAULT_MAX_PAGES = 100;

function refOf(repository: RepositoryRow): RepoRef {
  return { owner: repository.owner, repo: repository.name };
}

function hashRequestId(requestId: string | null): string | undefined {
  if (requestId === null) return undefined;
  return createHash('sha256').update(requestId).digest('hex').slice(0, 16);
}

function baseProof(): EvidenceProof {
  return { schema_version: 1, profile: 'squash_only' };
}

function unresolved(
  subject: EvidenceSubject,
  reason: MergeNumberBlockReason,
  proof: EvidenceProof,
): EvidenceDecision {
  return {
    kind: 'unresolved',
    reason,
    upsert: {
      repositoryId: subject.repository.repository_id,
      baseBranch: subject.baseBranch,
      seqEpoch: subject.seqEpoch,
      mergeSeq: subject.mergeSeq,
      commitSha: subject.commitSha,
      state: 'unresolved',
      prNumber: null,
      reason,
      sourceKind: 'unresolved_lookup',
      sourcePrVersion: null,
      mergedAt: null,
      proof,
    },
  };
}

function confirmed(
  subject: EvidenceSubject,
  prNumber: number,
  mergedAt: Date,
  sourceKind: 'pr_detail' | 'verified_snapshot',
  sourcePrVersion: number | null,
  proof: EvidenceProof,
): EvidenceDecision {
  return {
    kind: 'pr_confirmed',
    prNumber,
    mergedAt,
    upsert: {
      repositoryId: subject.repository.repository_id,
      baseBranch: subject.baseBranch,
      seqEpoch: subject.seqEpoch,
      mergeSeq: subject.mergeSeq,
      commitSha: subject.commitSha,
      state: 'pr_confirmed',
      prNumber,
      reason: null,
      sourceKind,
      sourcePrVersion,
      mergedAt,
      proof,
    },
  };
}

/** PR 상세가 이 first-parent 커밋의 squash 머지인가 (AC-9). */
function detailMatches(subject: EvidenceSubject, detail: PullRequestEvidence): boolean {
  return (
    detail.merged &&
    detail.merged_at !== null &&
    detail.merge_commit_sha !== null &&
    detail.merge_commit_sha.toLowerCase() === subject.commitSha.toLowerCase() &&
    detail.base.ref === subject.baseBranch &&
    detail.base.repo !== null &&
    detail.base.repo.id === subject.repository.repository_id
  );
}

/** 스냅숏 문서가 같은 조건을 만족하는가. `state`는 투영이 만든 값이라 GHE 상세보다 약하다. */
function snapshotMatches(
  subject: EvidenceSubject,
  snapshot: { readonly repository_id: string | number; readonly document: Record<string, unknown> },
): { readonly mergedAt: Date } | null {
  const doc = snapshot.document;
  const mergedAt = typeof doc['merged_at'] === 'string' ? new Date(doc['merged_at']) : null;
  if (
    doc['state'] === 'merged' &&
    typeof doc['merge_commit_sha'] === 'string' &&
    doc['merge_commit_sha'].toLowerCase() === subject.commitSha.toLowerCase() &&
    doc['base_branch'] === subject.baseBranch &&
    Number(snapshot.repository_id) === subject.repository.repository_id &&
    mergedAt !== null &&
    !Number.isNaN(mergedAt.getTime())
  ) {
    return { mergedAt };
  }
  return null;
}

/**
 * 한 first-parent 커밋의 근거를 판정한다. **외부 I/O는 여기서만** 일어나며 호출 측은
 * 이것을 시퀀스 트랜잭션 밖에서 부른다 (상세 설계 4.2).
 *
 * @param force 미확정 재조회 간격을 무시한다 (스냅숏 도착 등 새 정보가 있을 때).
 */
export async function resolveEvidence(
  deps: EvidenceDeps,
  subject: EvidenceSubject,
  options: { readonly force?: boolean } = {},
): Promise<EvidenceDecision> {
  const now = deps.now ?? ((): Date => new Date());
  const existing = subject.existing;

  // 확정된 근거는 다시 묻지 않는다. 그것이 "한 번 부여한 번호는 옮기지 않는다"의 전제다.
  if (existing?.state === 'pr_confirmed' && existing.pr_number !== null && existing.merged_at !== null) {
    return confirmed(subject, existing.pr_number, existing.merged_at, existing.source_kind === 'verified_snapshot' ? 'verified_snapshot' : 'pr_detail', existing.source_pr_version, existing.proof);
  }
  if (existing?.state === 'direct_confirmed') {
    return { kind: 'direct_confirmed', upsert: null };
  }
  if (
    existing?.state === 'unresolved' &&
    options.force !== true &&
    existing.reason !== 'partial_lookup' &&
    now().getTime() - existing.checked_at.getTime() < EVIDENCE_RECHECK_MS
  ) {
    // 60초 안에 다시 묻지 않는다 — 같은 질문에 같은 답이 돌아올 뿐 rate limit만 쓴다.
    return unresolved(subject, (existing.reason as MergeNumberBlockReason | null) ?? 'pr_evidence_pending', existing.proof);
  }

  const ref = refOf(subject.repository);
  const proof: EvidenceProof = { ...baseProof(), scan_started_at: now().toISOString() };

  // 1. 프로파일: 부모가 둘 이상이면 squash가 아니다 (AC-9). 부모 수 자체는 PR/direct 근거가 아니다.
  let parentCount: number | null = null;
  try {
    const commit = await deps.graphFor(subject.repository).readCommit(ref, subject.commitSha);
    parentCount = commit === null ? null : commit.parentShas.length;
  } catch {
    parentCount = null;
  }
  if (parentCount === null) return unresolved(subject, 'profile_unverified', proof);
  if (parentCount >= 2) return unresolved(subject, 'unsupported_merge_profile', proof);

  // 2. 후보: 정본 힌트 + 머지 커밋 SHA로 찾은 스냅숏.
  const snapshots = await prSnapshotRepo.findSnapshotsByMergeCommit(deps.pool, subject.repository.repository_id, subject.commitSha);
  const candidates = new Map<number, { readonly snapshot: (typeof snapshots)[number] | null }>();
  if (subject.candidateHint !== null) candidates.set(subject.candidateHint, { snapshot: null });
  for (const snapshot of snapshots) candidates.set(snapshot.pr_number, { snapshot });

  const matches: { readonly prNumber: number; readonly mergedAt: Date; readonly sourceKind: 'pr_detail' | 'verified_snapshot'; readonly version: number | null }[] = [];

  const verify = async (prNumber: number, snapshot: (typeof snapshots)[number] | null): Promise<void> => {
    if (deps.source !== null) {
      const detail = await deps.source.getPullRequestEvidence(ref, prNumber);
      if (detail !== null && detailMatches(subject, detail)) {
        matches.push({
          prNumber,
          mergedAt: new Date(detail.merged_at as string),
          sourceKind: 'pr_detail',
          version: detail.updated_at === null ? null : Date.parse(detail.updated_at),
        });
      }
      return;
    }
    if (snapshot !== null) {
      const match = snapshotMatches(subject, snapshot);
      if (match !== null) {
        matches.push({ prNumber, mergedAt: match.mergedAt, sourceKind: 'verified_snapshot', version: Number(snapshot.document_version) });
      }
    }
  };

  try {
    for (const [prNumber, entry] of candidates) await verify(prNumber, entry.snapshot);

    // 3. 후보가 없으면 GHE에서 연결 PR을 열거한다. 자격이 없으면 여기서 끝이다.
    let pageCount = 0;
    let lookupComplete = candidates.size > 0 ? undefined : false;
    if (matches.length === 0 && deps.source !== null) {
      const maxPages = deps.maxPagesPerRound ?? DEFAULT_MAX_PAGES;
      let page = existing?.reason === 'partial_lookup' && typeof existing.proof.resume_page === 'number' ? existing.proof.resume_page : 1;
      const seen = new Set<number>(candidates.keys());
      for (;;) {
        const response = await deps.source.listPullRequestsForCommitPage(ref, subject.commitSha, page);
        pageCount += 1;
        const requestHash = hashRequestId(response.requestId);
        if (requestHash !== undefined) (proof as { source_request_id_hash?: string }).source_request_id_hash = requestHash;
        for (const item of response.items) {
          if (seen.has(item.number)) continue;
          seen.add(item.number);
          await verify(item.number, null);
        }
        if (response.nextPage === null) {
          lookupComplete = true;
          break;
        }
        if (pageCount >= maxPages) {
          const partial: EvidenceProof = { ...proof, page_count: pageCount, lookup_complete: false, resume_page: response.nextPage, scan_finished_at: now().toISOString() };
          if (matches.length === 0) return unresolved(subject, 'partial_lookup', partial);
          break;
        }
        page = response.nextPage;
      }
    }

    const finished: EvidenceProof = {
      ...proof,
      ...(pageCount > 0 ? { page_count: pageCount } : {}),
      ...(lookupComplete === undefined ? {} : { lookup_complete: lookupComplete }),
      scan_finished_at: now().toISOString(),
    };

    if (matches.length > 1) {
      // 둘 이상이 같은 squash SHA를 가리킨다. 골라 주지 않는다.
      return unresolved(subject, 'mapping_conflict', finished);
    }
    const match = matches[0];
    if (match !== undefined) {
      return confirmed(subject, match.prNumber, match.mergedAt, match.sourceKind, match.version, {
        ...finished,
        matched_repository_id: subject.repository.repository_id,
        matched_base_branch: subject.baseBranch,
        matched_merge_commit_sha: subject.commitSha.toLowerCase(),
        merged: true,
      });
    }

    /*
     * 후보가 하나도 확정되지 않았다. 열거가 끝났어도 **부재는 확정되지 않는다** (DEV-581) —
     * 그 사실을 사유로 남기고 뒤 번호를 막는다. 열거할 수단이 없었으면 아직 모른다.
     */
    return unresolved(subject, lookupComplete === true ? 'negative_evidence_unavailable' : 'pr_evidence_pending', finished);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return unresolved(subject, 'fetch_failed', { ...proof, scan_finished_at: now().toISOString() });
    }
    throw error;
  }
}
