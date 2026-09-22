/**
 * 식별자 해석 (API-SRCH-001 / FR-SRCH-001, FR-SRCH-002, FR-SRCH-004).
 *
 * 판별은 `@prs/query`가 하고 여기서는 **조회만** 한다. 판별기가 우선순위 있는
 * 해석 목록을 주므로(CR-017, DEV-066) 이 파일이 하는 일은 그 목록을 순서대로
 * 조회해 후보를 모으는 것이다.
 *
 * 지켜야 할 것 셋:
 *
 * 1. **모든 조회가 강제 접근 범위 필터를 지난다** (ADR-008). 후보 하나가 범위
 *    밖 저장소의 것이면 결과에서 빠져야 한다 (FR-SRCH-001 AC-6).
 * 2. **자동 이동을 결정하지 않는다** (AC-5). 후보가 2건 이상이면 그대로 배열로
 *    낸다. "1건이니 바로 이동"은 화면의 판단이고, 이 API는 몇 건인지만 말한다.
 * 3. **후보 0건은 오류가 아니다.** HTTP 200에 빈 배열과 사유 코드를 싣는다
 *    (FR-SRCH-001 예외 처리). 404로 만들면 "없다"와 "못 본다"가 섞인다.
 */

import {
  MAX_PREFIX_CANDIDATES,
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  commitExactQuery,
  commitPrefixQuery,
  isRepositoryInScope,
  pullRequestDetailQuery,
  pullRequestQuery,
  search,
  shaFallbackQuery,
  type AccessScope,
} from '@prs/es';
import { repositoryCodeOf } from '@prs/domain';
import { mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, withReadSnapshot, type Pool } from '@prs/db';
import type { Identifier, IdentifierDetection, IdentifierKind } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';

/** 후보 상한의 기본값. 요청의 `limit`이 이보다 크면 이쪽이 이긴다. */
export const DEFAULT_RESOLVE_LIMIT = 10;
export const MAX_RESOLVE_LIMIT = MAX_PREFIX_CANDIDATES;

const COMMIT_ALIAS = 'prs-commits' as const;
const PR_ALIAS = 'prs-pull-requests' as const;

export function clampLimit(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_RESOLVE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RESOLVE_LIMIT;
  return Math.min(parsed, MAX_RESOLVE_LIMIT);
}

/** 응답의 후보 하나. 유형에 따라 채워지는 키가 다르다. */
export interface ResolveCandidate {
  readonly kind: 'commit' | 'pull_request';
  readonly repository: string | null;
  readonly repository_id: number | null;
  readonly display_name: string | null;
  readonly url: string | null;
  readonly commit_sha?: string;
  readonly short_sha?: string;
  readonly role?: string;
  readonly pull_request_numbers?: readonly number[];
  readonly pr_number?: number;
  readonly state?: string;
  readonly author?: string;
  readonly merged_at?: string;
  /** 시퀀스는 WP-021까지 비어 있다. 키를 두고 `null`로 "아직 없다"를 말한다. */
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
  /**
   * M 번호로 찾은 PR 후보에만 실린다 (CR-114 / FR-SRCH-001 AC-7).
   *
   * **정본 값이다** — 색인의 `merge_number`가 아니라 `merge_sequence`의 현재 에폭
   * 행이며, 그래서 이 후보의 `merge_seq`·`seq_epoch`·`sequence_space`도 정본에서
   * 온다. 세 키는 함께 있거나 함께 없다. 표기 문자열은 현재 저장소 이름으로 만든다(OD-009).
   */
  readonly merge_number?: string;
  readonly merge_number_epoch?: number;
  readonly merge_number_state?: 'assigned';
}

/**
 * 후보 0건의 사유. `merge_number_disabled`는 M 번호 문자열을 넣었는데 이 배포의
 * M 번호 기능이 꺼져 있을 때다 (CR-114) — "없다"와 "이 배포는 그 조회를 하지
 * 않는다"를 한 코드로 묶으면 운영자가 왜 안 되는지 알 수 없다.
 */
