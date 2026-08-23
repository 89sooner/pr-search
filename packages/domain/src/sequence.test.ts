/**
 * push 웹훅 해석과 시퀀스 공간 문자열 (WP-021 / CR-025, DEV-116·DEV-119).
 *
 * 이 파일이 막는 것 둘:
 *
 * 1. **태그나 삭제된 브랜치가 시퀀스 공간을 만드는 것.** 태그 하나가 공간
 *    하나가 되면 그 공간은 영원히 커밋 하나짜리로 남고, 아무도 그것을
 *    이상하다고 보지 않는다.
 * 2. **모양이 틀린 payload를 조용히 통과시키는 것.** 통과시키면 채번 워커가
 *    존재하지 않는 브랜치를 붙들고 매 회차 `stale`을 찍는다.
 */

import { describe, expect, it } from 'vitest';
import { branchFromRef, extractPushTarget, sequencePartitionKey, sequenceSpaceLabel } from './sequence.js';

const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);

function push(over: Record<string, unknown> = {}): unknown {
  return {
    ref: 'refs/heads/main',
    after: SHA,
    before: 'b'.repeat(40),
    deleted: false,
    repository: { id: 4021, full_name: 'acme/payments' },
    ...over,
  };
}

describe('ref → 브랜치 이름', () => {
  it('`refs/heads/`를 벗긴다', () => {
    expect(branchFromRef('refs/heads/main')).toBe('main');
    expect(branchFromRef('refs/heads/release/2026')).toBe('release/2026');
  });

  it('태그는 브랜치가 아니다 — 태그 하나가 시퀀스 공간 하나가 되면 안 된다', () => {
    expect(branchFromRef('refs/tags/v1.0.0')).toBeNull();
  });

  it('브랜치도 태그도 아닌 ref는 `null`이다', () => {
    expect(branchFromRef('refs/pull/12/head')).toBeNull();
    expect(branchFromRef('refs/notes/commits')).toBeNull();
    expect(branchFromRef('main')).toBeNull();
  });

  it('접두만 있고 이름이 없으면 `null`이다', () => {
    expect(branchFromRef('refs/heads/')).toBeNull();
  });
});

describe('push payload → 채번 대상 (DEV-116)', () => {
  it('정상 push에서 저장소·브랜치·head를 뽑는다', () => {
    const outcome = extractPushTarget(push());
    expect(outcome).toEqual({
      kind: 'target',
      target: { repositoryId: 4021, baseBranch: 'main', headSha: SHA },
    });
  });

  it('대문자 SHA를 소문자로 내린다 — 뒤의 모든 대조가 소문자 기준이다', () => {
    const outcome = extractPushTarget(push({ after: 'A'.repeat(40) }));
    expect(outcome.kind === 'target' && outcome.target.headSha).toBe(SHA);
  });

  it('태그 push는 건너뛴다 (실패가 아니다)', () => {
    const outcome = extractPushTarget(push({ ref: 'refs/tags/v1.0.0' }));
    expect(outcome.kind).toBe('skip');
  });

  it('`deleted: true`인 브랜치 삭제는 건너뛴다', () => {
    const outcome = extractPushTarget(push({ deleted: true }));
    expect(outcome.kind).toBe('skip');
  });

  it('`after`가 40자 0인 삭제도 건너뛴다 — 표기가 둘이라 둘 다 본다', () => {
    /*
     * `deleted` 플래그만 보면 그 필드가 빠진 payload에서 40자 0을 head로 삼아
     * 존재하지 않는 커밋을 채번하려 든다.
     */
    const outcome = extractPushTarget(push({ after: ZERO, deleted: undefined }));
    expect(outcome.kind).toBe('skip');
  });

  it('`ref`가 없으면 잘못된 payload다', () => {
    expect(extractPushTarget(push({ ref: undefined })).kind).toBe('invalid');
  });

  it('`after`가 없으면 잘못된 payload다', () => {
    expect(extractPushTarget(push({ after: undefined })).kind).toBe('invalid');
  });

  it('`after`가 40자 SHA가 아니면 잘못된 payload다 — 축약 SHA는 그래프 입력이 아니다', () => {
    expect(extractPushTarget(push({ after: 'abc1234' })).kind).toBe('invalid');
    expect(extractPushTarget(push({ after: `${SHA}extra` })).kind).toBe('invalid');
    expect(extractPushTarget(push({ after: 'z'.repeat(40) })).kind).toBe('invalid');
  });

  it('`repository`가 없거나 id가 정수가 아니면 잘못된 payload다', () => {
    expect(extractPushTarget(push({ repository: undefined })).kind).toBe('invalid');
    expect(extractPushTarget(push({ repository: { id: '4021' } })).kind).toBe('invalid');
    expect(extractPushTarget(push({ repository: { id: 0 } })).kind).toBe('invalid');
    expect(extractPushTarget(push({ repository: { id: -1 } })).kind).toBe('invalid');
    expect(extractPushTarget(push({ repository: { id: 1.5 } })).kind).toBe('invalid');
  });

  it('객체가 아닌 payload는 잘못된 payload다', () => {
    expect(extractPushTarget(null).kind).toBe('invalid');
    expect(extractPushTarget('push').kind).toBe('invalid');
    expect(extractPushTarget([]).kind).toBe('invalid');
  });

  it('건너뛰기와 잘못됨을 구분한다 — 하나로 뭉치면 실패 대기열이 태그 push로 찬다', () => {
    expect(extractPushTarget(push({ ref: 'refs/tags/v1' })).kind).toBe('skip');
    expect(extractPushTarget(push({ ref: undefined })).kind).toBe('invalid');
  });
});

describe('파티션 키와 시퀀스 공간 문자열', () => {
  it('파티션 키는 시퀀스 공간 단위다 — 같은 공간의 채번이 서로를 앞지르지 않는다', () => {
    expect(sequencePartitionKey(4021, 'main')).toBe('4021:main');
    expect(sequencePartitionKey(4021, 'main')).not.toBe(sequencePartitionKey(4021, 'release/2026'));
    expect(sequencePartitionKey(4021, 'main')).not.toBe(sequencePartitionKey(4022, 'main'));
  });

  it('시퀀스 공간 문자열은 사람이 읽는 형태다 (DEV-119)', () => {
    // `SequencePosition`이 이 값을 화면에 그대로 출력한다.
    expect(sequenceSpaceLabel('acme/payments', 'main')).toBe('acme/payments@main');
  });

  it('저장소 이름이 바뀌면 문자열이 갈라진다 — 그래서 범위 필터로 쓰지 않는다 (DEV-119)', () => {
    /*
     * 이 시험은 동작을 막지 않는다. **이 값이 왜 필터가 될 수 없는지를 못박는다.**
     * 같은 시퀀스 공간이 이름 변경 하나로 두 문자열이 되고, `term(sequence_space)`로
     * 거른 범위 조회는 그때 오류 없이 절반만 돌려준다.
     */
    const before = sequenceSpaceLabel('acme/payments', 'main');
    const after = sequenceSpaceLabel('acme/billing', 'main');
    expect(before).not.toBe(after);
  });
});
