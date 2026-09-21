import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/** 이 환경에 미리 놓인 Chromium. 없으면 Playwright 기본 해석을 쓴다. */
const PREINSTALLED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * E2E (WP-015 DoD / FLOW-000, CR-018 DEV-069).
 *
 * 이것이 DEV-032(`test:e2e` 스크립트 부재)를 닫는다. WP 20곳이 이 이름을
 * 참조해 왔고, 화면을 처음 세우는 WP가 harness를 세운다.
 *
 * **실제 브라우저로 돈다.** jsdom이 흉내 내지 못하는 것 — 리다이렉트 연쇄,
 * 쿠키 속성, 실제 포커스 이동 — 을 확인하는 것이 이 계층의 존재 이유다.
 */

const PORT = Number(process.env['WEB_E2E_PORT'] ?? 3100);
/**
 * 기본 `/search` 화면(RepositoryWorkspace)용 두 번째 서버 (CR-113).
 *
 * 아래 기본 서버는 `PRS_LEGACY_SEARCH=1`로 떠서 `/search`가 legacy `SearchView`로 분기한다.
 * 그 위에서 도는 spec은 legacy 화면을 시험하는 것이지 운영 기본 화면이 아니다 — 사내 보고의
 * 「M number 정렬」은 RepositoryWorkspace의 것이므로, 그 플래그 없이 뜬 서버를 하나 더 두고
 * `workspace.*.spec.ts`만 그쪽으로 보낸다.
 */
const WORKSPACE_PORT = Number(process.env['WEB_E2E_WORKSPACE_PORT'] ?? PORT + 1);
const WORKSPACE_SPEC = /workspace\..*\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  // CI에서 `.only`가 남아 나머지를 조용히 건너뛰는 것을 막는다.
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  reporter: process.env['CI'] === 'true' ? 'list' : 'line',

  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    // 실패했을 때만 흔적을 남긴다 — 통과한 실행의 아티팩트는 쓰이지 않는다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: WORKSPACE_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        /*
         * 이 실행 환경에 **사전 설치된** Chromium을 쓴다.
         *
         * `PLAYWRIGHT_BROWSERS_PATH`가 가리키는 빌드(1194)와 `@playwright/test`가
         * 기대하는 빌드가 다를 수 있어 기본 해석은 실패한다. 브라우저를 새로
         * 내려받지 않고(이그레스가 막혀 있다) 있는 것을 가리킨다.
         *
         * 경로가 없으면 `undefined`가 되어 Playwright의 기본 해석으로 돌아간다 —
         * 다른 환경(개발자 로컬·CI)에서 이 설정이 방해가 되지 않는다.
         */
        ...(existsSync(PREINSTALLED_CHROME) ? { launchOptions: { executablePath: PREINSTALLED_CHROME } } : {}),
      },
    },
    {
      name: 'workspace',
      testMatch: WORKSPACE_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(WORKSPACE_PORT)}`,
        ...(existsSync(PREINSTALLED_CHROME) ? { launchOptions: { executablePath: PREINSTALLED_CHROME } } : {}),
      },
    },
  ],

  /**
   * 앱을 직접 띄운다.
   *
   * **인증을 끈 채로 띄운다** (`AUTH_ENABLED=false`). 실제 IdP가 없는
   * 환경이므로 OIDC 왕복 전체를 e2e로 돌 수 없다 — 그 부분은 `@prs/authz`의
   * 단위 시험과 `lib/oidc-state.test.ts`가 덮는다. 여기서 확인하는 것은
   * **셸이 실제 브라우저에서 서는가**와 **인증 라우트가 올바른 응답을
   * 내는가**다.
   */
  webServer: [
    {
    command: `./node_modules/.bin/next start --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/healthz`,
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 120_000,
    env: {
      AUTH_ENABLED: 'false',
      PRS_LEGACY_SEARCH: '1',
      /*
       * `SESSION_COOKIE_SECURE`를 **덮어쓰지 않는다.**
       *
       * `next start`가 `NODE_ENV=production`으로 돌고, 그 상태에서
       * `SESSION_COOKIE_SECURE=false`를 주면 `resolveSessionReaderConfig`가
       * **기동을 거부한다** (WP-012 FR-AUTH-001 AC-2). 그것이 옳은 동작이므로
       * 시험을 위해 끄지 않는다 — 끄는 순간 e2e가 운영과 다른 앱을 시험한다.
       */
    },
    },
    {
      // 운영 기본 화면. `PRS_LEGACY_SEARCH`를 세우지 않는다 — 그것이 이 서버의 존재 이유다.
      command: `./node_modules/.bin/next start --port ${String(WORKSPACE_PORT)}`,
      url: `http://127.0.0.1:${String(WORKSPACE_PORT)}/healthz`,
      reuseExistingServer: process.env['CI'] !== 'true',
      timeout: 120_000,
      env: { AUTH_ENABLED: 'false' },
    },
  ],
});
