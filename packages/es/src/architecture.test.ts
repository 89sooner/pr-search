/**
 * 아키텍처 테스트: 필수 접근 범위 필터를 우회하는 경로가 없다 (WP-012 DoD 9, ADR-008).
 *
 * 타입 시스템이 이미 대부분을 막는다 — `search`는 `ScopedQuery`만 받고
 * `ScopedQuery`는 `applyMandatoryScopeFilter`만 만든다. 그러나 타입은 **두
 * 가지를 막지 못한다.**
 *
 *   1. `client.search()`를 직접 부르기 — 브랜드 타입을 아예 지나친다
 *   2. `as ScopedQuery` 캐스팅 — 브랜드를 손으로 붙인다
 *
 * 그래서 소스를 읽어 그 둘을 찾는다. 이 검사가 없으면 ADR-008의 불변식은
 * "리뷰에서 걸리기를 바란다"가 된다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * `search`·`multiSearch`를 정의하는 파일.
 *
 * 여기서만 `client.search`·`client.msearch`를 부른다. 둘 다 `ScopedQuery`만
 * 받으므로 이 파일을 거치는 조회는 필터를 건너뛸 수 없다.
 */
const SEARCH_FACADE = 'packages/es/src/search.ts';
/** 브랜드를 만드는 파일. 여기서만 `as ScopedQuery`가 허용된다. */
const SCOPE_FILTER = 'packages/es/src/scoped-query.ts';

/**
 * 접근 범위를 거치지 않는 조회가 **의도적으로** 허용된 자리.
 *
 * 목록이 짧고 사유가 붙어 있어야 한다. 비워 두거나 규칙에서 `count`를 통째로
 * 빼면 다음 전역 집계가 조용히 들어온다 — 그것이 THR-003이 말하는 유출 경로다.
 *
 * **두 갈래를 섞지 않는다** (CR-024 DEV-051이 정한 경계).
 *
 *   - `user_facing`: 사용자 요청이 부르는 경로. 요청자가 있으므로 무엇을
 *     내주는지가 곧 유출 여부다. 여기 새 항목이 들어오는 것은 **경계를 넓히는
 *     일**이므로 CR이 필요하다.
 *   - `no_requester`: 웹훅·스케줄이 깨운 잡. 볼 사람이 없어 접근 범위라는
 *     개념 자체가 성립하지 않는다. 결과를 사용자에게 내주는 API가 각자 필터를
 *     건다.
 *
 * 둘을 하나로 뭉치면 다음에 들어올 사용자 대면 예외가 "워커도 있잖아"를 근거로
 * 조용히 따라 들어온다.
 */
const UNSCOPED_ALLOWLIST: readonly {
  readonly file: string;
  readonly kind: 'user_facing' | 'no_requester';
  readonly why: string;
}[] = [
  {
    file: 'apps/search-api/src/ops/pipeline-status.ts',
    kind: 'user_facing',
    why:
      'FR-ADMIN-001 AC-1이 파이프라인 전체의 "보강 대기 건수"를 요구한다. ' +
      '저장소 신원이 없는 단일 정수이고 `operator` 역할 뒤에 있다. ' +
      'CR-024가 그 경계를 확정했다 — 전역 수치는 예외, 저장소 식별자는 범위 안 (DEV-051).',
  },
];

const UNSCOPED_FILES = UNSCOPED_ALLOWLIST.map((one) => one.file);

/**
 * 테스트는 Elasticsearch를 직접 부를 수 있다.
 *
 * 테스트가 확인하는 것은 사용자에게 나가는 결과가 아니라 ES 자체의 동작이다.
 * 다만 **`src/`의 테스트가 아닌 파일은 예외가 아니다** — 운영 코드가
 * `integration/` 아래로 숨는 것을 막는다.
 */
function isTestFile(file: string): boolean {
  return file.endsWith('.test.ts') || file.includes('/integration/') || file.includes('/testing/');
}

