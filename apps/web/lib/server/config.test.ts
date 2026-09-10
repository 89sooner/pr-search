/**
 * web 구성 판정 (`CR-078` / `DEV-577`).
 *
 * `webConfigFailure`는 **기동 검증(`instrumentation.ts`)과 헬스체크가 함께 읽는
 * 하나의 판정**이다. 이것이 조용히 `null`을 돌려주기 시작하면 두 방어가 동시에
 * 사라지고, 배포는 다시 `0.1.0-pilot.3`의 모양으로 돌아간다 — 컨테이너는
 * 초록이고 사람이 여는 화면만 500인 상태다. 그래서 판정 자체를 건다.
 */

import { describe, expect, it, vi } from 'vitest';

/*
 * `server-only`는 `react-server` 조건이 없는 곳에서 **가져오는 즉시 던진다.**
 * 번들 경계를 지키는 표지이며 vitest는 번들러가 아니므로, 이 파일에서만
 * 비운다. 실제 경계는 `next build`가 강제한다.
 */
vi.mock('server-only', () => ({}));

const { resolveWebConfig, webConfigFailure } = await import('./config.js');

describe('DEV-577: 구성 판정이 한 곳에 있다', () => {
  it('성립하는 구성에서는 null이다', () => {
    expect(webConfigFailure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' })).toBeNull();
  });

  /**
   * **삼키지 않는다.** `try`로 감싼 판정이 `null`을 돌려주면 호출자는 성립한
   * 것으로 읽는다 — 이 함수가 존재하는 이유가 그 자리에서 사라진다.
   */
  it('계약을 어긴 구성에서는 이유를 돌려준다', () => {
    const failure = webConfigFailure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' });
    expect(failure).not.toBeNull();
    expect(failure).toContain('SESSION_COOKIE_SECURE');
  });

  it('돌려주는 이유가 resolveWebConfig가 던지는 것과 같다', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' };
    let thrown = '';
    try {
      resolveWebConfig(env);
    } catch (cause) {
      thrown = cause instanceof Error ? cause.message : String(cause);
    }
    expect(thrown).not.toBe('');
    expect(webConfigFailure(env)).toBe(thrown);
  });

  /**
   * 세션 쿠키만 보는 것이 아니다. `IDP_GROUP_ROLE_MAP`이 잘못돼도 같은 모양으로
   * 죽었다 — 요청마다 500이고 컨테이너는 초록이었다. 판정이 그 갈래도 잡아야
   * 기동 검증이 그것까지 막는다.
   */
  it('그룹 역할 매핑이 잘못돼도 판정한다', () => {
    const failure = webConfigFailure({
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true',
      IDP_GROUP_ROLE_MAP: '형식이없다',
    });
    expect(failure).not.toBeNull();
  });

  /**
   * 인증을 켰는데 자격 증명이 없으면 화면이 전부 `/auth/login`으로 가고 그
   * 라우트가 500을 낸다 — 컨테이너는 초록인데 아무도 로그인할 수 없다
   * (`DEV-579`). 그 구성으로 서지 않는다.
   */
  it('AUTH_ENABLED=true인데 OIDC 값이 비면 판정한다', () => {
    const failure = webConfigFailure({
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true',
      AUTH_ENABLED: 'true',
    });
    expect(failure).not.toBeNull();
    expect(failure).toContain('AUTH_ENABLED=true');
  });

  /**
   * **로그인 라우트가 부르는 함수를 그대로 부른다.** 키 목록을 옮겨 적었다면
   * `OIDC_REDIRECT_URI`가 빠진 채로 통과했을 것이다 — 실제로 배포 정의에서
   * 그 키가 빠져 있었고 로그인이 500이었다.
   */
  it('OIDC_REDIRECT_URI만 빠져도 판정한다', () => {
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true',
      AUTH_ENABLED: 'true',
      OIDC_ISSUER: 'https://idp.example',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
    };
    expect(webConfigFailure(base)).toContain('OIDC_REDIRECT_URI');
    expect(webConfigFailure({ ...base, OIDC_REDIRECT_URI: 'https://prs.example/auth/callback' })).toBeNull();
  });

  it('AUTH_ENABLED=false면 OIDC 값이 없어도 성립한다 — Pilot 형상이다', () => {
    expect(
      webConfigFailure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true', AUTH_ENABLED: 'false' }),
    ).toBeNull();
  });

  /**
   * **백킹 서비스를 보지 않는다.** DB·Redis·Elasticsearch가 늦게 올라오는 것은
   * 정상이며, 그것을 기동 실패로 판정하면 정상 배포가 순서 때문에 죽는다.
   */
  it('백킹 서비스 주소가 없어도 성립한다', () => {
    expect(webConfigFailure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' })).toBeNull();
  });
});
