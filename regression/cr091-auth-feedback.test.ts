/**
 * CR-091 — 사내 `0.1.0-pilot.6` 반입 피드백 세 건의 배선 회귀.
 *
 * 세 건 모두 **단위 시험이 통과하는데 운영 형상에서 성립하지 않는 종류**였다.
 *
 *   - DEV-694: `Secure`를 풀어도 쿠키 이름이 `__Host-`면 브라우저가 버린다 — 속성과 이름이 한 규칙이어야 한다.
 *   - DEV-695: 역할 합집합은 함수(`composeRoles`)에 있었지만 세션을 읽는 두 자리가 그 절반만 썼고, 지정 경로가 없었다.
 *   - DEV-696: search-api의 기동 거부는 옳았지만 컨테이너를 바꾼 뒤에야 보였다 — `prsctl`이 먼저 말해야 한다.
 *
 * 그래서 여기서는 함수가 아니라 **배선**을 건다. prsctl 판정은 실제 `docker compose`로 렌더해 search-api의 판정과
 * 대조한다(DEV-664와 같은 규율). docker가 없으면 실패다 — skip은 통과가 아니다.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE_AUDIT_ACTIONS } from '@prs/domain';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const PRSCTL = read('deploy/single-host/prsctl');
const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\r?\\n\\}`, 'm').exec(PRSCTL)?.[0] ?? '';

/** compose가 `:?`로 요구하는 변수를 전부 채운 `.env` 머리. 값 자체는 관심사가 아니다. */
function composeBase(): string {
  const compose = read('deploy/single-host/compose.yml');
  const required = [...new Set([...compose.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1] ?? ''))].filter((k) => k !== '');
  return required.map((key) => `${key}=x`).join('\n');
}

/** prsctl 함수 몇 개를 실제 compose와 함께 돌린다. */
function runShell(functions: readonly string[], body: string, envLines: string): string {
  return renderAndRun(functions, body, envLines).out;
}

type ServiceEnv = Record<string, string | undefined>;

/**
 * prsctl 함수를 돌리고, **같은 `.env`로 compose가 서비스에 실제로 넘길 환경을 JSON 렌더에서 따로 읽는다.**
 *
 * 대조의 기준은 prsctl이 추출한 문자열이 아니라 이 JSON이다. 처음 판은 prsctl이 뽑은 값을 그대로 search-api 판정에
 * 넣었고, 그래서 추출이 틀려도(작은따옴표를 벗기지 않아도) 양쪽이 같은 틀린 값을 보고 일치했다(변이 E2가 살아남았다).
 */
function renderAndRun(
  functions: readonly string[],
  body: string,
  envLines: string,
): { out: string; services: Record<string, ServiceEnv> } {
  const dir = mkdtempSync(join(tmpdir(), 'prs-cr091-'));
  try {
    const envFile = join(dir, '.env');
    const composeFile = join(root, 'deploy/single-host/compose.yml');
    writeFileSync(envFile, `${composeBase()}\n${envLines}\n`);
    // **prsctl과 같은 strict 모드로 돌린다** (독립 검토 B). nounset·pipefail·대입의 errexit에서만 드러나는 회귀가 있다.
    const shell = ['set -Eeuo pipefail', ...functions.map(fn), body].join('\n');
    const out = execFileSync('bash', ['-c', shell], {
      env: { ...process.env, ENV_FILE: envFile, PROJECT: 'prs-cr091-test', COMPOSE_FILE: composeFile },
      encoding: 'utf8',
    });
    const json = JSON.parse(
      execFileSync('docker', ['compose', '--project-name', 'prs-cr091-test', '--env-file', envFile, '-f', composeFile, 'config', '--format', 'json'], {
        encoding: 'utf8',
      }),
    ) as { services: Record<string, { environment?: ServiceEnv }> };
    const services = Object.fromEntries(Object.entries(json.services).map(([name, service]) => [name, service.environment ?? {}]));
    return { out, services };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (name === 'node_modules' || name === '.next' || name === 'dist') return [];
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });

