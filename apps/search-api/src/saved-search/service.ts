/**
 * 저장된 검색 서비스 (API-SRCH-005 / WP-033, CR-049).
 *
 * ## 접근 통제는 리포지터리 질의 안에 있다
 *
 * 여기서 "소유자인가"를 판정해 리포지터리에 넘기지 않는다. 조회·수정·삭제·실행
 * 넷이 각자의 SQL에 권한 조건을 담고, 이 계층은 그 결과를 계약 모양으로 옮긴다.
 * 관계 조회가 `resolveRelationAnchor`에 접근 통제를 둔 것과 같은 이유다 —
 * 판정이 호출부에 있으면 새 경로마다 빠뜨릴 자리가 생긴다.
 *
 * ## 실행은 검색을 대신하지 않는다
 *
 * `runSavedSearch`가 하는 일은 권한 확인·질의 재검증·실행 시각 갱신·이동 대상
 * 반환 넷뿐이다. 결과를 여기서 계산하면 "누구의 범위로 계산했는가"가 이 함수의
 * 판단이 되고, 언젠가 저장자의 범위를 캐시하는 최적화가 들어올 자리가 생긴다.
 * 화면을 W-001로 보내면 저장된 검색은 접근 통제 경로에 **아예 참여하지 않는다**
 * (FR-SRCH-010 AC-3, THR-012).
 */

import type { Pool } from '@prs/db';
import { savedSearchRepo, type SavedSearchRow } from '@prs/db';
import { QUERY_KEYS, QueryParseError, parseQuery, type QueryErrorDetail } from '@prs/query';
import type { CursorSigner } from '../cursor/envelope.js';
import {
  computeSavedSearchFingerprint,
  decodeSavedSearchCursor,
  encodeSavedSearchCursor,
  type SavedSearchView,
} from './cursor.js';

export interface SavedSearchDeps {
  readonly pool: Pool;
  /**
   * 커서 서명자.
   *
   * **선택 필드로 만들지 않는다** (WP-032의 `_cursor-fixture.ts`가 배운 것).
   * 선택이면 "커서가 조용히 발급되지 않는" 배포를 시험이 통과시킨다.
   */
  readonly cursorSigner: CursorSigner;
}

/** 기본·최대 페이지 크기 (API-SRCH-005). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface QueryErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly detail: QueryErrorDetail & { readonly supported_keys?: readonly string[] };
}

export interface SavedSearchResource {
  readonly saved_search_id: number;
  readonly name: string;
  readonly query: string;
  readonly visibility: 'private' | 'team';
  readonly target_team?: { readonly team_id: number; readonly org_id: number; readonly slug: string };
  readonly owner: { readonly user_id: string; readonly login: string };
  /** 요청한 사람 기준. 서버는 이 값을 믿지 않고 매번 다시 판정한다. */
  readonly is_owner: boolean;
  readonly query_status: 'valid' | 'invalid';
  readonly query_error?: QueryErrorInfo;
  readonly created_at: string;
  readonly last_run_at: string | null;
}

/**
 * 질의를 현재 문법으로 판정한다.
 *
 * **저장된 질의는 문법이 바뀌면 무효가 될 수 있다** (AC-6). 목록에서도 판정해
 * 그 사실을 항목마다 실어 보낸다 — 화면이 실행을 막고 사유를 보이려면 값이
 * 있어야 한다. 자동으로 고치지 않는다.
 *
 * 파서는 서버와 화면이 같은 것을 쓴다 (ADR-001). 여기서 오류를 다시 만들지
 * 않고 파서가 준 코드·오프셋을 그대로 옮긴다.
 */
export function judgeQuery(query: string): QueryErrorInfo | null {
  try {
    parseQuery(query);
    return null;
  } catch (error) {
    if (error instanceof QueryParseError) {
      return {
        code: error.code,
        message: error.message,
        detail: { ...error.detail, supported_keys: [...QUERY_KEYS] },
      };
    }
    throw error;
  }
}

export function toResource(row: SavedSearchRow, viewerUserId: string): SavedSearchResource {
  const queryError = judgeQuery(row.query);
  return {
    saved_search_id: row.saved_search_id,
    name: row.name,
    query: row.query,
    visibility: row.visibility,
    ...(row.visibility === 'team' && row.team_id !== null
      ? {
          target_team: {
            team_id: row.team_id,
            org_id: row.team_org_id ?? 0,
            slug: row.team_slug ?? '',
          },
        }
      : {}),
    owner: { user_id: row.owner_user_id, login: row.owner_login },
    is_owner: row.owner_user_id === viewerUserId,
    query_status: queryError === null ? 'valid' : 'invalid',
    ...(queryError === null ? {} : { query_error: queryError }),
    created_at: row.created_at,
    last_run_at: row.last_run_at,
  };
}

