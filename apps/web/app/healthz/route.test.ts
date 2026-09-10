/**
 * 헬스체크가 구성을 본다 (`CR-078` / `DEV-577`).
 *
 * **왜 문자열이 아니라 실행으로 재는가.** 이 시험이 없을 때, `webConfigFailure`를
 * import한 채로 결과를 버리는 변이가 회귀의 소스 검사를 그대로 통과했다. 그
 * 상태의 배포는 다시 `0.1.0-pilot.3`이 된다 — 헬스체크는 초록이고 화면만 죽는다.
 * 핸들러를 실제로 불러 상태 코드를 본다.
 *
 * `instrumentation.ts`가 기동을 막으므로 운영에서 이 갈래에 닿는 일은 없어야
 * 한다. 그럼에도 거는 이유는 그 방어가 프레임워크 훅 하나에 걸려 있기 때문이다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

/* `server-only`는 `react-server` 조건 밖에서 가져오는 즉시 던진다. */
vi.mock('server-only', () => ({}));

const { GET } = await import('./route.js');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('DEV-577: /healthz가 구성을 본다', () => {
  it('구성이 성립하면 200과 ok를 낸다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'false');

    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'web' });
  });

  it('운영 계약을 어기면 200을 내지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    const response = GET();
    expect(response.status).toBe(503);
    // `ok`를 내면 Docker가 healthy로 보고한다 — 그것이 이 결함의 재발 경로다.
    expect(await response.json()).not.toMatchObject({ status: 'ok' });
  });

  it('인증을 켰는데 OIDC 값이 없어도 200을 내지 않는다 (DEV-579)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('OIDC_ISSUER', undefined);

    expect(GET().status).toBe(503);
  });

  /**
   * **본문이 구성 값을 반사하지 않는다** (NFR-005). 이 경로는 호스트 포트에
   * 열려 있고 판정 문구에는 구성 값이 실릴 수 있다.
   */
  it('실패 본문에 판정 문구를 싣지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('IDP_GROUP_ROLE_MAP', 'secret-group-name:없는역할');

    const body = JSON.stringify(await GET().json());
    expect(body).not.toContain('secret-group-name');
    // 대신 운영자만 읽는 로그로 간다.
    expect(logged).toHaveBeenCalled();
  });
});
