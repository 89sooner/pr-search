/**
 * web 구성 판정 (`CR-078` / `DEV-577`).
 *
 * `webConfigFailure`는 **기동 검증(`instrumentation.ts`)과 헬스체크가 함께 읽는
 * 하나의 판정**이다. 이것이 조용히 `null`을 돌려주기 시작하면 두 방어가 동시에
 * 사라지고, 배포는 다시 `0.1.0-pilot.3`의 모양으로 돌아간다 — 컨테이너는
 * 초록이고 사람이 여는 화면만 500인 상태다. 그래서 판정 자체를 건다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/**
 * 기동 검증이 공급자마다 다른 키를 본다 (`CR-083`).
 *
 * **GHE 배포에서 OIDC 키를 요구하면** 자격을 다 채운 배포가 서지 못한다. 반대도
 * 마찬가지다. 두 방향을 모두 건다 — 한쪽만 걸면 반대 방향의 회귀를 놓친다.
 */
describe('CR-083: 공급자별 필수 키', () => {
  const GHE = {
    NODE_ENV: 'production',
    SESSION_COOKIE_SECURE: 'true',
    AUTH_ENABLED: 'true',
    AUTH_PROVIDER: 'github',
    GHE_BASE_URL: 'https://ghe.example.com',
    GHE_OAUTH_CLIENT_ID: 'Iv1.abc',
    GHE_OAUTH_CLIENT_SECRET: 'secret',
    GHE_OAUTH_REDIRECT_URI: 'https://prs.example.com/auth/callback',
  } as NodeJS.ProcessEnv;

  const OIDC = {
    NODE_ENV: 'production',
    SESSION_COOKIE_SECURE: 'true',
    AUTH_ENABLED: 'true',
    OIDC_ISSUER: 'https://idp.example.com',
    OIDC_CLIENT_ID: 'client',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'https://prs.example.com/auth/callback',
  } as NodeJS.ProcessEnv;

  it('GHE 자격이 갖춰지면 OIDC 키가 없어도 성립한다', () => {
    expect(webConfigFailure(GHE)).toBeNull();
  });

  it.each(['GHE_BASE_URL', 'GHE_OAUTH_CLIENT_ID', 'GHE_OAUTH_CLIENT_SECRET', 'GHE_OAUTH_REDIRECT_URI'])(
    'GHE 배포에서 %s가 비면 이유를 돌려준다',
    (key) => {
      const failure = webConfigFailure({ ...GHE, [key]: '' });
      expect(failure).not.toBeNull();
      expect(failure).toContain(key);
    },
  );

  it('OIDC 배포에서 GHE 키를 요구하지 않는다', () => {
    expect(webConfigFailure(OIDC)).toBeNull();
  });

  /**
   * **오타가 조용히 기본값으로 떨어지지 않는다.**
   *
   * 떨어지면 GHE 자격을 다 채운 배포가 OIDC 키 부재로 막히고, 운영자는 채운
   * 값이 왜 안 읽히는지 묻게 된다.
   */
  it('AUTH_PROVIDER 오타를 기동 전에 잡는다', () => {
    const failure = webConfigFailure({ ...GHE, AUTH_PROVIDER: 'githubb' });
    expect(failure).toContain('AUTH_PROVIDER');
  });

  /**
   * 팀 매핑 형식 오류도 기동 전에 잡는다.
   *
   * `resolveSessionReaderConfig`는 `IDP_GROUP_ROLE_MAP`만 파싱하므로 GHE 쪽
   * 변수는 이 경로가 아니면 **로그인 요청 시점에야** 500으로 나타난다.
   */
  it('GHE_TEAM_ROLE_MAP 형식 오류를 기동 전에 잡는다', () => {
    const failure = webConfigFailure({ ...GHE, GHE_TEAM_ROLE_MAP: 'acme/team=manager' });
    expect(failure).toContain('GHE_TEAM_ROLE_MAP');
  });

  it('팀 매핑이 부여 불가 역할을 지목하면 잡는다', () => {
    const failure = webConfigFailure({ ...GHE, GHE_TEAM_ROLE_MAP: 'acme/team:security_officer' });
    expect(failure).toContain('GHE_TEAM_ROLE_MAP');
  });

  it('올바른 팀 매핑은 통과한다', () => {
    expect(webConfigFailure({ ...GHE, GHE_TEAM_ROLE_MAP: 'acme/admins:manager,acme/qa:qa' })).toBeNull();
  });

  /**
   * **인증을 끈 배포는 어느 공급자든 키를 요구받지 않는다.**
   *
   * 그 형상에서는 로그인 경로가 503을 내므로 자격이 쓰이지 않는다.
   */
  it('인증이 꺼져 있으면 공급자 키를 요구하지 않는다', () => {
    expect(
      webConfigFailure({
        NODE_ENV: 'production',
        SESSION_COOKIE_SECURE: 'true',
        AUTH_ENABLED: 'false',
        AUTH_PROVIDER: 'github',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

/**
 * 배포 산출물 게이트가 계약과 같은 말을 하는가 (`DEV-615`).
 *
 * ## 무엇이 있었나
 *
 * `CR-083`이 쿠키 계약에 면제를 열었을 때 그 계약을 강제하는 자리가 셋이었다 —
 * 단위 시험, 기동 검증, 그리고 **릴리스 산출물 게이트**(`smoke-images.sh`). 앞의
 * 둘은 갱신됐고 셋째는 그대로 남았다. 그래서 번들 빌드가 「이 번들을 반입하지
 * 않는다」로 멈췄고 릴리스가 나가지 못했다.
 *
 * 그때 회귀는 **초록이었다.** `runtime-reachability.test.ts`가 스모크에 그 검사가
 * 있는지를 문자열로 보기 때문이다 — 검사는 그대로 있었고, 다만 **기대가 계약과
 * 반대**였다.
 *
 * ## 그래서 무엇을 하는가
 *
 * 스모크에서 **기대하는 환경 조합을 뽑아 실제 계약 함수에 넣는다.** `.env.example`에
 * 하는 것과 같은 방식이다(`packages/authz/src/config.test.ts`) — 문자열이 아니라
 * 실행으로 대조하므로, 한쪽이 바뀌고 다른 쪽이 안 바뀌면 여기서 죽는다.
 */
describe('DEV-615: 릴리스 게이트가 계약과 같은 말을 한다', () => {
  const SMOKE = readFileSync(
    fileURLToPath(new URL('../../../../deploy/single-host/smoke-images.sh', import.meta.url)),
    'utf8',
  );

  /** `expect_rejected "라벨" -e K=V -e K=V ...` 한 호출의 환경 조합. */
  const callsOf = (fn: 'expect_rejected' | 'expect_accepted'): { label: string; env: NodeJS.ProcessEnv }[] => {
    const calls: { label: string; env: NodeJS.ProcessEnv }[] = [];
    // 줄 끝 `\`로 이어진 호출을 한 줄로 모은다.
    const joined = SMOKE.replace(/\\\r?\n\s*/g, ' ');
    const pattern = new RegExp(`^${fn}\\s+"([^"]*)"((?:\\s+-e\\s+\\S+)*)`, 'gm');
    for (const match of joined.matchAll(pattern)) {
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
      for (const pair of match[2]?.matchAll(/-e\s+([A-Z_][A-Z0-9_]*)=(\S*)/g) ?? []) {
        env[pair[1] as string] = pair[2];
      }
      calls.push({ label: match[1] ?? '', env });
    }
    return calls;
  };

  const rejected = callsOf('expect_rejected');
  const accepted = callsOf('expect_accepted');

  /**
   * **파서가 먼저 검증 대상이다.** 스모크의 호출 형태가 바뀌어 아무것도 뽑지
   * 못하면 아래 단언이 전부 무의미하게 통과한다.
   */
  it('스모크에서 기대 조합을 실제로 읽는다', () => {
    expect(rejected.length, '거부 기대를 하나도 읽지 못했다').toBeGreaterThanOrEqual(3);
    expect(accepted.length, '허용 기대를 하나도 읽지 못했다').toBeGreaterThanOrEqual(1);
    // 환경 변수가 실제로 붙었는가.
    expect(rejected.every((call) => Object.keys(call.env).length > 1)).toBe(true);
  });

  /**
   * **게이트가 막겠다는 것을 계약도 막는가.**
   *
   * 계약이 넓어졌는데 게이트가 그대로면 여기서 죽는다 — 번들 빌드가 멈추기 전에.
   */
  it.each(rejected.map((call) => [call.label, call.env] as const))(
    '거부 기대 「%s」를 계약도 거부한다',
    (_label, env) => {
      expect(webConfigFailure(env), '게이트는 막는데 계약은 통과시킨다').not.toBeNull();
    },
  );

  /**
   * **게이트가 세우겠다는 것을 계약도 세우는가.**
   *
   * 이 방향이 `CR-083`에서 어긋났다. 거부만 검사하면 게이트가 한 방향으로만
   * 정직하고, 허용해야 할 형상을 막고 있어도 아무것도 죽지 않는다.
   */
  it.each(accepted.map((call) => [call.label, call.env] as const))(
    '허용 기대 「%s」를 계약도 허용한다',
    (_label, env) => {
      expect(webConfigFailure(env), '게이트는 세우는데 계약이 막는다').toBeNull();
    },
  );

  /**
   * 파일럿 형상이 게이트에 실제로 들어 있는가.
   *
   * 사내가 요청한 것이 이 조합이므로, 검사 목록에서 빠지면 다음 판에서 조용히
   * 깨질 수 있다.
   */
  it('파일럿 형상(인증 끔 + insecure 쿠키)을 게이트가 검사한다', () => {
    const pilot = accepted.find(
      (call) => call.env['AUTH_ENABLED'] === 'false' && call.env['SESSION_COOKIE_SECURE'] === 'false',
    );
    expect(pilot, '파일럿 형상이 허용 기대 목록에 없다').toBeDefined();
  });
});
