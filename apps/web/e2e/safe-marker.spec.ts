import { expect, test, type Page } from '@playwright/test';

/**
 * W-004 안전 구간 표식 (WP-041 DoD / FR-SEQ-006, C-031).
 *
 * ## 여기서만 잴 수 있는 것
 *
 * 실제 브라우저에서 **프록시를 지나는 왕복**이다 — 카드가 서고, 등록이
 * `PUT`을 보내며, 그 본문에 `expected_marker_seq`가 실리고, 충돌 응답이
 * **자동 재시도를 만들지 않는다**는 것. 마지막 것은 네트워크 계수로만
 * 잴 수 있어 단위·a11y로는 증명되지 않는다 (DEV-464).
 *
 * ## 자격 갈래는 여기서 재지 않는다
 *
 * e2e 서버는 `AUTH_ENABLED=false`로 돌므로 역할을 알 수 없고, 그 배포에서는
 * **빈 역할을 "자격 없음"으로 읽지 않는 것이 옳은 동작이다.** `QA-W004-12`의
 * 비활성 갈래는 `a11y/ranges.test.tsx`가 덮는다.
 */

const SPACES = {
  spaces: [
    {
      repository: 'acme/payments',
      base_branch: 'main',
      sequence_space: 'acme/payments@main',
      seq_epoch: 3,
      sequence_state: 'ok',
    },
  ],
};

function resolvedBody(position: string, expression: string): unknown {
  const seq = Number(/^seq:(\d+)$/.exec(expression)?.[1] ?? '1');
  return {
    sequence_space: 'acme/payments@main',
    seq_epoch: 3,
    resolved: [
      {
        position,
        expression,
        kind: 'sequence',
        merge_seq: seq,
        commit_sha: `${String(seq).padStart(2, '0')}${'e'.repeat(38)}`,
        boundary: position === 'from' ? 'exclusive' : 'inclusive',
        occurred_at: '2026-08-12T00:00:00Z',
      },
    ],
    correlation_id: 'a',
  };
}

const MARKER = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  marker: {
    merge_seq: 4,
    seq_epoch: 3,
    note: '결제 회귀 통과',
    created_by: 'kim',
    created_at: '2026-08-14T09:12:44Z',
    epoch_stale: false,
  },
  correlation_id: 'm',
};

interface MarkerStub {
  /** `GET /safe-markers`가 답할 본문. */
  readonly get?: unknown;
  /** `PUT /safe-markers`가 답할 상태와 본문. */
  readonly put?: { status: number; body: unknown };
}

interface Traffic {
  /** `PUT`으로 보낸 본문들. 자동 재시도 여부를 여기서 센다. */
  readonly puts: unknown[];
}

async function stubApi(page: Page, marker: MarkerStub = {}): Promise<Traffic> {
  const traffic: Traffic = { puts: [] };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/api/safe-markers')) {
      if (method === 'PUT') {
        traffic.puts.push(route.request().postDataJSON());
        const stub = marker.put ?? {
          status: 200,
          body: { ...MARKER, outcome: 'created', replaced_merge_seq: 4 },
        };
        await route.fulfill({
          status: stub.status,
          contentType: 'application/json',
          body: JSON.stringify(stub.body),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(marker.get ?? MARKER),
      });
      return;
    }

    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) body = SPACES;
    else if (url.includes('/api/sequence-anchors/resolve')) {
      const payload = route.request().postDataJSON() as {
        anchors?: { position: string; expression: string }[];
      };
      const anchor = payload.anchors?.[0];
      body = anchor === undefined ? {} : resolvedBody(anchor.position, anchor.expression);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return traffic;
}

