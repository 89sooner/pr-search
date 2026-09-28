/**
 * A-004 순수 계층 (WP-039 / FR-AUTH-004, QA-A004-01·10, CR-054).
 *
 * 여기서 거는 것은 **화면이 사실을 왜곡하지 않는가**다. 서버가 `null`을 주면
 * `null`로 남는가, 빈 필터가 서버를 400으로 만들지 않는가, 403을 받고도
 * "결과 없음"이라 말하지 않는가.
 */

import { describe, expect, it } from 'vitest';
import { NOT_ACTIVATED_AUDIT_ACTIONS } from '@prs/domain';
import {
  ACTION_OPTIONS,
  EMPTY_FILTER,
  buildAuditRequestUrl,
  readAuditFilter,
  readCursorFailure,
  resolveAuditState,
  toAuditPage,
  writeAuditFilter,
  type AuditFilterState,
} from './audit';
import { AUDIT_INPUT_OFFSET, fromAuditDraft, fromKstWallClock, toAuditDraft, toKstWallClock } from './audit';

const FILLED: AuditFilterState = {
  userId: 'alice',
  action: 'search.execute',
  target: 'acme/payments',
  from: '2026-08-01T00:00',
  to: '2026-08-29T00:00',
  resultCode: 'ok',
};

describe('QA-A004-01: 다섯 축이 URL 상태로 왕복한다', () => {
  it('쓰고 읽으면 같은 값이 나온다', () => {
    expect(readAuditFilter(writeAuditFilter(FILLED))).toEqual(FILLED);
  });

  it('빈 값은 **키를 만들지 않는다**', () => {
    // `?action=`을 남기면 서버가 "빈 문자열과 정확히 일치"로 읽어 400을 낸다.
    expect(writeAuditFilter(EMPTY_FILTER).toString()).toBe('');
  });

  it('없는 파라미터는 빈 문자열로 읽는다', () => {
    expect(readAuditFilter(new URLSearchParams())).toEqual(EMPTY_FILTER);
  });

  it('일부만 채워도 그 축만 실린다', () => {
    const params = writeAuditFilter({ ...EMPTY_FILTER, action: 'audit.view' });
    expect(params.toString()).toBe('action=audit.view');
  });
});

describe('요청 URL', () => {
  it('조건이 없으면 질의 문자열도 없다', () => {
    expect(buildAuditRequestUrl(EMPTY_FILTER, null)).toBe('/api/admin/audit-records');
  });

  it('커서를 그대로 싣는다 — 해석하지 않는다', () => {
    const url = buildAuditRequestUrl(EMPTY_FILTER, 'abc.def');
    expect(url).toContain('cursor=abc.def');
  });

  it('빈 커서는 싣지 않는다', () => {
    expect(buildAuditRequestUrl(EMPTY_FILTER, '')).toBe('/api/admin/audit-records');
  });

  it('`/api/v1`을 만들지 않는다 — 프록시가 붙인다', () => {
    expect(buildAuditRequestUrl(FILLED, null)).not.toContain('/api/v1');
  });
});

describe('QA-A004-10: 없는 값을 지어내지 않는다', () => {
  it('`target`·`query`가 `null`이면 `null`로 남는다', () => {
    const page = toAuditPage({
      items: [
        {
          user_id: 'alice',
          action: 'search.execute',
          target: null,
          query: 'repo:acme/payments',
          occurred_at: '2026-08-29T04:12:07.412Z',
          result_code: 'ok',
          correlation_id: 'c1',
        },
      ],
      next_cursor: null,
    });
    expect(page.items[0]?.target).toBeNull();
    expect(page.items[0]?.query).toBe('repo:acme/payments');
  });

  it('빈 문자열도 `null`로 읽는다 — 둘 다 "값이 없다"이다', () => {
    const page = toAuditPage({ items: [{ target: '', query: '' }] });
    expect(page.items[0]?.target).toBeNull();
    expect(page.items[0]?.query).toBeNull();
  });

  it('필수 필드 일곱을 모두 옮긴다 (AC-2)', () => {
    const page = toAuditPage({
      items: [
        {
          user_id: 'bob',
          action: 'entity.view',
          target: 'commit:acme/payments:abc',
          query: null,
          occurred_at: '2026-08-29T00:00:00.000Z',
          result_code: 'ok',
          correlation_id: 'c9',
        },
      ],
    });
    expect(page.items[0]).toEqual({
      userId: 'bob',
      action: 'entity.view',
      target: 'commit:acme/payments:abc',
      query: null,
      occurredAt: '2026-08-29T00:00:00.000Z',
      resultCode: 'ok',
      correlationId: 'c9',
    });
  });

  it('본문이 아니면 빈 페이지다 — 던지지 않는다', () => {
    expect(toAuditPage(null)).toEqual({ items: [], nextCursor: null });
    expect(toAuditPage('nope')).toEqual({ items: [], nextCursor: null });
  });
});

