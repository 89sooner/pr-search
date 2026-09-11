/**
 * API-SEQ-007 M 번호 해석 (WP-074 / FR-SEQ-008 AC-12, CR-077 · CR-079, DEV-580).
 *
 * ## 검사 순서가 계약이다
 *
 * 세션 → 구조·숫자 → 저장소 접근 범위 → 코드 대조 → 브랜치·PR 확인 → **같은 read
 * snapshot의** 에폭 대조 → 값 조회. 권한 밖 저장소의 실제 코드를 비교한 오류를 먼저
 * 내지 않는다 — 그 순서가 뒤집히면 400의 존재 여부로 비공개 저장소를 탐지할 수 있다.
 *
 * ## 에폭이 다르면 계산하지 않는다
 *
 * 결과 키 자체를 넣지 않는다 (`API-SEQ-001`의 DEV-138과 같은 규율). 빈 결과로
 * 위장하지 않고 현재 에폭으로 자동 이동하지도 않는다 (ADR-007 규칙 5).
 *
 * ## 잠정 번호를 지어내지 않는다
 *
 * 아직 채번되지 않은 PR은 `pending`이고 `merge_number`는 `null`이다. M 방향으로는
 * 그 상태에 도달할 수 없다 — 발급되지 않은 번호는 질의할 값 자체가 없으므로 404다.
 */

import { parseMergeNumber, repositoryCodeOf } from '@prs/domain';
import { mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, withReadSnapshot, type Pool, type PoolClient, type RepositoryRow } from '@prs/db';
import { isRepositoryInScope, type AccessScope } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { readMergeNumberProjection } from '@prs/es';
import { mergeNumberFieldsOf, type MergeNumberFields } from './merge-number-view.js';
import { parseRepositorySlug, readEpochParam, type RepositorySlug } from './space.js';

export const MERGE_NUMBER_RESOLVE_PATH = '/api/v1/merge-numbers/resolve';

/** PR 번호의 상한. `pr_number`·`seq_epoch` 둘 다 int4다. */
const INT4_MAX = 2_147_483_647;

export type ResolveOutcome =
  | {
      readonly kind: 'ok';
      readonly body: Record<string, unknown>;
    }
  | { readonly kind: 'invalid'; readonly field: string; readonly message: string; readonly reason?: string }
  | { readonly kind: 'not_found'; readonly message: string }
  | { readonly kind: 'no_sequence'; readonly reason: string; readonly message: string }
  | { readonly kind: 'feature_disabled' };

export interface ResolveDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly enabled: boolean;
}

export interface ResolveRequest {
  readonly repository: unknown;
  readonly baseBranch: unknown;
  readonly prNumber: unknown;
  readonly mergeNumber: unknown;
  readonly seqEpoch: unknown;
  readonly scope: AccessScope;
}

/**
 * 중복 query key(배열)·빈 값을 받지 않는다. 단일 문자열만 값이다.
 *
 * 앞뒤 공백은 여기서 다듬는다 — 저장소 슬러그와 브랜치 이름에는 공백이 들어갈 수
 * 없으므로 무해하다. **숫자와 M 문자열은 다듬지 않는다** (`exactString` 참조).
 */
function singleString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * **다듬지 않은** 단일 문자열. 숫자·M 문자열 검사가 이것을 쓴다.
 *
 * 계약이 공백을 400으로 정했다 (API-SEQ-007의 배포 전 정정). `' 21'`을 `21`로
 * 다듬으면 형식이 틀린 인용이 조용히 통과하고, 그 URL이 그대로 공유된다.
 */
