/**
 * 되돌림·체리픽·스택 간선 파생 (WP-030 / CR-041, JOB-REL-002·003·004).
 *
 * ## 이 모듈의 중심 계약: 후보의 변화가 관계를 바꾼다
 *
 * `references`는 source 본문만 보면 답이 나온다. 이 세 계열은 다르다 — **다른
 * 엔티티의 현재 상태가 답을 바꾼다.**
 *
 *   - `Revert "X"`가 후보 1건으로 해결된 뒤 같은 제목 PR이 하나 더 들어온다
 *   - `patch_id=P`인 커밋 A만 있다가 나중에 B가 들어온다
 *   - 상위 PR이 머지되어 하위 PR의 스택 의존이 끊긴다
 *
 * **셋 다 source에는 새 이벤트가 없다** (DEV-242). 그래서 이벤트를 처리할 때
 * 두 방향을 함께 본다: 이 엔티티를 source로 한 재파생과, **이 엔티티의 변화가
 * 영향을 주는 다른 source들**의 재파생.
 *
 * ## 파생 정본은 PostgreSQL이다 (ADR-004)
 *
 * `pull_request_snapshot.document`와 `commit_snapshot`이 유일한 근거다.
 * Elasticsearch 현재 문서를 파생의 정본으로 읽지 않는다 — 색인은 파생의 **출력**
 * 이며, 영향받는 source를 좁히는 데만 쓸 수 있고 그마저도 판정은 정본에서 다시 한다.
 *
 * ## 계열마다 수명이 다르다 (DEV-233)
 *
 * `reverts`·`cherry_picks`는 근거가 사라지면 **제거**한다. `stacks_on`은
 * **`detached`**다 — FR-REL-006 AC-3이 "해제 상태로 표시"를 요구하며, 지우면
 * *그런 의존이 있었다*는 사실이 사라진다. 하나의 일반 추상으로 뭉치면 그 차이가
 * 조건문 속으로 숨는다.
 */

import { commitSnapshotRepo, prSnapshotRepo, type CommitSnapshotRow, type PullRequestSnapshotRow, type RepositoryRow } from '@prs/db';
import {
  commitDocId,
  commitSubject,
  derivedLinkId,
  extractCherryPicks,
  extractCommitReverts,
  extractReverts,
  pullRequestDocId,
  type ExtractedRevert,
} from '@prs/domain';
import {
  deleteStaleDerivedLinks,
  findLinksFrom,
  setLinkDetached,
  summarizeRelations,
  updateLinkSummary,
  writeDerivedLinks,
  type DerivedLinkDoc,
  type LinkEndpointKind,
  type LinkScopeFields,
} from '@prs/es';

import type { LinkDeps, LinkSource } from './link.js';

export const REVERT_JOB = 'JOB-REL-002' as const;
export const CHERRY_JOB = 'JOB-REL-003' as const;
export const STACK_JOB = 'JOB-REL-004' as const;

/**
 * 제목 대조 후보 상한.
 *
 * **고르기 위한 값이 아니라 폭주를 막는 값이다** (DEV-237). 2건이든 10건이든
 * 전부 저장한다 — 하나를 고르면 조사 도구가 자신 있게 틀린 답을 낸다.
 */
export const REVERT_CANDIDATE_LIMIT = 50;

/** 체리픽 후보 상한 (FR-REL-005 AC-4). 정렬이 결정론이라 "상위 5건"이 재실행에도 같다. */
export const CHERRY_CANDIDATE_LIMIT = 5;

/** 스택 깊이 상한 (FR-REL-006 AC-4). */
export const STACK_MAX_DEPTH = 10;

/** 같은 분기를 head로 갖는 열린 PR 후보 상한. 전부 평가한다 (DEV-244). */
export const STACK_CANDIDATE_LIMIT = 20;

/**
 * 후보 변화로 다시 볼 source의 상한.
 *
 * 방아쇠마다 저장소 전량을 돌 수는 없다. 넘치면 로그에 남기고 나머지는
 * JOB-REL-006이 보정한다 — **조용히 자르지 않는다.**
 */
export const AFFECTED_LIMIT = 200;