describe('DEV-696: prsctl이 세션 인증과 관리 토큰의 공존을 컨테이너 교체 전에 막는다', () => {
  it('require_env가 충돌을 검사하고 load·install·upgrade·health·role이 모두 require_env를 지난다', () => {
    const requireEnv = fn('require_env');
    expect(requireEnv).toMatch(/!\s*auth_token_conflict\s*\\\s*\n\s*\|\|\s*die/);
    for (const command of ['cmd_load', 'cmd_install', 'cmd_upgrade', 'cmd_health', 'cmd_role']) {
      const body = fn(command);
      expect(body, command).not.toBe('');
      expect(body.indexOf('require_env'), `${command}가 require_env를 먼저 부르지 않는다`).toBeGreaterThan(0);
    }
    // upgrade에서 충돌 검사(require_env)가 마이그레이션·교체보다 앞선다.
    const upgrade = fn('cmd_upgrade');
    expect(upgrade.indexOf('require_env')).toBeLessThan(upgrade.indexOf('compose up -d'));
    expect(upgrade.indexOf('require_env')).toBeLessThan(upgrade.indexOf('run --rm migrate'));
  });

  /**
   * **판정이 search-api와 같다** — 실제 docker compose로 렌더한 값을 search-api의 두 함수에 넣는다.
   * 따옴표·주석·`export `·공백·빈 토큰(`이름:`)·작은따옴표 렌더(`','`, `':'`)가 갈릴 자리였다.
   */
  it('prsctl의 충돌 판정이 compose가 넘기는 값에 대한 search-api의 기동 거부 판정과 같다 — 실제 docker compose', async () => {
    const { resolveSessionReaderConfig } = await import('../packages/authz/src/config.js');
    const { parseAdminTokens } = await import('../apps/search-api/src/config.js');
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });

    const tokenLines = [
      '', 'ADMIN_API_TOKENS=', 'ADMIN_API_TOKENS=alice:tok1,bob:tok2', 'ADMIN_API_TOKENS=tok', 'ADMIN_API_TOKENS=,',
      'ADMIN_API_TOKENS= , ', 'ADMIN_API_TOKENS=alice:', 'ADMIN_API_TOKENS=:', 'ADMIN_API_TOKENS=: tok',
      'ADMIN_API_TOKENS=alice : ', 'ADMIN_API_TOKENS= alice : tok ', 'ADMIN_API_TOKENS="alice:tok"', "ADMIN_API_TOKENS='a:b c'",
      'ADMIN_API_TOKENS=alice:tok # 주석', 'export ADMIN_API_TOKENS=tok', 'ADMIN_API_TOKENS=a:,b:', 'ADMIN_API_TOKENS=a:,b:t',
      "ADMIN_API_TOKENS=it's:tok",
    ];
    const authLines = ['', 'AUTH_ENABLED=', 'AUTH_ENABLED=true', 'AUTH_ENABLED=false', 'AUTH_ENABLED="false"', 'AUTH_ENABLED=TRUE'];

    let conflicts = 0;
    for (const auth of authLines) {
      for (const tokens of tokenLines) {
        const { out: raw, services } = renderAndRun(
          ['rendered_env_value', 'admin_tokens_configured', 'auth_token_conflict'],
          [
            'printf "%s\\n" "$(rendered_env_value search-api AUTH_ENABLED)"',
            'printf "%s\\n" "$(rendered_env_value search-api ADMIN_API_TOKENS)"',
            'if auth_token_conflict; then echo conflict; else echo ok; fi',
          ].join('\n'),
          `${auth}\n${tokens}`,
        );
        const [renderedAuth = '', renderedTokens = '', verdict = ''] = raw.split('\n');
        const actual = services['search-api'] ?? {};
        const label = `${JSON.stringify(auth)} + ${JSON.stringify(tokens)}`;
        // prsctl의 추출이 compose가 실제로 넘기는 값과 같다 — 인용 형식이 판정을 바꾸지 않는다.
        expect(renderedAuth, `${label}: AUTH_ENABLED 추출`).toBe(actual['AUTH_ENABLED'] ?? '');
        expect(renderedTokens, `${label}: ADMIN_API_TOKENS 추출`).toBe(actual['ADMIN_API_TOKENS'] ?? '');

        const enabled = resolveSessionReaderConfig({ AUTH_ENABLED: actual['AUTH_ENABLED'] }).enabled;
        const apiRefuses = enabled && parseAdminTokens({ ...actual }).length > 0;
        expect(verdict, `${label} → compose ${JSON.stringify([actual['AUTH_ENABLED'], actual['ADMIN_API_TOKENS']])}`).toBe(
          apiRefuses ? 'conflict' : 'ok',
        );
        if (apiRefuses) conflicts += 1;
      }
    }
    // 표가 양쪽 답을 모두 만든다 — 한쪽만 나오면 이 시험은 아무것도 대조하지 않은 것이다.
    expect(conflicts).toBeGreaterThan(10);
    expect(conflicts).toBeLessThan(authLines.length * tokenLines.length);
  }, 600_000);

  /**
   * **단수형 `ADMIN_API_TOKEN`은 compose가 search-api에 넘기지 않는다.** search-api의 `parseAdminTokens`는 그것도 읽지만
   * prsctl은 복수형만 본다(독립 검토 A). 누가 compose에 단수형을 더하면 prsctl이 그 공존을 놓치므로 여기서 깨뜨린다.
   */
  it('compose가 search-api에 단수형 ADMIN_API_TOKEN을 넘기지 않는다 — prsctl이 복수형만 보는 근거', () => {
    const { services } = renderAndRun([], 'true', 'ADMIN_API_TOKEN=tok');
    expect(services['search-api']?.['ADMIN_API_TOKEN']).toBeUndefined();
    expect(read('deploy/single-host/compose.yml')).not.toMatch(/^\s+ADMIN_API_TOKEN:/m);
    expect(read('apps/search-api/src/config.ts')).toContain("env['ADMIN_API_TOKEN']");
  }, 120_000);

  it('작은따옴표·큰따옴표 렌더를 벗긴다 — 값의 인용 형식이 판정을 바꾸지 않는다', () => {
    const out = runShell(['rendered_env_value'], 'rendered_env_value search-api ADMIN_API_TOKENS', "ADMIN_API_TOKENS=' alice : tok '");
    expect(out).toBe(' alice : tok ');
  }, 120_000);
});

