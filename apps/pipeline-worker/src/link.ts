/**
 * JOB-REL-001 참조 간선 파생 · JOB-REL-005 미해결 참조 해결 · JOB-REL-006 전량 재파생
 * (WP-029 / CR-039, DEV-215~228).
 *
 * ## 방아쇠는 둘이다
 *
 * | 방아쇠 | 무엇을 깨우나 |
 * | --- | --- |
 * | `EVT-ING-003` | PR 문서·PR 유래 커밋 문서가 색인됐다 |
 * | `EVT-ING-005` | 커밋 메타데이터가 정본·색인에 모두 들어갔다 — **직접 푸시 커밋이 여기로** |
 *
 * `EVT-ING-003`만으로는 성립하지 않는다. 그 이벤트는 `project` 워커가 색인한
 * 문서마다 내는데, 직접 푸시 커밋 문서는 `project`가 만들지 않는다 (DEV-206).
 *
 * ## 이벤트는 신호이고 본문이 아니다
 *
 * 핸들러는 payload의 텍스트를 쓰지 않는다. **현재 PostgreSQL 정본**에서 읽는다 —
 * `pull_request_snapshot.document`의 `title`·`body`, `commit_snapshot.message`.
 * 그래서 오래된 이벤트가 늦게 재전달돼도 결과가 현재 정본으로 수렴한다.
 * Elasticsearch 현재 문서를 파생의 정본으로 읽지 않는다 (ADR-004).
 *
 * ## 한 source의 참조는 완전한 집합이다
 *
 * 본문에서 참조가 사라지면 간선도 사라져야 한다 (DEV-220). 그래서 매 회차가
 * 원하는 집합을 다시 만들고 나머지를 지운다. **단 추출·쓰기가 실패한 회차는
 * 지우지 않는다** — 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다.
 */

import {
  EVENT_NAMES,
  commitDocId,
  commitReferenceKeys,
  extractReferences,
  parseReferenceKey,
  pullRequestDocId,
  pullRequestReferenceKeys,
  referenceLinkId,
  type CommitMetadataReady,
  type ExtractedReference,
  type IngestionProjected,
  type ReferenceTarget,
  type RepoSlug,
} from '@prs/domain';
import {
  MAX_RETRIES,
  TOPICS,
  consumerGroup,
  type DeliveredEvent,
  type EventBus,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { commitSnapshotRepo, jobRepo, prSnapshotRepo, repositoryRepo, withReindexWrite } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import {
  deleteStaleReferenceLinks,
  derivedLinkSource,
  findReferenceTargets,
  findReferencesTo,
  isReferenceTargetIndexed,
  referenceLinkSource,
  resolveReferenceLinks,
  updateLinkSummary,
  writeReferenceLinks,
  type LinkEndpointKind,
  type ReferenceLinkDoc,
  type ReferenceResolution,
  type TargetLookup,
  type WriteTargets,
} from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { deriveRelations, handleRelationsReady, planRelationEdges, type RelationOutcome } from './relations.js';
import type { WorkerMetrics } from './metrics.js';
import type { LinkRebuildPort, PlannedLinks } from './reindex.js';

export const LINK_DERIVE_JOB = 'JOB-REL-001' as const;
export const LINK_RESOLVE_JOB = 'JOB-REL-005' as const;
export const LINK_REBUILD_JOB = 'JOB-REL-006' as const;

/** `job.type`. 마이그레이션 001의 `job_type_chk`에 이미 있다 — 새 번호를 만들지 않는다. */
export const LINK_REBUILD_TYPE = 'link_rebuild' as const;

/** 재파생 한 배치의 크기. 무한정 밀어 넣지 않는다. */
export const REBUILD_BATCH = 200;

export interface LinkLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface LinkDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  /**
   * 승인된 GHE 호스트. **없으면 URL 참조를 만들지 않는다** (THR-036).
   *
   * 검증할 근거가 없는 상태에서 URL을 내부 대상으로 해석하면 외부가 심은
   * 문자열이 내부 조회를 유발한다.
   */
  readonly gheHost?: string | null;
  readonly log?: (fields: LinkLogFields) => void;
  readonly now?: () => Date;
  /** 시험이 색인 가시성을 기다리지 않게 한다. 운영은 기본값(끔)이다. */
  readonly refresh?: boolean;
}

/** 파생 대상 하나. */
export interface LinkSource {
  readonly kind: LinkEndpointKind;
  /** PR이면 번호, 커밋이면 소문자 40자 SHA. */
  readonly id: string;
}

export interface DeriveOutcome {
  readonly references: number;
  readonly resolved: number;
  readonly removed: number;
  /** 이번 회차가 완전한 파생에 성공했는가. `false`면 `links_pending`이 남는다. */
  readonly complete: boolean;
  /**
   * 정본에 source가 없었다 (CR-121). 실패가 아니라 「만들 간선이 없다」이다 — 재색인의 회수가 이것과
   * 불완전을 가른다: 없는 source의 미처리는 끝난 일이고, 불완전은 다시 할 일이다.
   */
  readonly absent?: true;
}

