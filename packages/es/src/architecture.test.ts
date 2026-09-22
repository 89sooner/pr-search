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
  {
    file: 'packages/es/src/links.ts',
    kind: 'no_requester',
    why:
      'WP-029 참조 간선 파생·해결 (CR-039)과 WP-030 되돌림·체리픽·스택 파생 (CR-041). ' +
      '방아쇠가 이벤트와 운영자 잡이라 **요청자가 없다** — ' +
      '읽는 것은 "이 참조의 대상이 색인되었는가"와 "이 대상을 가리키는 미해결 간선이 무엇인가"이며, ' +
      '둘 다 사용자에게 나가지 않는 파생 사실이다. 간선 자체는 생성 시점에 source 저장소의 ' +
      '접근 통제 material을 싣고(THR-035), 그것을 **사용자에게 내주는** 관계 조회 API는 WP-031이 ' +
      '만들며 거기서 대상 저장소 범위를 다시 교집합해야 한다 (THR-034). ' +
      'WP-030이 더한 조회도 같은 성질이다 — 후보 대조·조정·요약 재계산은 전부 파생 사실이며 ' +
      '세 계열 모두 **동일 저장소 안**의 관계라 저장소 경계를 넘지 않는다 (FR-REL-005 AC-3, FR-REL-006).',
  },
  {
    file: 'apps/pipeline-worker/src/reindex.ts',
    kind: 'no_requester',
    why:
      'WP-035 무중단 재색인의 **전환 전 검증** (CR-045, DEV-297). 방아쇠가 운영자 잡이라 ' +
      '요청자가 없고, 읽는 대상은 **아직 별칭이 붙지 않은 shadow 인덱스**를 구체 이름으로 ' +
      '지목한 것이다 — 어떤 사용자 요청도 그 인덱스에 닿을 수 없다. ' +
      '`count`는 커버리지 판정이고 `search`는 `size: 0` 대표 질의라 **문서가 하나도 나오지 않는다**: ' +
      '둘 다 결과가 잡 진행률 로그로만 나가고 응답 본문이 되지 않는다. ' +
      '`source_count == target_count` 하나로 판정하지 않는 것이 이 검증의 요지이며(같은 수의 다른 문서), ' +
      '그래서 두 인덱스의 건수를 함께 본다. 이 파일에 **사용자 대면 조회를 넣지 않는다** — ' +
      '넣으면 이 사유를 그대로 물려받고 검사기가 침묵한다 (DEV-265가 links.ts에서 배운 것).',
  },
  {
    file: 'packages/es/src/sequence-projection.ts',
    kind: 'no_requester',
    why:
      'CR-113 머지 시퀀스의 문서 단위 투영기 (FR-SEQ-001 AC-7, ADR-004 Amendment). 방아쇠가 채번·' +
      '재채번·늦은 스냅숏·커밋 보강·재색인·durable 러너·운영자 재투영 잡이라 **요청자가 없다**. ' +
      '`mget`은 문서 ID를 이미 알고 있는 커밋·PR 문서의 서수 필드(repository_id·base_branch·SHA·' +
      'merge_seq·seq_epoch·sequence_space)만 읽어 정본과 대조하고, `search`는 재색인 전환 전 검증이 ' +
      '구체 target 인덱스에서 서수 순서만 읽는다 — 제목·본문·작성자는 읽지 않고 결과는 판정·로그로만 ' +
      '쓰이며 응답 본문이 되지 않는다. 사용자 대면 조회를 이 파일에 넣지 않는다.',
  },
];

const UNSCOPED_FILES = UNSCOPED_ALLOWLIST.map((one) => one.file);

/**
 * `search` 예외는 **`no_requester`만** 허용한다.
 *
 * `user_facing` 예외는 요청자에게 무언가를 내주는 경로다. 거기서 `search`가
 * 열리면 전역 집계 하나를 허용한 근거가 **문서 목록 전체**로 번진다 —
 * `count`는 수를 주고 `search`는 문서를 준다. 둘은 같은 예외가 아니다.
 */
