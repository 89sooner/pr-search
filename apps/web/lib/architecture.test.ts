/**
 * 셸이 지켜야 할 정적 규칙 (WP-015 / ADR-006, QA-COMMON-16, QA-COMMON-17).
 *
 * ADR-006은 "리터럴 색상값을 두지 않는다. **정적 검사로 강제한다**"고
 * 못박는다. 코드 리뷰에 맡기면 지켜지지 않는 종류의 규칙이라 시험으로 건다 —
 * 화면을 처음 세우는 WP가 이 그물을 쳐 두어야 WP-016 이후가 그 위에서 큰다.
 *
 * `packages/es/src/architecture.test.ts`가 ADR-008에 대해 하는 것과 같다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 검사 대상 디렉터리. 빌드 산출물과 의존성은 우리 코드가 아니다. */
const SOURCE_DIRS = ['app', 'components', 'lib'] as const;

function sourceFiles(dir: string): string[] {
  const root = join(WEB_ROOT, dir);
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      /*
       * 시험 파일은 뺀다. ADR-006이 막는 것은 **제품 코드**의 리터럴 색상이고,
       * 시험은 번들에 들어가지 않는다 — 게다가 이 파일 자신이 색상 정규식을
       * 갖고 있어 넣으면 스스로를 위반으로 신고한다.
       */
      if (/\.test\.tsx?$/.test(entry)) continue;
      if (/\.(ts|tsx|css)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

const FILES = SOURCE_DIRS.flatMap(sourceFiles);

describe('QA-COMMON-16: 리터럴 색상값이 없다 (ADR-006)', () => {
  /*
   * `#rrggbb`·`#rrggbbaa`·`rgb()`·`hsl()`을 본다. 색은 Conductor 토큰에서만
   * 온다 — 리터럴을 하나 두면 그 하나가 테마 전환에서 따라오지 않아,
   * 다크 모드에서 글자가 배경과 같은 색이 된다.
   *
   * **3·4자리 축약형은 일부러 뺐다.** 이 제품의 UI 문구에는 `#1234` 같은
   * **PR 번호**가 도처에 있고(`ResultTable`의 표시 이름이 그 모양이다),
   * `#1234`는 4자리 RGBA 축약과 문자열로 구별되지 않는다. 실제로 이 검사가
   * `OmniSearchInput`의 placeholder에 있는 `#1234`를 색으로 신고했다.
   *
   * 늘 거짓 경보를 내는 검사는 곧 꺼지므로, **요구사항이 문자 그대로 적은
   * 것**(QA-COMMON-16: "리터럴 색상값(`#rrggbb`)")까지만 건다. 축약형이
   * 새어 들어올 위험은 남지만, Conductor 토큰이 색을 전부 공급하므로 그
   * 경로 자체가 드물다.
   */
  const COLOR = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|\brgba?\s*\(|\bhsla?\s*\(/;

  it('제품 코드 어디에도 없다', () => {
    const offenders = FILES.filter((file) => !file.endsWith('/app/ui.css') && COLOR.test(readFileSync(file, 'utf8'))).map((f) =>
      f.slice(WEB_ROOT.length),
    );
    expect(offenders).toEqual([]);
  });

  it('검사가 실제로 도는지 — 대상 파일이 비어 있지 않다', () => {
    // 걸러내기가 잘못돼 0개를 훑으면 위 시험이 영원히 통과한다.
    expect(FILES.length).toBeGreaterThan(10);
  });
});

describe('FR-AUTH-001: 화면 라우트는 전부 공통 관문을 지난다', () => {
  /*
   * WP-017까지는 라우트 셋이 **같은 다섯 줄을 각자 갖고** 있었고, 이 검사는
   * 그 다섯 줄이 빠지지 않았는지를 봤다. WP-018이 네 번째 화면을 세우면서
   * `GuardedPage` 하나로 묶었으므로, 이제 볼 것은 **관문을 지나는가**다.
   *
   * 검사를 유지하는 이유는 그대로다 — 다섯 번째 화면(W-004)이 관문을 건너뛰고
   * 직접 `Shell`을 세우면 **미인증 사용자가 화면을 보게 되고**, 그것은 리뷰에서
   * 눈에 띄지 않는다.
   *
   * `app/api`·`auth/*`·`healthz`는 화면이 아니라 제외한다. 프록시는 자기
   * 방식으로 401을 내고(WP-015 `resolveProxyAuth`), 로그인 라우트가 세션을
   * 요구하면 로그인할 방법이 없어진다.
   */
  const NOT_A_SCREEN = ['app/api/', 'app/auth/', 'app/healthz/'];

  const screenRoutes = sourceFiles('app')
    .filter((f) => /(^|\/)page\.tsx$/.test(f))
    .filter((f) => !NOT_A_SCREEN.some((skip) => f.includes(skip)));

  it('검사가 실제로 도는지 — 화면 라우트를 찾았다', () => {
    expect(screenRoutes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(screenRoutes.map((f) => [f.slice(WEB_ROOT.length), f] as const))(
    '%s가 `GuardedPage`를 지난다',
    (_name, full) => {
      expect(readFileSync(full, 'utf8')).toContain('GuardedPage');
    },
  );

  it.each(screenRoutes.map((f) => [f.slice(WEB_ROOT.length), f] as const))(
    '%s가 세션을 **직접** 다루지 않는다 — 관문을 우회하지 않는다',
    (_name, full) => {
      const source = readFileSync(full, 'utf8');
      /*
       * 라우트가 쿠키를 직접 읽기 시작하면 관문이 둘이 되고, 둘은 갈라진다.
       * 세션에 관한 결정은 전부 `page-guard.tsx` 안에 있어야 한다.
       */
      expect(source).not.toContain('SESSION_COOKIE_NAME');
      // 브라우저 쪽 이름은 `Secure` 여부로 갈린다 (CR-091). 그 판정도 관문 안에만 있어야 한다.
      expect(source).not.toContain('sessionCookieName(');
      expect(source).not.toContain('sessionStore(');
      // 실효 역할(DEV-695)도 관문이 묻는다. 화면이 따로 물으면 두 판정이 갈라진다.
      expect(source).not.toContain('resolveEffectiveRoles(');
    },
  );

  it('관문 자신은 네 가지를 모두 한다 — 읽고, 없으면 보내고, 실효 역할을 묻고, 셸을 세운다', () => {
    const guard = readFileSync(join(WEB_ROOT, 'lib/server/page-guard.tsx'), 'utf8');
    // `Secure` 여부로 갈리는 이름을 세울 때와 같은 함수로 읽는다 (CR-091).
    expect(guard).toContain('sessionCookieName(config.session.cookieSecure)');
    expect(guard).toContain('sessionStore()');
    // 역할은 세션 레코드가 아니라 search-api의 /me에서 온다 (DEV-695, API-AUTH-001).
    expect(guard).toContain('resolveEffectiveRoles(');
    expect(guard).not.toMatch(/session\.roles as/);
    // 확인만 하고 통과시키면 확인하지 않은 것과 같다.
    expect(guard).toContain('redirect(');
    expect(guard).toContain('return_to=');
  });
});

describe('CR-092 / DEV-699: 라우트 핸들러가 서버가 들은 출처로 주소를 조립하지 않는다', () => {
  /*
   * `next start`는 요청 출처를 자기가 들은 호스트·포트로 조립한다. 역방향 프록시 뒤에서 그 값은 `localhost:3000`이고,
   * 콜백 둘이 그것으로 복귀 주소를 만들어 사내 `0.1.0-pilot.7`의 사용자가 로그인 뒤 `localhost:3000`으로 떨어졌다.
   * 복귀는 `lib/redirect.ts`의 상대 경로로만 한다. **새 라우트가 같은 한 줄을 다시 쓰는 것**이 이 결함이 되돌아오는
   * 길이라 정적으로 막는다. 주석은 뺀다 — 「쓰지 않는다」고 적은 설명까지 잡으면 규칙을 설명할 수 없다.
   */
  const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const ROUTES = sourceFiles('app').filter((f) => /(^|\/)route\.ts$/.test(f));

  it('검사가 실제로 도는지 — 라우트 핸들러를 찾았다', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(ROUTES.map((f) => [f.slice(WEB_ROOT.length), f] as const))('%s가 요청 출처로 리다이렉트 주소를 만들지 않는다', (_name, full) => {
    const code = withoutComments(readFileSync(full, 'utf8'));
    expect(code).not.toMatch(/nextUrl\.origin/);
    expect(code).not.toMatch(/new URL\([^)]*request\.url/);
    expect(code).not.toMatch(/NextResponse\.redirect\(\s*new URL\(/);
  });
});

describe('QA-GH-24: GitHub 작업 화면은 원시 HTML을 만들지 않는다 (ADR-018, THR-023)', () => {
  /*
   * gh의 출력과 GitHub 필드(PR 제목·브랜치명)는 외부 입력이다. 서버가 무해화한 값을 화면이
   * **텍스트 노드로만** 그려야 하며, `dangerouslySetInnerHTML`이나 `innerHTML` 하나가 그 경계를
   * 통째로 무너뜨린다. 리뷰에 맡기면 지켜지지 않는 종류의 규칙이라 정적으로 건다.
   */
  const GH_FILES = FILES.filter(
    (file) =>
      /\/components\/Gh[A-Za-z]+\.tsx$/.test(file) ||
      /\/components\/SafeGhOutputViewer\.tsx$/.test(file) ||
      /\/app\/gh\//.test(file) ||
      /\/lib\/gh\.ts$/.test(file),
  );

  it('검사가 실제로 도는지 — gh 화면 파일을 찾았다', () => {
    expect(GH_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(GH_FILES.map((f) => [f.slice(WEB_ROOT.length), f] as const))('%s에 원시 HTML 삽입이 없다', (_name, full) => {
    const source = readFileSync(full, 'utf8');
    // 속성·키로 **쓰는** 자리만 잡는다 — 「쓰지 않는다」고 적은 주석까지 잡으면 규칙을 설명할 수 없다.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
    expect(source).not.toMatch(/\.innerHTML\s*=/);
    expect(source).not.toMatch(/insertAdjacentHTML\s*\(/);
  });
});

describe('CR-096: Radix primitives and local theme tokens own the UI', () => {
  const pkg = JSON.parse(
    readFileSync(join(WEB_ROOT, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

  /**
   * 런타임 의존성 허용 목록.
   *
   * **런타임만 본다.** `@testing-library/*`나 `axe-core`는 시험 도구라
   * 번들에 들어가지 않는다 — 그것까지 막으면 접근성 시험을 못 쓴다.
   */
  const ALLOWED = new Set([
    '@fontsource-variable/geist',
    'diff', '@radix-ui/react-slider',
    '@radix-ui/react-checkbox', '@radix-ui/react-collapsible', '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-select',
    '@radix-ui/react-slot', '@radix-ui/react-switch', '@radix-ui/react-tabs', '@radix-ui/react-tooltip',
    /*
     * 아이콘 라이브러리 (CR-093, ADR-006의 아이콘 예외). Conductor 0.4.1이 peer로 요구하고 README가
     * 함께 설치하라고 적은 바로 그 패키지다. 제품은 `components/WorkbenchIcon.tsx` 한 곳에서만
     * 가져온다 — 다른 파일이 직접 가져오면 아래 시험이 잡는다.
     */
    'lucide-react',
    'next',
    'react',
    'react-dom',
    'server-only',
  ]);

  it('워크스페이스 패키지와 허용 목록만 있다', () => {
    const extra = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !ALLOWED.has(name) && !name.startsWith('@prs/'),
    );
    expect(extra).toEqual([]);
  });

  it('directly depends on Radix and has no Conductor runtime dependency', () => {
    /*
     * Conductor가 Radix 위에 서 있지만 우리가 직접 가져다 쓰면 두 버전이
     * 공존하게 되고, Dialog 컨텍스트가 갈려 포커스 관리가 조용히 깨진다.
     */
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((n) => n.startsWith('@radix-ui/')).length).toBeGreaterThan(0);
    expect(Object.keys(all).filter((n) => n.startsWith('@conductor-by-89soone/'))).toEqual([]);
  });
});

describe('CR-093: 아이콘 라이브러리는 한 파일만 안다', () => {
  /*
   * `lucide-react`를 가져오는 제품 파일은 `components/WorkbenchIcon.tsx` 하나여야 한다. 호출부가
   * 라이브러리를 직접 알면 이름 → 그림의 대응이 여러 곳으로 흩어져, 라이브러리를 바꾸거나 그림을
   * 고칠 때 한 자리를 놓친다. 스타일 규칙과 같은 종류라 정적으로 건다.
   */
  it('icons are imported by presentation components only', () => {
    const importers = FILES.filter((file) => /from 'lucide-react'/.test(readFileSync(file, 'utf8'))).map((f) =>
      f.slice(WEB_ROOT.length),
    );
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.every(file => file.startsWith('components/'))).toBe(true);
  });
});