export interface RelationOutcome {
  readonly reverts: number;
  readonly cherryPicks: number;
  readonly stacks: number;
  readonly removed: number;
  readonly detached: number;
  /** 이번 회차가 완전한 파생에 성공했는가. `false`면 제거를 하지 않는다. */
  readonly complete: boolean;
}

const EMPTY: RelationOutcome = {
  reverts: 0,
  cherryPicks: 0,
  stacks: 0,
  removed: 0,
  detached: 0,
  complete: true,
};

function scopeOf(repository: RepositoryRow): LinkScopeFields {
  return {
    repository_id: Number(repository.repository_id),
    org_id: Number(repository.org_id),
    visibility: repository.visibility,
    allowed_team_ids: [...repository.allowed_team_ids].map(Number),
  };
}

function docIdOf(repositoryId: number, source: LinkSource): string {
  return source.kind === 'pull_request'
    ? pullRequestDocId(repositoryId, Number(source.id))
    : commitDocId(repositoryId, source.id);
}

function aliasOf(kind: LinkEndpointKind): 'prs-pull-requests' | 'prs-commits' {
  return kind === 'pull_request' ? 'prs-pull-requests' : 'prs-commits';
}

/** PR 문서의 문자열 필드. 없으면 빈 문자열 — 정본이 아직 안 채운 것과 없는 것을 섞지 않는다. */
function field(document: Record<string, unknown>, key: string): string {
  const value = document[key];
  return typeof value === 'string' ? value : '';
}