export type ResolveReasonCode = 'not_found' | 'merge_number_disabled';

export interface ResolveResult {
  readonly input: string;
  readonly detected_kind: IdentifierKind;
  readonly candidates: readonly ResolveCandidate[];
  readonly truncated: boolean;
  readonly reason_code: ResolveReasonCode | null;
}

export interface ResolveDeps {
  readonly es: Client;
  readonly timeoutMs?: number;
  /**
   * M 번호 정본 (CR-114 / FR-SRCH-001 AC-7). 없거나 꺼져 있으면 M 번호 문자열은
   * 후보 0건과 `merge_number_disabled`로 답한다 — 잠정값도 색인 값도 쓰지 않는다.
   */
  readonly mergeNumbers?: { readonly pool: Pool; readonly enabled: boolean };
}

export interface ResolveRequest {
  readonly detection: IdentifierDetection;
  readonly scope: AccessScope;
  readonly repositoryHint: string | null;
  readonly limit: number;
}

/** 검색 문서에서 우리가 읽는 필드. 없을 수 있는 것은 전부 optional이다. */
interface ResolveHitSource {
  readonly repository?: string;
  readonly repository_id?: number;
  readonly commit_sha?: string;
  readonly role?: string;
  readonly pull_request_numbers?: readonly number[];
  readonly pr_number?: number;
  readonly title?: string;
  readonly state?: string;
  readonly author?: string;
  readonly merged_at?: string;
  readonly merge_seq?: number;
  readonly seq_epoch?: number;
  readonly sequence_space?: string;
}

const SHORT_SHA_LENGTH = 12;

/**
 * 시퀀스 3종을 붙인다.
 *
 * **키를 두고 `null`이다.** 채번 경로(WP-021)가 아직 없다는 뜻이며, 커밋
 * 메타데이터처럼 "만들지 않은"(키 없음) 것과 구분된다 — CR-016 DEV-057의 규칙.
 */
function sequenceOf(source: ResolveHitSource): Pick<
  ResolveCandidate,
  'merge_seq' | 'seq_epoch' | 'sequence_space'
> {
  return {
    merge_seq: source.merge_seq ?? null,
    seq_epoch: source.seq_epoch ?? null,
    sequence_space: source.sequence_space ?? null,
  };
}

function commitCandidate(source: ResolveHitSource): ResolveCandidate {
  const sha = source.commit_sha ?? '';
  const repository = source.repository ?? null;
  return {
    kind: 'commit',
    repository,
    repository_id: source.repository_id ?? null,
    /*
     * 커밋 메시지가 없으므로 표시명은 SHA 축약이다 (CR-017, DEV-060).
     *
     * 투영이 `message`를 채우지 않는다 — `EVT-ING-002`가 커밋에 대해 SHA만
     * 나른다. 여기서 PR 제목을 빌려 오지 않는 이유는 커밋 하나가 여러 PR에
     * 속할 수 있어(N:M) 어느 제목인지 정할 수 없기 때문이다. WP-020이
     * 커밋을 보강하면 그때 진짜 제목이 붙는다.
     */
    display_name: sha === '' ? null : sha.slice(0, SHORT_SHA_LENGTH),
    url: repository === null || sha === '' ? null : `/commit/${repository}/${sha}`,
    ...(sha === '' ? {} : { commit_sha: sha, short_sha: sha.slice(0, SHORT_SHA_LENGTH) }),
    ...(source.role === undefined ? {} : { role: source.role }),
    ...(source.pull_request_numbers === undefined
      ? {}
      : { pull_request_numbers: [...source.pull_request_numbers] }),
    ...sequenceOf(source),
  };
}

function pullRequestCandidate(source: ResolveHitSource): ResolveCandidate {
  const repository = source.repository ?? null;
  const number = source.pr_number;
  return {
    kind: 'pull_request',
    repository,
    repository_id: source.repository_id ?? null,
    display_name: source.title ?? null,
    url: repository === null || number === undefined ? null : `/pr/${repository}/${String(number)}`,
    ...(number === undefined ? {} : { pr_number: number }),
    ...(source.state === undefined ? {} : { state: source.state }),
    ...(source.author === undefined ? {} : { author: source.author }),
    ...(source.merged_at === undefined ? {} : { merged_at: source.merged_at }),
    ...sequenceOf(source),
  };
}

