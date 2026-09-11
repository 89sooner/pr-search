/**
 * M 번호 표시 모델 (WP-074 FR-SEQ-008 / CR-079, 상세 설계 9절, T05c).
 *
 * 가장 중요한 것은 **없는 번호를 지어내지 않는 것**과 **상태를 서로 섞지 않는
 * 것**이다. `pending`·`not_applicable`·`unavailable`은 사용자가 할 일이 다르다.
 */

import { describe, expect, it } from 'vitest';
import {
  MERGE_NUMBER_PARAM,
  MERGE_NUMBER_POLL_DEADLINE_MS,
  hasPendingMergeNumber,
  judgeMergeNumberResolve,
  mergeNumberEntryHref,
  mergeNumberResolveUrl,
  mergeNumberView,
  pullRequestHref,
  readMergeNumberEntry,
  revalidationDecision,
  splitSequenceSpace,
  type MergeNumberContext,
} from './merge-number';

const PR: MergeNumberContext = { kind: 'pull_request', repository: 'acme/smp1900', baseBranch: 'main' };

const ASSIGNED = {
  merge_number: 'M-1900-42',
  merge_number_state: 'assigned',
  merge_number_reason: null,
  merge_number_epoch: 4,
};

describe('WP-074 FR-SEQ-008 배지 판정 — 상세 설계 9절 표', () => {
  it('assigned → 표기 문자열이 문구이고 링크가 네 값을 나른다', () => {
    const view = mergeNumberView(ASSIGNED, PR);
    expect(view.kind).toBe('shown');
    if (view.kind !== 'shown') return;
    expect(view.state).toBe('assigned');
    expect(view.label).toBe('M-1900-42');
    expect(view.tone).toBe('accent');
    expect(view.link).not.toBeNull();
    expect(view.link?.href).toBe(
      '/search?m_repository=acme%2Fsmp1900&m_base_branch=main&m_seq_epoch=4&m_number=M-1900-42',
    );
    // 설명이 공간·에폭·"PR 번호를 대체하지 않음"을 말한다 (AC-8).
    expect(view.description).toContain('acme/smp1900@main');
    expect(view.description).toContain('에폭 4');
    expect(view.description).toContain('PR 번호를 대체하지 않');
  });

  it('**키가 없으면 그리지 않는다** — 기능 off·구버전 응답', () => {
    expect(mergeNumberView({}, PR)).toEqual({ kind: 'hidden' });
    expect(mergeNumberView({ merge_number: 'M-1-1' }, PR)).toEqual({ kind: 'hidden' });
    expect(mergeNumberView({ merge_number_state: 'weird' }, PR)).toEqual({ kind: 'hidden' });
  });

  it('**커밋 행은 키가 실려 와도 그리지 않는다** (FR-SEQ-008 AC-1)', () => {
    expect(mergeNumberView(ASSIGNED, { ...PR, kind: 'commit' })).toEqual({ kind: 'hidden' });
  });

  it('merge_seq 없음(not_sequenced) → 「시퀀스 채번 대기」, 링크 없음', () => {
    const view = mergeNumberView(
      { merge_number: null, merge_number_state: 'pending', merge_number_reason: 'not_sequenced', merge_number_epoch: null },
      PR,
    );
    expect(view).toMatchObject({ kind: 'shown', state: 'pending', label: '시퀀스 채번 대기', link: null });
  });

  it('pending → 「M 번호 대기」 + 사유 설명, **잠정 번호도 링크도 없다**', () => {
    const view = mergeNumberView(
      { merge_number: null, merge_number_state: 'pending', merge_number_reason: 'predecessor_pending', merge_number_epoch: 4 },
      PR,
    );
    expect(view).toMatchObject({ kind: 'shown', state: 'pending', label: 'M 번호 대기', link: null, tone: 'neutral' });
    if (view.kind !== 'shown') return;
    expect(view.description).toContain('앞선 항목');
    expect(view.description).toContain('잠정 번호는 없');
    expect(view.label).not.toMatch(/M-\d+-\d+/);
  });

  it.each([
    'pr_evidence_pending',
    'negative_evidence_unavailable',
    'partial_lookup',
    'profile_unverified',
    'unsupported_merge_profile',
    'mapping_conflict',
    'fetch_failed',
  ])('pending 사유 %s 가 접근 가능한 설명을 갖는다', (reason) => {
    const view = mergeNumberView({ merge_number: null, merge_number_state: 'pending', merge_number_reason: reason }, PR);
    if (view.kind !== 'shown') throw new Error('shown이어야 한다');
    expect(view.label).toBe('M 번호 대기');
    expect(view.description.length).toBeGreaterThan(20);
    expect(view.description).not.toContain('사유 코드');
  });

  it('모르는 pending 사유는 코드를 그대로 읽어 준다 — 숨기지 않는다', () => {
    const view = mergeNumberView({ merge_number_state: 'pending', merge_number_reason: 'new_reason' }, PR);
    if (view.kind !== 'shown') throw new Error('shown이어야 한다');
    expect(view.description).toContain('new_reason');
  });

  it('not_merged → 「M 번호 대상 아님」', () => {
    const view = mergeNumberView({ merge_number_state: 'not_applicable', merge_number_reason: 'not_merged' }, PR);
    expect(view).toMatchObject({ kind: 'shown', state: 'not_applicable', label: 'M 번호 대상 아님', link: null });
  });

  it('branch_not_tracked → 「채번 비대상 브랜치」', () => {
    const view = mergeNumberView({ merge_number_state: 'not_applicable', merge_number_reason: 'branch_not_tracked' }, PR);
    expect(view).toMatchObject({ kind: 'shown', state: 'not_applicable', label: '채번 비대상 브랜치' });
  });

  it('repository_code_unavailable → 「저장소 코드 확인 필요」', () => {
    const view = mergeNumberView(
      { merge_number: null, merge_number_state: 'unavailable', merge_number_reason: 'repository_code_unavailable' },
      PR,
    );
    expect(view).toMatchObject({ kind: 'shown', state: 'unavailable', label: '저장소 코드 확인 필요', link: null, tone: 'warning' });
  });

  it('그 밖의 unavailable → 「M 번호 확인 불가」 — pending과 **문구가 다르다**', () => {
    const failed = mergeNumberView({ merge_number_state: 'unavailable', merge_number_reason: 'mnumber_read_failed' }, PR);
    const capacity = mergeNumberView({ merge_number_state: 'unavailable', merge_number_reason: 'number_capacity_exceeded' }, PR);
    const pending = mergeNumberView({ merge_number_state: 'pending', merge_number_reason: 'fetch_failed' }, PR);
    expect(failed).toMatchObject({ kind: 'shown', label: 'M 번호 확인 불가', link: null });
    expect(capacity).toMatchObject({ kind: 'shown', label: 'M 번호 확인 불가', link: null });
    if (failed.kind !== 'shown' || pending.kind !== 'shown') throw new Error('shown이어야 한다');
    expect(failed.label).not.toBe(pending.label);
    expect(failed.tone).not.toBe(pending.tone);
  });

  it('assigned인데 표기 문자열이 없으면 확인 불가로 말한다 — 빈 배지를 그리지 않는다', () => {
    const view = mergeNumberView({ merge_number: null, merge_number_state: 'assigned', merge_number_epoch: 4 }, PR);
    expect(view).toMatchObject({ kind: 'shown', state: 'unavailable', label: 'M 번호 확인 불가', link: null });
  });

  it('assigned여도 에폭·저장소·브랜치 중 하나가 없으면 **링크를 만들지 않는다**', () => {
    expect(mergeNumberView({ ...ASSIGNED, merge_number_epoch: null }, PR)).toMatchObject({ label: 'M-1900-42', link: null });
    expect(mergeNumberView(ASSIGNED, { ...PR, baseBranch: null })).toMatchObject({ label: 'M-1900-42', link: null });
    expect(mergeNumberView(ASSIGNED, { ...PR, repository: null })).toMatchObject({ label: 'M-1900-42', link: null });
  });
});

