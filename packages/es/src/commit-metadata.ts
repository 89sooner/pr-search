/**
 * 커밋 메타데이터를 색인에 반영한다 (WP-067 / CR-038, DEV-206·209·213).
 *
 * ## 왜 기존 업서트를 쓰지 않는가
 *
 * `bulkUpsert`의 조건부 스크립트는 **`document_version`이 더 클 때만** 필드를
 * 대입한다. 그 규칙은 "같은 엔티티의 더 새로운 상태가 이긴다"를 지키기 위한
 * 것인데, 커밋 메타데이터는 **엔티티 상태가 아니라 불변 git 사실**이다:
 *
 * - 같은 SHA면 언제 읽어도 값이 같다 — 새 것과 옛 것이라는 개념이 없다
 * - 그래서 **버전을 올릴 이유가 없다.** 올리면 그 뒤 도착하는 정상 웹훅 투영이
 *   "오래된 이벤트"로 밀려난다 (DEV-209)
 * - 그런데 기존 스크립트로는 버전을 올리지 않으면 **아무것도 대입되지 않는다**
 *
 * 그래서 메타데이터 전용 경로를 둔다: 버전과 무관하게 대입하고, 버전은 건드리지
 * 않는다.
 *
 * ## 없는 문서는 만든다 (DEV-206)
 *
 * 직접 푸시 커밋은 PR이 없어 투영이 문서를 만든 적이 없다. "부분 갱신만 한다"는
 * 규칙을 그대로 두면 그 커밋은 영원히 검색되지 않는다. 생성할 때는 **접근 통제
 * material을 함께** 싣는다 — 먼저 만들고 나중에 채우면 그 사이 문서를 강제 필터가
 * 거를 수 없다 (DEV-213, fail closed).
 *
 * 새 문서의 초기 `document_version`은 **커밋 시각**이다. `Date.now()`를 쓰면 그 뒤
 * 도착하는 정상 투영이 전부 밀려난다 (DEV-209).
 */

import type { Client } from '@elastic/elasticsearch';
import { reportShadowFailure, type WriteTargets } from './write-targets.js';

/** 이 경로가 쓰는 유일한 별칭. */
const COMMITS_ALIAS = 'prs-commits';

/**
 * 메타데이터만 대입하고 **`document_version`은 건드리지 않는다.**
 *
 * 값이 이미 같으면 `noop`이다 — 같은 SHA를 두 번 보강해도 문서가 바뀌지 않고,
 * 그것이 DoD("같은 SHA로 두 번 돌려도 문서가 동일하다")를 성립시킨다.
 *
 * **필드가 없는 것과 값이 `null`인 것은 다르다** (CR-119 / FR-ING-008 AC-10). 전에는 두 경우를
 * 같다고 보아, 정본이 `author: null`이라고 말해도 필드가 없는 문서에는 아무것도 쓰지 않았다.
 * 그러면 그 문서는 「작성자가 없다」가 아니라 「아직 모른다」로 남고, 전환 전 검증은 둘을 가를
 * 수 없다. 이제 필드가 없으면 `null`이라도 대입한다. 두 번째 보강은 여전히 `noop`이다.
 */
export const COMMIT_METADATA_SCRIPT = [
  'boolean changed = false;',
  'for (e in params.meta.entrySet()) {',
  '  def key = e.getKey();',
  '  def next = e.getValue();',
  '  def cur = ctx._source[key];',
  '  boolean same = ctx._source.containsKey(key) && (cur == null ? next == null : cur.equals(next));',
  '  if (!same) { ctx._source[key] = next; changed = true; }',
  '}',
  /*
   * `patch_id`는 **한 번 얻으면 잃지 않는다** (PR #42 리뷰).
   *
   * 미러가 계산해 준 값을, 나중에 API 폴백으로 돈 회차가 `no_mirror`로 지우면
   * 색인이 정본(PostgreSQL은 `COALESCE`로 보존한다)과 어긋나고 체리픽 파생
   * (WP-030)이 이미 알던 사실을 잃는다. 능력이 없는 쪽이 있는 쪽을 지우지 않는다.
   */
  'if (params.patch_id != null) {',
  "  if (!params.patch_id.equals(ctx._source.patch_id)) { ctx._source.patch_id = params.patch_id; changed = true; }",
  "  if (ctx._source.containsKey('patch_id_unavailable')) { ctx._source.remove('patch_id_unavailable'); changed = true; }",
  '} else if (params.patch_unavailable != null && ctx._source.patch_id == null) {',
  "  if (!params.patch_unavailable.equals(ctx._source.patch_id_unavailable)) {",
  '    ctx._source.patch_id_unavailable = params.patch_unavailable; changed = true;',
  '  }',
  '}',
  "if (!changed) { ctx.op = 'noop'; }",
].join('\n');

