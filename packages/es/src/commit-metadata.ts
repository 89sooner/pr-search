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
 */
export const COMMIT_METADATA_SCRIPT = [
  'boolean changed = false;',
  'for (e in params.meta.entrySet()) {',
  '  def key = e.getKey();',
  '  def next = e.getValue();',
  '  def cur = ctx._source[key];',
  '  boolean same = cur == null ? next == null : cur.equals(next);',
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

export interface CommitMetadataResult {
  readonly result: 'created' | 'updated' | 'noop';
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
    // 문서가 없으면 만들지 않고 조용히 넘어간다 — 접근 범위를 모르기 때문이다.
    body['scripted_upsert'] = false;
  }

  const served = await sendMetadata(client, COMMITS_ALIAS, input, body);

  /*
   * shadow에도 같은 갱신을 보낸다 (WP-035, DEV-295).
   *
   * **404를 실패로 세지 않는다.** `createWith`가 없는 회차는 문서를 만들지
   * 않기로 한 것이고, 그 사실은 shadow에서도 그대로다 — 정본 스캔이 아직 그
   * 커밋에 닿지 않았을 뿐이다. 실패로 세면 정상 진행이 전환을 막는다.
   */
  const shadow = targets.shadows[COMMITS_ALIAS];
  if (shadow !== undefined) {
    try {
      await sendMetadata(client, shadow, input, body);
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

/** 한 인덱스에 메타데이터를 반영한다. 서비스와 shadow가 **같은 경로**를 쓴다. */
async function sendMetadata(
  client: Client,
  index: string,
  input: CommitMetadataUpsert,
  body: Record<string, unknown>,
): Promise<CommitMetadataResult> {
  try {
    const response = await client.update({
      index,
      id: input.docId,
      routing: String(input.repositoryId),
      retry_on_conflict: 3,
      ...body,
    });
    return { result: (response.result as CommitMetadataResult['result']) ?? 'noop' };
  } catch (error) {
    // 만들 근거가 없는 문서는 없는 것이 맞다. 그 사실을 실패로 세지 않는다.
    if (input.createWith === undefined && isNotFound(error)) return { result: 'noop' };
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const status = (error as { statusCode?: number; meta?: { statusCode?: number } });
  return status.statusCode === 404 || status.meta?.statusCode === 404;
}
