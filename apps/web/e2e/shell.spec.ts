import { expect, test, type Page } from '@playwright/test';

/**
 * 셸과 인증 라우트 (WP-015 DoD / FLOW-000, QA-COMMON).
 *
 * **실제 브라우저에서만 확인할 수 있는 것**만 여기 둔다. 역할 필터링이나
 * 포맷 같은 것은 단위·a11y 시험이 이미 더 촘촘하게 건다 — 같은 것을 느린
 * 계층에서 다시 걸면 실행 시간만 늘고 잡는 것은 늘지 않는다.
 */

test.describe('셸이 실제 브라우저에서 선다', () => {
  test('랜드마크가 서고 스킵 링크가 첫 탭이다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();

    // 스킵 링크는 평소 숨어 있다가 포커스를 받으면 나타난다.
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('href', '#main-content');
  });

  test('스킵 링크를 누르면 포커스가 본문으로 간다', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    /*
     * **URL이 아니라 포커스를 건다.**
     *
     * Conductor의 스킵 링크는 `preventDefault()` 후 `main`에 직접
     * `focus()`를 부른다. 해시 이동에 기대지 않는 것이 옳다 — 여러
     * 브라우저에서 `href="#id"` 이동은 스크롤만 옮기고 **키보드 포커스는
     * 옮기지 않아서**, 다음 탭이 본문이 아니라 헤더 다음 항목으로 간다.
     * 그래서 URL에 `#main-content`가 남지 않으며(히스토리도 더럽히지
     * 않는다), 스킵 링크가 존재하는 이유인 **포커스 이동**만 남는다.
     *
     * 이것이 실제 브라우저에서만 확인되는 것이다 — jsdom은 해시 이동의
     * 포커스 동작을 흉내 내지 못한다.
     */
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(focusedId).toBe('main-content');

    // 다음 탭이 본문 안에서 이어져야 스킵이 실제로 이뤄진 것이다.
    const inMain = await page.evaluate(
      () => document.getElementById('main-content')?.contains(document.activeElement) ?? false,
    );
    expect(inMain).toBe(true);
  });

  test('제목이 문서 제목에 실린다', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PR Search/);
  });

  test('`lang` is English so screen readers use the product language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('내비게이션', () => {
  test('링크가 실제로 이동한다', async ({ page }) => {
    await page.goto('/');

    // 화면은 WP-016 이후지만 경로 구조는 셸이 소유한다. 404여도 이동은 일어난다.
    await page.getByRole('link', { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search$/);
  });

  test('인증이 꺼진 배포에서는 운영 항목이 없다', async ({ page }) => {
    // 세션이 없으므로 역할도 없다 — 운영 그룹이 렌더링되지 않는다 (QA-A001-10).
    await page.goto('/');

    await expect(page.getByRole('link', { name: "Pipeline" })).toHaveCount(0);
    await expect(page.getByRole('link', { name: "Audit log" })).toHaveCount(0);
  });
});