export interface CommitMetadataFields {
  readonly parent_shas: readonly string[];
  readonly message: string;
  readonly author: string | null;
  readonly committer: string | null;
  readonly authored_at: string;
  readonly committed_at: string;
  readonly changed_paths: readonly string[];
  readonly changed_paths_truncated: boolean;
  readonly patch_id?: string;
  readonly patch_id_unavailable?: string;
  /**
   * 역할. **first-parent 체인에서 판정한 경우에만 넘긴다** (CR-038, DEV-207).
   *
   * PR 유래 커밋(원본 커밋)의 역할을 이 경로가 덮으면 안 된다 — 그 커밋이
   * first-parent인지 우리가 모르기 때문이다.
   */
  readonly role?: string;
}

export interface CommitMetadataUpsert {
  readonly repositoryId: number;
  readonly commitSha: string;
  /** 문서 ID. `commitDocId`가 만든 값이다. */
  readonly docId: string;
  readonly fields: CommitMetadataFields;
  /**
   * 문서를 새로 만들 때만 쓰는 본문 — 접근 통제 material과 초기 버전.
   *
   * 없으면 **문서를 만들지 않는다**(`doc_as_upsert` 없이 갱신만 시도). 접근 범위를
   * 모르는 자리에서 문서를 만들면 강제 필터가 거를 수 없는 문서가 생긴다.
   */
  readonly createWith?: Readonly<Record<string, unknown>> & { readonly document_version: number };
}

/**
 * 한 인덱스에 대한 메타데이터 쓰기의 결과 (CR-119 / FR-ING-008 AC-10).
 *
 * - `created` — 문서가 없어 `createWith`로 만들었다
 * - `updated` — 값이 바뀌었다
 * - `already_equal` — 값이 이미 같았다. 문서가 있고 그 값을 안다
 * - `document_missing` — 문서가 없고 만들 근거(`createWith`)도 없었다. **값이 반영되지 않았다**
 *
 * 전에는 마지막 둘이 모두 `noop`이었다. 그래서 재색인이 "문서가 아직 없어 반영하지 못함"을
 * "반영함"과 구별하지 못하고 그 문서를 기대 건수에 넣었다(사내 pilot.18 보고).
 */
export type CommitMetadataOutcome = 'created' | 'updated' | 'already_equal' | 'document_missing';

export interface CommitMetadataResult {
  /** 서비스 별칭에 대한 결과. */
  readonly result: CommitMetadataOutcome;
  /**
   * 재색인 대상(shadow)에 대한 결과. **서비스 결과와 섞지 않는다** — 재색인은 이 값으로만
   * 새 인덱스가 그 값을 받았는지 안다. shadow가 없으면 없고, shadow 쓰기가 던졌으면
   * `failed`다(그 실패는 `recordShadowFailure`로 따로 기록되어 잡을 실패로 만든다).
   */
  readonly shadow?: CommitMetadataOutcome | 'failed';
}

/**
 * 커밋 문서 하나에 메타데이터를 반영한다.
 *
 * `patch_id`·`patch_id_unavailable`은 **둘 중 하나만** 문서에 남는다. 값을 얻었으면
 * 사유 필드를 지우고, 못 얻었으면 값 필드를 지운다 — 둘이 함께 있으면 "얻었는데
 * 못 얻었다"가 되고, 매핑 주석이 약속한 "이 필드가 없으면 정상"이 깨진다.
 */
