/**
 * W-004 구간 커서 (WP-032 / FR-SEQ-002 AC-6·7·8, CR-043 DEV-270, CR-044 DEV-287).
 *
 * ## W-001의 커서를 쓰지 않는다
 *
 * 두 화면이 순회하는 **정본이 다르다.** W-001은 Elasticsearch 검색 결과를
 * PIT + `search_after`로 잇고, W-004는 PostgreSQL `merge_sequence`의 구간
 * 멤버십을 잇는다. 하나로 합치면 "구현이 이미 `search_after`를 쓰니까"라는
 * 이유로 W-004의 멤버십까지 Elasticsearch가 소유하게 되고, 그러면 이 API가
 * 존재하는 이유(DEV-130 — 색인 반영이 실패하면 구간이 **오류 없이 줄어든다**)가
 * 그대로 되돌아온다. ADR-007을 깨는 최적화다.
 *
 * 공유하는 것은 봉인 방식뿐이다 (`cursor/envelope.ts`).
 *
 * ## 완결 서수 — 하나의 물음, 두 갈래의 답
 *
 * 커서가 가리키는 것은 **"그 서수 이하의 일치를 모두 반환했음이 보장되는
 * 지점"**이다. 규칙은 하나이고 결과만 둘로 갈린다.
 *
 * | 상황 | 봉인하는 값 |
 * | --- | --- |
 * | 페이지가 차서 판정을 멈췄다 | 목록에 **실제로 실은** 마지막 일치의 서수 |
 * | 판정할 것이 남지 않을 때까지 보고도 안 찼다 | **마지막으로 검사한** 서수 |
 *
 * 둘 중 하나로 고정하면 각각 다른 방향으로 깨진다.
 *
 *   - 언제나 "검사한 마지막"이면 — chunk 100 · `size` 10 · 그 chunk에 일치
 *     20건일 때 앞 10건만 내주고 커서를 100으로 봉인해 **나머지 10건이 영영
 *     사라진다** (DEV-287).
 *   - 언제나 "반환한 마지막"이면 — 일치가 하나도 없는 페이지에서 **커서가
 *     전진하지 못한다** (DEV-270이 만든 상태와 같다).
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

export const RANGE_CURSOR_VERSION = 1;

/** 봉투에 실리는 것. 시퀀스 공간·경계는 지문에 섞지 않고 **따로** 싣는다. */
interface RangeCursorPayload {
  readonly v: number;
  /** 시퀀스 공간: 저장소 ID. */
  readonly r: number;
  /** 시퀀스 공간: 대상 브랜치. */
  readonly b: string;
  /** 시퀀스 공간: 에폭. */
  readonly e: number;
  /** 구간 경계 (반개구간 `(f, t]`). */
  readonly f: number;
  readonly t: number;
  /** `q`/필터 + 접근 범위의 지문. */
  readonly q: string;
  /** 완결 서수. */
  readonly c: number;
  readonly x: number;
}

export interface RangeCursor {
  readonly completeSeq: number;
}

/**
 * 이 커서가 딛고 선 자리.
 *
 * 공간·경계를 **지문에 해시하지 않고 그대로 싣는** 것은, 어긋났을 때 무엇이
 * 달라졌는지 오류 메시지가 말할 수 있어야 하기 때문이다. 에폭 불일치는
 * "재채번이 일어났다"는 뜻이고 경계 불일치는 "다른 구간을 보고 있다"는 뜻이라
 * 사용자가 할 일이 다르다.
 */
export interface RangeCursorAnchor {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly fromExclusive: number;
  readonly toInclusive: number;
}

export interface RangeFingerprintInput {
  /** 정규화한 `q`. 없으면 빈 문자열. */
  readonly query: string;
  readonly scope: AccessScope;
  readonly scopeVersion: number;
}

function scopeMaterial(scope: AccessScope): string {
  const sorted = (values: readonly number[] | readonly string[]): string =>
    [...values].map(String).sort().join(',');

  if (scope.kind === 'explicit') return `explicit|${sorted(scope.repositoryIds)}`;
  return `org_team|${sorted(scope.orgIds)}|${sorted(scope.teamIds)}|${sorted(scope.visibilities)}`;
}

export function computeRangeFingerprint(input: RangeFingerprintInput): string {
  const material = [input.query, scopeMaterial(input.scope), String(input.scopeVersion)].join(' ');
  return createHash('sha256').update(material, 'utf8').digest('base64url').slice(0, 22);
}

export function encodeRangeCursor(
  completeSeq: number,
  anchor: RangeCursorAnchor,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): string {
  const payload: RangeCursorPayload = {
    v: RANGE_CURSOR_VERSION,
    r: anchor.repositoryId,
    b: anchor.baseBranch,
    e: anchor.seqEpoch,
    f: anchor.fromExclusive,
    t: anchor.toInclusive,
    q: fingerprint,
    c: completeSeq,
    x: nowMs + CURSOR_TTL_MS,
  };
  return encodeEnvelope(payload, signer);
}

/**
 * 커서를 연다.
 *
 * 검사 순서가 곧 오류의 뜻이다 — 형식·서명·버전·만료는 `CURSOR_INVALID`,
 * 공간·에폭·경계·지문은 `CURSOR_QUERY_MISMATCH`.
 *
 * **에폭이 바뀌면 반드시 거절한다.** 재채번 뒤 옛 커서를 이어 쓰면 서수가
 * 다른 두 공간을 한 목록으로 섞는다 — 그것이 에폭이 존재하는 이유다 (ADR-007).
 *
 * @throws {CursorInvalidError}
 * @throws {CursorQueryMismatchError}
 */
export function decodeRangeCursor(
  raw: string,
  anchor: RangeCursorAnchor,
  fingerprint: string,
  signer: CursorSigner,
  nowMs: number,
): RangeCursor {
  const payload = decodeEnvelope(raw, signer) as Partial<RangeCursorPayload>;

  if (payload.v !== RANGE_CURSOR_VERSION) {
    throw new CursorInvalidError(`모르는 커서 버전: ${String(payload.v)}`);
  }
  assertNotExpired(payload.x, nowMs);
  if (typeof payload.c !== 'number' || !Number.isSafeInteger(payload.c)) {
    throw new CursorInvalidError('완결 서수가 없다');
  }

  if (payload.r !== anchor.repositoryId || payload.b !== anchor.baseBranch) {
    throw new CursorQueryMismatchError('다른 시퀀스 공간의 커서다');
  }
  if (payload.e !== anchor.seqEpoch) {
    throw new CursorQueryMismatchError(
      `에폭이 달라졌다 (커서 ${String(payload.e)} · 현재 ${String(anchor.seqEpoch)}) — 재채번이 일어났다`,
    );
  }
  if (payload.f !== anchor.fromExclusive || payload.t !== anchor.toInclusive) {
    throw new CursorQueryMismatchError('구간 경계가 달라졌다');
  }
  if (payload.q !== fingerprint) {
    throw new CursorQueryMismatchError('질의·필터·접근 범위가 커서 발급 시점과 다르다');
  }

  /*
   * 완결 서수가 구간 밖이면 이 커서를 쓸 수 없다.
   *
   * 경계가 같은데 값만 구간 밖인 것은 **훼손**이지 조건 변경이 아니다.
   * 서명이 그것을 막지만, 검사를 서명에만 기대면 서명 방식이 바뀔 때
   * 이 불변식이 함께 사라진다.
   */
  if (payload.c < anchor.fromExclusive || payload.c > anchor.toInclusive) {
    throw new CursorInvalidError('완결 서수가 구간 밖이다');
  }

  return { completeSeq: payload.c };
}