describe('QA-A004-08: 화면이 제시하는 행위 후보', () => {
  it('legacy 값을 포함한다 — 과거를 조사할 수 있어야 한다', () => {
    expect(ACTION_OPTIONS).toContain('sequence_integrity.reassign');
  });

  it('활성 액션을 포함한다', () => {
    expect(ACTION_OPTIONS).toEqual(
      expect.arrayContaining(['search.execute', 'audit.view', 'retention.purge']),
    );
  });

  /*
   * **정본 목록과 대조한다.** 문자열을 여기 적으면 액션이 활성으로 옮겨갈
   * 때 이 시험이 그 사실을 결함으로 신고한다 — `WP-041`이 `safe_marker.set`을
   * 세우자 실제로 그렇게 됐다. 확인할 성질은 "미활성인 것이 목록에 없다"이지
   * "이 두 문자열이 없다"가 아니다.
   */
  it('**미활성 액션은 넣지 않는다** — 언제나 0건이라 "없다"와 구분되지 않는다', () => {
    for (const action of NOT_ACTIVATED_AUDIT_ACTIONS) {
      expect(ACTION_OPTIONS, action).not.toContain(action);
    }
  });

  it('활성으로 옮겨간 액션은 목록에 있다 (WP-041)', () => {
    expect(ACTION_OPTIONS).toContain('safe_marker.set');
  });

  it('WP-044 / FR-SRCH-012: 내보내기 실행을 감사 목록에서 조사할 수 있다', () => {
    expect(ACTION_OPTIONS).toContain('export.create');
  });
});

describe('커서 실패 갈래', () => {
  it('두 코드를 구분해 읽는다', () => {
    expect(readCursorFailure({ error: { code: 'CURSOR_INVALID' } })).toBe('CURSOR_INVALID');
    expect(readCursorFailure({ error: { code: 'CURSOR_QUERY_MISMATCH' } })).toBe(
      'CURSOR_QUERY_MISMATCH',
    );
  });

  it('다른 오류는 커서 실패가 아니다', () => {
    expect(readCursorFailure({ error: { code: 'INVALID_PARAMETER' } })).toBeNull();
    expect(readCursorFailure(null)).toBeNull();
  });

  it('**옛 판 커서는 셋째 갈래로 읽는다** — 서버 코드는 `CURSOR_INVALID`이고 사유가 `detail`에 있다 (DEV-777)', () => {
    expect(
      readCursorFailure({
        error: {
          code: 'CURSOR_INVALID',
          detail: { reason: 'cursor_version_outdated', issued_version: 1, current_version: 2 },
        },
      }),
    ).toBe('CURSOR_OUTDATED');
    // 사유가 없거나 다른 `CURSOR_INVALID`는 그대로다.
    expect(readCursorFailure({ error: { code: 'CURSOR_INVALID', detail: { reason: 'other' } } })).toBe('CURSOR_INVALID');
    // 조건 변경에 옛 판 사유가 붙어도 조건 변경이다 — 서버 코드가 먼저다.
    expect(
      readCursorFailure({ error: { code: 'CURSOR_QUERY_MISMATCH', detail: { reason: 'cursor_version_outdated' } } }),
    ).toBe('CURSOR_QUERY_MISMATCH');
  });
});