const EMPTY: DeriveOutcome = { references: 0, resolved: 0, removed: 0, complete: false };

function slugOf(repository: RepositoryRow): RepoSlug {
  return { owner: repository.owner.toLowerCase(), name: repository.name.toLowerCase() };
}

function docIdOf(repositoryId: number, source: LinkSource): string {
  return source.kind === 'pull_request'
    ? pullRequestDocId(repositoryId, Number(source.id))
    : commitDocId(repositoryId, source.id);
}

function aliasOf(kind: LinkEndpointKind): 'prs-pull-requests' | 'prs-commits' {
  return kind === 'pull_request' ? 'prs-pull-requests' : 'prs-commits';
}

/** 파생 입력. 정본에서 읽은 텍스트와 그 정본의 시각. */
interface SourceText {
  readonly text: string;
  /** 간선의 `created_at`. `now()`가 아니다 — 재파생이 결정론적이어야 한다. */
  readonly canonicalAt: string;
}

/**
 * 정본에서 본문을 읽는다.
 *
 * `undefined`는 "정본이 아직 없다"이며 **실패가 아니다** — 커밋 보강이나 투영이
 * 아직 도달하지 않았을 뿐이고, 그때가 오면 이벤트가 다시 온다.
 */
async function readSource(
  deps: LinkDeps,
  repositoryId: number,
  source: LinkSource,
): Promise<SourceText | undefined> {
  if (source.kind === 'pull_request') {
    const rows = await prSnapshotRepo.listSnapshotsAfter(
      deps.pool,
      repositoryId,
      Number(source.id) - 1,
      1,
    );
    const row = rows[0];
    if (row === undefined || row.pr_number !== Number(source.id)) return undefined;
    const document = row.document;
    const title = typeof document['title'] === 'string' ? document['title'] : '';
    const body = typeof document['body'] === 'string' ? document['body'] : '';
    return {
      // 제목과 본문 둘 다 참조를 담을 수 있다. 줄로 나눠 트레일러 판정이 섞이지 않게 한다.
      text: `${title}\n${body}`,
      canonicalAt: canonicalTime(document),
    };
  }

  const row = await commitSnapshotRepo.findCommitSnapshot(deps.pool, repositoryId, source.id);
  if (row === undefined) return undefined;
  return { text: row.message, canonicalAt: row.committed_at.toISOString() };
}