export async function upsertCommitMetadata(
  client: Client,
  input: CommitMetadataUpsert,
  targets: WriteTargets,
): Promise<CommitMetadataResult> {
  const { fields } = input;
  const meta: Record<string, unknown> = {
    parent_shas: [...fields.parent_shas],
    message: fields.message,
    author: fields.author,
    committer: fields.committer,
    authored_at: fields.authored_at,
    committed_at: fields.committed_at,
    changed_paths: [...fields.changed_paths],
    changed_paths_truncated: fields.changed_paths_truncated,
  };
  if (fields.role !== undefined) meta['role'] = fields.role;

  /*
   * `patch_id`는 스크립트가 따로 다룬다 — 이미 있는 값을 없는 쪽이 지우지 않기
   * 위해서다. `meta`에 넣으면 단순 대입이라 그 규칙을 표현할 수 없다.
   */
  const body: Record<string, unknown> = {
    script: {
      lang: 'painless',
      source: COMMIT_METADATA_SCRIPT,
      params: {
        meta,
        patch_id: fields.patch_id ?? null,
        patch_unavailable: fields.patch_id_unavailable ?? null,
      },
    },
  };
  if (input.createWith !== undefined) {
    body['upsert'] = {
      ...input.createWith,
      ...meta,
      // 생성 시점에는 스크립트가 돌지 않는다 — 여기에 전량이 들어가야 한다.
      ...(fields.patch_id === undefined
        ? fields.patch_id_unavailable === undefined
          ? {}
          : { patch_id_unavailable: fields.patch_id_unavailable }
        : { patch_id: fields.patch_id }),
      doc_id: input.docId,
      commit_sha: input.commitSha,
    };
  } else {
    // 문서가 없으면 만들지 않는다 — 접근 범위를 모르기 때문이다. 결과는 `document_missing`이다.
    body['scripted_upsert'] = false;
  }

  const served = await sendMetadata(client, COMMITS_ALIAS, input, body);

  /*
   * shadow에도 같은 갱신을 보낸다 (WP-035, DEV-295).
   *
   * **문서 없음은 실패가 아니라 결과다** (CR-119). `createWith`가 없는 회차는 문서를 만들지
   * 않기로 한 것이고, 재색인 중이라면 정본 스캔이 아직 그 커밋 문서를 만들지 않았을 수 있다.
   * 그것을 실패로 세면 정상 진행이 전환을 막고, 성공으로 세면 값이 새 인덱스에 없는데도
   * 반영한 것처럼 된다 — 그래서 결과를 따로 돌려주고 재색인이 판정한다.
   */
  const shadow = targets.shadows[COMMITS_ALIAS];
  if (shadow === undefined) return { result: served };
  try {
    return { result: served, shadow: await sendMetadata(client, shadow, input, body) };
  } catch (error) {
    reportShadowFailure(targets, {
      alias: COMMITS_ALIAS,
      index: shadow,
      operation: 'update',
      reason: String(error),
    });
    return { result: served, shadow: 'failed' };
  }
}

/** 한 인덱스에 메타데이터를 반영한다. 서비스와 shadow가 **같은 경로**를 쓴다. */
async function sendMetadata(
  client: Client,
  index: string,
  input: CommitMetadataUpsert,
  body: Record<string, unknown>,
): Promise<CommitMetadataOutcome> {
  let result: unknown;
  try {
    const response = await client.update({
      index,
      id: input.docId,
      routing: String(input.repositoryId),
      retry_on_conflict: 3,
      ...body,
    });
    result = response.result;
  } catch (error) {
    /*
     * 만들 근거가 없는 문서는 없는 것이 맞다 — 그러나 「이미 같음」이 아니라 「없음」이다.
     * **인덱스가 없는 404는 여기가 아니다** (`index_not_found_exception`): 쓰기 대상이 사라진
     * 것이고, 그것을 문서 없음으로 삼키면 대상 인덱스 전체가 조용히 빈다.
     */
    if (input.createWith === undefined && isDocumentMissing(error)) return 'document_missing';
    throw error;
  }
  switch (result) {
    case 'created':
      return 'created';
    case 'updated':
      return 'updated';
    case 'noop':
      return 'already_equal';
    default:
      // 응답에 결과가 없거나 모르는 값이면 반영했는지 알 수 없다. 성공으로 세지 않는다.
      throw new Error(`commit_metadata_unexpected_result: ${String(result)} (${index})`);
  }
}