describe('WP-074 FR-SEQ-008 시퀀스 공간 분리', () => {
  it('첫 `@`에서 가른다 — 브랜치 이름의 `@`를 보존한다', () => {
    expect(splitSequenceSpace('acme/smp1900@release/2026@rc')).toEqual({
      repository: 'acme/smp1900',
      baseBranch: 'release/2026@rc',
    });
  });

  it('모양이 아니면 `null`', () => {
    expect(splitSequenceSpace(null)).toBeNull();
    expect(splitSequenceSpace('acme/smp1900')).toBeNull();
    expect(splitSequenceSpace('@main')).toBeNull();
    expect(splitSequenceSpace('acme/smp1900@')).toBeNull();
  });
});

describe('WP-074 FR-SEQ-008 pending 탐지', () => {
  it('pending이 하나라도 있으면 참, 커밋(키 없음)은 세지 않는다', () => {
    expect(hasPendingMergeNumber([{}, ASSIGNED, { merge_number_state: 'pending' }])).toBe(true);
    expect(hasPendingMergeNumber([{}, ASSIGNED, { merge_number_state: 'unavailable' }])).toBe(false);
    expect(hasPendingMergeNumber([])).toBe(false);
  });
});

describe('WP-074 FR-SEQ-008 자동 재검증 정책 (5초 간격 · 60초 상한)', () => {
  const base = { pending: true, enabled: true, hidden: false, inFlight: false, startedAt: 1_000, now: 6_000 };

  it('pending이고 보이고 진행 중이 아니면 보낸다', () => {
    expect(revalidationDecision(base)).toBe('revalidate');
  });

  it('pending이 없거나 화면이 ready가 아니면 아무것도 하지 않는다', () => {
    expect(revalidationDecision({ ...base, pending: false })).toBe('idle');
    expect(revalidationDecision({ ...base, enabled: false })).toBe('idle');
  });

  it('**60초가 지나면 멈춘다** — 숨김·진행 중보다 먼저 판정한다', () => {
    const late = { ...base, now: base.startedAt + MERGE_NUMBER_POLL_DEADLINE_MS };
    expect(revalidationDecision(late)).toBe('stop_deadline');
    expect(revalidationDecision({ ...late, hidden: true })).toBe('stop_deadline');
    expect(revalidationDecision({ ...late, inFlight: true })).toBe('stop_deadline');
    expect(revalidationDecision({ ...base, now: base.startedAt + MERGE_NUMBER_POLL_DEADLINE_MS - 1 })).toBe('revalidate');
  });

  it('숨은 탭에서는 보내지 않는다', () => {
    expect(revalidationDecision({ ...base, hidden: true })).toBe('skip_hidden');
  });

  it('**직전 요청이 돌아오지 않았으면 겹치지 않는다**', () => {
    expect(revalidationDecision({ ...base, inFlight: true })).toBe('skip_in_flight');
  });

  it('시작 시각이 없으면 마감을 판정하지 않는다', () => {
    expect(revalidationDecision({ ...base, startedAt: null, now: 10_000_000 })).toBe('revalidate');
  });
});

