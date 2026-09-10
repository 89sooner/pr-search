/**
 * 세션 구성 계약 (WP-012 / FR-AUTH-001 AC-2, `CR-078` `DEV-577`).
 *
 * ## 왜 이 파일이 늦게 생겼는가
 *
 * 이 계약은 `WP-012`부터 있었지만 **계약 자체를 거는 시험이 없었다.** 배포 문서와
 * 코드 주석이 「운영에서 false면 기동을 막는다」고 적고, 원장의 검증 표도 그렇게
 * 적었는데, 그 문장이 참인지 재는 자리가 어디에도 없었다. 사내 반입
 * `0.1.0-pilot.3`에서 그 문장이 실제로는 거짓임이 드러났다 — 막은 것은 기동이
 * 아니라 **요청 하나하나**였고, 컨테이너는 초록으로 서 있었다.
 *
 * 그래서 두 가지를 건다.
 *
 *   1. 계약 자체 — 어떤 입력에 던지고 어떤 입력에 던지지 않는가
 *   2. **배포 문서가 그 계약과 같은 말을 하는가** — 문서에 적힌 값을 실제
 *      계약 함수에 넣어 본다. 문자열 대조가 아니라 실행이다.
 *
 * 2번이 이번 결함의 재발 경로다. `.env.example`이 「HTTP면 false여야 한다」고
 * 적었고 운영자가 그대로 했으며, 그 값은 운영에서 모든 화면을 500으로 만들었다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveSessionReaderConfig } from './config.js';

const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('FR-AUTH-001 AC-2: 운영에서 insecure 세션 쿠키를 거부한다', () => {
  it('운영에서 SESSION_COOKIE_SECURE=false면 던진다', () => {
    expect(() => resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toThrow(
      /SESSION_COOKIE_SECURE/,
    );
  });

  it('운영에서 값이 없으면 secure가 기본이고 던지지 않는다', () => {
    const config = resolveSessionReaderConfig({ NODE_ENV: 'production' });
    expect(config.cookieSecure).toBe(true);
  });

  it('운영에서 true면 던지지 않는다', () => {
    expect(resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' }).cookieSecure).toBe(
      true,
    );
  });

  /**
   * **인증을 껐다고 계약이 풀리지 않는다.**
   *
   * 사내 Pilot은 `AUTH_ENABLED=false`로 돌았고, 그 형상에서는 세션 쿠키가
   * 아예 발급되지 않는다. 그래도 이 계약은 그대로다 — 인증을 켜는 순간
   * 평문 HTTP로 세션이 나가기 시작하는데, 그 전환은 환경 변수 한 줄이라
   * 「지금은 안 쓰니까」로 열어 두면 열린 채로 켜진다.
   */
  it('AUTH_ENABLED=false여도 운영의 insecure 쿠키는 거부한다', () => {
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'false', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('개발에서는 false를 허용한다 — TLS 없이 도는 것이 정상이다', () => {
    expect(resolveSessionReaderConfig({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'false' }).cookieSecure).toBe(
      false,
    );
  });
});

/**
 * 배포 문서가 계약과 같은 말을 하는가 (`DEV-577`).
 *
 * **문서에서 값을 읽어 실제 계약 함수에 넣는다.** 이렇게 하면 문구가 어떻게
 * 바뀌든, 문서가 권하는 값이 운영에서 서지 못하는 값이면 시험이 죽는다.
 */
describe('DEV-577: 배포 문서의 값이 운영 계약을 통과한다', () => {
  const ENV_EXAMPLE = repoFile('deploy/single-host/.env.example');
  const COMPOSE = repoFile('deploy/single-host/compose.yml');

  it('.env.example이 권하는 SESSION_COOKIE_SECURE가 운영에서 선다', () => {
    const declared = /^SESSION_COOKIE_SECURE=(.*)$/m.exec(ENV_EXAMPLE)?.[1];
    expect(declared, '.env.example에 SESSION_COOKIE_SECURE가 없다').toBeDefined();
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: (declared as string).trim() }),
    ).not.toThrow();
  });

  it('compose의 기본값이 운영에서 선다', () => {
    // `SESSION_COOKIE_SECURE: ${SESSION_COOKIE_SECURE:-true}` 에서 기본값만 읽는다.
    const fallback = /SESSION_COOKIE_SECURE:\s*\$\{SESSION_COOKIE_SECURE:-([^}]*)\}/.exec(COMPOSE)?.[1];
    expect(fallback, 'compose가 SESSION_COOKIE_SECURE에 기본값을 주지 않는다').toBeDefined();
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: (fallback as string).trim() }),
    ).not.toThrow();
  });

  /**
   * **문서가 운영자를 거부당하는 값으로 보내지 않는다.**
   *
   * 이전 `.env.example`은 「TLS 없이 HTTP로 서비스하면 false여야 쿠키가
   * 전달된다」고 적었다. 그 문장 자체는 브라우저 동작으로는 참인데, 이 배포의
   * 운영 계약에서는 **실행 불가능한 조합**이다. 두 문장이 한 파일에 있으면
   * 운영자는 앞 문장을 실행한다.
   */
  it('.env.example이 운영에서 false를 쓰라고 읽히지 않는다', () => {
    const section = ENV_EXAMPLE.slice(
      ENV_EXAMPLE.indexOf('# 인증 (OIDC)'),
      ENV_EXAMPLE.indexOf('SESSION_COOKIE_SECURE='),
    );
    expect(section, 'false를 권하는 문장이 남아 있다').not.toMatch(/false여야|false로 (?:둔다|바꾼다|내린다)/);
    // 대신 무엇을 해야 하는지 말해야 한다 — 금지만으로는 운영자가 갈 곳이 없다.
    expect(section).toContain('AUTH_ENABLED=false');
  });
});
