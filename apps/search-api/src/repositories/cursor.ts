/**
 * 저장소 개요 목록 커서 (API-ING-002 / WP-034, CR-050).
 *
 * ## Elasticsearch 커서를 쓰지 않는다
 *
 * 이 목록의 정본은 **PostgreSQL `repository` 표**다. Point In Time도
 * `search_after`도 여기에 뜻이 없다 — 순회하는 것이 색인 문서가 아니라 등록
 * 행이다. 공유하는 것은 봉인 방식(`cursor/envelope.ts`)과 두 오류 코드뿐이며,
 * 순회의 뜻은 이 모듈의 것이다. W-004의 구간 커서와 W-008의 저장 검색 커서가
 * 같은 이유로 갈라져 있다.
 *
 * ## 접근 범위가 지문에 들어간다
 *
 * 이 목록의 **내용을 정하는 것이 "내가 무엇을 볼 수 있는가"**다. 첫 페이지를
 * 받은 뒤 팀에서 회수되거나 저장소 권한이 바뀌면 그 커서가 가리키는 위치는
 * 이제 다른 집합의 위치다. 지문 없이 이어 보면 회수된 범위의 저장소를 계속
 * 내주게 된다 — 접근 통제가 순회 도중에 조용히 무력해진다.
 *
 * 여기서는 W-008과 달리 **접근 범위 자체**가 재료다. 저장된 검색의 가시성은
 * 소유와 팀 소속이 정하지만 이 목록은 저장소 권한이 그대로 정하기 때문이다.
 *
 * ## 원본 식별자를 싣지 않는다
 *
 * 봉투는 **서명될 뿐 암호화되지 않는다** — base64 한 번이면 안이 읽힌다.
 * 그래서 범위를 해시로 접어 넣는다. 지문은 같은 범위가 늘 같은 값이면
 * 충분하고, 그 안을 되읽을 필요는 없다.
 */

import { createHash } from 'node:crypto';
import type { AccessScope } from '@prs/es';
import {
  CURSOR_TTL_MS,
  CursorInvalidError,
  CursorQueryMismatchError,
  assertNotExpired,
  decodeEnvelope,
  encodeEnvelope,
  type CursorSigner,
} from '../cursor/envelope.js';

export const REPOSITORY_CURSOR_VERSION = 1;

interface RepositoryCursorPayload {
  readonly v: number;
  /** 키셋: `owner`. */
  readonly o: string;
  /** 키셋: `name`. */
  readonly n: string;
  /** 키셋: `repository_id`. 동률을 깬다. */
  readonly i: number;
  /** 접근 범위와 필터의 지문. */
  readonly q: string;
  readonly x: number;
}

export interface RepositoryCursorPosition {
  readonly owner: string;
  readonly name: string;
  readonly repositoryId: number;
}

export interface RepositoryFingerprintInput {
  readonly scope: AccessScope;
  /** `owner/name` 완전 일치 필터. 없으면 전체 목록이다. */
  readonly slug: string | null;
  /**
   * 지문에 덧붙이는 결속 (CR-112). **없으면 재료가 이전과 같다** — 공개 커서가 그대로 통한다.
   * PIPE 연동은 client와 canonical 사용자를 넣는다.
   */
  readonly binding?: string;
}

/**
 * 지문.
 *
 * 배열을 전부 정렬해 넣는다 — 같은 권한이 늘 같은 지문이어야 한다. 정렬하지
 * 않으면 조회 순서가 달라질 때마다 지문이 흔들려 멀쩡한 커서가 거절되고,
 * 사용자는 자기가 만들지 않은 오류를 본다.
 *
 * `kind`를 재료에 넣는다. `explicit`과 `org_team`은 같은 논리 권한을 다르게
 * 표현할 수 있는데(ADR-008의 전환 임계), **표현이 바뀌면 목록의 정렬 위치도
 * 달라질 수 있으므로** 이어 보기를 끊는 편이 안전하다.
 */
export function computeRepositoryFingerprint(input: RepositoryFingerprintInput): string {
  const scope = input.scope;
  const material =
    scope.kind === 'explicit'
      ? ['explicit', [...scope.repositoryIds].sort((a, b) => a - b).join(',')]
      : [
          'org_team',
          [...scope.orgIds].sort((a, b) => a - b).join(','),
          [...scope.teamIds].sort((a, b) => a - b).join(','),
          [...scope.visibilities].sort().join(','),
        ];
  // 결속은 있을 때만 재료가 된다 — 없을 때 빈 자리를 더하면 공개 커서의 지문이 바뀐다.
  const binding = input.binding === undefined ? [] : [`binding:${input.binding}`];
  return createHash('sha256')
    .update([...material, input.slug ?? '', ...binding].join('|'), 'utf8')
    .digest('base64url')
    .slice(0, 22);
}

export function encodeRepositoryCursor(
  position: RepositoryCursorPosition,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: RepositoryCursorPayload = {
    v: REPOSITORY_CURSOR_VERSION,
    o: position.owner,
    n: position.name,
    i: position.repositoryId,
    q: fingerprint,
    x: nowMs + CURSOR_TTL_MS,
  };
  return encodeEnvelope(payload, signer);
}

/**
 * 커서를 연다.
 *
 * 검사 순서가 곧 오류의 뜻이다 — 형식·서명·버전·만료·키셋 형태는
 * `CURSOR_INVALID`, 접근 범위와 필터는 `CURSOR_QUERY_MISMATCH`.
 *
 * @throws {CursorInvalidError}
 * @throws {CursorQueryMismatchError}
 */
export function decodeRepositoryCursor(
  raw: string,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): RepositoryCursorPosition {
  const payload = decodeEnvelope(raw, signer) as Partial<RepositoryCursorPayload>;

  if (payload.v !== REPOSITORY_CURSOR_VERSION) {
    throw new CursorInvalidError(`모르는 커서 버전: ${String(payload.v)}`);
  }
  assertNotExpired(payload.x, nowMs);

  if (typeof payload.o !== 'string' || payload.o === '') {
    throw new CursorInvalidError('키셋 소유자가 없다');
  }
  if (typeof payload.n !== 'string' || payload.n === '') {
    throw new CursorInvalidError('키셋 이름이 없다');
  }
  if (typeof payload.i !== 'number' || !Number.isSafeInteger(payload.i) || payload.i <= 0) {
    throw new CursorInvalidError('키셋 식별자가 없다');
  }

  if (payload.q !== fingerprint) {
    throw new CursorQueryMismatchError('접근 범위 또는 조회 조건이 커서 발급 시점과 다르다');
  }

  return { owner: payload.o, name: payload.n, repositoryId: payload.i };
}
