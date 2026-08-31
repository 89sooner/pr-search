/**
 * W-004 안전 구간 표식의 화면 판정 (WP-041 / FR-SEQ-006, C-031).
 *
 * 여기서 거는 것은 **판정**이다. 그 판정이 실제로 그려지는가는
 * `a11y/ranges.test.tsx`가 본다.
 */

import { describe, expect, it } from 'vitest';
import {
  MARKER_WRITE_ROLE,
  judgeMarkerSubmit,
  markerBlockedReason,
  markerCardState,
  markerRequestUrl,
  mayWriteMarker,
  type MarkerView,
} from './safe-marker';

const MARKER: MarkerView = {
  merge_seq: 4,
  seq_epoch: 3,
  note: '검증 완료',
  created_by: 'kim',
  created_at: '2026-08-14T09:12:44Z',
  epoch_stale: false,
};

describe('쓰기 자격 (FR-SEQ-006 AC-3, OD-008)', () => {
  it(`\`${MARKER_WRITE_ROLE}\`만 등록할 수 있다`, () => {
    expect(mayWriteMarker([MARKER_WRITE_ROLE])).toBe(true);
    expect(mayWriteMarker(['developer', MARKER_WRITE_ROLE])).toBe(true);
    expect(mayWriteMarker(['developer'])).toBe(false);
    expect(mayWriteMarker([])).toBe(false);
  });

  it('**`operator`가 대신하지 않는다** — OD-008이 `(b) 저장소 관리자 포함`을 택하지 않았다', () => {
    expect(mayWriteMarker(['operator'])).toBe(false);
    expect(mayWriteMarker(['security_officer'])).toBe(false);
  });

  it('인증이 구성되지 않은 배포에서는 빈 역할을 "자격 없음"으로 읽지 않는다', () => {
    expect(mayWriteMarker([], false)).toBe(true);
    // 완화는 그 배포에만 적용된다 — 인증이 있으면 역할이 판정한다.
    expect(mayWriteMarker([], true)).toBe(false);
  });
});

describe('카드 상태 (상태 매트릭스 W-004)', () => {
  it('표식이 없으면 `marker_absent`다 — 카드를 감추지 않는다', () => {
    expect(markerCardState(null)).toBe('marker_absent');
  });

  it('에폭이 낡으면 `marker_epoch_stale`이다 (AC-4)', () => {
    expect(markerCardState({ ...MARKER, epoch_stale: true })).toBe('marker_epoch_stale');
  });

  it('그 밖에는 `ready`다', () => {
    expect(markerCardState(MARKER)).toBe('ready');
  });

  it('**자격은 카드 상태를 바꾸지 않는다** — 막히는 것은 버튼이다', () => {
    // 무효한 표식을 가진 사용자가 자격이 없더라도 그 무효를 봐야 한다.
    expect(markerCardState({ ...MARKER, epoch_stale: true })).toBe('marker_epoch_stale');
  });
});

describe('등록이 막힌 이유 (C-031 사용 규칙)', () => {
  it('자격이 없으면 필요한 역할 이름을 말한다', () => {
    expect(markerBlockedReason(false, 5)).toContain(MARKER_WRITE_ROLE);
  });

  it('끝 앵커가 없으면 그 사실을 말한다 (`marker_target_unresolved`)', () => {
    expect(markerBlockedReason(true, null)).toContain('끝 앵커');
  });

  it('**자격 없음이 앵커 미해석보다 앞선다** — 자격이 없으면 앵커를 해석해도 못 누른다', () => {
    expect(markerBlockedReason(false, null)).toContain(MARKER_WRITE_ROLE);
  });

  it('둘 다 만족하면 막지 않는다', () => {
    expect(markerBlockedReason(true, 5)).toBeNull();
  });
});

describe('등록 응답 판정 (API-SEQ-004)', () => {
  it('`created`는 대체한 서수를 함께 준다', () => {
    const outcome = judgeMarkerSubmit(200, {
      outcome: 'created',
      marker: MARKER,
      replaced_merge_seq: 2,
    });
    expect(outcome).toEqual({ kind: 'created', marker: MARKER, replaced: 2 });
  });

  it('첫 등록은 `replaced`가 `null`이다', () => {
    const outcome = judgeMarkerSubmit(200, { outcome: 'created', marker: MARKER });
    expect(outcome).toMatchObject({ kind: 'created', replaced: null });
  });

  it('`unchanged`를 `created`와 가른다 — 재시도가 등록으로 보이면 안 된다', () => {
    const outcome = judgeMarkerSubmit(200, { outcome: 'unchanged', marker: MARKER });
    expect(outcome).toEqual({ kind: 'unchanged', marker: MARKER });
  });

  it('**409 둘을 코드로 가른다** — 사용자가 해야 할 일이 다르다', () => {
    const conflict = judgeMarkerSubmit(409, {
      error: {
        code: 'SAFE_MARKER_CONFLICT',
        message: '옮겨졌습니다',
        detail: { current_marker_seq: 9 },
      },
    });
    expect(conflict).toEqual({ kind: 'conflict', currentSeq: 9 });

    const stale = judgeMarkerSubmit(409, {
      error: {
        code: 'SEQUENCE_EPOCH_STALE',
        message: '에폭이 바뀌었습니다',
        detail: { current_seq_epoch: 5 },
      },
    });
    expect(stale).toEqual({ kind: 'epoch_stale', currentEpoch: 5 });
  });

  it('표식이 지워진 충돌은 `currentSeq`가 `null`이다', () => {
    const outcome = judgeMarkerSubmit(409, {
      error: { code: 'SAFE_MARKER_CONFLICT', message: 'x', detail: {} },
    });
    expect(outcome).toEqual({ kind: 'conflict', currentSeq: null });
  });

  it('그 밖의 오류는 코드와 메시지를 그대로 옮긴다 — 재해석하지 않는다', () => {
    const outcome = judgeMarkerSubmit(400, {
      error: { code: 'SEQUENCE_NOT_FOUND', message: '그 서수는 없습니다', detail: { merge_seq: 99 } },
    });
    expect(outcome).toEqual({
      kind: 'error',
      code: 'SEQUENCE_NOT_FOUND',
      message: '그 서수는 없습니다',
    });
  });

  it('200인데 표식이 없으면 성공으로 읽지 않는다', () => {
    const outcome = judgeMarkerSubmit(200, { outcome: 'created', marker: null });
    expect(outcome).toMatchObject({ kind: 'error' });
  });
});

describe('조회 URL', () => {
  it('공간을 질의 파라미터로 지목한다', () => {
    expect(markerRequestUrl('acme/payments', 'main')).toBe(
      '/api/safe-markers?repository=acme%2Fpayments&base_branch=main',
    );
  });

  it('슬래시가 있는 브랜치도 인코딩한다', () => {
    expect(markerRequestUrl('acme/payments', 'release/2026-08')).toContain(
      'base_branch=release%2F2026-08',
    );
  });
});