const UNSCOPED_SEARCH_FILES = UNSCOPED_ALLOWLIST.filter((one) => one.kind === 'no_requester').map(
  (one) => one.file,
);

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

    /*
     * **`\r`를 함께 자른다** (WP-032, DEV-327).
     *
     * `split('\n')`만 하면 CRLF 파일의 각 줄 끝에 `\r`가 남는다. 그리고 JS
     * 정규식에서 `.`는 `\r`를 매치하지 않으므로 아래 주석 제거의 `.*$`가 줄
     * 끝에 닿지 못하고 **치환이 통째로 실패한다.**
     *
     * 이 저장소의 소스는 거의 전부 CRLF다(`core.autocrlf=true`). 즉 "주석에
     * 규칙을 적어 두는 것은 위반이 아니다"라는 규칙이 지금까지 한 번도 참이
     * 아니었다 — 금지된 모양을 **설명하는 주석**이 위반으로 잡힌다. 검사가
     * 의도보다 엄격했던 것이라 유출은 없었지만, 다음 사람에게 "설명을 쓰지
     * 마라"를 가르치는 검사였다.
     */
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
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
    const offences = scan(/\b(?:client|es|elasticsearch)\s*\.\s*search\s*[(<]/, [
      SEARCH_FACADE,
      ...UNSCOPED_SEARCH_FILES,
    ]);

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

  it('접근 범위 필드를 `msearch`·`count`·`mget`으로 우회하지 않는다', () => {
    // `search` 말고도 문서를 세거나 읽는 경로가 있다. 생기면 여기서 걸린다.
    //
    // `mget`을 더한 것은 CR-042다 (DEV-265). 관계 조회가 대상의 제목·작성자를
    // 붙일 때 **ID를 알고 있으므로** `mget`이 가장 짧은 길인데, 그것은 강제
    // 필터를 통째로 지나간다 — THR-034가 막으려는 바로 그 유출이다.
    const offences = scan(
      /\b(?:client|es)\s*\.\s*(?:msearch|count|scroll|openPointInTime|mget)\s*[(<]/,
      [SEARCH_FACADE, ...UNSCOPED_FILES],
    );


    expect(
      offences,
      `범위 필터를 거치지 않는 조회 경로가 있다:\n${offences
        .map((one) => `  ${one.file}:${String(one.line)} — ${one.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('**Elasticsearch 핸들의 `get`으로 문서를 직접 읽지 않는다** (CR-042, DEV-265)', () => {
    /*
     * `client.get`은 받지 않는다 — Redis 핸들도 같은 이름을 쓰고
     * (`apps/search-api/src/index.ts`의 세션 저장소), 그것을 잡으면 규칙이
     * 아니라 소음이 된다. 이 저장소에서 Elasticsearch 핸들의 이름은 `es`이며
     * (`DetailDeps`·`SearchDeps`·`RuntimeParts`가 모두 그렇다) `mget`은 위
     * 검사가 이름과 무관하게 잡는다.
     */
    const offences = scan(/\b(?:es|elasticsearch)\s*\.\s*get\s*[(<]/, [
      SEARCH_FACADE,
      ...UNSCOPED_FILES,
    ]);

    expect(
      offences,
      `범위 필터를 거치지 않는 문서 읽기가 있다:\n${offences
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

  it('**`user_facing` 예외는 `search`를 열지 않는다** (CR-039)', () => {
    // `count`는 수를 주고 `search`는 문서를 준다. 같은 예외로 묶으면 전역 집계
    // 하나를 허용한 근거가 문서 목록 전체로 번진다.
    const userFacing = UNSCOPED_ALLOWLIST.filter((one) => one.kind === 'user_facing');
    expect(userFacing.length).toBeGreaterThan(0);
    for (const entry of userFacing) {
      expect(UNSCOPED_SEARCH_FILES, `${entry.file}이 search 예외에 들어 있다`).not.toContain(entry.file);
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