describe('상태 판정', () => {
  const base = { items: null, loading: false, status: null, cursorFailure: null } as const;

  it('**권한 없음이 먼저다** — 403을 "결과 없음"으로 말하지 않는다', () => {
    expect(resolveAuditState({ ...base, items: [], status: 403 })).toBe('no_permission');
    expect(resolveAuditState({ ...base, items: [], status: 401 })).toBe('no_permission');
  });

  it('첫 조회와 이어 보기를 가른다', () => {
    expect(resolveAuditState({ ...base, loading: true })).toBe('loading_initial');
    expect(resolveAuditState({ ...base, items: [], loading: true })).toBe('loading_more');
  });

  it('빈 목록은 `empty_no_result`다', () => {
    expect(resolveAuditState({ ...base, items: [], status: 200 })).toBe('empty_no_result');
  });

  it('항목이 있으면 `ready`다', () => {
    const items = [
      {
        userId: 'a',
        action: 'search.execute',
        target: null,
        query: 'q',
        occurredAt: 'x',
        resultCode: 'ok',
        correlationId: 'c',
      },
    ];
    expect(resolveAuditState({ ...base, items, status: 200 })).toBe('ready');
  });

  it('커서 실패가 오류보다 앞선다 — 복구 경로가 다르다', () => {
    expect(resolveAuditState({ ...base, items: [], status: 400, cursorFailure: 'CURSOR_INVALID' })).toBe(
      'cursor_invalid',
    );
  });

  it('그 밖의 4xx·5xx는 `error`다', () => {
    expect(resolveAuditState({ ...base, items: [], status: 500 })).toBe('error');
  });
});

describe('CR-127: 기간 입력은 KST 벽시계이고 +09:00을 붙여 보낸다 (FR-AUTH-004 AC-9)', () => {
  it('입력칸 값에 +09:00을 붙인다 — 브라우저 시간대와 무관하게 같은 요청이다', () => {
    expect(AUDIT_INPUT_OFFSET).toBe('+09:00');
    expect(fromKstWallClock('2026-09-27T00:00')).toBe('2026-09-27T00:00+09:00');
    expect(fromKstWallClock('')).toBe('');
  });

  it('URL 값을 같은 순간의 KST 벽시계로 채운다 — 옛 URL(오프셋 없음 = UTC)도 순간을 지킨다', () => {
    expect(toKstWallClock('2026-09-27T00:00+09:00')).toBe('2026-09-27T00:00');
    expect(toKstWallClock('2026-09-26T15:00:00Z')).toBe('2026-09-27T00:00');
    expect(toKstWallClock('2026-08-01T00:00')).toBe('2026-08-01T09:00');
    expect(toKstWallClock('2026-08-01')).toBe('2026-08-01T09:00');
    expect(toKstWallClock('yesterday')).toBe('');
    expect(toKstWallClock('')).toBe('');
  });

  it('옛 URL을 입력칸으로 읽고 그대로 다시 적용하면 같은 순간이다', () => {
    const legacy = { ...FILLED, from: '2026-08-01T00:00', to: '2026-08-29T00:00' };
    const reapplied = fromAuditDraft(toAuditDraft(legacy));
    expect(reapplied.from).toBe('2026-08-01T09:00+09:00');
    expect(Date.parse(reapplied.from)).toBe(Date.parse('2026-08-01T00:00Z'));
    expect(Date.parse(reapplied.to)).toBe(Date.parse('2026-08-29T00:00Z'));
    expect(reapplied.userId).toBe(legacy.userId);
  });

  it('요청 URL은 +를 %2B로 싣는다 — 공백으로 풀리지 않는다', () => {
    const url = buildAuditRequestUrl({ ...FILLED, from: '2026-09-27T00:00+09:00' }, null);
    expect(url).toContain('from=2026-09-27T00%3A00%2B09%3A00');
    expect(new URLSearchParams(url.split('?')[1] ?? '').get('from')).toBe('2026-09-27T00:00+09:00');
  });
});