/** 같은 것을 두 번 싣지 않기 위한 키. 해석이 여럿이면 겹칠 수 있다. */
function candidateKey(candidate: ResolveCandidate): string {
  return candidate.kind === 'commit'
    ? `c:${candidate.repository ?? ''}:${candidate.commit_sha ?? ''}`
    : `p:${candidate.repository ?? ''}:${String(candidate.pr_number ?? '')}`;
}

interface Lookup {
  readonly alias: typeof COMMIT_ALIAS | typeof PR_ALIAS;
  readonly query: ReturnType<typeof commitExactQuery>;
  readonly toCandidate: (source: ResolveHitSource) => ResolveCandidate;
}

/**
 * 해석 하나가 만드는 조회 목록.
 *
 * 40자 hex는 조회가 둘이다 — 커밋 인덱스를 먼저 보고, 없으면 PR 문서의
 * `merge_commit_sha`·`head_sha`·`base_sha`를 본다 (백엔드 아키텍처 4.5).
 * 접두에는 폴백을 붙이지 않는다 (`shaFallbackQuery` 주석 참조).
 */
function lookupsFor(identifier: Identifier, repositoryHint: string | null): readonly Lookup[] {
  // M 번호는 색인 질의가 아니라 정본 조회다 — `lookupMergeNumberCandidates`가 맡는다 (CR-114).
  if (identifier.kind === 'text' || identifier.kind === 'merge_number') return [];

  if (identifier.kind === 'commit') {
    if (identifier.match === 'exact') {
      return [
        { alias: COMMIT_ALIAS, query: commitExactQuery(identifier.sha), toCandidate: commitCandidate },
        {
          alias: PR_ALIAS,
          query: shaFallbackQuery(identifier.sha),
          toCandidate: pullRequestCandidate,
        },
      ];
    }
    return [
      { alias: COMMIT_ALIAS, query: commitPrefixQuery(identifier.sha), toCandidate: commitCandidate },
    ];
  }

  // 요청의 `repository` 힌트가 해석이 확정한 저장소보다 약하다 — 확정이 이긴다.
  const repository = identifier.repository ?? repositoryHint;
  return [
    {
      alias: PR_ALIAS,
      query: pullRequestQuery(identifier.number, repository),
      toCandidate: pullRequestCandidate,
    },
  ];
}

/**
 * 해석 목록을 조회해 후보를 모은다.
 *
 * @throws {AccessScopeUnavailableError} 접근 범위가 비어 있으면 (기본 거부).
 * @throws {PartialSearchError} 샤드가 하나라도 실패하면.
 */