/** Elasticsearch 오류 본문의 `error.type`. 모르면 `undefined`다. */
export function esErrorTypeOf(error: unknown): string | undefined {
  const holder = error as { meta?: { body?: unknown }; body?: unknown };
  const body = holder.meta?.body ?? holder.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const inner = (body as { error?: unknown }).error;
  if (typeof inner !== 'object' || inner === null) return undefined;
  const type = (inner as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function statusOf(error: unknown): number | undefined {
  const holder = error as { statusCode?: number; meta?: { statusCode?: number } };
  return holder.statusCode ?? holder.meta?.statusCode;
}

/**
 * **문서가** 없는 404인가 (CR-119). 인덱스가 없는 404(`index_not_found_exception`)와 구별한다.
 * 본문이 없는 404도 문서 없음으로 읽지 않는다 — 무엇이 없는지 모르는 것을 아는 척하지 않는다.
 */
function isDocumentMissing(error: unknown): boolean {
  return statusOf(error) === 404 && esErrorTypeOf(error) === 'document_missing_exception';
}

/* ------------------------------------------------------------------------- */
/* 체인 커밋의 역할 되돌리기 (CR-117 / FR-SRCH-002 AC-7, WP-102)               */
/* ------------------------------------------------------------------------- */

/**
 * **단방향이다.** 지금 역할이 `source_commit`일 때만 체인이 정한 역할로 바꾼다.
 *
 * 체인 커밋을 `source_commit`으로 덮은 것은 PR 투영이었다 — 피처 브랜치가 `git merge dev`로
 * 받아 온 dev 체인 커밋을 그 PR의 원본 커밋으로 쓰면서, 조건부 업서트가 더 큰 버전(웹훅 수신
 * 시각)으로 `role`을 대입했다. 반대 방향(`merge_commit` → `source_commit`)은 이 함수가 만들 수
 * 없어야 한다. 다른 값이면 손대지 않는다 — 그 값은 체인 경로가 쓴 것이고 이 함수의 몫이 아니다.
 */
export const RESTORE_CHAIN_ROLE_SCRIPT = [
  "if (ctx._source.role == 'source_commit') { ctx._source.role = params.role; }",
  "else { ctx.op = 'noop'; }",
].join('\n');

export type ChainCommitRole = 'merge_commit' | 'direct_push';

export interface ChainRoleRestore {
  readonly repositoryId: number;
  /** 문서 ID. `commitDocId`가 만든 값이다. */
  readonly docId: string;
  /** 체인 행에서 정한 역할. PR 대응이 있으면 `merge_commit`, 없으면 `direct_push`다. */
  readonly role: ChainCommitRole;
}

export type ChainRoleRestoreResult = 'restored' | 'noop' | 'missing';

/**
 * 덮인 체인 커밋 역할을 되돌린다. **복구 명령(`prsctl links apply`)만 부른다.**
 *
 * `apply`는 원래 투영 의도만 만들고 색인에는 쓰지 않는다(CR-116). 이것은 그 규율의 예외이며
 * 이유가 있다: 관계 러너는 `role`을 비추지 않으므로 그 러너와 갈라질 두 번째 경로가 생기지
 * 않고, 쓰는 값은 체인 행에서 결정론적으로 나오며, 쓰기는 멱등이다(이미 되돌린 문서는
 * `noop`). 문서를 **만들지 않는다** — 없으면 `missing`이며 실패가 아니다.
 *
 * shadow에도 같은 쓰기를 보낸다. 재색인 중 shadow에 그 문서가 아직 없으면 404이고, 그것은
 * 정본 스캔이 아직 닿지 않았다는 뜻이라 실패로 세지 않는다(`updateLinkSummary`와 같다).
 */
export async function restoreChainCommitRole(
  client: Client,
  input: ChainRoleRestore,
  targets: WriteTargets,
): Promise<ChainRoleRestoreResult> {
  const served = await sendRoleRestore(client, COMMITS_ALIAS, input);

  const shadow = targets.shadows[COMMITS_ALIAS];
  if (shadow !== undefined) {
    try {
      await sendRoleRestore(client, shadow, input);
    } catch (error) {
      reportShadowFailure(targets, {
        alias: COMMITS_ALIAS,
        index: shadow,
        operation: 'update',
        reason: String(error),
      });
    }
  }

  return served;
}

async function sendRoleRestore(
  client: Client,
  index: string,
  input: ChainRoleRestore,
): Promise<ChainRoleRestoreResult> {
  try {
    const response = await client.update({
      index,
      id: input.docId,
      routing: String(input.repositoryId),
      retry_on_conflict: 3,
      script: { lang: 'painless', source: RESTORE_CHAIN_ROLE_SCRIPT, params: { role: input.role } },
    });
    return response.result === 'noop' ? 'noop' : 'restored';
  } catch (error) {
    // 문서가 없는 것만 `missing`이다. 인덱스가 없는 404는 대상이 사라진 것이라 던진다 (CR-119).
    if (isDocumentMissing(error)) return 'missing';
    throw error;
  }
}