test.describe('W-004 안전 구간 표식', () => {
  test('**카드가 서고 현재 표식을 그린다** (QA-W004-13)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main');

    await expect(page.getByTestId('safe-marker-card')).toBeVisible();
    await expect(page.getByTestId('safe-marker-seq')).toHaveText('seq 4');
    await expect(page.getByTestId('safe-marker-author')).toHaveText('kim');
    await expect(page.getByTestId('safe-marker-epoch')).toHaveText('3');
    await expect(page.getByTestId('safe-marker-note')).toHaveText('결제 회귀 통과');
  });

  test('**등록 대상은 끝 앵커다** (DEV-462)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main');

    // 앵커가 없으면 무엇을 표식할지 모른다 — 사유와 함께 막힌다.
    await expect(page.getByTestId('safe-marker-blocked')).toContainText('끝 앵커');

    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await expect(page.getByTestId('safe-marker-submit')).toContainText('seq 5');
    await expect(page.getByTestId('safe-marker-blocked')).toHaveCount(0);
  });

  test('**등록이 본 값을 함께 보낸다** (DEV-464)', async ({ page }) => {
    const traffic = await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await expect(page.getByTestId('safe-marker-submit')).toContainText('seq 5');

    await page.getByTestId('safe-marker-note-input').fill('릴리스 검증 완료');
    await page.getByTestId('safe-marker-submit').click();

    await expect(page.getByTestId('safe-marker-result')).toContainText('등록했습니다');
    expect(traffic.puts).toHaveLength(1);
    expect(traffic.puts[0]).toMatchObject({
      repository: 'acme/payments',
      base_branch: 'main',
      merge_seq: 5,
      seq_epoch: 3,
      note: '릴리스 검증 완료',
      // 화면이 본 현재 표식. 이것이 없으면 재시도가 남의 갱신을 되돌린다.
      expected_marker_seq: 4,
    });
  });

  test('**충돌은 사유를 말하고 자동으로 다시 보내지 않는다** (DEV-464)', async ({ page }) => {
    const traffic = await stubApi(page, {
      put: {
        status: 409,
        body: {
          error: {
            code: 'SAFE_MARKER_CONFLICT',
            message: '그 사이 다른 사람이 표식을 옮겼습니다',
            detail: { current_marker_seq: 9, expected_marker_seq: 4 },
          },
          correlation_id: 'c',
        },
      },
    });
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await expect(page.getByTestId('safe-marker-submit')).toContainText('seq 5');
    await page.getByTestId('safe-marker-submit').click();

    await expect(page.getByTestId('safe-marker-result')).toContainText('seq 9');
    // 한 번만 보냈다. 되돌리기가 정당한 동작이라 자동 재시도는 남의 판정을 덮는다.
    expect(traffic.puts).toHaveLength(1);
  });

  test('**낡은 표식을 감추지 않고 무효로 표시한다** (QA-W004-14)', async ({ page }) => {
    await stubApi(page, {
      get: {
        sequence_space: 'acme/payments@main',
        seq_epoch: 7,
        marker: {
          merge_seq: 4,
          seq_epoch: 3,
          note: null,
          created_by: 'kim',
          created_at: '2026-08-14T09:12:44Z',
          epoch_stale: true,
        },
        correlation_id: 'm',
      },
    });
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main');

    await expect(page.getByTestId('safe-marker-stale')).toContainText('무효');
    // 저장된 에폭이 그대로 보인다 — 현재 값으로 갈아 끼우면 무효가 사라진다.
    await expect(page.getByTestId('safe-marker-epoch')).toHaveText('3');
    await expect(page.getByTestId('safe-marker-seq')).toHaveText('seq 4');
  });

  test('표식이 없어도 카드를 감추지 않는다 (`marker_absent`)', async ({ page }) => {
    await stubApi(page, {
      get: { sequence_space: 'acme/payments@main', seq_epoch: 3, marker: null, correlation_id: 'm' },
    });
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main');

    await expect(page.getByTestId('safe-marker-card')).toBeVisible();
    await expect(page.getByTestId('safe-marker-absent')).toBeVisible();
  });

  test('메모 상한이 화면에 보인다 (AC-2)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');

    await expect(page.getByTestId('safe-marker-note-remaining')).toHaveText('500자 남음');
    await page.getByTestId('safe-marker-note-input').fill('가'.repeat(10));
    await expect(page.getByTestId('safe-marker-note-remaining')).toHaveText('490자 남음');
  });
});
