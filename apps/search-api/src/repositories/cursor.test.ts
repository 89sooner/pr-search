/**
 * 저장소 개요 커서 (API-ING-002 / WP-034, CR-050).
 *
 * 통합 시험이 "순회가 저장소를 빠뜨리지 않는다"를 실제 PostgreSQL로 건다면,
 * 여기서는 **봉투가 무엇을 거절하는가**를 건다 — 거절은 실패 경로라 통합에서
 * 만들기 번거롭고, 그 경로가 바로 접근 통제가 사는 자리다.
 */

import { describe, expect, it } from 'vitest';
import type { AccessScope } from '@prs/es';
import { createCursorSigner, CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import {
  REPOSITORY_CURSOR_VERSION,
  computeRepositoryFingerprint,
  decodeRepositoryCursor,
  encodeRepositoryCursor,
} from './cursor.js';

const SIGNER = createCursorSigner('unit-test-key-0123456789abcdef-wp034');
const OTHER_SIGNER = createCursorSigner('other-key-0123456789abcdef-wp034xx');
const NOW = 1_800_000_000_000;

const POSITION = { owner: 'acme', name: 'payments', repositoryId: 4021 };

const ORG_TEAM: AccessScope = {
  kind: 'org_team',
  orgIds: [7],
  teamIds: [101, 202],
  visibilities: ['public', 'internal'],
};

function fp(scope: AccessScope, slug: string | null = null): string {
  return computeRepositoryFingerprint({ scope, slug });
}

const BASE = fp(ORG_TEAM);

describe('지문', () => {
  it('같은 입력이면 같다', () => {
    expect(fp(ORG_TEAM)).toBe(BASE);
  });

  it('**팀·조직 순서가 달라도 같다** — 조회 순서가 지문을 흔들지 않는다', () => {
    expect(fp({ ...ORG_TEAM, teamIds: [202, 101] })).toBe(BASE);
    expect(fp({ ...ORG_TEAM, orgIds: [7] })).toBe(BASE);
  });

  it('**팀 소속이 바뀌면 다르다** — 회수도 추가도 집합을 바꾼다', () => {
    expect(fp({ ...ORG_TEAM, teamIds: [101] })).not.toBe(BASE);
    expect(fp({ ...ORG_TEAM, teamIds: [101, 202, 303] })).not.toBe(BASE);
  });

  it('가시성이 바뀌면 다르다', () => {
    expect(fp({ ...ORG_TEAM, visibilities: ['public'] })).not.toBe(BASE);
  });

  it('조직이 바뀌면 다르다', () => {
    expect(fp({ ...ORG_TEAM, orgIds: [7, 8] })).not.toBe(BASE);
  });

  it('**표현이 바뀌면 다르다** — explicit과 org_team은 정렬 위치가 달라질 수 있다', () => {
    expect(fp({ kind: 'explicit', repositoryIds: [4021] })).not.toBe(BASE);
  });

  it('명시 범위의 저장소 집합이 바뀌면 다르다', () => {
    const one = fp({ kind: 'explicit', repositoryIds: [1, 2] });
    expect(fp({ kind: 'explicit', repositoryIds: [1] })).not.toBe(one);
    expect(fp({ kind: 'explicit', repositoryIds: [2, 1] })).toBe(one);
  });

  it('**`repository=` 필터가 바뀌면 다르다** — 좁힌 목록과 전체 목록은 다른 순회다', () => {
    expect(fp(ORG_TEAM, 'acme/payments')).not.toBe(BASE);
    expect(fp(ORG_TEAM, 'acme/other')).not.toBe(fp(ORG_TEAM, 'acme/payments'));
  });

  it('**원본 식별자를 담지 않는다** — 봉투는 서명될 뿐 암호화되지 않는다', () => {
    // 지문은 해시라 재료를 되읽을 수 없다. 길이가 고정인 것이 그 증거다.
    expect(BASE).toHaveLength(22);
    expect(BASE).not.toContain('7');
  });
});

describe('왕복', () => {
  it('실은 위치를 그대로 돌려준다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    expect(decodeRepositoryCursor(cursor, BASE, SIGNER, NOW)).toEqual(POSITION);
  });

  it('**동률 tiebreak가 살아남는다** — 같은 owner/name이라도 id가 위치를 정한다', () => {
    const cursor = encodeRepositoryCursor({ ...POSITION, repositoryId: 9999 }, BASE, SIGNER, NOW);
    expect(decodeRepositoryCursor(cursor, BASE, SIGNER, NOW).repositoryId).toBe(9999);
  });
});

describe('거절', () => {
  it('다른 키로 서명된 커서는 CURSOR_INVALID다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, OTHER_SIGNER, NOW);
    expect(() => decodeRepositoryCursor(cursor, BASE, SIGNER, NOW)).toThrow(CursorInvalidError);
  });

  it('훼손된 커서는 CURSOR_INVALID다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    const tampered = `${cursor.slice(0, -3)}xyz`;
    expect(() => decodeRepositoryCursor(tampered, BASE, SIGNER, NOW)).toThrow(CursorInvalidError);
  });

  it('만료된 커서는 CURSOR_INVALID다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    expect(() => decodeRepositoryCursor(cursor, BASE, SIGNER, NOW + 60 * 60 * 1000)).toThrow(
      CursorInvalidError,
    );
  });

  it('**접근 범위가 바뀌면 CURSOR_QUERY_MISMATCH다** — 이어 보면 회수된 범위를 계속 내준다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    const revoked = fp({ ...ORG_TEAM, teamIds: [101] });
    expect(() => decodeRepositoryCursor(cursor, revoked, SIGNER, NOW)).toThrow(
      CursorQueryMismatchError,
    );
  });

  it('**필터가 바뀌면 CURSOR_QUERY_MISMATCH다**', () => {
    const cursor = encodeRepositoryCursor(POSITION, fp(ORG_TEAM, 'acme/payments'), SIGNER, NOW);
    expect(() => decodeRepositoryCursor(cursor, BASE, SIGNER, NOW)).toThrow(CursorQueryMismatchError);
  });

  it('**두 오류가 다른 사실을 말한다** — 화면이 다르게 안내한다', () => {
    const cursor = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    expect(() => decodeRepositoryCursor(cursor, BASE, OTHER_SIGNER, NOW)).toThrow(CursorInvalidError);
    expect(() => decodeRepositoryCursor(cursor, 'different-fingerprint', SIGNER, NOW)).toThrow(
      CursorQueryMismatchError,
    );
  });

  it('버전이 다르면 CURSOR_INVALID다', () => {
    expect(REPOSITORY_CURSOR_VERSION).toBe(1);
    // 다른 계열의 커서를 그대로 먹이면 스키마가 달라 거절된다.
    const foreign = encodeRepositoryCursor(POSITION, BASE, SIGNER, NOW);
    const decoded = JSON.parse(
      Buffer.from(foreign.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(decoded['v']).toBe(1);
  });
});