export async function runResolve(
  request: ResolveRequest,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const { detection, scope, limit } = request;

  const candidates: ResolveCandidate[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let producedBy: IdentifierKind | null = null;
  let mergeNumberDisabled = false;

  for (const identifier of detection.interpretations) {
    if (identifier.kind === 'merge_number') {
      /*
       * M 번호 문자열 (CR-114 / FR-SRCH-001 AC-7). 색인이 아니라 **정본**에서 찾는다 —
       * 색인의 `merge_number`는 투영이 늦을 수 있고(CR-113의 교훈), 표기 문자열은
       * 저장소 이름에서 만드는 파생값이라 색인에 없다. 기능이 꺼진 배포는 조회하지
       * 않고 사유만 남긴다.
       */
      if (deps.mergeNumbers === undefined || !deps.mergeNumbers.enabled) {
        mergeNumberDisabled = true;
        continue;
      }
      const found = await lookupMergeNumberCandidates(
        { pool: deps.mergeNumbers.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
        identifier,
        scope,
        limit + 1,
      );
      if (found.length > limit) truncated = true;
      for (const candidate of found.slice(0, limit)) {
        const key = candidateKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
        producedBy ??= identifier.kind;
      }
      continue;
    }

    for (const lookup of lookupsFor(identifier, request.repositoryHint)) {
      /*
       * 상한보다 하나 더 가져온다.
       *
       * "50건을 넘었다"를 알려면 51번째가 있는지 봐야 한다 (FR-SRCH-004 AC-3).
       * `hits.total`로도 알 수 있지만 그 값은 `track_total_hits` 기본 상한에
       * 걸려 근사가 될 수 있다 — 절삭 표식은 근사면 안 된다.
       */
      const response = await search<ResolveHitSource>(
        deps.es,
        lookup.alias,
        applyMandatoryScopeFilter(lookup.query, scope),
        {
          size: limit + 1,
          ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
        },
      );
      assertNoShardFailures(response);

      const hits = response.hits.hits;
      if (hits.length > limit) truncated = true;

      for (const hit of hits.slice(0, limit)) {
        if (hit._source === undefined) continue;
        const candidate = lookup.toCandidate(hit._source);
        const key = candidateKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
        producedBy ??= identifier.kind;
      }

      /*
       * 40자 hex의 폴백은 커밋을 못 찾았을 때만 돈다.
       *
       * 커밋 문서가 있으면 그것이 정답이다. PR의 `head_sha`까지 함께 실으면
       * 같은 SHA에 대해 커밋 1건과 PR 1건이 나와 화면이 "후보 2건"으로
       * 읽는다 — 자동 이동해야 할 상황을 선택 화면으로 만든다.
       */
      if (candidates.length > 0) break;
    }
  }

  return {
    input: detection.input,
    // 후보를 만들어 낸 해석의 유형. 아무것도 못 찾았으면 우선순위 1위 (DEV-066).
    detected_kind: producedBy ?? detection.interpretations[0]?.kind ?? 'text',
    candidates: candidates.slice(0, limit),
    truncated,
    reason_code: candidates.length > 0 ? null : mergeNumberDisabled ? 'merge_number_disabled' : 'not_found',
  };
}

/* ------------------------------------------------------------------ M 번호 (CR-114) */

export interface MergeNumberLookupDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly timeoutMs?: number;
}

/** 정본에서 확정한 PR 하나. 색인 문서는 표시 필드를 덧댈 뿐이다. */
interface MergeNumberSeed {
  readonly repositoryId: number;
  readonly repository: string;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly prNumber: number;
  readonly mergeSeq: number;
}

/**
 * `M-<코드>-<번호>` → PR 후보 (FR-SRCH-001 AC-7, CR-114).
 *
 * ## 순서가 통제다
 *
 * 코드로 저장소를 고른다 → **접근 범위를 지난다** → 추적 브랜치마다 현재 에폭의
 * `merge_sequence`에서 그 번호를 찾는다 → 색인 문서로 표시 필드를 덧댄다.
 * 범위 밖 저장소는 두 번째 단계에서 빠지므로 그 저장소에 그 번호가 있는지 없는지는
 * 응답 어디에도 드러나지 않는다(AC-6, THR-006).
 *
 * ## 정본은 한 스냅숏에서 읽는다
 *
 * 저장소·브랜치마다 공간과 행을 따로 읽되 **같은 REPEATABLE READ 스냅숏** 안이다
 * (`API-SEQ-007`의 DEV-592와 같은 규율) — 그 사이 재채번이 커밋하면 한 응답이 두
 * 세대의 번호를 섞는다. 색인 조회는 스냅숏 밖이다.
 *
 * ## 후보가 여럿인 것은 정상이다
 *
 * 코드는 저장소 **이름**의 숫자 부분이라(OD-009) 조직이 다른 `acme/smp1900`과
 * `tools/app1900`이 같은 코드 `1900`을 갖는다. 그때 각각의 `M-1900-1450`이 다른 PR이며
 * 둘 다 후보다 — AC-5가 정한 대로 자동 이동하지 않는다. 시퀀스 브랜치가 둘인
 * 저장소도 브랜치마다 후보가 될 수 있다.
 *
 * @param limit 이 수까지만 돌려준다. 호출부가 `limit + 1`을 넘겨 절삭을 판정한다.
 */
export async function lookupMergeNumberCandidates(
  deps: MergeNumberLookupDeps,
  identifier: Extract<Identifier, { kind: 'merge_number' }>,
  scope: AccessScope,
  limit: number,
): Promise<ResolveCandidate[]> {
  const repositories = (await repositoryRepo.listActiveRepositoriesByCode(deps.pool, identifier.code)).filter((repository) => {
    // SQL 정규식이 이미 거르지만 코드 규칙의 정본은 `repositoryCodeOf`다 — 둘이 어긋나면 이쪽이 이긴다.
    const code = repositoryCodeOf(repository.name);
    if (code.kind !== 'code' || code.code !== identifier.code) return false;
    return isRepositoryInScope(
      {
        repositoryId: repository.repository_id,
        orgId: repository.org_id,
        visibility: repository.visibility,
        allowedTeamIds: repository.allowed_team_ids,
      },
      scope,
    );
  });
  if (repositories.length === 0) return [];

  const seeds = await withReadSnapshot(deps.pool, async (db) => {
    const found: MergeNumberSeed[] = [];
    for (const repository of repositories) {
      for (const baseBranch of [...repository.sequence_branches].sort()) {
        if (found.length >= limit) return found;
        const space = await sequenceSpaceRepo.findSequenceSpace(db, repository.repository_id, baseBranch);
        if (space === undefined) continue;
        const row = await mergeSequenceRepo.findRowByMergeNumber(db, repository.repository_id, baseBranch, space.seq_epoch, identifier.number);
        // 발급되지 않은 번호는 후보가 아니다 — 잠정값을 지어내지 않는다 (FR-SEQ-008 예외 처리).
        if (row === null || row.pull_request_number === null) continue;
        found.push({
          repositoryId: repository.repository_id,
          repository: `${repository.owner}/${repository.name}`,
          baseBranch,
          seqEpoch: space.seq_epoch,
          prNumber: row.pull_request_number,
          mergeSeq: Number(row.merge_seq),
        });
      }
    }
    return found;
  });

  const candidates: ResolveCandidate[] = [];
  for (const seed of seeds) {
    /*
     * 표시 필드(제목·작성자·상태·머지 시각)는 색인 문서에서 덧댄다. 문서가 아직 없어도
     * 후보는 성립한다 — 정본이 그 PR을 확정했고 상세 URL은 정본만으로 만들 수 있다.
     * 색인 조회도 강제 범위 필터를 지난다(ADR-008) — 두 번 걸러도 뜻은 같다.
     */
    const response = await search<ResolveHitSource>(
      deps.es,
      PR_ALIAS,
      applyMandatoryScopeFilter(pullRequestDetailQuery(seed.repository, seed.prNumber), scope),
      { size: 1, ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }) },
    );
    assertNoShardFailures(response);
    const source = response.hits.hits[0]?._source;
    const base: ResolveCandidate =
      source === undefined
        ? {
            kind: 'pull_request',
            repository: seed.repository,
            repository_id: seed.repositoryId,
            display_name: null,
            url: `/pr/${seed.repository}/${String(seed.prNumber)}`,
            pr_number: seed.prNumber,
            // 정본에 현재 에폭 행이 있다는 것은 그 PR의 머지 커밋이 체인에 있다는 뜻이다.
            state: 'merged',
            merge_seq: null,
            seq_epoch: null,
            sequence_space: null,
          }
        : pullRequestCandidate(source);
    candidates.push({
      ...base,
      // 시퀀스 세 키와 M 세 키는 정본이 말한다 — 색인의 옛 값이 이기지 않는다.
      merge_seq: seed.mergeSeq,
      seq_epoch: seed.seqEpoch,
      sequence_space: `${seed.repository}@${seed.baseBranch}`,
      merge_number: identifier.label,
      merge_number_epoch: seed.seqEpoch,
      merge_number_state: 'assigned',
    });
  }
  return candidates;
}