function exactString(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/** 1..max의 십진 정수. `parseInt` 접두 허용·지수·소수·부호·공백은 전부 거부한다. */
function decimalInt(raw: unknown, max: number): number | null {
  const text = exactString(raw);
  if (text === null || !/^[0-9]+$/.test(text)) return null;
  if (text.length > 19) return null;
  const value = BigInt(text);
  if (value < 1n || value > BigInt(max)) return null;
  return Number(value);
}

function notFound(): ResolveOutcome {
  // 미등록과 권한 밖과 없는 대상이 **같은 메시지**여야 존재가 새지 않는다 (ADR-008, THR-006).
  return { kind: 'not_found', message: '대상을 찾을 수 없습니다.' };
}

/**
 * M 번호 ↔ PR 양방향 해석.
 *
 * `es`는 색인 반영 상태를 읽는 데만 쓴다. 그 조회가 실패해도 번호 조회는 성공이며
 * 상태만 `unknown`이 된다.
 */
export async function resolveMergeNumber(deps: ResolveDeps, request: ResolveRequest): Promise<ResolveOutcome> {
  if (!deps.enabled) return { kind: 'feature_disabled' };

  // ---- 1. 구조와 숫자. 저장소를 읽기 전에 끝낸다.
  const slug: RepositorySlug | null = parseRepositorySlug(request.repository);
  if (slug === null) {
    return { kind: 'invalid', field: 'repository', message: 'repository는 owner/name 형식이어야 합니다.' };
  }
  const baseBranch = singleString(request.baseBranch);
  if (baseBranch === null) {
    return { kind: 'invalid', field: 'base_branch', message: 'base_branch가 필요합니다 — 서버가 시퀀스 공간을 고르지 않습니다.' };
  }

  const hasPr = request.prNumber !== undefined && request.prNumber !== null;
  const hasMerge = request.mergeNumber !== undefined && request.mergeNumber !== null;
  if (hasPr === hasMerge) {
    return {
      kind: 'invalid',
      field: hasPr ? 'pr_number' : 'merge_number',
      message: 'pr_number 또는 merge_number 중 정확히 하나가 필요합니다.',
    };
  }

  let prNumber: number | null = null;
  let mergeNumberCode: string | null = null;
  let mergeNumberValue: number | null = null;
  if (hasPr) {
    prNumber = decimalInt(request.prNumber, INT4_MAX);
    if (prNumber === null) {
      return { kind: 'invalid', field: 'pr_number', message: `pr_number는 1..${String(INT4_MAX)}의 정수여야 합니다.` };
    }
  } else {
    const text = exactString(request.mergeNumber);
    const parsed = text === null ? null : parseMergeNumber(text);
    if (parsed === null) {
      return { kind: 'invalid', field: 'merge_number', message: 'merge_number는 M-<저장소 코드>-<번호> 형식이어야 합니다.' };
    }
    mergeNumberCode = parsed.code;
    mergeNumberValue = parsed.number;
  }

  const epochParam = readEpochParam(request.seqEpoch);
  if (epochParam.kind === 'invalid') {
    return { kind: 'invalid', field: 'seq_epoch', message: 'seq_epoch는 1 이상의 정수여야 합니다.' };
  }
  if (hasMerge && epochParam.kind === 'absent') {
    /*
     * **M 방향은 에폭이 필수다** (AC-12). 생략값을 현재로 자동 보완하면 옛 인용이
     * 조용히 새 세대의 답을 받는다 — ADR-007이 막으려는 바로 그 재해석이다.
     */
    return { kind: 'invalid', field: 'seq_epoch', message: 'merge_number로 조회할 때 seq_epoch는 필수입니다.' };
  }
  const requestedEpoch = epochParam.kind === 'value' ? epochParam.epoch : null;

  /*
   * ---- 여기부터 정본 조회는 **한 스냅숏 안에서** 돈다 (설계 9절 / API-SEQ-007, DEV-592).
   *
   * `Pool`에 문장을 따로 보내면 각자 다른 커넥션의 다른 시점을 본다. 그 사이에
   * 재채번이 커밋하면 공간은 옛 에폭을, 행은 새 에폭을 말해 **한 응답이 두 세대를
   * 섞는다** — `epoch_stale: false`라고 적으면서 다른 세대의 `merge_seq`를 싣게 된다.
   * ES 조회는 이 스냅숏 밖이다. 색인은 정본이 아니고 실패해도 답을 되돌리지 않는다.
   */
  const read = await withReadSnapshot(deps.pool, (db) =>
    resolveInSnapshot(deps, request, db, {
      slug,
      baseBranch,
      hasMerge,
      mergeNumberCode,
      mergeNumberValue,
      prNumber,
      requestedEpoch,
    }),
  );
  return read.kind === 'canonical' ? withProjection(deps, request, read) : read;
}

/** 스냅숏이 정본에서 읽어 온 것. 여기까지가 일관된 한 시점이다. */
interface CanonicalRead {
  readonly kind: 'canonical';
  readonly repository: RepositoryRow;
  readonly baseBranch: string;
  readonly sequenceSpace: string;
  readonly space: { readonly seq_epoch: number; readonly state: string };
  readonly prNumber: number;
  readonly canonical: Awaited<ReturnType<typeof mergeSequenceRepo.lookupMergeNumbers>>;
  readonly canonicalRow: Awaited<ReturnType<typeof mergeSequenceRepo.lookupMergeNumbers>>['rows'][number];
}

/** 1단계가 이미 판정한 입력. 스냅숏 안의 2~6단계는 이것만 본다. */
interface SnapshotInput {
  readonly slug: { readonly owner: string; readonly name: string };
  readonly baseBranch: string;
  readonly hasMerge: boolean;
  readonly mergeNumberCode: string | null;
  readonly mergeNumberValue: number | null;
  readonly prNumber: number | null;
  readonly requestedEpoch: number | null;
}

/** 한 스냅숏 안에서 도는 2~6단계. */
async function resolveInSnapshot(
  deps: ResolveDeps,
  request: ResolveRequest,
  db: PoolClient,
  input: SnapshotInput,
): Promise<ResolveOutcome | CanonicalRead> {
  const { slug, baseBranch, hasMerge, mergeNumberCode, mergeNumberValue, requestedEpoch } = input;
  let prNumber = input.prNumber;
  // ---- 2. 저장소와 접근 범위. 여기를 지나야 저장소의 실재를 말할 수 있다.
  const repository: RepositoryRow | undefined = await repositoryRepo.findRepositoryBySlug(db, slug.owner, slug.name);
  if (repository === undefined) return notFound();
  const visible = isRepositoryInScope(
    {
      repositoryId: repository.repository_id,
      orgId: repository.org_id,
      visibility: repository.visibility,
      allowedTeamIds: repository.allowed_team_ids,
    },
    request.scope,
  );
  if (!visible) return notFound();

  // ---- 3. 코드 대조. **접근 범위를 지난 뒤**여야 실제 코드가 새지 않는다.
  const code = repositoryCodeOf(repository.name);
  if (hasMerge) {
    if (code.kind !== 'code') {
      return {
        kind: 'invalid',
        field: 'merge_number',
        message: '이 저장소의 이름에서 코드를 정할 수 없습니다.',
        reason: 'repository_code_unavailable',
      };
    }
    if (code.code !== mergeNumberCode) {
      return {
        kind: 'invalid',
        field: 'merge_number',
        message: '저장소 코드가 일치하지 않습니다.',
        reason: 'repository_code_mismatch',
      };
    }
  }

  // ---- 4. 브랜치가 채번 대상인가.
  if (!repository.sequence_branches.includes(baseBranch)) {
    return { kind: 'no_sequence', reason: 'branch_not_tracked', message: '채번 대상이 아닌 브랜치입니다.' };
  }

  const space = await sequenceSpaceRepo.findSequenceSpace(db, repository.repository_id, baseBranch);
  if (space === undefined) {
    return { kind: 'no_sequence', reason: 'not_sequenced', message: '시퀀스 채번을 기다리고 있습니다.' };
  }
  const sequenceSpace = `${slug.owner}/${slug.name}@${baseBranch}`;

  // ---- 5. 에폭 대조. 다르면 **계산하지 않는다**.
  if (requestedEpoch !== null && requestedEpoch !== space.seq_epoch) {
    return {
      kind: 'ok',
      body: {
        sequence_space: sequenceSpace,
        seq_epoch: space.seq_epoch,
        epoch_stale: true,
        requested_seq_epoch: requestedEpoch,
      },
    };
  }

  // ---- 6. 값 조회.
  if (hasMerge) {
    const row = await mergeSequenceRepo.findRowByMergeNumber(
      db,
      repository.repository_id,
      baseBranch,
      space.seq_epoch,
      mergeNumberValue as number,
    );
    // 발급되지 않은 번호는 질의할 값이 없다 — `pending`이 아니라 404다.
    if (row === null || row.pull_request_number === null) return notFound();
    prNumber = row.pull_request_number;
  } else {
    /*
     * 이 공간에 그 PR의 머지 커밋이 있는가. 없으면 미머지·다른 브랜치·미채번 셋을
     * 가르지 않는다 — 정본만으로는 구분되지 않고, 구분하는 척하면 없는 사실을
     * 주장하게 된다 (`API-SEQ-001`이 `not_sequenced` 하나로 답하는 것과 같다).
     */
    const point = await mergeSequenceRepo.findPointByPullRequest(
      db,
      repository.repository_id,
      baseBranch,
      space.seq_epoch,
      prNumber as number,
    );
    if (point === null) {
      return { kind: 'no_sequence', reason: 'not_sequenced', message: '시퀀스 채번을 기다리고 있습니다.' };
    }
  }

  const canonical = await mergeSequenceRepo.lookupMergeNumbers(db, [
    { repositoryId: repository.repository_id, baseBranch, prNumber: prNumber as number },
  ]);
  const canonicalRow = canonical.rows[0];
  if (canonicalRow === undefined) {
    return { kind: 'no_sequence', reason: 'not_sequenced', message: '시퀀스 채번을 기다리고 있습니다.' };
  }

  /*
   * **스냅숏은 여기서 끝난다.** 정본을 다 읽었으므로 커넥션을 붙잡을 이유가 없다 —
   * 뒤의 ES 조회는 네트워크 시간만큼 걸리고, 그 동안 읽기 커넥션 하나가 풀에서
   * 빠져 있으면 부하가 몰릴 때 그것이 병목이 된다. 미러 락이 fetch 동안 시퀀스
   * 트랜잭션을 열지 않는 것과 같은 규율이다.
   */
  return {
    kind: 'canonical',
    repository,
    baseBranch,
    sequenceSpace,
    space,
    prNumber: prNumber as number,
    canonical,
    canonicalRow,
  };
}

/** 스냅숏 밖에서 색인 상태를 덧대고 응답을 만든다. */
async function withProjection(deps: ResolveDeps, request: ResolveRequest, read: CanonicalRead): Promise<ResolveOutcome> {
  /*
   * 색인 반영 상태. **번호 조회의 성공을 실패시키지 않는다** — ES를 읽지 못하면
   * `unknown`이다. 실시간 GET이 아니라 실제 검색 hit를 읽는다 (상세 설계 7절).
   */
  let indexed: { readonly mergeNumber: number | null; readonly epoch: number | null } | undefined;
  if (read.canonicalRow.merge_number !== null) {
    try {
      const projection = await readMergeNumberProjection(deps.es, request.scope, read.repository.repository_id, read.prNumber);
      if (projection !== null) indexed = { mergeNumber: projection.merge_number, epoch: projection.merge_number_epoch };
    } catch {
      indexed = undefined;
    }
  }

  const fields: MergeNumberFields = mergeNumberFieldsOf(
    {
      repositoryId: read.repository.repository_id,
      baseBranch: read.baseBranch,
      prNumber: read.prNumber,
      repositoryName: read.repository.name,
      // 정본에 행이 있다는 것은 그 PR의 머지 커밋이 체인에 있다는 뜻이다 (미머지가 아니다).
      state: 'merged',
      ...(indexed === undefined ? {} : { indexed }),
    },
    { canonical: read.canonical, trackedBranches: read.canonical.tracked },
  );

  return {
    kind: 'ok',
    body: {
      sequence_space: read.sequenceSpace,
      seq_epoch: read.space.seq_epoch,
      sequence_state: read.space.state,
      epoch_stale: false,
      pr_number: read.prNumber,
      merge_seq: read.canonicalRow.merge_seq,
      ...fields,
    },
  };
}