describe('WP-074 FR-SEQ-008 `/search` M 진입 읽기', () => {
  it('네 키가 다 있으면 complete — 값은 원문 그대로다', () => {
    const entry = readMergeNumberEntry(
      new URLSearchParams('m_repository=acme%2Fsmp1900&m_base_branch=main&m_seq_epoch=4&m_number=M-1900-42&q=repo%3Aacme'),
    );
    expect(entry).toEqual({ kind: 'complete', repository: 'acme/smp1900', baseBranch: 'main', seqEpoch: '4', number: 'M-1900-42' });
  });

  it('하나도 없으면 absent', () => {
    expect(readMergeNumberEntry(new URLSearchParams('q=repo%3Aacme'))).toEqual({ kind: 'absent' });
  });

  it('**일부만 있으면 partial — 빠진 키를 이름으로 말하고 메우지 않는다**', () => {
    const entry = readMergeNumberEntry(new URLSearchParams('m_number=M-1900-42&m_repository=acme%2Fsmp1900'));
    expect(entry).toEqual({
      kind: 'partial',
      present: [MERGE_NUMBER_PARAM.repository, MERGE_NUMBER_PARAM.number],
      missing: [MERGE_NUMBER_PARAM.baseBranch, MERGE_NUMBER_PARAM.seqEpoch],
    });
  });

  it('빈 값은 없는 것과 같다 — `m_seq_epoch=`로 에폭을 넘겼다고 치지 않는다', () => {
    const entry = readMergeNumberEntry(
      new URLSearchParams('m_repository=acme%2Fsmp1900&m_base_branch=main&m_seq_epoch=&m_number=M-1900-42'),
    );
    expect(entry.kind).toBe('partial');
  });

  it('해석 URL이 BFF 경로에 네 파라미터를 싣는다 (API-SEQ-007)', () => {
    expect(
      mergeNumberResolveUrl({ kind: 'complete', repository: 'acme/smp1900', baseBranch: 'main', seqEpoch: '4', number: 'M-1900-42' }),
    ).toBe('/api/merge-numbers/resolve?repository=acme%2Fsmp1900&base_branch=main&merge_number=M-1900-42&seq_epoch=4');
  });

  it('링크 href와 진입 읽기가 왕복한다', () => {
    const href = mergeNumberEntryHref({ repository: 'acme/smp1900', baseBranch: 'release/2026@rc', seqEpoch: 4, number: 'M-1900-42' });
    const entry = readMergeNumberEntry(new URLSearchParams(href.slice(href.indexOf('?') + 1)));
    expect(entry).toEqual({ kind: 'complete', repository: 'acme/smp1900', baseBranch: 'release/2026@rc', seqEpoch: '4', number: 'M-1900-42' });
  });

  it('PR 상세 경로는 조각마다 인코딩하고 모양이 아니면 `null`이다', () => {
    expect(pullRequestHref('acme/smp1900', 1234)).toBe('/pr/acme/smp1900/1234');
    expect(pullRequestHref('acme', 1)).toBeNull();
    expect(pullRequestHref('a/b/c', 1)).toBeNull();
  });
});