describe('DEV-694: ALLOW_INSECURE_COOKIES가 쿠키를 발급하는 web에만 가고 health가 그 형상을 말한다', () => {
  it('실제 compose 렌더에서 web만 ALLOW_INSECURE_COOKIES를 받는다', () => {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    const out = runShell(
      ['rendered_env_value'],
      ['rendered_env_value web ALLOW_INSECURE_COOKIES; echo', 'rendered_env_value search-api ALLOW_INSECURE_COOKIES; echo'].join('\n'),
      'ALLOW_INSECURE_COOKIES=true',
    ).split('\n');
    expect(out[0]).toBe('true');
    expect(out[1]).toBe('');
    // 환경 키로 선언한 자리가 하나다(`${ALLOW_INSECURE_COOKIES:-}` 치환은 세지 않는다).
    expect(read('deploy/single-host/compose.yml').match(/^\s+ALLOW_INSECURE_COOKIES:/gm)).toHaveLength(1);
  }, 120_000);

  /**
   * **health의 경고가 web의 판정과 같은 형상에서만 나온다** — 실제 compose로 돌린다.
   *
   * 처음 판은 함수 본문에 세 변수 이름이 있는지만 봤고, 조건 앞에 `false &&`를 붙인 변이가 살아남았다(E5). 경고를 함수로
   * 떼어 실제로 실행하고, compose가 web에 넘기는 값으로 web의 판정(`insecureCookiesAllowed`)과 대조한다.
   */
  it('health의 평문 HTTP 경고가 compose가 web에 넘기는 값에 대한 web의 판정과 같다 — 실제 docker compose', async () => {
    const { insecureCookiesAllowed, resolveSessionReaderConfig } = await import('../packages/authz/src/config.js');
    expect(fn('cmd_health')).toMatch(/^\s+insecure_cookie_notice$/m);
    const cases = [
      '',
      'SESSION_COOKIE_SECURE=false',
      'SESSION_COOKIE_SECURE=false\nALLOW_INSECURE_COOKIES=true',
      'SESSION_COOKIE_SECURE=0\nALLOW_INSECURE_COOKIES=true',
      'SESSION_COOKIE_SECURE=true\nALLOW_INSECURE_COOKIES=true',
      'AUTH_ENABLED=false\nSESSION_COOKIE_SECURE=false\nALLOW_INSECURE_COOKIES=true',
      'SESSION_COOKIE_SECURE=false\nALLOW_INSECURE_COOKIES="true"',
      'SESSION_COOKIE_SECURE=false\nALLOW_INSECURE_COOKIES=yes',
    ];
    let warned = 0;
    for (const lines of cases) {
      const { out, services } = renderAndRun(['rendered_env_value', 'insecure_cookie_notice'], 'insecure_cookie_notice', lines);
      const web = services['web'] ?? {};
      let webWarns: boolean;
      try {
        webWarns = resolveSessionReaderConfig({ ...web }).enabled && insecureCookiesAllowed({ ...web });
      } catch {
        webWarns = false; // 거부되는 구성은 경고가 아니라 기동 거부다
      }
      expect(out.includes('평문 HTTP 세션 허용'), `${JSON.stringify(lines)} → web ${JSON.stringify(web['SESSION_COOKIE_SECURE'])}`).toBe(webWarns);
      if (webWarns) warned += 1;
    }
    expect(warned).toBeGreaterThan(1);
    expect(warned).toBeLessThan(cases.length);
  }, 300_000);

  /**
   * **web의 쿠키 계약도 컨테이너 교체 전에 막는다** (독립 검토 B). 토큰 공존만 사전에 막고 이 판이 만든 플래그의 오타를
   * 교체 뒤로 미루면 DEV-696이 없앤 재기동 반복이 새 플래그에서 되살아난다. 사내가 처음 막힌 형상(플래그 없이 Secure만 끔)도
   * 같은 자리에서 잡는다. 기준은 compose가 web에 넘기는 값에 대한 web의 판정(`resolveSessionReaderConfig`)이다.
   */
  it('prsctl의 쿠키 계약 판정이 compose가 web에 넘기는 값에 대한 web의 기동 거부와 같다 — 실제 docker compose', async () => {
    const { resolveSessionReaderConfig } = await import('../packages/authz/src/config.js');
    expect(fn('require_env')).toMatch(/case "\$\(web_cookie_contract\)" in[\s\S]*flag_invalid\) die[\s\S]*insecure_undeclared\) die/);
    const cases = [
      '',
      'SESSION_COOKIE_SECURE=false',
      'SESSION_COOKIE_SECURE=false\nAUTH_ENABLED=false',
      'SESSION_COOKIE_SECURE=false\nALLOW_INSECURE_COOKIES=true',
      'SESSION_COOKIE_SECURE=0\nALLOW_INSECURE_COOKIES=true',
      'SESSION_COOKIE_SECURE=0',
      'ALLOW_INSECURE_COOKIES=TRUE',
      'ALLOW_INSECURE_COOKIES=yes\nSESSION_COOKIE_SECURE=false',
      "ALLOW_INSECURE_COOKIES=' true '\nSESSION_COOKIE_SECURE=false",
      'ALLOW_INSECURE_COOKIES=false\nSESSION_COOKIE_SECURE=false',
      'ALLOW_INSECURE_COOKIES=true',
      'AUTH_ENABLED=TRUE\nSESSION_COOKIE_SECURE=false',
    ];
    const seen = new Set<string>();
    for (const lines of cases) {
      const { out, services } = renderAndRun(['rendered_env_value', 'web_cookie_contract'], 'web_cookie_contract', lines);
      const web = services['web'] ?? {};
      let expected = 'ok';
      try {
        resolveSessionReaderConfig({ ...web });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expected = message.includes('ALLOW_INSECURE_COOKIES는 true 또는 false') ? 'flag_invalid' : message.includes('SESSION_COOKIE_SECURE=false는 허용되지 않는다') ? 'insecure_undeclared' : `unexpected: ${message}`;
      }
      expect(out, `${JSON.stringify(lines)} → web ${JSON.stringify([web['NODE_ENV'], web['AUTH_ENABLED'], web['SESSION_COOKIE_SECURE'], web['ALLOW_INSECURE_COOKIES']])}`).toBe(expected);
      seen.add(expected);
    }
    // 표가 세 답을 모두 만든다 — 한쪽만 나오면 아무것도 대조하지 않은 것이다.
    expect([...seen].sort()).toEqual(['flag_invalid', 'insecure_undeclared', 'ok']);
  }, 300_000);

  it('.env.example이 플래그를 빈 값으로 두고 운영 기본값은 Secure다', async () => {
    const example = read('deploy/single-host/.env.example');
    expect(example).toMatch(/^ALLOW_INSECURE_COOKIES=$/m);
    expect(example).toMatch(/^SESSION_COOKIE_SECURE=true$/m);
    const { insecureCookiesAllowed } = await import('../packages/authz/src/config.js');
    expect(insecureCookiesAllowed({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true', ALLOW_INSECURE_COOKIES: '' })).toBe(false);
  });

  /**
   * **브라우저 쿠키 이름을 고르는 규칙이 한 벌이다.** web에서 브라우저의 세션 쿠키를 `SESSION_COOKIE_NAME`으로 직접 읽는
   * 자리가 남으면, 평문 HTTP 파일럿에서 그 자리만 세션을 못 찾는다. 정본 이름은 search-api로 보내는 헤더를 조립하는
   * `lib/proxy.ts` 한 곳에서만 쓴다.
   */
  it('web이 브라우저 쿠키를 읽는 자리는 모두 sessionCookieName()을 쓰고 중복을 거절하는 읽기를 지난다', () => {
    const files = [...walk('apps/web/app'), ...walk('apps/web/lib')].filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    expect(files.length).toBeGreaterThan(30);
    // 프레임워크의 `cookies.get()`은 같은 이름이 둘이면 하나를 고른다 — 인증 쿠키를 그것으로 읽지 않는다 (독립 검토 A).
    const direct = files.filter((file) =>
      /cookies(\(\))?\)?\.get\((SESSION_COOKIE_NAME|OIDC_STATE_COOKIE|sessionCookieName\(|oidcStateCookieName\()/.test(read(file)),
    );
    expect(direct).toEqual([]);
    const users = files.filter((file) => read(file).includes('SESSION_COOKIE_NAME'));
    expect(users).toEqual(['apps/web/lib/proxy.ts']);
    for (const file of ['apps/web/lib/server/page-guard.tsx', 'apps/web/app/api/[...path]/route.ts', 'apps/web/app/gh/identity/callback/route.ts']) {
      expect(read(file), file).toMatch(/readBrowserCookie\(.*\.get\('cookie'\), sessionCookieName\(config\.session\.cookieSecure\)\)/);
    }
    expect(read('apps/web/app/auth/logout/route.ts')).toMatch(/readBrowserCookieValues\(.*\.get\('cookie'\), sessionCookieName\(config\.session\.cookieSecure\)\)/);
    expect(read('apps/web/app/auth/callback/route.ts')).toMatch(/readBrowserCookie\(request\.headers\.get\('cookie'\), oidcStateCookieName\(secure\)\)/);
  });
});

describe('DEV-695: 관리자 지정 역할이 실효 역할이 되고 지정 경로가 배포에 있다', () => {
  it('search-api의 운영 조립이 역할을 합치는 세션 저장소를 쓰고, web 관문이 /me에 묻는다', () => {
    expect(read('apps/search-api/src/auth/context.ts')).toMatch(/new RegisteringSessionStore\(/);
    const registration = read('apps/search-api/src/auth/registration.ts');
    expect(registration).toContain('withAssignedRoles(loaded.session.roles, assigned)');
    expect(registration).toContain('authRepo.findAssignedRoles(');
    const guard = read('apps/web/lib/server/page-guard.tsx');
    expect(guard).toContain('resolveEffectiveRoles(');
    expect(read('apps/web/lib/server/effective-roles.ts')).toContain('/api/v1/me');
  });

  it('prsctl role이 search-api 이미지의 role-cli를 호스트 사용자를 행위 주체로 넘겨 부른다', () => {
    const role = fn('cmd_role');
    expect(role).toMatch(/compose run --rm --no-deps -T search-api node dist\/role-cli\.js "\$@" --actor "\$actor"/);
    expect(role).toContain('SUDO_USER');
    expect(PRSCTL).toMatch(/^\s*role\)\s+shift; cmd_role "\$@" ;;/m);
    // 진입점이 실제로 빌드 대상에 있다 — search-api tsconfig는 src/**를 dist로 낸다.
    expect(read('apps/search-api/src/role-cli.ts')).toContain("runRoleCommand(process.argv.slice(2)");
    expect(read('Dockerfile')).toMatch(/pnpm deploy --legacy --filter @prs\/search-api --prod \/out/);
  });

  it('감사 어휘에 역할 지정·회수가 있고 SRS 감사 대상 정본 표가 활성 어휘 전부를 행으로 가진다', () => {
    expect(ACTIVE_AUDIT_ACTIONS as readonly string[]).toEqual(expect.arrayContaining(['user_role.grant', 'user_role.revoke']));
    const srs = read('docs/10_requirements/srs_final.md');
    const missing = ACTIVE_AUDIT_ACTIONS.filter((action) => !srs.includes(`| \`${action}\` |`));
    expect(missing).toEqual([]);
  });
});