/** PR 정본의 시각. 없으면 색인 시각, 그것도 없으면 빈 문자열이 아니라 epoch다. */
function canonicalTime(document: Record<string, unknown>): string {
  for (const key of ['updated_at', 'created_at', 'indexed_at']) {
    const value = document[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return new Date(0).toISOString();
}

/**
 * 참조의 대상 저장소를 정한다.
 *
 * 등록되지 않은 저장소는 `undefined`다 — **미해결이 정답이며 오류가 아니다.**
 * 임의의 외부 GitHub 조회로 확장하지 않는다 (THR-036).
 */
async function targetRepositoryId(
  deps: LinkDeps,
  sourceRepositoryId: number,
  target: ReferenceTarget,
  cache: Map<string, number | null>,
): Promise<number | undefined> {
  if (target.repo === null) return sourceRepositoryId;
  const slug = `${target.repo.owner}/${target.repo.name}`;
  const cached = cache.get(slug);
  if (cached !== undefined) return cached ?? undefined;

  const row = await repositoryRepo.findRepositoryBySlug(deps.pool, target.repo.owner, target.repo.name);
  const id = row === undefined ? null : Number(row.repository_id);
  cache.set(slug, id);
  return id ?? undefined;
}

function toLookup(key: string, repositoryId: number, target: ReferenceTarget): TargetLookup | null {
  switch (target.kind) {
    case 'pull_request':
      return { key, kind: 'pull_request', repositoryId, prNumber: target.number };
    case 'commit':
      return { key, kind: 'commit', repositoryId, sha: target.sha };
    case 'commit_prefix':
      return { key, kind: 'commit_prefix', repositoryId, prefix: target.prefix };
  }
}

/** 한 source의 참조 간선 계획 — 쓰기 전의 결과다. 파생과 전환 전 검증이 함께 쓴다 (CR-121). */
export type ReferencePlan =
  | { readonly kind: 'absent' }
  | { readonly kind: 'extract_failed'; readonly reason: string }
  | { readonly kind: 'planned'; readonly docs: readonly ReferenceLinkDoc[]; readonly resolvedCount: number };

/**
 * 정본에서 참조 간선을 **계획한다** — 아무것도 쓰지 않는다 (CR-121).
 *
 * 추출·대상 해석·간선 문서까지가 여기다. 파생(`deriveReferenceLinks`)이 이 결과를 쓰고, 전환 전
 * 검증이 이 결과를 새 인덱스와 맞댄다 — 같은 함수라 둘이 다른 간선을 말할 수 없다.
 */
export async function planReferenceLinks(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<ReferencePlan> {
  const repositoryId = Number(repository.repository_id);
  const docId = docIdOf(repositoryId, source);

  const canonical = await readSource(deps, repositoryId, source);
  if (canonical === undefined) return { kind: 'absent' };

  let extracted: readonly ExtractedReference[];
  try {
    extracted = extractReferences(canonical.text, {
      sourceRepo: slugOf(repository),
      gheHost: deps.gheHost ?? null,
    });
  } catch (error) {
    return { kind: 'extract_failed', reason: String(error).slice(0, 200) };
  }

  // ---- 대상 해석. 등록되지 않은 저장소는 미해결이 정답이다.
  const cache = new Map<string, number | null>();
  const lookups: TargetLookup[] = [];
  for (const reference of extracted) {
    const targetRepo = await targetRepositoryId(deps, repositoryId, reference.target, cache);
    if (targetRepo === undefined) continue;
    const lookup = toLookup(reference.reference_key, targetRepo, reference.target);
    if (lookup !== null) lookups.push(lookup);
  }
  const resolutions = await findReferenceTargets(deps.es, lookups);

  // ---- 간선 문서.
  const scope = {
    repository_id: repositoryId,
    org_id: Number(repository.org_id),
    visibility: repository.visibility,
    allowed_team_ids: [...repository.allowed_team_ids].map(Number),
  };
  const docs: ReferenceLinkDoc[] = extracted.map((reference) => ({
    link_id: referenceLinkId(source.kind, docId, reference.reference_key),
    reference_key: reference.reference_key,
    scope,
    from_type: source.kind,
    from_id: docId,
    confidence: reference.confidence,
    evidence: reference.evidence,
    created_at: canonical.canonicalAt,
    resolution: resolutions.get(reference.reference_key) ?? null,
  }));
  return { kind: 'planned', docs, resolvedCount: resolutions.size };
}

/**
 * 한 source의 참조 간선을 **완전히** 다시 만든다 (JOB-REL-001).
 *
 * 파생이 **해결까지 다시 시도한다.** 그러지 않으면 재파생이 이미 해결된 간선을
 * 미해결로 되돌린다 — 간선을 통째로 색인하기 때문이다.
 */
export async function deriveReferenceLinks(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<DeriveOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const repositoryId = Number(repository.repository_id);
  const docId = docIdOf(repositoryId, source);

  const plan = await planReferenceLinks(deps, repository, source);
  if (plan.kind === 'absent') {
    /*
     * 정본이 없으면 **아무것도 확정하지 않는다.** 간선을 지우지도, 완결을 찍지도
     * 않는다 — 여기서 "참조 0건"으로 확정하면 정본이 늦게 도착한 문서의 간선이
     * 통째로 사라진다.
     */
    return { ...EMPTY, absent: true };
  }
  if (plan.kind === 'extract_failed') {
    /*
     * 추출 실패는 색인을 막지 않는다 (FR-REL-003 예외 처리). **기존 간선도 지우지
     * 않는다** — 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다.
     */
    log({
      level: 'warn',
      message: '참조 추출 실패 — 기존 간선을 보존한다',
      repository_id: repositoryId,
      doc_id: docId,
      reason: plan.reason,
    });
    await withReindexWrite(deps.pool, (targets) => markPending(deps, targets, source, repositoryId, docId));
    return EMPTY;
  }

  /*
   * 이 회차의 간선 쓰기 전체를 **한 울타리 안에서** 한다 (WP-035, DEV-296·308).
   *
   * 쓰기·stale 제거·요약이 하나의 논리 쓰기다 — 나누면 그 사이에 전환이 끼어들어
   * 새 인덱스가 간선은 받고 삭제는 못 받는 상태가 될 수 있다.
   */
  return withReindexWrite(deps.pool, async (targets) =>
    writeDerivedReferenceSet(deps, targets, {
      docs: plan.docs,
      source,
      repositoryId,
      docId,
      resolvedCount: plan.resolvedCount,
      log,
    }),
  );
}

interface ReferenceWriteInput {
  readonly docs: readonly ReferenceLinkDoc[];
  readonly source: LinkSource;
  readonly repositoryId: number;
  readonly docId: string;
  readonly resolvedCount: number;
  readonly log: (fields: LinkLogFields) => void;
}

/** 울타리 안에서 도는 실제 쓰기. 대상은 인자로 받는다. */
async function writeDerivedReferenceSet(
  deps: LinkDeps,
  targets: WriteTargets,
  input: ReferenceWriteInput,
): Promise<DeriveOutcome> {
  const { docs, source, repositoryId, docId, log } = input;

  const write = await writeReferenceLinks(deps.es, docs, targets, { refresh: deps.refresh === true });
  const complete = write.failures.length === 0;

  if (!complete) {
    log({
      level: 'warn',
      message: '간선 쓰기 일부 실패 — stale 제거를 하지 않는다',
      repository_id: repositoryId,
      doc_id: docId,
      failures: write.failures.length,
      reason: write.failures[0]?.reason ?? '',
    });
    await markPending(deps, targets, source, repositoryId, docId);
    return { references: docs.length, resolved: input.resolvedCount, removed: 0, complete: false };
  }

  /*
   * ---- 완전한 파생에 성공했을 때만 지운다 (DEV-220).
   */
  const removed = await deleteStaleReferenceLinks(
    deps.es,
    {
      repositoryId,
      fromType: source.kind,
      fromId: docId,
      keep: docs.map((doc) => doc.link_id),
    },
    targets,
  );

  await updateLinkSummary(
    deps.es,
    {
      alias: aliasOf(source.kind),
      docId,
      repositoryId,
      referenceCount: docs.length,
      /*
       * **미해결이 있다는 이유로 `true`가 되지 않는다.** 미해결은 정상 상태다 —
       * 이 표식은 "현재 본문에 대한 파생이 완결됐다고 보장할 수 없다"는 뜻이다.
       */
      linksPending: false,
    },
    targets,
    { refresh: deps.refresh === true },
  );

  deps.metrics.linkReferencesTotal.inc({ kind: source.kind }, docs.length);
  return { references: docs.length, resolved: input.resolvedCount, removed, complete: true };
}

/**
 * 완결을 보장할 수 없을 때의 표식.
 *
 * **참조 수를 건드리지 않는다.** 세지 못한 회차가 어떤 값을 쓰든 그 값은
 * 거짓말이다 — 화면은 그것을 "이 문서의 참조는 N건"으로 읽는다.
 */
async function markPending(
  deps: LinkDeps,
  targets: WriteTargets,
  source: LinkSource,
  repositoryId: number,
  docId: string,
): Promise<void> {
  await updateLinkSummary(
    deps.es,
    { alias: aliasOf(source.kind), docId, repositoryId, linksPending: true },
    targets,
    { refresh: deps.refresh === true },
  );
}

/* ------------------------------------------------------------------------- */
/* JOB-REL-005 미해결 참조 해결                                                */
/* ------------------------------------------------------------------------- */

/**
 * 새로 쓸 수 있게 된 대상 T를 가리키는 참조를 다시 판정한다.
 *
 * **전량 스캔하지 않는다.** `reference_key` 후보가 대상 하나당 최대 일곱이라
 * `terms` 하나로 찾고, 페이지는 끝까지 넘긴다.
 *
 * ## 축약 SHA는 양방향이다 (PR #44 리뷰 P1)
 *
 * 대상이 나타났다고 바로 해결하지 않는다 — 그 사이 같은 접두를 가진 커밋이 하나
 * 더 생겨 **방금 모호해졌을 수** 있다. 반대도 참이다: **한 번 유일해서 해결된
 * 간선이 새 커밋 때문에 모호해질 수 있고**, 그때 대상을 그대로 두면 간선이
 * "자신 있게 틀린 답"을 계속 말한다. 그래서 접두 키는 해결 여부와 무관하게
 * 매번 유일성을 다시 계산하고, 모호해졌으면 **해결을 되돌린다.**
 *
 * 정확한 키(`pr:N`·`commit:<40자>`)는 모호해질 수 없으므로 재평가하지 않는다.
 *
 * ## 정확한 키도 대상이 색인되어 있을 때만 붙인다 (CR-123 / DEV-775)
 *
 * 해결의 기준은 「대상이 색인되었는가」다(FR-REL-003 AC-3). 파생과 전환 전 검증은 그 기준으로 계획하는데,
 * 이 함수는 불린 대상이 곧 있다고 여겨 정확한 키를 그대로 붙였다. 평시에는 투영이 대상을 쓴 뒤에 불리므로
 * 같은 답이지만, 재색인은 source를 정본 스냅숏에서 차례로 읽는다 — 문서를 만들 근거가 없는 커밋(DEV-759)이나
 * 손으로 전환한 인덱스에 빠진 커밋도 대상으로 온다. 그때 새 인덱스와 서비스 인덱스(이중 쓰기)에는 없는
 * 문서를 가리키는 해결 간선이 서고, 검증의 계획은 미해결이라 전환이 매번 막혔다.
 */
export async function resolveReferencesTo(
  deps: LinkDeps,
  repository: RepositoryRow,
  target: LinkSource,
): Promise<number> {
  const repositoryId = Number(repository.repository_id);
  const slug = slugOf(repository);
  const docId = docIdOf(repositoryId, target);

  const sameRepoKeys =
    target.kind === 'pull_request'
      ? pullRequestReferenceKeys(Number(target.id), null)
      : commitReferenceKeys(target.id, null);
  const crossRepoKeys =
    target.kind === 'pull_request'
      ? pullRequestReferenceKeys(Number(target.id), slug)
      : commitReferenceKeys(target.id, slug);

  /*
   * 커밋 대상은 **해결된 것까지** 가져온다 — 접두 간선이 방금 모호해졌을 수 있다.
   * PR 대상은 키가 정확해 모호해질 수 없으므로 미해결만 본다.
   */
  const candidates = await findReferencesTo(deps.es, {
    targetRepositoryId: repositoryId,
    sameRepoKeys,
    crossRepoKeys,
    include: target.kind === 'commit' ? 'any' : 'unresolved',
  });
  if (candidates.length === 0) return 0;

  // 접두 키는 유일성을 다시 본다. 나머지는 대상이 곧 답이다.
  const prefixKeys = new Set<string>();
  for (const link of candidates) {
    const parsed = parseReferenceKey(link.reference_key);
    if (parsed?.kind === 'commit_prefix') prefixKeys.add(link.reference_key);
  }

  let prefixResolutions: ReadonlyMap<string, ReferenceResolution> = new Map();
  if (prefixKeys.size > 0) {
    const lookups: TargetLookup[] = [];
    for (const key of prefixKeys) {
      const parsed = parseReferenceKey(key);
      if (parsed?.kind !== 'commit_prefix') continue;
      lookups.push({ key, kind: 'commit_prefix', repositoryId, prefix: parsed.prefix });
    }
    prefixResolutions = await findReferenceTargets(deps.es, lookups);
  }

  const direct: ReferenceResolution = {
    to_type: target.kind,
    to_id: docId,
    to_repository_id: repositoryId,
  };
  /*
   * 정확한 키를 붙일 후보가 있을 때만 대상 문서를 한 번 확인한다. 실시간 존재 확인이라 방금 투영된
   * 대상도 보이고, 없으면 계획(`findReferenceTargets`)처럼 미해결로 둔다.
   */
  const needsDirect = candidates.some((link) => !prefixKeys.has(link.reference_key) && !link.resolved);
  const targetIndexed = needsDirect
    ? await isReferenceTargetIndexed(deps.es, { kind: target.kind, docId, repositoryId })
    : false;

  const updates: Array<{
    link_id: string;
    repository_id: number;
    owner: { readonly sourceKind: LinkEndpointKind; readonly docId: string };
    resolution: ReferenceResolution | null;
  }> = [];
  for (const link of candidates) {
    /*
     * **소유 source와 간선 ID가 맞는지 본다** (CR-121). 부분 갱신이 재색인의 새 인덱스에서 간선을 찾지
     * 못하면 회수할 대상은 그 소유 source다 — 그 source가 이 간선을 만든 것이 아니면 엉뚱한 source를
     * 다시 파생하고 간선은 빠진 채 남는다. 어긋난 문서는 색인이 손상된 것이라 던진다.
     */
    if (referenceLinkId(link.from_type, link.from_id, link.reference_key) !== link.link_id) {
      throw new Error(`reference_link_owner_mismatch: ${link.link_id} (${link.from_type} ${link.from_id})`);
    }
    const owner = { sourceKind: link.from_type, docId: link.from_id };
    if (prefixKeys.has(link.reference_key)) {
      /*
       * 접두는 **매번 다시 계산한다.** 유일하면 그 커밋으로, 모호하거나 사라졌으면
       * `null`로 — 되돌리는 쪽이 없으면 한 번 잘못 붙은 간선이 영원히 남는다.
       */
      const next = prefixResolutions.get(link.reference_key) ?? null;
      // 이미 미해결인데 여전히 해결되지 않으면 쓸 것이 없다.
      if (next === null && !link.resolved) continue;
      updates.push({ link_id: link.link_id, repository_id: Number(link.repository_id), owner, resolution: next });
      continue;
    }
    // 정확한 키. 이미 해결됐으면 다시 쓸 이유가 없다 — 모호해질 수 없다.
    if (link.resolved) continue;
    // 대상 문서가 서비스 색인에 없으면 붙이지 않는다 — 파생·검증의 계획과 같은 판정이다.
    if (!targetIndexed) continue;
    updates.push({ link_id: link.link_id, repository_id: Number(link.repository_id), owner, resolution: direct });
  }

  const result = await withReindexWrite(deps.pool, (targets) =>
    resolveReferenceLinks(deps.es, updates, targets, { refresh: deps.refresh === true }),
  );

  /*
   * **부분 실패를 성공으로 세지 않는다** (PR #44 리뷰 P2).
   *
   * `bulk`는 요청 수준에서 성공하면서 개별 항목만 실패할 수 있다. 그 실패를
   * 버리고 성공 수만 돌려주면 핸들러가 ack하고, 실패한 간선은 **다시 시도할
   * 방아쇠가 없다** — 대상 색인은 보통 한 번뿐인 사건이다.
   *
   * 던지면 핸들러가 예산 안에서 재시도한다. 해결은 멱등이라 다시 해도 안전하다.
   */
  if (result.failures.length > 0) {
    throw new Error(
      `참조 해결 부분 실패 ${String(result.failures.length)}건: ${result.failures[0]?.reason ?? ''}`,
    );
  }
  return result.written;
}

/* ------------------------------------------------------------------------- */
/* 이벤트 핸들러                                                               */
/* ------------------------------------------------------------------------- */

function sourceFromEntity(entityKind: string, entityId: string): LinkSource | null {
  const separator = entityId.indexOf(':');
  if (separator < 0) return null;
  const tail = entityId.slice(separator + 1);
  if (tail === '') return null;
  if (entityKind === 'pull_request') return { kind: 'pull_request', id: tail };
  if (entityKind === 'commit') return { kind: 'commit', id: tail.toLowerCase() };
  return null;
}

/**
 * 하나의 source를 파생하고, 그것을 가리키던 미해결 참조를 해결한다.
 *
 * 한 소비자가 **연속해서 두 일을 한다** (CR-039). 소비자 그룹을 둘로 나눠 같은
 * 이벤트를 broadcast할 필요가 없다 — consumer group은 work sharing이므로,
 * 나누는 것은 서로 독립적으로 전부 받아야 하는 두 서비스일 때만 옳다.
 */
export async function handleSourceReady(
  deps: LinkDeps,
  repository: RepositoryRow,
  source: LinkSource,
): Promise<{
  readonly derived: DeriveOutcome;
  readonly resolved: number;
  readonly relations: RelationOutcome;
  readonly reevaluated: number;
}> {
  const derived = await deriveReferenceLinks(deps, repository, source);
  const resolved = await resolveReferencesTo(deps, repository, source);
  /*
   * ---- WP-030: 되돌림·체리픽·스택 (CR-041).
   *
   * **같은 진입점에 붙인다.** 별도 핸들러·별도 소비자 그룹·별도 역할을 만들지
   * 않는다 — 입력이 같은 PostgreSQL 정본이고, 나누면 JOB-REL-006이 두 틀을
   * 각각 돌아야 한다. 여기 붙였으므로 **재파생이 저절로 네 계열을 덮는다**
   * (DEV-234): `runReferenceRebuild`가 이 함수를 부른다.
   */
  const { outcome: relations, reevaluated } = await withReindexWrite(deps.pool, (targets) =>
    handleRelationsReady(deps, repository, source, targets),
  );
  return { derived, resolved, relations, reevaluated };
}

export async function handleLinkEvent(
  deps: LinkDeps,
  delivered: DeliveredEvent,
): Promise<HandlerDisposition> {
  const log = deps.log ?? ((): void => undefined);
  const name = delivered.event_name;

  let repositoryId: number | null = null;
  let source: LinkSource | null = null;

  if (name === EVENT_NAMES.ingestionProjected) {
    const event = delivered.payload as unknown as IngestionProjected | null;
    if (event === null) return { kind: 'ack' };
    repositoryId = Number(event.repository_id);
    source = sourceFromEntity(event.entity_kind, event.entity_id);
  } else if (name === EVENT_NAMES.commitMetadataReady) {
    const event = delivered.payload as unknown as CommitMetadataReady | null;
    if (event === null) return { kind: 'ack' };
    repositoryId = Number(event.repository_id);
    source = { kind: 'commit', id: event.commit_sha.toLowerCase() };
  } else {
    /*
     * 시퀀스 이벤트도 이 토픽으로 온다. 관계 파생의 방아쇠가 아니다 —
     * 채번은 문서 본문을 바꾸지 않는다.
     */
    return { kind: 'ack' };
  }

  if (source === null || repositoryId === null || !Number.isFinite(repositoryId)) return { kind: 'ack' };

  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  // 등록되지 않은 저장소의 간선은 애초에 만들지 않는다 (FR-ING-009 AC-4).
  if (repository === undefined) return { kind: 'ack' };

  try {
    const outcome = await handleSourceReady(deps, repository, source);
    log({
      level: 'info',
      message: '참조 간선 파생',
      job: LINK_DERIVE_JOB,
      repository_id: repositoryId,
      correlation_id: delivered.correlation_id,
      from: `${source.kind}:${source.id}`,
      references: outcome.derived.references,
      removed: outcome.derived.removed,
      resolved: outcome.resolved,
      complete: outcome.derived.complete,
      reverts: outcome.relations.reverts,
      cherry_picks: outcome.relations.cherryPicks,
      stacks: outcome.relations.stacks,
      detached: outcome.relations.detached,
      relations_complete: outcome.relations.complete,
      reevaluated: outcome.reevaluated,
    });
    return { kind: 'ack' };
  } catch (error) {
    /*
     * **예산은 핸들러가 집행한다** (CR-039, DEV-228).
     *
     * 어댑터는 `retry`를 받으면 백오프만 늘리고 횟수 상한을 보지 않는다. 여기서
     * 세지 않으면 영구 실패가 무한 재시도되며 **그 파티션의 뒤 이벤트를 영영
     * 막는다.** 소진하면 종료 처분으로 바꿔 파티션을 푼다 — 재파생(JOB-REL-006)이
     * 남은 경로다.
     */
    const exhausted = delivered.delivery_count >= MAX_RETRIES;
    log({
      level: exhausted ? 'error' : 'warn',
      message: exhausted ? '참조 간선 파생 실패 — 재시도 예산 소진' : '참조 간선 파생 실패 — 재시도',
      job: LINK_DERIVE_JOB,
      repository_id: repositoryId,
      correlation_id: delivered.correlation_id,
      delivery_count: delivered.delivery_count,
      reason: String(error).slice(0, 200),
    });
    return exhausted
      ? { kind: 'dead_letter', reason: 'link_derivation_failed' }
      : { kind: 'retry', reason: 'link_derivation_failed' };
  }
}

/**
 * `prs:projected`를 **기본 그룹 `link`** 로 구독한다.
 *
 * 이름을 바꾸지 않는다 — 기존 소비자의 group을 바꾸면 Redis에서 읽던 자리를 잃는다
 * (CR-038, DEV-205). 커밋 보강은 `link:commit-enrich`라는 다른 group을 쓰므로
 * 두 소비자가 같은 이벤트를 각각 전부 받는다.
 */
export async function startLinkWorker(
  deps: LinkDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  return deps.bus.subscribe(
    TOPICS.projected,
    consumerGroup(TOPICS.projected),
    (delivered) => handleLinkEvent(deps, delivered),
    options,
  );
}

/* ------------------------------------------------------------------------- */
/* JOB-REL-006 전량 재파생                                                     */
/* ------------------------------------------------------------------------- */

/** 재개 커서. 잡 행에 그대로 남는다. */
export interface RebuildCursor {
  readonly phase: 'pull_request' | 'commit';
  /** 마지막으로 처리한 PR 번호. */
  readonly pr: number;
  /** 마지막으로 처리한 커밋 SHA. */
  readonly sha: string;
}

const START: RebuildCursor = { phase: 'pull_request', pr: 0, sha: '' };

function parseCursor(raw: Record<string, unknown> | null): RebuildCursor {
  if (raw === null) return START;
  return {
    phase: raw['phase'] === 'commit' ? 'commit' : 'pull_request',
    pr: typeof raw['pr'] === 'number' ? raw['pr'] : 0,
    sha: typeof raw['sha'] === 'string' ? raw['sha'] : '',
  };
}

export interface RebuildResult {
  readonly processed: number;
  readonly cursor: RebuildCursor;
  readonly done: boolean;
  /**
   * 참조 파생이 완결되지 않은 source (CR-121). 커서는 넘어가지만 이 source들은 끝난 것이 아니다 —
   * 재색인은 이것을 미처리로 남기고 전환 전에 다시 파생한다. 없는 source(`absent`)는 넣지 않는다.
   */
  readonly incomplete: readonly LinkSource[];
}

/**
 * 정본에서 참조 간선을 다시 만든다 (JOB-REL-006 / DEV-221).
 *
 * ## 왜 이벤트 backlog로는 안 되는가
 *
 * 새 consumer group은 Redis stream을 `0`부터 읽을 수 있다. 그러나 **stream
 * retention은 정본이 아니고**, WP-029 이전의 직접 푸시 커밋에는 애초에
 * `EVT-ING-003`이 없었다. 배포 뒤 "새 이벤트부터만 관계가 생긴다"가 운영 구멍으로
 * 남는다 — CR-037이 DEV-194에서 PR 스냅숏 축에 대해 이미 겪은 자리다.
 *
 * ## 같은 파생 핸들러를 쓴다
 *
 * 두 번째 추출 알고리즘을 만들지 않는다. 다른 경로로 만들면 재구축의 근거와
 * 실제 색인 내용이 갈라지고, 그 순간 이 잡은 불변식을 지키는 대신 지키는 척한다.
 *
 * **경계가 있고 재개 가능하다.** 한 번에 `REBUILD_BATCH`만 처리하고 커서를 남긴다.
 */
export async function runReferenceRebuild(
  deps: LinkDeps,
  repository: RepositoryRow,
  cursor: RebuildCursor = START,
  batch: number = REBUILD_BATCH,
): Promise<RebuildResult> {
  const repositoryId = Number(repository.repository_id);
  let processed = 0;
  let current = cursor;
  const incomplete: LinkSource[] = [];
  const track = async (source: LinkSource): Promise<void> => {
    const outcome = await handleSourceReady(deps, repository, source);
    if (!outcome.derived.complete && outcome.derived.absent !== true) incomplete.push(source);
  };

  if (current.phase === 'pull_request') {
    const rows = await prSnapshotRepo.listSnapshotsAfter(deps.pool, repositoryId, current.pr, batch);
    for (const row of rows) {
      await track({ kind: 'pull_request', id: String(row.pr_number) });
      processed += 1;
      current = { ...current, pr: row.pr_number };
    }
    if (rows.length < batch) current = { phase: 'commit', pr: current.pr, sha: '' };
    return { processed, cursor: current, done: false, incomplete };
  }

  const rows = await commitSnapshotRepo.listCommitSnapshotsAfter(
    deps.pool,
    repositoryId,
    current.sha,
    batch,
  );
  for (const row of rows) {
    await track({ kind: 'commit', id: row.commit_sha });
    processed += 1;
    current = { ...current, sha: row.commit_sha };
  }
  return { processed, cursor: current, done: rows.length < batch, incomplete };
}

/**
 * 재색인의 간선 재구축 포트 (DEV-295 · CR-121).
 *
 * **운영(`index.ts`)과 시험이 이 함수 하나를 쓴다.** 전에는 `index.ts`의 객체 리터럴이었고, 시험은
 * 그것을 옮겨 적어 부를 수밖에 없었다 — 운영 배선이 바뀌어도 시험은 옛 사본을 재고 있었을 것이다.
 *
 * - `rebuildRepository` — JOB-REL-006과 같은 경로로 저장소 하나를 끝까지 돈다. 불완전한 source를 돌려준다.
 * - `rederiveSource` — 미처리 회수. **그 source 자신의 간선만** 정본에서 다시 파생한다(참조·관계).
 *   역방향 해결·재평가는 하지 않는다 — 그것이 새 부분 갱신을 만들고, 회수가 회수를 부르게 된다.
 * - `planSource` — 전환 전 검증. 그 source가 만들어야 하는 간선 문서를 **쓰기 없이** 계산한다.
 */
export function createLinkRebuildPort(deps: LinkDeps): LinkRebuildPort {
  return {
    async rebuildRepository(repository) {
      let cursor: RebuildCursor | undefined;
      let processed = 0;
      const incomplete: LinkSource[] = [];
      for (;;) {
        const result = await runReferenceRebuild(deps, repository, cursor);
        processed += result.processed;
        incomplete.push(...result.incomplete);
        cursor = result.cursor;
        if (result.done) break;
      }
      return { processed, incomplete };
    },
    async rederiveSource(repository, source) {
      const derived = await deriveReferenceLinks(deps, repository, source);
      if (derived.absent === true) return 'absent';
      const relations = await withReindexWrite(deps.pool, (targets) => deriveRelations(deps, repository, source, targets));
      return derived.complete && relations.complete ? 'complete' : 'incomplete';
    },
    async planSource(repository, source): Promise<PlannedLinks> {
      const references = await planReferenceLinks(deps, repository, source);
      if (references.kind === 'absent') return { kind: 'absent' };
      if (references.kind === 'extract_failed') return { kind: 'unplannable', reason: references.reason };
      const relations = await planRelationEdges(deps, repository, source);
      // 참조 계획이 정본을 읽은 뒤 사라졌다 — 이 순간의 기대를 말할 수 없다.
      if (relations === undefined) return { kind: 'unplannable', reason: 'source_vanished_during_plan' };
      return {
        kind: 'planned',
        edges: [...references.docs.map(referenceLinkSource), ...relations.map(derivedLinkSource)],
      };
    },
  };
}

export interface RebuildRunner {
  stop(): Promise<void>;
}

/** 폴링 간격. 큐가 비었을 때만 기다린다. */
export const REBUILD_POLL_MS = 5_000;

/**
 * `link_rebuild` 잡을 집어 재파생을 돌린다.
 *
 * `claimNextJob`을 재사용한다 — 새 큐 틀을 만들지 않는다. 영구 `queued`를
 * 허용하지 않는 것이 러너의 존재 이유다 (CR-034, DEV-178).
 */
export function startReferenceRebuildRunner(deps: LinkDeps): RebuildRunner {
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;
  let wake: (() => void) | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      let worked = false;
      try {
        const job = await jobRepo.claimNextJob(deps.pool, LINK_REBUILD_TYPE);
        if (job !== undefined) {
          worked = true;
          await runJob(deps, job.job_id, log);
        }
      } catch (error) {
        log({ level: 'error', message: '재파생 러너 오류', job: LINK_REBUILD_JOB, reason: String(error).slice(0, 200) });
      }
      if (!worked && !stopped) await sleep(REBUILD_POLL_MS);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}

async function runJob(deps: LinkDeps, jobId: number, log: (fields: LinkLogFields) => void): Promise<void> {
  const row = await jobRepo.findJobById(deps.pool, jobId);
  if (row === undefined) return;

  /*
   * `target`은 다른 잡과 같은 **`owner/repo`**다 (PR #44 리뷰 P1).
   *
   * 여기만 `repository_id`를 쓰면 API-ADM-002가 만든 행을 러너가 해석하지
   * 못한다 — 운영자가 만들 수 있는 유일한 경로가 그 형식이다.
   */
  const slash = row.target.indexOf('/');
  const repository =
    slash < 0
      ? undefined
      : await repositoryRepo.findRepositoryBySlug(
          deps.pool,
          row.target.slice(0, slash),
          row.target.slice(slash + 1),
        );
  if (repository === undefined) {
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', 'repository_not_found');
    return;
  }
  const repositoryId = Number(repository.repository_id);

  let cursor = parseCursor(row.cursor);
  let total = 0;
  try {
    for (;;) {
      // 운영자가 멈췄으면 커서를 남긴 채 물러난다 (CR-037, DEV-196의 규율).
      const state = await jobRepo.findJobState(deps.pool, jobId);
      if (state !== 'running') return;

      const result = await runReferenceRebuild(deps, repository, cursor);
      cursor = result.cursor;
      total += result.processed;
      await jobRepo.updateJobProgress(
        deps.pool,
        jobId,
        { done: total, total: null, unit: 'documents' },
        { ...cursor },
      );
      if (result.done) break;
    }
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'completed', null);
    log({
      level: 'info',
      message: '참조 간선 전량 재파생 완료',
      job: LINK_REBUILD_JOB,
      repository_id: repositoryId,
      processed: total,
    });
  } catch (error) {
    await jobRepo.finishJobIfRunning(deps.pool, jobId, 'failed', String(error).slice(0, 200));
    log({
      level: 'error',
      message: '참조 간선 전량 재파생 실패 — 커서가 남는다',
      job: LINK_REBUILD_JOB,
      repository_id: repositoryId,
      processed: total,
      reason: String(error).slice(0, 200),
    });
  }
}