describe('WP-074 FR-SEQ-008 해석 응답 판정 (API-SEQ-007 CR-079 상태 표)', () => {
  const ok = {
    sequence_space: 'acme/smp1900@main',
    seq_epoch: 4,
    sequence_state: 'ok',
    epoch_stale: false,
    pr_number: 1234,
    merge_seq: 1342,
    merge_number: 'M-1900-42',
    merge_number_state: 'assigned',
    merge_number_epoch: 4,
    merge_number_reason: null,
    merge_number_projection_state: 'in_sync',
    correlation_id: 'c',
  };

  it('200 assigned → PR 상세 경로', () => {
    expect(judgeMergeNumberResolve(200, ok, 'acme/smp1900')).toEqual({
      kind: 'assigned',
      prNumber: 1234,
      mergeNumber: 'M-1900-42',
      seqEpoch: 4,
      sequenceSpace: 'acme/smp1900@main',
      href: '/pr/acme/smp1900/1234',
    });
  });

  it('200 pending → 잠정값 없이 대기', () => {
    expect(
      judgeMergeNumberResolve(200, { ...ok, merge_number: null, merge_number_state: 'pending', merge_number_reason: 'predecessor_pending' }, 'acme/smp1900'),
    ).toEqual({ kind: 'pending', reason: 'predecessor_pending', prNumber: 1234 });
  });

  it('**200 epoch_stale → 결과 키가 없어도 낡음으로 판정한다** — 자동 이동하지 않는다', () => {
    expect(
      judgeMergeNumberResolve(200, { sequence_space: 'acme/smp1900@main', seq_epoch: 5, epoch_stale: true, requested_seq_epoch: 4, correlation_id: 'c' }, 'acme/smp1900'),
    ).toEqual({ kind: 'epoch_stale', sequenceSpace: 'acme/smp1900@main', requestedEpoch: 4, currentEpoch: 5 });
  });

  it('404 + feature_disabled → 기능 off, 그 밖의 404 → 찾을 수 없음 (존재 유출 없음)', () => {
    expect(
      judgeMergeNumberResolve(404, { error: { code: 'NOT_FOUND', message: 'x', detail: { reason: 'feature_disabled' } } }, 'acme/smp1900'),
    ).toEqual({ kind: 'feature_disabled' });
    expect(judgeMergeNumberResolve(404, { error: { code: 'NOT_FOUND', message: 'x' } }, 'acme/smp1900')).toEqual({ kind: 'not_found' });
  });

  it('409 NO_SEQUENCE → 사유를 나른다', () => {
    expect(
      judgeMergeNumberResolve(409, { error: { code: 'NO_SEQUENCE', message: '시퀀스 채번을 기다리고 있습니다.', detail: { reason: 'not_sequenced' } } }, 'acme/smp1900'),
    ).toEqual({ kind: 'no_sequence', reason: 'not_sequenced', message: '시퀀스 채번을 기다리고 있습니다.' });
  });

  it('400 INVALID_PARAMETER → 필드와 사유', () => {
    expect(
      judgeMergeNumberResolve(400, { error: { code: 'INVALID_PARAMETER', message: '코드 불일치', detail: { field: 'merge_number', reason: 'repository_code_mismatch' } } }, 'acme/smp1900'),
    ).toEqual({ kind: 'invalid', message: '코드 불일치', field: 'merge_number', reason: 'repository_code_mismatch' });
  });

  it('401 → 재인증, 500 → 상관 ID를 나르는 오류', () => {
    expect(judgeMergeNumberResolve(401, { error: { code: 'UNAUTHENTICATED', message: 'x', detail: { login_path: '/auth/login' } } }, 'a/b')).toEqual({
      kind: 'auth_expired',
      loginPath: '/auth/login',
    });
    expect(judgeMergeNumberResolve(500, { error: { code: 'INTERNAL_ERROR', message: '정본 장애' }, correlation_id: 'cid' }, 'a/b')).toEqual({
      kind: 'error',
      code: 'INTERNAL_ERROR',
      message: '정본 장애',
      correlationId: 'cid',
      status: 500,
    });
  });

  it('2xx인데 아는 모양이 아니면 성공으로 위장하지 않는다', () => {
    expect(judgeMergeNumberResolve(200, {}, 'a/b')).toMatchObject({ kind: 'error', code: 'UNEXPECTED_RESPONSE' });
  });
});
