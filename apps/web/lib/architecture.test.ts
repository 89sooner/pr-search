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
    const offenders = FILES.filter((file) => COLOR.test(readFileSync(file, 'utf8'))).map((f) =>
      f.slice(WEB_ROOT.length),
    );
    expect(offenders).toEqual([]);
  });

  it('검사가 실제로 도는지 — 대상 파일이 비어 있지 않다', () => {
    // 걸러내기가 잘못돼 0개를 훑으면 위 시험이 영원히 통과한다.
    expect(FILES.length).toBeGreaterThan(10);
  });
});

describe('QA-COMMON-17: Conductor 외 UI 라이브러리가 없다 (ADR-006)', () => {
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
    '@conductor-by-89soone/css',
    '@conductor-by-89soone/react',
    '@conductor-by-89soone/tokens',
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

  it('Radix를 직접 의존하지 않는다 — Conductor를 통해서만 쓴다', () => {
    /*
     * Conductor가 Radix 위에 서 있지만 우리가 직접 가져다 쓰면 두 버전이
     * 공존하게 되고, Dialog 컨텍스트가 갈려 포커스 관리가 조용히 깨진다.
     */
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((n) => n.startsWith('@radix-ui/'))).toEqual([]);
  });
});