test.describe('프록시가 미인증을 401로 막는다', () => {
  test('세션 없이 API를 부르면 401과 로그인 경로를 준다', async ({ request }) => {
    const response = await request.get('/api/search?q=test');

    expect(response.status()).toBe(401);
    const body = (await response.json()) as {
      error: { code: string; detail?: { login_path?: string } };
      correlation_id: string;
    };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.detail?.login_path).toBe('/auth/login');
    // 상관 ID가 있어야 사용자가 운영자에게 전달할 것이 생긴다.
    expect(body.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('위조한 세션 쿠키로도 통과하지 못한다', async ({ request }) => {
    const response = await request.get('/api/search?q=test', {
      headers: { cookie: '__Host-prs_session=forged-value' },
    });

    /*
     * Redis가 서 있으면 401(그런 세션이 없다), 없으면 503(확인할 수 없다).
     * **어느 쪽이든 통과하지 못한다**가 이 계층이 거는 것이다 — e2e 환경에
     * Redis를 요구하지 않으면서도 "위조가 통한다"는 회귀는 잡는다.
     *
     * 다만 이 단언만으로는 **부족하다.** 저장소가 없으면 503이 401을 가려
     * "그런 세션이 없다" 갈래가 한 번도 실행되지 않는다 — 변이 E11이
     * 그것을 드러냈다. 그 갈래는 `lib/proxy.test.ts`의 `resolveProxyAuth`가
     * 저장소 없이 직접 건다.
     */
    expect([401, 503]).toContain(response.status());
  });

  test('**신원 헤더로는 통과하지 못한다** (CR-018, DEV-067)', async ({ request }) => {
    for (const headers of [
      { 'x-user-id': 'attacker' },
      { 'x-forwarded-user': 'attacker' },
      { 'x-roles': 'operator' },
      { authorization: 'Bearer stolen' },
    ]) {
      const response = await request.get('/api/search?q=test', { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(401);
    }
  });

  test('상관 ID를 응답 헤더로도 돌려준다', async ({ request }) => {
    const response = await request.get('/api/search?q=test');
    expect(response.headers()['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

test.describe('인증 라우트 (FLOW-000)', () => {
  test('OIDC 미구성 배포에서는 로그인이 503이다 — IdP 대신 404로 보내지 않는다', async ({ request }) => {
    const response = await request.get('/auth/login', { maxRedirects: 0 });

    expect(response.status()).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PERMISSION_UNAVAILABLE');
  });

  test('콜백도 마찬가지다', async ({ request }) => {
    const response = await request.get('/auth/callback?code=x&state=y', { maxRedirects: 0 });
    expect(response.status()).toBe(503);
  });

  test('로그아웃은 `GET`을 받지 않는다 — `<img src>` 하나로 로그아웃되면 안 된다', async ({ request }) => {
    const response = await request.get('/auth/logout', { maxRedirects: 0 });
    expect(response.status()).toBe(405);
  });

  test('로그아웃 `POST`는 세션 쿠키를 만료시킨다', async ({ request }) => {
    const response = await request.post('/auth/logout');

    expect(response.status()).toBe(200);
    const setCookie = response.headers()['set-cookie'] ?? '';
    expect(setCookie).toContain('__Host-prs_session=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });
});

/**
 * 역방향 프록시 뒤의 복귀 주소와 로그아웃 완료 (CR-092 / DEV-699 · DEV-700).
 *
 * 라우트 시험은 `NextRequest`에 출처를 직접 넣으므로 **`next start`가 실제로 무엇을 출처로 삼는지**, 그리고 서버가
 * 상대 `Location`을 절대 주소로 바꾸지 않는지는 여기서만 보인다. 사내 `0.1.0-pilot.7`은 `Host`를 그대로 넘기는 nginx
 * 뒤에서 `location: https://localhost:3000/…`을 받았다 — 그 헤더들을 그대로 싣고 부른다.
 */
test.describe('프록시 뒤의 복귀 주소와 로그아웃 완료 (CR-092)', () => {
  const PROXY_HEADERS = { host: 'prs.corp.example', 'x-forwarded-host': 'prs.corp.example', 'x-forwarded-proto': 'https' };

  test('Operations 콜백의 복귀 주소에 서버가 들은 호스트가 실리지 않는다 (DEV-699)', async ({ request }) => {
    const response = await request.get('/gh/identity/callback', { headers: PROXY_HEADERS, maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe('/gh?identity=failed');
  });

  test('폼으로 로그아웃하면 303으로 완료 화면을 가리키고 쿠키를 만료시킨다 (DEV-700)', async ({ request }) => {
    const response = await request.post('/auth/logout', {
      headers: { ...PROXY_HEADERS, accept: 'text/html,application/xhtml+xml' },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/auth/signed-out');
    expect(response.headers()['set-cookie'] ?? '').toContain('Max-Age=0');
  });

  test('완료 화면은 세션 없이 서고, 셸 없이 다시 로그인할 길만 준다 (DEV-700)', async ({ page }) => {
    const response = await page.goto('/auth/signed-out');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: "Signed out" })).toBeVisible();
    // 셸의 내비게이션을 두지 않는다 — 누르면 로그인으로 이어져 IdP 세션으로 곧바로 다시 로그인된다.
    await expect(page.getByRole('navigation', { name: "Main navigation" })).toHaveCount(0);
    // 이 e2e는 인증을 끈 배포다 — 로그인 경로(503) 대신 진입 화면을 가리킨다.
    await expect(page.getByRole('link', { name: "Sign in again" })).toHaveAttribute('href', '/');
  });
});

test.describe('헬스체크', () => {
  test('`/healthz`가 200이다', async ({ request }) => {
    expect((await request.get('/healthz')).status()).toBe(200);
  });
});

test.describe('축소 모션 설정을 존중한다 (NFR-007 · Conductor FR-CSS-005)', () => {
  /*
   * 계산된 CSS 값은 jsdom이 흉내 내지 못한다. 레이어 밖에서 토큰을 한 번 더
   * 가져오면 @layer cdt.base 안의 0s 재정의가 무력화되므로(DEV-538), 실제
   * 브라우저에서 루트 토큰과 요소의 transition-duration을 직접 읽는다.
   *
   * Next 빌드는 Conductor CSS를 압축하면서 `140ms`를 `.14s`로 바꿔 쓴다.
   * 표기에 기대지 않도록 지속시간을 ms 숫자로 정규화해 비교한다.
   */
  function durationMs(value: string): number | null {
    const match = /^(\d*\.?\d+)(ms|s)\b/.exec(value.trim());
    if (match === null) return null;
    const amount = Number(match[1]);
    return match[2] === 's' ? Math.round(amount * 1000) : amount;
  }

  async function readMotion(page: Page) {
    return page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const item = document.querySelector('.ui-nav-link');
      return {
        fast: root.getPropertyValue('--ui-motion-fast').trim(),
        standard: root.getPropertyValue('--ui-motion-standard').trim(),
        itemDurations: item === null ? null : getComputedStyle(item).transitionDuration,
      };
    });
  }

  test('reduce에서는 모션 토큰과 전환 지속시간이 0s다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const motion = await readMotion(page);
    expect(durationMs(motion.fast)).toBe(0);
    expect(durationMs(motion.standard)).toBe(0);
    expect(motion.itemDurations).not.toBeNull();
    expect(motion.itemDurations?.split(',').every((d) => d.trim() === '0s')).toBe(true);
  });

  test('no-preference에서는 토큰이 살아 있다 — 축소가 토큰 소실로 통과하지 않게 한다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');

    const motion = await readMotion(page);
    expect(durationMs(motion.fast)).toBe(140);
    expect(durationMs(motion.standard)).toBe(240);
    expect(motion.itemDurations?.split(',').every((d) => d.trim() === '0.14s')).toBe(true);
  });
});
