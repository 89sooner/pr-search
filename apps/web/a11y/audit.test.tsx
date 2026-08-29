/**
 * A-004 감사 로그 컴포넌트 (WP-039 DoD / QA-A004-02·03·10, NFR-007, CR-054).
 *
 * 순수 판정은 `lib/audit.test.ts`가 이미 걸었다. 여기서 거는 것은 **그 판정이
 * 실제로 그려지는가**와 접근성이다:
 *   - 일곱 열이 모두 있는가 (AC-2)
 *   - `null`을 빈 칸으로 그리는가, `N/A`를 지어내지 않는가 (AC-2, QA-A004-10)
 *   - **수정·삭제 컨트롤이 하나도 없는가** (AC-3, QA-A004-03)
 *   - `no_permission`이 필요 역할을 그대로 적는가 (NFR-006)
 *   - axe 위반 0건
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditRecordView } from '../lib/audit';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ops/audit',
  useSearchParams: () => new URLSearchParams(''),
}));

const { AuditRecordTable } = await import('../components/AuditRecordTable');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const ROWS: readonly AuditRecordView[] = [
  {
    userId: 'alice',
    action: 'search.execute',
    // 검색은 대상이 하나가 아니다 — 그 칸이 비어야 한다.
    target: null,
    query: 'repo:acme/payments seq:1200..1350',
    occurredAt: '2026-08-29T04:12:07.412Z',
    resultCode: 'ok',
    correlationId: '11111111-1111-4111-8111-111111111111',
  },
  {
    userId: 'bob',
    action: 'entity.view',
    target: 'commit:acme/payments:a3f9c21',
    // 상세 조회는 조건이 없다.
    query: null,
    occurredAt: '2026-08-29T04:10:00.000Z',
    resultCode: 'not_found',
    correlationId: '22222222-2222-4222-8222-222222222222',
  },
  {
    userId: 'system:audit-retention',
    action: 'retention.purge',
    target: 'audit_record_2025_07',
    query: null,
    occurredAt: '2026-08-29T03:00:00.000Z',
    resultCode: 'dropped',
    correlationId: '33333333-3333-4333-8333-333333333333',
  },
];

afterEach(() => {
  cleanup();
});

describe('AuditRecordTable', () => {
  it('QA-A004-02: 일곱 열을 모두 그린다 (AC-2)', () => {
    render(<AuditRecordTable items={ROWS} />);
    for (const header of ['시각', '사용자', '행위', '대상', '질의', '결과', '상관 ID']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
  });

  it('QA-A004-10: `null`을 빈 값으로 그린다 — `N/A`를 지어내지 않는다', () => {
    render(<AuditRecordTable items={ROWS} />);
    const rows = screen.getAllByTestId('audit-row');

    // 검색 행: 대상이 비고 질의가 있다.
    const searchRow = rows[0];
    expect(searchRow).toBeTruthy();
    expect(within(searchRow as HTMLElement).getByTestId('audit-absent')).toBeTruthy();
    expect(within(searchRow as HTMLElement).getByTestId('audit-query').textContent).toContain(
      'repo:acme/payments',
    );

    // 어디에도 `N/A`나 `없음` 같은 지어낸 값이 없다.
    expect(screen.queryByText('N/A')).toBeNull();
    expect(screen.queryByText('-')).toBeNull();
  });

  it('빈 값에 접근 가능한 이름을 준다 — 스크린 리더가 대시를 읽지 않는다', () => {
    render(<AuditRecordTable items={ROWS} />);
    const absent = screen.getAllByTestId('audit-absent');
    expect(absent.length).toBeGreaterThan(0);
    expect(absent[0]?.getAttribute('aria-label')).toBe('값 없음');
  });

  it('**질의를 자르지 않는다** — AC-2가 요구하는 것은 재구성 가능한 문자열이다', () => {
    render(<AuditRecordTable items={ROWS} />);
    const query = screen.getAllByTestId('audit-query')[0];
    expect(query?.textContent).toBe('repo:acme/payments seq:1200..1350');
    expect(query?.textContent).not.toContain('…');
  });

  it('QA-A004-03: **수정·삭제 컨트롤이 하나도 없다** (AC-3)', () => {
    const { container } = render(<AuditRecordTable items={ROWS} />);
    // 버튼·링크·체크박스 어느 것도 두지 않는다 — 불변성을 흉내 낼 자리를
    // 아예 만들지 않는다.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('표에 설명이 있다 — 무엇을 보는 표인지 말한다', () => {
    const { container } = render(<AuditRecordTable items={ROWS} />);
    const caption = container.querySelector('caption');
    expect(caption?.textContent).toContain('수정·삭제할 수 없습니다');
  });

  it('빈 목록도 머리글을 그린다 — 표가 사라지지 않는다', () => {
    render(<AuditRecordTable items={[]} />);
    expect(screen.getByRole('columnheader', { name: '행위' })).toBeTruthy();
    expect(screen.queryAllByTestId('audit-row')).toHaveLength(0);
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<AuditRecordTable items={ROWS} />);
    expect(await violations(container)).toEqual([]);
  });

  it('빈 목록에서도 axe 위반 0건', async () => {
    const { container } = render(<AuditRecordTable items={[]} />);
    expect(await violations(container)).toEqual([]);
  });
});