/** PR 정본의 시각. `references`와 같은 규칙이다 — `now()`를 쓰면 재파생이 비결정론이 된다. */
function canonicalTime(document: Record<string, unknown>): string {
  for (const key of ['updated_at', 'created_at', 'indexed_at']) {
    const value = document[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return new Date(0).toISOString();
}

/**
 * A가 B보다 **나중**인가.
 *
 * 시각이 같으면 `commit_sha`로 가른다 — 전순서가 있어야 방향이 결정론이 된다
 * (DEV-243). 시각 동률에 방향을 정하지 않으면 같은 쌍이 양쪽에서 만들어진다.
 */
function isLater(a: { committed_at: Date; commit_sha: string }, b: { committed_at: Date; commit_sha: string }): boolean {
  const left = a.committed_at.getTime();
  const right = b.committed_at.getTime();
  if (left !== right) return left > right;
  return a.commit_sha > b.commit_sha;
}

/* ------------------------------------------------------------------------- */
/* 되돌림 (JOB-REL-002 / FR-REL-004)                                           */
/* ------------------------------------------------------------------------- */

interface RevertPlan {
  readonly docs: readonly DerivedLinkDoc[];
}

/**
 * 되돌림 표현을 간선으로 바꾼다.
 *
 * 트레일러는 대상 SHA를 직접 지목하므로 **대상 문서가 아직 없어도 끝점이 정해진다**
 * — `resolved: false`로 저장하고 대상이 나타나면 갱신한다. `link_id`가 끝점으로
 * 만들어지므로 그것은 새 문서가 아니라 같은 문서의 갱신이다.
 *
 * 제목 대조는 다르다. **후보를 실제로 찾기 전에는 끝점이 없으므로** 가짜 대상 ID를
 * 만들지 않는다 — 후보가 0건이면 간선도 0건이고, 나중에 후보가 생기면 그때
 * 역방향 재평가가 이 source를 다시 부른다 (DEV-242).
 */
async function planReverts(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
  extracted: readonly ExtractedRevert[],
  createdAt: string,
): Promise<RevertPlan> {
  const repositoryId = Number(repository.repository_id);
  const fromId = docIdOf(repositoryId, source);
  const scope = scopeOf(repository);
  const docs: DerivedLinkDoc[] = [];
  const seen = new Set<string>();

  const push = (
    toType: LinkEndpointKind,
    toId: string,
    confidence: 'exact' | 'heuristic',
    evidence: string,
    resolved: boolean,
  ): void => {
    // 자기 자신을 되돌릴 수는 없다.
    if (toType === source.kind && toId === fromId) return;
    const linkId = derivedLinkId('reverts', source.kind, fromId, toType, toId);
    if (seen.has(linkId)) return;
    seen.add(linkId);
    docs.push({
      link_id: linkId,
      link_type: 'reverts',
      scope,
      from_type: source.kind,
      from_id: fromId,
      to_type: toType,
      to_id: toId,
      to_repository_id: repositoryId,
      confidence,
      evidence,
      created_at: createdAt,
      resolved,
    });
  };

  for (const entry of extracted) {
    if (entry.target.kind === 'commit') {
      const sha = entry.target.sha;
      const snapshot = await commitSnapshotRepo.findCommitSnapshot(deps.pool, repositoryId, sha);
      push('commit', commitDocId(repositoryId, sha), 'exact', entry.evidence, snapshot !== undefined);
      continue;
    }

    /*
     * 제목 대조는 **PR과 커밋 양쪽**을 본다. AC-1이 "커밋 메시지 또는 PR 제목"을
     * 되돌림 표현의 자리로 정하므로 대상도 두 축 모두에 있을 수 있다.
     *
     * **후보를 하나로 좁히지 않는다** (DEV-237).
     */
    const title = entry.target.title;
    const [prs, commits] = await Promise.all([
      prSnapshotRepo.findPullRequestsByTitle(deps.pool, repositoryId, title, REVERT_CANDIDATE_LIMIT),
      commitSnapshotRepo.findCommitsBySubject(deps.pool, repositoryId, title, REVERT_CANDIDATE_LIMIT),
    ]);
    for (const row of prs) {
      push('pull_request', pullRequestDocId(repositoryId, row.pr_number), 'heuristic', entry.evidence, true);
    }
    for (const row of commits) {
      push('commit', commitDocId(repositoryId, row.commit_sha), 'heuristic', entry.evidence, true);
    }
  }

  return { docs };
}

/* ------------------------------------------------------------------------- */
/* 체리픽 (JOB-REL-003 / FR-REL-005)                                           */
/* ------------------------------------------------------------------------- */

/**
 * 체리픽 간선을 계획한다. **커밋 source만** 해당한다.
 *
 * ## 트레일러는 `patch_id` 가용성과 무관하다 (AC-1)
 *
 * `no_mirror`·`blob_fetch_disabled`·`compute_failed` 어느 상태에서도 트레일러가
 * 있으면 `exact` 간선이 된다. AC-2가 조건부인 것과 별개다.
 *
 * ## `derived`는 트레일러가 없고 값이 실제로 있을 때만 (AC-2)
 *
 * 시도하지 않은 것(`no_mirror`·`blob_fetch_disabled`)에서 후보 조회를 도는 것은
 * 낭비이자 "시도했다"는 거짓 기록이다 (CR-024, DEV-111).
 */
async function planCherryPicks(
  deps: LinkDeps,
  repository: RepositoryRow,
  self: CommitSnapshotRow,
): Promise<RevertPlan> {
  const repositoryId = Number(repository.repository_id);
  const fromId = commitDocId(repositoryId, self.commit_sha);
  const scope = scopeOf(repository);
  const createdAt = self.committed_at.toISOString();
  const docs: DerivedLinkDoc[] = [];
  const seen = new Set<string>();

  const push = (toSha: string, confidence: 'exact' | 'derived', evidence: string, resolved: boolean): void => {
    if (toSha === self.commit_sha) return;
    const toId = commitDocId(repositoryId, toSha);
    const linkId = derivedLinkId('cherry_picks', 'commit', fromId, 'commit', toId);
    if (seen.has(linkId)) return;
    seen.add(linkId);
    docs.push({
      link_id: linkId,
      link_type: 'cherry_picks',
      scope,
      from_type: 'commit',
      from_id: fromId,
      to_type: 'commit',
      to_id: toId,
      to_repository_id: repositoryId,
      confidence,
      evidence,
      created_at: createdAt,
      resolved,
    });
  };

  const trailers = extractCherryPicks(self.message);
  for (const trailer of trailers) {
    const snapshot = await commitSnapshotRepo.findCommitSnapshot(deps.pool, repositoryId, trailer.sha);
    push(trailer.sha, 'exact', trailer.evidence, snapshot !== undefined);
  }

  if (trailers.length === 0 && self.patch_id !== null) {
    /*
     * 후보는 **같은 저장소 안에서만** 찾는다 (AC-3). 그 조건은 질의 자신이
     * 강제한다 — 여기서 거르면 그 한 줄이 사라지는 순간 저장소 간 간선이 생긴다.
     */
    const candidates = await commitSnapshotRepo.findCommitsByPatchId(
      deps.pool,
      repositoryId,
      self.patch_id,
      self.commit_sha,
      /*
       * 상한보다 넉넉히 가져온다 — 방향 필터로 걸러진 뒤에도 5건을 채울 수 있어야
       * "상위 5건"이 실제로 5건이다.
       */
      CHERRY_CANDIDATE_LIMIT * 4,
    );
    /*
     * **방향: 나중 커밋 → 이른 커밋** (DEV-243). 체리픽은 원본이 먼저 있고 사본이
     * 뒤에 온다. 미래 커밋을 현재 커밋의 "원본 후보"로 거꾸로 잇지 않는다 —
     * 나중 커밋이 들어오면 **그 커밋이 source가 되어** 이쪽으로 간선을 만든다.
     */
    const earlier = candidates.filter((row) => isLater(self, row)).slice(0, CHERRY_CANDIDATE_LIMIT);
    for (const row of earlier) {
      push(row.commit_sha, 'derived', `patch-id ${self.patch_id}`, true);
    }
  }

  return { docs };
}

/* ------------------------------------------------------------------------- */
/* 스택 (JOB-REL-004 / FR-REL-006)                                             */
/* ------------------------------------------------------------------------- */

interface StackPlan {
  readonly docs: readonly DerivedLinkDoc[];
  readonly cycles: number;
}

/**
 * 스택 간선을 계획한다. **PR source만** 해당한다.
 *
 * 조건은 "하위 PR의 `base_branch` == 같은 저장소의 다른 **열린** PR의 `head_branch`"
 * 이고 방향은 하위 → 상위, 신뢰도는 `derived`다 (AC-1·AC-2).
 *
 * **후보가 여럿일 수 있다** (DEV-244) — 계약이 `head_branch` 유일성을 보장하지
 * 않으므로 첫 결과로 좁히지 않는다.
 */
async function planStacks(
  deps: LinkDeps,
  repository: RepositoryRow,
  self: PullRequestSnapshotRow,
): Promise<StackPlan> {
  const repositoryId = Number(repository.repository_id);
  const base = field(self.document, 'base_branch');
  if (base === '') return { docs: [], cycles: 0 };

  const fromId = pullRequestDocId(repositoryId, self.pr_number);
  const scope = scopeOf(repository);
  const createdAt = canonicalTime(self.document);

  const parents = await prSnapshotRepo.findOpenPullRequestsByHeadBranch(
    deps.pool,
    repositoryId,
    base,
    STACK_CANDIDATE_LIMIT,
  );

  const docs: DerivedLinkDoc[] = [];
  let cycles = 0;

  for (const parent of parents) {
    if (parent.pr_number === self.pr_number) continue;
    const walk = await walkChain(deps, repositoryId, parent, self.pr_number);
    if (walk === 'cycle') {
      cycles += 1;
      continue;
    }
    docs.push({
      link_id: derivedLinkId('stacks_on', 'pull_request', fromId, 'pull_request', pullRequestDocId(repositoryId, parent.pr_number)),
      link_type: 'stacks_on',
      scope,
      from_type: 'pull_request',
      from_id: fromId,
      to_type: 'pull_request',
      to_id: pullRequestDocId(repositoryId, parent.pr_number),
      to_repository_id: repositoryId,
      confidence: 'derived',
      evidence: `base ${base} = head of #${String(parent.pr_number)}`,
      detached: false,
      created_at: createdAt,
      resolved: true,
    });
  }

  return { docs, cycles };
}

/**
 * 상위 사슬을 **최대 10단계까지** 따라가며 순환을 본다 (AC-4·AC-5).
 *
 * ## 상한은 추적 범위이지 간선의 조건이 아니다
 *
 * AC-4가 정하는 것은 "스택 깊이를 최대 10단계까지 **추적한다**"이다. 이 함수가
 * 만드는 간선은 언제나 **바로 위 부모**(깊이 1)이므로, 사슬이 15단계라는 이유로
 * 그 간선을 없애면 **깊은 스택의 PR이 자기 부모와의 의존을 잃는다** — 요구사항이
 * 말하지 않은 손실이다.
 *
 * 그래서 상한에 닿으면 "그 범위 안에서 순환을 찾지 못했다"로 끝내고 간선을 만든다.
 * **알려진 한계다**: 10단계보다 먼 곳에 있는 순환은 감지되지 않는다. AC-4가 정한
 * 추적 범위가 그것이고, 무한 탐색으로 넓히지 않는다.
 *
 * `self`로 되돌아오면 순환이다 — 간선을 만들지 않고 지표에 남긴다 (AC-5).
 */
async function walkChain(
  deps: LinkDeps,
  repositoryId: number,
  start: PullRequestSnapshotRow,
  selfPrNumber: number,
): Promise<'ok' | 'cycle'> {
  const visited = new Set<number>([selfPrNumber]);
  let current: PullRequestSnapshotRow | undefined = start;

  for (let depth = 1; depth <= STACK_MAX_DEPTH; depth += 1) {
    if (current === undefined) return 'ok';
    if (visited.has(current.pr_number)) return 'cycle';
    visited.add(current.pr_number);

    const base = field(current.document, 'base_branch');
    if (base === '') return 'ok';
    const next = await prSnapshotRepo.findOpenPullRequestsByHeadBranch(deps.pool, repositoryId, base, 1);
    current = next[0];
  }
  return 'ok';
}

/* ------------------------------------------------------------------------- */
/* 한 source의 관계 파생 전체                                                   */
/* ------------------------------------------------------------------------- */

/**
 * 한 source의 되돌림·체리픽·스택 간선을 **완전히** 다시 만든다.
 *
 * 순서는 `references`와 같다: **원하는 간선 upsert → stale 조정 → 요약 재계산.**
 * 중간에 실패하면 조정을 하지 않고 다음 회차가 같은 차이를 다시 본다.
 */
export async function deriveRelations(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<RelationOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const repositoryId = Number(repository.repository_id);
  const docId = docIdOf(repositoryId, source);
  const refresh = deps.refresh === true;

  let revertDocs: readonly DerivedLinkDoc[] = [];
  let cherryDocs: readonly DerivedLinkDoc[] = [];
  let stackDocs: readonly DerivedLinkDoc[] = [];
  let cycles = 0;

  if (source.kind === 'commit') {
    const self = await commitSnapshotRepo.findCommitSnapshot(deps.pool, repositoryId, source.id);
    /*
     * 정본이 없으면 **아무것도 확정하지 않는다.** 간선을 지우지도, 완결을 찍지도
     * 않는다 — 보강이 아직 도달하지 않았을 뿐이고 그때가 오면 이벤트가 다시 온다.
     */
    if (self === undefined) return EMPTY;
    const createdAt = self.committed_at.toISOString();
    revertDocs = (await planReverts(deps, repository, source, extractCommitReverts(self.message), createdAt)).docs;
    cherryDocs = (await planCherryPicks(deps, repository, self)).docs;
  } else {
    const self = await prSnapshotRepo.findPullRequestSnapshot(deps.pool, repositoryId, Number(source.id));
    if (self === undefined) return EMPTY;
    const title = field(self.document, 'title');
    const body = field(self.document, 'body');
    const createdAt = canonicalTime(self.document);
    /*
     * 제목은 **접두 규칙**까지 본다 (AC-1의 세 번째 패턴). 본문은 인용문일 수 있어
     * 접두 규칙을 적용하지 않는다.
     */
    const fromTitle = extractReverts(title, { isPullRequestTitle: true });
    const fromBody = extractReverts(body);
    revertDocs = (await planReverts(deps, repository, source, [...fromTitle, ...fromBody], createdAt)).docs;
    const stacks = await planStacks(deps, repository, self);
    stackDocs = stacks.docs;
    cycles = stacks.cycles;
  }

  if (cycles > 0) {
    deps.metrics.linkStackCycleTotal.inc({ repository: repository.name }, cycles);
    log({
      level: 'warn',
      message: '스택 순환 감지 — 간선을 만들지 않는다',
      job: STACK_JOB,
      repository_id: repositoryId,
      doc_id: docId,
      cycles,
    });
  }

  const all = [...revertDocs, ...cherryDocs, ...stackDocs];
  const write = await writeDerivedLinks(deps.es, all, { refresh });
  if (write.failures.length > 0) {
    log({
      level: 'warn',
      message: '관계 간선 쓰기 일부 실패 — 조정을 하지 않는다',
      repository_id: repositoryId,
      doc_id: docId,
      failures: write.failures.length,
      reason: write.failures[0]?.reason ?? '',
    });
    return {
      reverts: revertDocs.length,
      cherryPicks: cherryDocs.length,
      stacks: stackDocs.length,
      removed: 0,
      detached: 0,
      complete: false,
    };
  }

  /*
   * ---- 조정: 계열마다 수명이 다르다 (DEV-233).
   */
  let removed = 0;
  removed += await deleteStaleDerivedLinks(deps.es, {
    repositoryId,
    linkType: 'reverts',
    fromType: source.kind,
    fromId: docId,
    keep: revertDocs.map((doc) => doc.link_id),
  });
  if (source.kind === 'commit') {
    removed += await deleteStaleDerivedLinks(deps.es, {
      repositoryId,
      linkType: 'cherry_picks',
      fromType: 'commit',
      fromId: docId,
      keep: cherryDocs.map((doc) => doc.link_id),
    });
  }

  let detached = 0;
  if (source.kind === 'pull_request') {
    detached = await reconcileStackDetachment(deps, repositoryId, docId, stackDocs);
  }

  await refreshRelationSummary(deps, repositoryId, source, docId);

  for (const doc of all) {
    deps.metrics.linkRelationsTotal.inc({ link_type: doc.link_type, confidence: doc.confidence }, 1);
  }

  return {
    reverts: revertDocs.length,
    cherryPicks: cherryDocs.length,
    stacks: stackDocs.length,
    removed,
    detached,
    complete: true,
  };
}

/**
 * 더 이상 성립하지 않는 스택 간선을 `detached`로 바꾼다 (FR-REL-006 AC-3, DEV-238).
 *
 * **지우지 않는다.** 지우면 *그런 의존이 있었다*는 사실이 사라져 사후 조사가
 * 불가능해진다. 조건이 다시 성립하면 `false`로 되돌린다 — `writeDerivedLinks`가
 * `detached: false`로 통째 색인하므로 그쪽은 저절로 복구된다. 여기서 하는 것은
 * **원하는 집합에 없는 기존 간선**을 표시하는 일뿐이다.
 */
async function reconcileStackDetachment(
  deps: LinkDeps,
  repositoryId: number,
  fromId: string,
  desired: readonly DerivedLinkDoc[],
): Promise<number> {
  const keep = new Set(desired.map((doc) => doc.link_id));
  const existing = await findLinksFrom(deps.es, {
    repositoryId,
    fromType: 'pull_request',
    fromId,
    linkTypes: ['stacks_on'],
  });
  const stale = existing.filter((link) => !keep.has(link.link_id) && link.detached !== true);
  if (stale.length === 0) return 0;

  await setLinkDetached(
    deps.es,
    stale.map((link) => ({ link_id: link.link_id, repository_id: repositoryId, detached: true })),
    { refresh: deps.refresh === true },
  );
  return stale.length;
}

/**
 * 관계 요약 네 leaf를 **현재 active 간선 집합에서** 다시 계산한다 (DEV-241).
 *
 * 간선 하나의 결과로 boolean을 쓰지 않는다 — 같은 종류의 다른 간선이 남아 있을 수
 * 있고, 그러면 `false`가 "확인했고 현재 없다"가 아니라 거짓이 된다.
 *
 * `reference_count`를 넘기지 않는다. WP-029가 소유한 값이며 여기서 건드리면
 * 참조 수가 사라진다 (DEV-222).
 */
export async function refreshRelationSummary(
  deps: LinkDeps,
  repositoryId: number,
  source: LinkSource,
  docId: string,
): Promise<void> {
  const summary = await summarizeRelations(deps.es, {
    repositoryId,
    kind: source.kind,
    docId,
  });
  /*
   * **`has_stack`은 PR 문서에만 있다.** 스택은 PR↔PR 관계이므로 커밋 매핑에는
   * 그 leaf가 선언되어 있지 않고, `dynamic: strict`가 그것을 강제한다 (THR-010).
   *
   * 커밋 문서에 `false`를 쓰는 것은 매핑 위반일 뿐 아니라 **주장 자체가 틀렸다** —
   * "이 커밋은 스택이 없다"가 아니라 "커밋에는 스택이라는 개념이 없다"이다.
   * 없는 것과 아닌 것을 구분한다.
   */
  const relations =
    source.kind === 'pull_request'
      ? summary
      : {
          has_revert: summary.has_revert,
          is_reverted: summary.is_reverted,
          has_cherry_pick: summary.has_cherry_pick,
        };
  await updateLinkSummary(
    deps.es,
    {
      alias: aliasOf(source.kind),
      docId,
      repositoryId,
      /*
       * `links_pending`은 **참조 추출의 완결 상태**다 (DEV-246). 관계 파생이
       * 그 뜻을 빌려 쓰지 않는다 — 한 필드가 두 뜻을 가지면 화면이 무엇을
       * 말하는지 아무도 설명할 수 없다. 여기서는 현재 값을 보존한다.
       */
      linksPending: false,
      relations,
    },
    { refresh: deps.refresh === true },
  );
}

/* ------------------------------------------------------------------------- */
/* 후보 변화 재평가 (DEV-232·242)                                              */
/* ------------------------------------------------------------------------- */

/**
 * 이 엔티티가 **되돌림 제목 대조의 대상**이 될 때, 그것을 되돌리는 쪽이 가질 제목들.
 *
 * 되돌림 커밋의 제목은 `Revert "<원본 제목>"`이고 PR 제목은 접두 형태도 쓴다.
 * 그래서 대상 제목 하나에 대해 **후보 문자열은 유한하고 작다** — 인덱스가 잡히는
 * 정확 일치 조회 넷이면 역방향이 끝난다. 본문 전체를 훑지 않는다.
 */
function reverterTitles(title: string): readonly string[] {
  if (title === '') return [];
  return [`Revert "${title}"`, `Revert “${title}”`, `Revert: ${title}`, `Revert ${title}`];
}

/** 재평가 대상 하나. 같은 source가 여러 경로로 나와도 한 번만 돈다. */
function sourceKey(source: LinkSource): string {
  return `${source.kind}:${source.id}`;
}

/**
 * 이 엔티티의 변화가 영향을 주는 **다른 source들**을 다시 파생한다.
 *
 * ## 왜 필요한가 (DEV-242)
 *
 * 관계 집합은 source 본문뿐 아니라 **후보의 존재**에 달려 있는데, 후보가 나타날 때
 * source에는 아무 이벤트도 오지 않는다. 이 함수가 없으면 다음 셋이 영원히 어긋난다.
 *
 *   - 같은 제목의 PR이 하나 더 들어와도 되돌림 간선이 하나로 남는다
 *   - 같은 `patch_id` 커밋이 나중에 들어와도 체리픽 간선이 생기지 않는다
 *   - 상위 PR이 머지돼도 하위 PR의 스택 의존이 `active`로 남는다 (DEV-232)
 *
 * ## 경계가 있다
 *
 * 방아쇠마다 저장소 전량을 돌 수는 없다. 후보 조회는 전부 **인덱스가 잡히는 정확
 * 일치**이고 총량은 `AFFECTED_LIMIT`으로 자른다. 잘린 경우 **로그에 남긴다** —
 * 조용히 자르면 "전부 재평가했다"로 읽힌다. 나머지는 JOB-REL-006이 보정한다.
 */
export async function reevaluateAffectedRelations(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<number> {
  const log = deps.log ?? ((): void => undefined);
  const repositoryId = Number(repository.repository_id);
  const targets = new Map<string, LinkSource>();
  const self = sourceKey(source);

  const add = (candidate: LinkSource): void => {
    const key = sourceKey(candidate);
    if (key === self || targets.has(key)) return;
    if (targets.size >= AFFECTED_LIMIT) return;
    targets.set(key, candidate);
  };

  let title = '';

  if (source.kind === 'commit') {
    const row = await commitSnapshotRepo.findCommitSnapshot(deps.pool, repositoryId, source.id);
    if (row === undefined) return 0;
    title = commitSubject(row.message);

    /*
     * ---- 트레일러 역방향: 이 SHA를 되돌림 대상으로 적은 커밋들.
     *
     * 그 간선은 이미 `resolved: false`로 있을 수 있다. 다시 파생하면 대상이
     * 생겼다는 사실이 반영된다 — 별도의 "해결" 경로를 만들지 않는다.
     */
    const reverting = await commitSnapshotRepo.findCommitsRevertingSha(
      deps.pool,
      repositoryId,
      source.id,
      AFFECTED_LIMIT,
    );
    for (const one of reverting) add({ kind: 'commit', id: one.commit_sha });

    /*
     * ---- patch-id 역방향: 같은 patch를 가진 **나중** 커밋들.
     *
     * 방향이 나중 → 이른이므로, 이 커밋이 새로 준비되면 **이 커밋보다 나중인**
     * 커밋들의 후보 집합이 바뀐다. 이른 커밋들은 이 커밋을 후보로 삼지 않는다.
     */
    if (row.patch_id !== null) {
      const samePatch = await commitSnapshotRepo.findCommitsByPatchId(
        deps.pool,
        repositoryId,
        row.patch_id,
        row.commit_sha,
        AFFECTED_LIMIT,
      );
      for (const one of samePatch) {
        if (isLater(one, row)) add({ kind: 'commit', id: one.commit_sha });
      }
    }
  } else {
    const row = await prSnapshotRepo.findPullRequestSnapshot(deps.pool, repositoryId, Number(source.id));
    if (row === undefined) return 0;
    title = field(row.document, 'title');

    /*
     * ---- 스택 역방향: 이 PR의 head를 base로 삼는 하위 PR들 (DEV-232).
     *
     * 이 PR이 머지·종료·retarget되면 **하위 PR의 간선**이 바뀌어야 하는데 하위
     * PR에는 그때 이벤트가 오지 않는다. 상태로 거르지 않는다 — 닫힌 하위 PR의
     * 간선도 `detached` 판정 대상이다.
     */
    const head = field(row.document, 'head_branch');
    if (head !== '') {
      const children = await prSnapshotRepo.findPullRequestsByBaseBranch(
        deps.pool,
        repositoryId,
        head,
        AFFECTED_LIMIT,
      );
      for (const one of children) add({ kind: 'pull_request', id: String(one.pr_number) });
    }
  }

  /*
   * ---- 제목 역방향: 이 엔티티를 제목으로 되돌리는 source들 (양쪽 축 모두).
   */
  for (const candidate of reverterTitles(title)) {
    const [prs, commits] = await Promise.all([
      prSnapshotRepo.findPullRequestsByTitle(deps.pool, repositoryId, candidate, REVERT_CANDIDATE_LIMIT),
      commitSnapshotRepo.findCommitsBySubject(deps.pool, repositoryId, candidate, REVERT_CANDIDATE_LIMIT),
    ]);
    for (const one of prs) add({ kind: 'pull_request', id: String(one.pr_number) });
    for (const one of commits) add({ kind: 'commit', id: one.commit_sha });
  }

  if (targets.size === 0) return 0;

  if (targets.size >= AFFECTED_LIMIT) {
    log({
      level: 'warn',
      message: '후보 변화 재평가가 상한에 걸렸다 — 나머지는 JOB-REL-006이 보정한다',
      repository_id: repositoryId,
      from: sourceKey(source),
      limit: AFFECTED_LIMIT,
    });
  }

  let done = 0;
  for (const target of targets.values()) {
    /*
     * **재평가는 다시 재평가를 부르지 않는다.** 부르면 저장소 전체로 번지고 종료를
     * 보장할 수 없다. 한 홉이면 충분하다 — 이 source의 변화가 바꿀 수 있는 것은
     * 이 source를 후보로 삼는 쪽뿐이고, 그쪽의 결과가 또 다른 쪽을 바꾸지 않는다.
     */
    await deriveRelations(deps, repository, target);
    done += 1;
  }
  return done;
}

/**
 * 한 source의 관계 파생 + 후보 변화 재평가.
 *
 * `handleSourceReady`가 부르는 진입점이다. 둘을 한 함수로 묶는 이유는 **호출부가
 * 하나를 잊는 것을 막기 위해서다** — 잊으면 관계가 수렴하지 않고, 그 사실은
 * 한참 뒤에야 드러난다.
 */
export async function handleRelationsReady(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<{ readonly outcome: RelationOutcome; readonly reevaluated: number }> {
  const outcome = await deriveRelations(deps, repository, source);
  const reevaluated = await reevaluateAffectedRelations(deps, repository, source);
  return { outcome, reevaluated };
}