const SEARCHED_ROOTS = ['packages', 'apps'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function collectSourceFiles(): string[] {
  const files: string[] = [];

  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(child);
    }
  };

  for (const root of SEARCHED_ROOTS) {
    const absolute = join(ROOT, root);
    try {
      if (statSync(absolute).isDirectory()) walk(absolute);
    } catch {
      continue;
    }
  }

  return files;
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function scan(
  pattern: RegExp,
  allowed: readonly string[],
  options: { readonly includeTests?: boolean } = {},
): Offence[] {
  const offences: Offence[] = [];

  for (const absolute of collectSourceFiles()) {
    const file = relative(ROOT, absolute).replaceAll('\\', '/');
    if (allowed.includes(file)) continue;
    if (options.includeTests !== true && isTestFile(file)) continue;

    const lines = readFileSync(absolute, 'utf8').split('\n');
    lines.forEach((text, index) => {
      // 주석에 규칙을 적어 두는 것은 위반이 아니다.
      const code = text.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (pattern.test(code)) offences.push({ file, line: index + 1, text: text.trim() });
    });
  }

  return offences;
}

describe('DoD 9 / ADR-008: 우회 경로 부재', () => {
  it('`@prs/es`의 `search` 밖에서 Elasticsearch를 직접 조회하지 않는다', () => {
    // 이 검사가 잡는 것: `client.search({ query })`로 브랜드 타입을 지나가는 코드.
    const offences = scan(/\b(?:client|es|elasticsearch)\s*\.\s*search\s*[(<]/, [SEARCH_FACADE]);

    expect(
      offences,
      `필수 접근 범위 필터를 지나치는 조회가 있다:\n${offences
        .map((one) => `  ${one.file}:${String(one.line)} — ${one.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('`ScopedQuery`를 손으로 만들지 않는다', () => {
    // 이 검사가 잡는 것: `as ScopedQuery`로 브랜드를 붙여 필터를 건너뛰는 코드.
    const offences = scan(/\bas\s+ScopedQuery\b/, [SCOPE_FILTER]);

    expect(
      offences,
      `브랜드 타입을 손으로 붙인 곳이 있다:\n${offences
        .map((one) => `  ${one.file}:${String(one.line)} — ${one.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('접근 범위 필드를 `msearch`·`count`로 우회하지 않는다', () => {
    // `search` 말고도 문서를 세거나 읽는 경로가 있다. 생기면 여기서 걸린다.
    const offences = scan(
      /\b(?:client|es)\s*\.\s*(?:msearch|count|scroll|openPointInTime)\s*[(<]/,
      [SEARCH_FACADE, ...UNSCOPED_FILES],
    );

    expect(
      offences,
      `범위 필터를 거치지 않는 조회 경로가 있다:\n${offences
        .map((one) => `  ${one.file}:${String(one.line)} — ${one.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('허용 목록의 모든 항목에 사유가 붙어 있다', () => {
    // 사유 없는 예외가 쌓이면 규칙이 아니라 관습이 된다.
    for (const entry of UNSCOPED_ALLOWLIST) {
      expect(entry.why.length, `${entry.file}에 사유가 없다`).toBeGreaterThan(40);
    }
  });

  it('검사기 자신이 동작한다 — 규칙을 어긴 코드를 실제로 잡는다', () => {
    // 검사기가 늘 빈 배열을 돌려주는 상태로 썩는 것을 막는다.
    const files = collectSourceFiles();
    expect(files.length).toBeGreaterThan(50);
    // `search.ts`는 허용 목록에 있으므로 위 검사에서 빠지지만, 목록을 비우면 걸려야 한다.
    expect(scan(/\b(?:client|es)\s*\.\s*search\s*[(<]/, []).length).toBeGreaterThan(0);
    // 허용 목록을 비우면 DEV-051의 자리가 드러나야 한다.
    expect(
      scan(/\b(?:client|es)\s*\.\s*(?:msearch|count|scroll|openPointInTime)\s*[(<]/, []).length,
    ).toBeGreaterThan(0);
  });
});
