/**
 * A-002 저장소 등록 관리 컴포넌트 (WP-040 DoD / QA-A002-02·03·06·07·09·11, CR-055).
 *
 * 여기서 거는 것은 순수 판정이 실제로 그려지는가와 접근성이다:
 *   - **"등록 폼 채우기"가 요청 상태를 바꾸지 않는가** (AC-11, QA-A002-07)
 *   - 처리 상태·처리자·메모가 운영자 평면에 보이는가 (QA-A002-06)
 *   - 종료가 확인을 거치며 **확인 전에는 `onDismiss`를 부르지 않는가** (QA-A002-09)
 *   - 해제 문구가 "삭제"를 쓰지 않는가 (AC-3, QA-A002-03)
 *   - 브랜치 상한을 넘으면 알리는가 (AC-2, QA-A002-02)
 *   - **예상 소요를 지어내지 않는가** (DEV-435, QA-A002-11)
 *   - axe 위반 0건
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistrationRequestQueue } from '../components/RegistrationRequestQueue';
import { RepositoryRegistrationForm } from '../components/RepositoryRegistrationForm';
import { UNREGISTER_CONFIRM_MESSAGE, type RegistrationRequestView } from '../lib/ops-repositories';

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const REQUESTS: readonly RegistrationRequestView[] = [
  {
    request_id: '101',
    requested_by: 'alice',
    repository: 'acme/payments',
    created_at: '2026-08-30T01:00:00.000Z',
    status: 'pending',
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
  },
  {
    request_id: '102',
    requested_by: 'bob',
    repository: 'acme/ledger',
    created_at: '2026-08-29T01:00:00.000Z',
    status: 'dismissed',
    resolved_at: '2026-08-29T05:00:00.000Z',
    resolved_by: 'operator',
    resolution_note: '사내 저장소가 아닙니다',
  },
  {
    request_id: '103',
    requested_by: 'carol',
    repository: 'acme/wallet',
    created_at: '2026-08-28T01:00:00.000Z',
    status: 'fulfilled',
    resolved_at: '2026-08-28T06:00:00.000Z',
    resolved_by: 'operator',
    resolution_note: null,
  },
];

afterEach(() => {
  cleanup();
});

describe('RegistrationRequestQueue (C-071)', () => {
  it('QA-A002-06: 처리 상태·처리자·처리 시각·메모를 함께 보인다', () => {
    render(<RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={vi.fn()} />);
    const dismissed = screen.getAllByTestId('request-row')[1] as HTMLElement;
    expect(dismissed.textContent).toContain("Closed");
    expect(within(dismissed).getByTestId('request-resolved-by').textContent).toBe('operator');
    expect(within(dismissed).getByTestId('request-note').textContent).toContain("사내 저장소가 아닙니다");
  });

  it('**QA-A002-07: "등록 폼 채우기"는 요청 상태를 바꾸지 않는다** — 폼만 채운다', () => {
    const onPrefill = vi.fn();
    const onDismiss = vi.fn();
    render(<RegistrationRequestQueue requests={REQUESTS} onPrefill={onPrefill} onDismiss={onDismiss} />);

    fireEvent.click(within(screen.getAllByTestId('request-row')[0] as HTMLElement).getByTestId('request-prefill'));

    expect(onPrefill).toHaveBeenCalledWith(REQUESTS[0]);
    // 종료도 등록도 일어나지 않는다 — 승인은 성공한 등록 그 자체다.
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('종료된 요청에는 조작이 없다 — 다시 여는 경로를 만들지 않았다', () => {
    render(<RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={vi.fn()} />);
    for (const index of [1, 2]) {
      const row = screen.getAllByTestId('request-row')[index] as HTMLElement;
      expect(within(row).queryAllByRole('button')).toHaveLength(0);
    }
  });

  it('**QA-A002-09: 확인 전에는 `onDismiss`를 부르지 않는다**', () => {
    const onDismiss = vi.fn();
    render(<RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(within(screen.getAllByTestId('request-row')[0] as HTMLElement).getByTestId('request-dismiss-open'));
    expect(onDismiss).not.toHaveBeenCalled();

    // 사유가 비어 있으면 눌러도 나가지 않는다.
    fireEvent.click(screen.getByTestId('request-dismiss-submit'));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('request-dismiss-reason'), { target: { value: '대상이 아닙니다' } });
    fireEvent.click(screen.getByTestId('request-dismiss-submit'));
    expect(onDismiss).toHaveBeenCalledWith('101', "대상이 아닙니다");
  });

  it('상한을 넘는 사유는 보내지 않는다', () => {
    const onDismiss = vi.fn();
    render(<RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(within(screen.getAllByTestId('request-row')[0] as HTMLElement).getByTestId('request-dismiss-open'));
    fireEvent.change(screen.getByTestId('request-dismiss-reason'), { target: { value: 'x'.repeat(501) } });
    fireEvent.click(screen.getByTestId('request-dismiss-submit'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('현재 페이지 행 수를 전체 수처럼 적지 않는다', () => {
    render(
      <RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={vi.fn()} nextCursor="abc" />,
    );
    const count = screen.getByTestId('request-count').textContent ?? '';
    expect(count).toContain("Loaded 3 items so far.");
    expect(count).toContain("More items available.");
    expect(count).not.toContain("Total 3");
  });

  it('빈 목록은 나머지 섹션을 막지 않는다 (`requests_empty`)', () => {
    render(<RegistrationRequestQueue requests={[]} onPrefill={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('request-queue').getAttribute('data-state')).toBe('requests_empty');
  });

  it('axe 위반 0건', async () => {
    const { container } = render(
      <RegistrationRequestQueue requests={REQUESTS} onPrefill={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(await violations(container)).toEqual([]);
  });
});

const EDIT_TARGET = {
  repository_id: 4021,
  owner: 'acme',
  name: 'payments',
  sequence_branches: ['main'],
  mirror_enabled: true,
};

describe('RepositoryRegistrationForm (C-043)', () => {
  it('QA-A002-02: 브랜치 11개를 적으면 상한을 알린다', () => {
    const onSubmit = vi.fn();
    render(<RepositoryRegistrationForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('registration-owner'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByTestId('registration-name'), { target: { value: 'payments' } });
    fireEvent.change(screen.getByTestId('registration-branches'), {
      target: { value: Array.from({ length: 11 }, (_, i) => `b${String(i)}`).join('\n') },
    });

    expect(screen.getByTestId('registration-form-wrapper').getAttribute('data-state')).toBe('error_branch_limit');
    fireEvent.click(screen.getByTestId('registration-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('중복 브랜치는 접어 세므로 상한에 걸리지 않는다', () => {
    const onSubmit = vi.fn();
    render(<RepositoryRegistrationForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('registration-owner'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByTestId('registration-name'), { target: { value: 'payments' } });
    fireEvent.change(screen.getByTestId('registration-branches'), { target: { value: 'main\nmain\nmain' } });
    fireEvent.click(screen.getByTestId('registration-submit'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sequence_branches: ['main'] }));
  });

  it('**QA-A002-11: 예상 소요를 지어내지 않는다** — 생성될 잡을 가리킨다', () => {
    render(
      <RepositoryRegistrationForm
        edit={EDIT_TARGET}
        onSubmit={vi.fn()}
        onUnregister={vi.fn()}
        sequenceJobIds={[77]}
      />,
    );
    fireEvent.change(screen.getByTestId('registration-branches'), { target: { value: 'main\nrelease' } });

    const added = screen.getByTestId('registration-added-branches').textContent ?? '';
    expect(added).toContain('release');
    expect(added).toContain("job operations");
    // 시간을 지어내지 않는다.
    expect(added).not.toMatch(/about \d+|estimated|minutes required/);
    expect(screen.getByTestId('registration-sequence-jobs').textContent).toContain('77');
  });

  it('**QA-A002-03: 해제 문구가 "삭제"를 쓰지 않는다**', () => {
    render(<RepositoryRegistrationForm edit={EDIT_TARGET} onSubmit={vi.fn()} onUnregister={vi.fn()} />);
    fireEvent.click(screen.getByTestId('registration-unregister-open'));

    const message = screen.getByTestId('unregister-message').textContent ?? '';
    expect(message).toBe(UNREGISTER_CONFIRM_MESSAGE);
    expect(message).toContain("documents will be retained");
    expect(message).not.toContain("Delete");
  });

  it('**확인 전에는 `onUnregister`를 부르지 않는다**', () => {
    const onUnregister = vi.fn();
    render(<RepositoryRegistrationForm edit={EDIT_TARGET} onSubmit={vi.fn()} onUnregister={onUnregister} />);

    fireEvent.click(screen.getByTestId('registration-unregister-open'));
    expect(onUnregister).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('unregister-confirm'));
    expect(onUnregister).toHaveBeenCalledTimes(1);
  });

  it('`prefill`이 폼을 채운다 — 요청 상태는 건드리지 않는다', () => {
    render(<RepositoryRegistrationForm prefill={{ owner: 'acme', name: 'wallet' }} onSubmit={vi.fn()} />);
    expect((screen.getByTestId('registration-owner') as HTMLInputElement).value).toBe('acme');
    expect((screen.getByTestId('registration-name') as HTMLInputElement).value).toBe('wallet');
  });

  it('접근 권한이 없으면 필요한 권한을 그대로 적는다', () => {
    render(
      <RepositoryRegistrationForm
        onSubmit={vi.fn()}
        requiredPermissions={['metadata:read', 'contents:read', 'pull_requests:read']}
      />,
    );
    const notice = screen.getByTestId('registration-no-access').textContent ?? '';
    expect(notice).toContain('metadata:read');
    expect(notice).toContain('pull_requests:read');
  });

  it('axe 위반 0건', async () => {
    const { container } = render(
      <RepositoryRegistrationForm edit={EDIT_TARGET} onSubmit={vi.fn()} onUnregister={vi.fn()} />,
    );
    expect(await violations(container)).toEqual([]);
  });
});
