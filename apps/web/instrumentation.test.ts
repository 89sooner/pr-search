/**
 * 기동 검증이 실제로 기동을 막는다 (`CR-078` / `DEV-577`).
 *
 * **왜 문자열이 아니라 실행으로 재는가.** 소스에 `exit(1)`이 있는지만 보면,
 * 그 앞에 `return`을 넣거나 `NODE_ENV` 비교를 바꿔 종료를 죽은 코드로 만드는
 * 변이를 놓친다 — 적대적 검토가 실제로 그 변이를 통과시켰다. `register()`를
 * 불러 **종료가 요청되는지**를 본다.
 *
 * `process.exit`를 실제로 부르면 시험 실행기가 죽으므로 그 자리를 가로챈다.
 * 가로채는 것은 종료 그 자체가 아니라 **종료를 요청했다는 사실**이다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { register } = await import('./instrumentation.js');

let exits: number[];
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exits = [];
  // 실제로 종료하면 vitest가 죽는다. 요청만 받아 적는다.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exits.push(code ?? 0);
    return undefined as never;
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});

afterEach(() => {
  vi.unstubAllEnvs();
  exitSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('DEV-577: 기동 검증', () => {
  it('구성이 성립하면 종료하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'false');

    await register();
    expect(exits, '멀쩡한 배포를 죽였다').toEqual([]);
  });

  /**
   * 이 배포가 사내에서 막힌 그 구성이다.
   *
   * **`AUTH_ENABLED`를 적지 않은 배포는 면제되지 않는다** (`CR-083`). 자격 증명을
   * 나중에 채우는 순간 인증이 켜지기 때문이다.
   */
  it('운영에서 SESSION_COOKIE_SECURE=false면 0이 아닌 코드로 종료한다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    await register();
    expect(exits, '잘못된 구성으로 기동했다 — 초록으로 서서 화면만 500이 된다').toHaveLength(1);
    expect(exits[0]).not.toBe(0);
  });

  /**
   * **인증을 명시적으로 끈 파일럿은 기동한다** (`CR-083`, 사용자 결정).
   *
   * 그 형상에서는 로그인 경로가 503을 내고 세션이 발급되지 않으므로 보호할
   * 쿠키가 없다.
   */
  it('AUTH_ENABLED=false를 명시하면 종료하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('AUTH_ENABLED', 'false');

    await register();
    expect(exits, '세션이 발급되지 않는 형상까지 막았다').toHaveLength(0);
  });

  /**
   * **그 값을 남긴 채 인증만 켜면 다시 막는다.**
   *
   * `CR-078`이 적은 우려가 이것이다 — 「지금은 안 쓰니까」로 열어 두면 열린 채로
   * 켜진다. 그 전환이 환경 변수 한 줄이므로 구조로 막는다.
   */
  it('insecure 쿠키를 남긴 채 인증을 켜면 종료한다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('AUTH_ENABLED', 'true');

    await register();
    expect(exits, '열린 채로 켜졌다').toHaveLength(1);
    expect(exits[0]).not.toBe(0);
  });

  it('인증을 켰는데 OIDC 값이 없으면 종료한다 (DEV-579)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('OIDC_ISSUER', undefined);

    await register();
    expect(exits).toHaveLength(1);
  });

  it('OIDC 값이 완비되면 종료하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example');
    vi.stubEnv('OIDC_CLIENT_ID', 'id');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'secret');
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://prs.example/auth/callback');

    await register();
    expect(exits).toEqual([]);
  });

  /**
   * **이유를 적지 않고 죽지 않는다.** 종료만 하면 운영자는 컨테이너가 재기동을
   * 반복하는 것만 보고 무엇이 틀렸는지 알 수 없다.
   */
  it('종료하기 전에 이유를 적는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    await register();
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[0])).toContain('SESSION_COOKIE_SECURE');
  });

  /** 개발 루프를 죽이지 않는다 — 이것은 운영 계약이다. */
  it('개발에서는 종료하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    await register();
    expect(exits).toEqual([]);
  });

  /** Edge 런타임에는 종료할 프로세스가 없다. */
  it('nodejs 런타임이 아니면 아무것도 하지 않는다', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');

    await register();
    expect(exits).toEqual([]);
  });
});
