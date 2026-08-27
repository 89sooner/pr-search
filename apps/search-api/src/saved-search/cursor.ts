/**
 * 저장된 검색 목록 커서 (WP-033 / FR-SRCH-010 AC-5, CR-049 DEV-340).
 *
 * ## W-001의 커서를 쓰지 않는다
 *
 * 이 자원의 정본은 **PostgreSQL**이다. Point In Time도 `search_after`도 여기에
 * 뜻이 없다 — 순회하는 것이 Elasticsearch 문서가 아니라 `saved_search`의 행이다.
 * 공유하는 것은 봉인 방식(`cursor/envelope.ts`)과 두 오류 코드뿐이며, 순회의
 * 뜻은 이 모듈의 것이다. W-004의 구간 커서가 같은 이유로 갈라져 있다.
 *
 * ## 왜 팀 구성원 자격이 지문에 들어가는가
 *
 * `view=team` 목록의 **내용을 정하는 것이 "내가 어느 팀에 속해 있는가"**다.
 * 첫 페이지를 받은 뒤 팀에서 회수되면 그 커서가 가리키는 위치는 이제 다른
 * 집합의 위치다. 지문 없이 이어 보면 회수된 팀의 항목을 계속 내주게 된다 —
 * 접근 통제가 순회 도중에 조용히 무력해진다.
 *
 * ## 접근 범위 버전은 넣지 않는다
 *
 * 저장된 검색의 가시성은 소유와 팀 소속이 정하지 저장소 권한이 정하지 않는다.
 * `access_scope_version`을 지문에 넣으면 **무관한 저장소 권한 변경이 목록
 * 순회를 끊고**, 사용자는 자기가 만들지 않은 오류를 본다. 지문에는 이 목록의
 * 답을 실제로 바꾸는 것만 담는다.
 */

import { createHash } from 'node:crypto';
import {
  CURSOR_TTL_MS,
  CursorInvalidError,
  CursorQueryMismatchError,
  assertNotExpired,
  decodeEnvelope,
  encodeEnvelope,
  type CursorSigner,
} from '../cursor/envelope.js';

export const SAVED_SEARCH_CURSOR_VERSION = 1;

/** 두 논리 목록. 같은 항목이 양쪽에 나타나지 않는다. */
export type SavedSearchView = 'mine' | 'team';

export const SAVED_SEARCH_VIEWS: readonly SavedSearchView[] = ['mine', 'team'];

export function isSavedSearchView(value: unknown): value is SavedSearchView {
  return typeof value === 'string' && (SAVED_SEARCH_VIEWS as readonly string[]).includes(value);
}

interface SavedSearchCursorPayload {
  readonly v: number;
  /** 어느 목록의 커서인가. */
  readonly w: SavedSearchView;
  /** 키셋: `created_at` (ISO µs). */
  readonly c: string;
  /** 키셋: `saved_search_id`. */
  readonly i: number;
  /** 사용자·목록·팀 소속의 지문. */
  readonly q: string;
  readonly x: number;
}

export interface SavedSearchCursorPosition {
  readonly createdAt: string;
  readonly savedSearchId: number;
}

export interface SavedSearchFingerprintInput {
  readonly userId: string;
  readonly view: SavedSearchView;
  /** 이 사용자가 **지금** 구성원인 팀. 순서는 여기서 정한다. */
  readonly teamIds: readonly number[];
}

/**
 * 지문.
 *
 * 팀 ID를 정렬해 넣는다 — 같은 소속이 늘 같은 지문이어야 한다. 정렬하지 않으면
 * 조회 순서가 달라질 때마다 지문이 흔들려 멀쩡한 커서가 거절된다.
 */
export function computeSavedSearchFingerprint(input: SavedSearchFingerprintInput): string {
  const teams = [...input.teamIds].sort((a, b) => a - b).join(',');
  const material = [input.userId, input.view, teams].join('|');
  return createHash('sha256').update(material, 'utf8').digest('base64url').slice(0, 22);
}

export function encodeSavedSearchCursor(
  position: SavedSearchCursorPosition,
  view: SavedSearchView,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: SavedSearchCursorPayload = {
    v: SAVED_SEARCH_CURSOR_VERSION,
    w: view,
    c: position.createdAt,
    i: position.savedSearchId,
    q: fingerprint,
    x: nowMs + CURSOR_TTL_MS,
  };
  return encodeEnvelope(payload, signer);
}

/**
 * 커서를 연다.
 *
 * 검사 순서가 곧 오류의 뜻이다 — 형식·서명·버전·만료·키셋 형태는
 * `CURSOR_INVALID`, 목록과 지문은 `CURSOR_QUERY_MISMATCH`.
 *
 * **남의 커서도 지문 불일치다** (CR-049 PR #59 리뷰, DEV-345). 사용자 ID가
 * 지문에 섞여 있으므로 서명은 유효하고 지문만 다르다. 그것을 따로 구분하려면
 * 사용자 ID를 봉투에 평문으로 실어야 하는데, 봉투는 서명될 뿐 암호화되지 않아
 * OIDC `sub`가 base64 한 번으로 읽힌다. 구분의 값보다 노출의 대가가 크고,
 * 두 코드의 사용자 대면 결과는 어차피 같다.
 *
 * @throws {CursorInvalidError}
 * @throws {CursorQueryMismatchError}
 */
export function decodeSavedSearchCursor(
  raw: string,
  view: SavedSearchView,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): SavedSearchCursorPosition {
  const payload = decodeEnvelope(raw, signer) as Partial<SavedSearchCursorPayload>;

  if (payload.v !== SAVED_SEARCH_CURSOR_VERSION) {
    throw new CursorInvalidError(`모르는 커서 버전: ${String(payload.v)}`);
  }
  assertNotExpired(payload.x, nowMs);

  if (typeof payload.c !== 'string' || payload.c === '') {
    throw new CursorInvalidError('키셋 시각이 없다');
  }
  if (typeof payload.i !== 'number' || !Number.isSafeInteger(payload.i) || payload.i <= 0) {
    throw new CursorInvalidError('키셋 식별자가 없다');
  }

  if (payload.w !== view) {
    throw new CursorQueryMismatchError(
      `다른 목록의 커서다 (커서 ${String(payload.w)} · 현재 ${view})`,
    );
  }
  if (payload.q !== fingerprint) {
    throw new CursorQueryMismatchError('사용자 또는 팀 구성이 커서 발급 시점과 다르다');
  }

  return { createdAt: payload.c, savedSearchId: payload.i };
}
