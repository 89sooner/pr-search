/**
 * A-002 화면 판정 시험 (WP-040 / FR-ING-009, CR-055).
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_RESOLUTION_NOTE,
  MAX_SEQUENCE_BRANCHES,
  UNREGISTER_CONFIRM_MESSAGE,
  addedBranches,
  hasMoreRequests,
  noteTooLong,
  normalizeBranchInput,
  requestActionable,
  requestPrefill,
  requestStatusLabel,
  type RegistrationRequestView,
} from './ops-repositories';

const request = (overrides: Partial<RegistrationRequestView> = {}): RegistrationRequestView => ({
  request_id: '318',
  requested_by: 'alice',
  repository: 'acme/payments',
  created_at: '2026-08-28T02:14:07.000Z',
  status: 'pending',
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
  ...overrides,
});

describe('요청 처리는 `pending`에서만 가능하다 (AC-11 / QA-A002-06)', () => {
  it('대기 중이면 처리할 수 있다', () => {
    expect(requestActionable(request())).toBe(true);
  });

  it('종료된 요청을 다시 여는 경로를 만들지 않았다', () => {
    expect(requestActionable(request({ status: 'fulfilled' }))).toBe(false);
    expect(requestActionable(request({ status: 'dismissed' }))).toBe(false);
  });

  it('세 상태에 사람이 읽는 이름이 있다', () => {
    expect(requestStatusLabel('pending')).toBe("Queued");
    expect(requestStatusLabel('fulfilled')).toBe("Registered");
    expect(requestStatusLabel('dismissed')).toBe("Closed");
  });

  it('모르는 상태는 그대로 보인다 — 지어내지 않는다', () => {
    expect(requestStatusLabel('approved')).toBe('approved');
  });
});

describe('"등록"은 폼을 채우기만 한다 (QA-A002-07)', () => {
  it('식별자를 쪼개 돌려준다', () => {
    expect(requestPrefill(request())).toEqual({ owner: 'acme', name: 'payments' });
  });

  it('형식이 아니면 `null`이다 — 채울 수 없는 폼을 열지 않는다', () => {
    expect(requestPrefill(request({ repository: 'payments' }))).toBeNull();
    expect(requestPrefill(request({ repository: 'acme/' }))).toBeNull();
    expect(requestPrefill(request({ repository: '/payments' }))).toBeNull();
  });

  it('저장소 이름에 `/`가 더 있어도 첫 것만 경계다', () => {
    expect(requestPrefill(request({ repository: 'acme/sub/payments' }))).toEqual({
      owner: 'acme',
      name: 'sub/payments',
    });
  });
});

describe('브랜치 입력 (AC-2 / QA-A002-02)', () => {
  it('줄바꿈과 쉼표를 모두 구분자로 받는다', () => {
    expect(normalizeBranchInput('main\nrelease/2026.08, hotfix')).toEqual({
      kind: 'ok',
      branches: ['main', 'release/2026.08', 'hotfix'],
    });
  });

  it('중복과 빈 값을 걷어 낸다', () => {
    expect(normalizeBranchInput('main,,main, ')).toEqual({ kind: 'ok', branches: ['main'] });
  });

  it('상한을 넘으면 알린다 — 서버 검증을 대신하지는 않는다', () => {
    const many = Array.from({ length: MAX_SEQUENCE_BRANCHES + 1 }, (_, i) => `b${String(i)}`).join(',');
    expect(normalizeBranchInput(many)).toEqual({ kind: 'limit_exceeded', given: MAX_SEQUENCE_BRANCHES + 1 });
  });

  it('상한과 같으면 통과한다 — 경계가 초과에서 걸린다', () => {
    const exact = Array.from({ length: MAX_SEQUENCE_BRANCHES }, (_, i) => `b${String(i)}`).join(',');
    expect(normalizeBranchInput(exact).kind).toBe('ok');
  });
});

describe('새로 대상이 된 브랜치만 채번한다 (AC-12 / QA-A002-11)', () => {
  it('추가된 것만 돌려준다', () => {
    expect(addedBranches(['main'], ['main', 'release/2026.08'])).toEqual(['release/2026.08']);
  });

  it('빠진 브랜치는 돌려주지 않는다 — 기존 시퀀스를 지우는 일이 아니다', () => {
    expect(addedBranches(['main', 'old'], ['main'])).toEqual([]);
  });

  it('처음 등록이면 전부가 새 것이다', () => {
    expect(addedBranches([], ['main', 'dev'])).toEqual(['main', 'dev']);
  });
});

describe('해제 확인 문구 (QA-A002-03)', () => {
  it('"삭제"라는 낱말을 쓰지 않는다', () => {
    expect(UNREGISTER_CONFIRM_MESSAGE).not.toContain("Delete");
  });

  it('수집 중단과 문서 유지를 함께 말한다', () => {
    expect(UNREGISTER_CONFIRM_MESSAGE).toContain("collection will stop");
    expect(UNREGISTER_CONFIRM_MESSAGE).toContain("documents will be retained");
  });
});

describe('처리 메모 상한 (마이그레이션 020의 CHECK와 같은 값)', () => {
  it('상한과 같으면 통과한다', () => {
    expect(noteTooLong('가'.repeat(MAX_RESOLUTION_NOTE))).toBe(false);
  });

  it('넘으면 알린다', () => {
    expect(noteTooLong('가'.repeat(MAX_RESOLUTION_NOTE + 1))).toBe(true);
  });

  it('앞뒤 공백은 세지 않는다', () => {
    expect(noteTooLong(` ${'가'.repeat(MAX_RESOLUTION_NOTE)} `)).toBe(false);
  });
});

describe('전체 수를 지어내지 않는다 (CR-055)', () => {
  it('더 있는지는 커서가 답한다', () => {
    expect(hasMoreRequests('abc')).toBe(true);
    expect(hasMoreRequests(null)).toBe(false);
  });
});