/** 페이지 크기. 상한을 넘으면 자른다 — 400으로 거절할 만큼 무거운 사실이 아니다. */
export function clampPageSize(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PAGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
}

export interface ListSavedSearchesInput {
  readonly userId: string;
  readonly view: SavedSearchView;
  readonly size: number;
  readonly cursor: string | null;
  readonly nowMs: number;
}

export interface ListSavedSearchesResult {
  readonly view: SavedSearchView;
  readonly items: readonly SavedSearchResource[];
  readonly nextCursor: string | null;
}

/**
 * 목록 (API-SRCH-005 `GET`).
 *
 * `size + 1`을 요청해 다음 페이지 유무를 판정한다. `total`을 세지 않는다 —
 * 커서 순회에서 총계는 매 페이지마다 같은 비용을 다시 치르게 하고, 이 화면은
 * 그것을 쓰지 않는다.
 */
export async function listSavedSearches(
  input: ListSavedSearchesInput,
  deps: SavedSearchDeps,
): Promise<ListSavedSearchesResult> {
  /*
   * 팀 소속을 **한 번만** 읽는다.
   *
   * 지문에 쓰는 값과 목록을 만든 조건이 같아야 한다. 두 번 부르면 그 사이에
   * 회수가 끼어들어 어긋날 수 있다 — WP-032가 접근 범위에서 겪은 자리와
   * 같은 모양이다 (DEV-272).
   */
  const teams = await savedSearchRepo.listTeamsForUser(deps.pool, input.userId);
  const fingerprint = computeSavedSearchFingerprint({
    userId: input.userId,
    view: input.view,
    teamIds: teams.map((team) => team.team_id),
  });

  const after =
    input.cursor === null
      ? null
      : decodeSavedSearchCursor(input.cursor, input.view, fingerprint, deps.cursorSigner, input.nowMs);

  const limit = input.size + 1;
  const rows =
    input.view === 'mine'
      ? await savedSearchRepo.listOwnedSavedSearches(deps.pool, input.userId, {
          limit,
          after: after === null ? null : { createdAt: after.createdAt, savedSearchId: after.savedSearchId },
        })
      : await savedSearchRepo.listSharedSavedSearches(deps.pool, input.userId, {
          limit,
          after: after === null ? null : { createdAt: after.createdAt, savedSearchId: after.savedSearchId },
        });

  const page = rows.slice(0, input.size);
  const last = page.at(-1);
  const nextCursor =
    rows.length > input.size && last !== undefined
      ? encodeSavedSearchCursor(
          { createdAt: last.created_at, savedSearchId: last.saved_search_id },
          input.view,
          fingerprint,
          deps.cursorSigner,
          input.nowMs,
        )
      : null;

  return {
    view: input.view,
    items: page.map((row) => toResource(row, input.userId)),
    nextCursor,
  };
}

export type RunSavedSearchOutcome =
  | {
      readonly kind: 'ok';
      readonly savedSearchId: number;
      readonly query: string;
      readonly lastRunAt: string | null;
      readonly navigationUrl: string;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'query_invalid'; readonly error: QueryErrorInfo };

/** W-001이 여는 주소. 화면이 여기서 다시 조립하지 않도록 서버가 만든다. */
export function navigationUrlFor(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

/**
 * 실행 준비 (API-SRCH-005 `POST /{id}/run`).
 *
 * 순서가 계약이다: 볼 수 있는가 → 질의가 유효한가 → 실행 시각을 찍는다.
 * **무효하거나 권한이 없으면 시각을 갱신하지 않는다** — 실행되지 않은 것을
 * 실행했다고 적지 않는다 (AC-6).
 */
export async function runSavedSearch(
  savedSearchId: number,
  userId: string,
  deps: SavedSearchDeps,
): Promise<RunSavedSearchOutcome> {
  const row = await savedSearchRepo.findVisibleSavedSearch(deps.pool, savedSearchId, userId);
  if (row === null) return { kind: 'not_found' };

  const queryError = judgeQuery(row.query);
  if (queryError !== null) return { kind: 'query_invalid', error: queryError };

  /*
   * 갱신 문장이 권한 조건을 **다시** 건다.
   *
   * 위의 조회와 이 갱신 사이에 팀 구성이 바뀔 수 있다. 그 창에서 회수된 사람이
   * "마지막으로 실행한 사람"으로 기록되면 그 기록이 거짓이 된다. 조건에 맞는
   * 행이 없으면 `null`이고 그것은 404다.
   */
  const updated = await savedSearchRepo.markSavedSearchRun(deps.pool, savedSearchId, userId);
  if (updated === null) return { kind: 'not_found' };

  return {
    kind: 'ok',
    savedSearchId: updated.saved_search_id,
    query: updated.query,
    lastRunAt: updated.last_run_at,
    navigationUrl: navigationUrlFor(updated.query),
  };
}
