/**
 * 커밋 그래프 판정 (WP-020 / CR-023).
 *
 * 여기 있는 것이 **git에 무엇을 넘길지**와 **git이 답한 것을 어떻게 읽을지**의
 * 전부다. 실제 git 동작은 통합 시험이 걸고, 이 계층은 클러스터 없이 판정된다.
 *
 * 검증: `npx vitest run packages/github/src/graph-plan.test.ts`
 */

import { describe, expect, it } from 'vitest';
import {
  authArgs,
  branchRef,
  diskUsageRatio,
  firstParentChain,
  gitEnv,
  GraphInputError,
  isFullSha,
  isSafeBranch,
  mirrorPath,
  parsePatchId,
  parseFirstParentCommits,
  parseRevList,
  readAncestorExit,
  revRangeArg,
} from './graph-plan.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('식별자 검사', () => {
  it('40자 소문자 16진수만 SHA로 본다', () => {
    expect(isFullSha(SHA_A)).toBe(true);
    expect(isFullSha('A'.repeat(40))).toBe(false);
    expect(isFullSha('a'.repeat(39))).toBe(false);
    expect(isFullSha('a'.repeat(41))).toBe(false);
    expect(isFullSha('g'.repeat(40))).toBe(false);
  });

  it('**축약 SHA를 그래프 입력으로 받지 않는다** — 검색 입력이지 정체성이 아니다 (ADR-012)', () => {
    expect(isFullSha('abc1234')).toBe(false);
  });

  it('**앞에 `-`가 붙은 브랜치 이름을 막는다** — git이 옵션으로 읽는다', () => {
    expect(isSafeBranch('--upload-pack=evil')).toBe(false);
    expect(isSafeBranch('-x')).toBe(false);
  });

  it('git이 ref 이름으로 거부하는 모양을 막는다', () => {
    for (const bad of ['a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[1]', 'a\\b', 'x.lock', 'x/']) {
      expect(isSafeBranch(bad)).toBe(false);
    }
  });

  it('평범한 브랜치 이름은 통과한다', () => {
    for (const good of ['main', 'release/2026.08', 'feat_x-1', 'a']) {
      expect(isSafeBranch(good)).toBe(true);
    }
  });
});

describe('revRangeArg', () => {
  it('`from`이 null이면 끝만 넘긴다 — 처음부터라는 뜻이다', () => {
    expect(revRangeArg({ from: null, to: SHA_A })).toBe(SHA_A);
  });

  it('둘 다 있으면 `a..b`다', () => {
    expect(revRangeArg({ from: SHA_A, to: SHA_B })).toBe(`${SHA_A}..${SHA_B}`);
  });

  it('**SHA가 아니면 던진다** — 검사 없이 넘기면 git의 revision 문법으로 읽힌다', () => {
    expect(() => revRangeArg({ from: null, to: 'HEAD' })).toThrow(GraphInputError);
    expect(() => revRangeArg({ from: '--all', to: SHA_A })).toThrow(GraphInputError);
    expect(() => revRangeArg({ from: null, to: 'abc1234' })).toThrow(GraphInputError);
  });
});

describe('경로와 ref', () => {
  it('미러 경로는 `repository_id`로 짓는다 — 소유자·이름이 바뀌어도 따라가지 않는다', () => {
    expect(mirrorPath('/mirrors', 4021)).toBe('/mirrors/4021.git');
  });

  it('루트 끝의 `/`를 중복시키지 않는다', () => {
    expect(mirrorPath('/mirrors/', 7)).toBe('/mirrors/7.git');
  });

  it('브랜치는 `refs/heads/`를 붙여 넘긴다', () => {
    expect(branchRef('main')).toBe('refs/heads/main');
  });

  it('안전하지 않은 브랜치는 ref로 만들지 않는다', () => {
    expect(() => branchRef('--exec=x')).toThrow(GraphInputError);
  });
});

describe('gitEnv', () => {
  it('**기본은 blob 지연 인출 금지다** (CR-023, DEV-111)', () => {
    expect(gitEnv({}).GIT_NO_LAZY_FETCH).toBe('1');
    expect(gitEnv({}, {}).GIT_NO_LAZY_FETCH).toBe('1');
    expect(gitEnv({}, { allowBlobFetch: false }).GIT_NO_LAZY_FETCH).toBe('1');
  });

  it('명시적으로 켜야만 풀린다 — 켜면 소스가 볼륨에 남는다', () => {
    expect(gitEnv({}, { allowBlobFetch: true }).GIT_NO_LAZY_FETCH).toBeUndefined();
  });

  it('상속된 `GIT_NO_LAZY_FETCH`를 켤 때 확실히 지운다', () => {
    expect(gitEnv({ GIT_NO_LAZY_FETCH: '1' }, { allowBlobFetch: true }).GIT_NO_LAZY_FETCH).toBeUndefined();
  });

  it('터미널 프롬프트를 막는다 — 워커에는 터미널이 없어 멈추면 타임아웃까지 매달린다', () => {
    expect(gitEnv({}).GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('시스템 설정을 무시한다 — 환경마다 다른 결과를 내지 않는다', () => {
    expect(gitEnv({}).GIT_CONFIG_NOSYSTEM).toBe('1');
  });
});

describe('authArgs (CR-023, DEV-110)', () => {
  it('토큰이 없으면 인자를 만들지 않는다', () => {
    expect(authArgs(null)).toEqual([]);
    expect(authArgs('')).toEqual([]);
  });

  it('**토큰을 URL이 아니라 헤더로 넘긴다** — URL에 넣으면 `.git/config`에 남는다', () => {
    const args = authArgs('ghs_secret');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('http.extraHeader=Authorization: Basic ');
  });

  it('헤더 값이 base64라 토큰이 평문으로 보이지 않는다', () => {
    const args = authArgs('ghs_secret');
    expect(args[1]).not.toContain('ghs_secret');
    const encoded = args[1]?.split('Basic ')[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('x-access-token:ghs_secret');
  });
});

describe('출력 해석', () => {
  it('rev-list 출력에서 빈 줄을 버린다', () => {
    expect(parseRevList(`${SHA_A}\n${SHA_B}\n\n`)).toEqual([SHA_A, SHA_B]);
  });

  it('빈 출력은 빈 배열이다 — 채번할 것이 없다는 뜻이지 오류가 아니다', () => {
    expect(parseRevList('')).toEqual([]);
    expect(parseRevList('\n\n')).toEqual([]);
  });

  it('patch-id 출력의 첫 필드만 읽는다', () => {
    expect(parsePatchId(`${SHA_A} ${SHA_B}\n`)).toBe(SHA_A);
  });

  it('**빈 출력은 오류가 아니다** — 변경 없는 커밋은 patch-id가 없다', () => {
    expect(parsePatchId('')).toBeNull();
    expect(parsePatchId('\n')).toBeNull();
  });

  it('patch-id 모양이 아니면 받지 않는다', () => {
    expect(parsePatchId('not-a-patch-id abc\n')).toBeNull();
  });
});

describe('parseFirstParentCommits (CR-025, DEV-115)', () => {
  const AT_A = '2026-08-23T09:49:50+09:00';
  const AT_B = '2026-08-22T23:08:41+00:00';

  it('한 줄에서 SHA와 시각을 함께 읽는다', () => {
    expect(parseFirstParentCommits(`${SHA_A} ${AT_A}\n${SHA_B} ${AT_B}\n`)).toEqual([
      { sha: SHA_A, committedAt: AT_A },
      { sha: SHA_B, committedAt: AT_B },
    ]);
  });

  it('빈 줄은 버린다', () => {
    expect(parseFirstParentCommits('')).toEqual([]);
    expect(parseFirstParentCommits(`\n${SHA_A} ${AT_A}\n\n`)).toEqual([{ sha: SHA_A, committedAt: AT_A }]);
  });

  it('시각이 없는 줄은 **버리지 않고 던진다**', () => {
    /*
     * 한 줄을 조용히 버리면 그 뒤 서수가 통째로 하나씩 밀리는데, 그 사실을
     * 알아챌 방법이 없다. `parseRevList`가 빈 줄을 버리는 것과 다르다 —
     * 거기서 버리는 것은 값이 없는 줄이고, 여기서 버리게 되는 것은 커밋이다.
     */
    expect(() => parseFirstParentCommits(`${SHA_A}\n`)).toThrow();
  });

  it('SHA 자리가 40자 hex가 아니면 던진다', () => {
    expect(() => parseFirstParentCommits(`abc1234 ${AT_A}\n`)).toThrow();
    expect(() => parseFirstParentCommits(`commit ${SHA_A}\n`)).toThrow();
  });

  it('`rev-list --format`의 머리줄을 만나면 던진다 — 조용히 넘기지 않는다', () => {
    /*
     * `git rev-list --format=...`은 커밋마다 `commit <sha>` 머리줄을 더 낸다
     * (실측 확인). 그래서 구현은 `git log`를 쓰지만, 누군가 명령을 되돌렸을 때
     * **파서가 그것을 알아채야** 한다 — 머리줄을 커밋으로 세면 서수가 두 배가 된다.
     */
    expect(() => parseFirstParentCommits(`commit ${SHA_A}\n${SHA_A} ${AT_A}\n`)).toThrow();
  });

  it('오프셋 없는 시각은 던진다 — 서버 시간대로 해석되면 커밋 시각이 환경마다 달라진다', () => {
    expect(() => parseFirstParentCommits(`${SHA_A} 2026-08-23 09:49:50\n`)).toThrow();
    expect(() => parseFirstParentCommits(`${SHA_A} 2026-08-23T09:49:50\n`)).toThrow();
  });

  it('`Z` 표기와 `+09:00` 표기를 모두 받는다', () => {
    expect(parseFirstParentCommits(`${SHA_A} 2026-08-23T00:49:50Z\n`)).toEqual([
      { sha: SHA_A, committedAt: '2026-08-23T00:49:50Z' },
    ]);
    expect(parseFirstParentCommits(`${SHA_A} ${AT_A}\n`)).toEqual([{ sha: SHA_A, committedAt: AT_A }]);
  });

  it('날짜가 아닌 문자열은 던진다', () => {
    expect(() => parseFirstParentCommits(`${SHA_A} not-a-date+09:00\n`)).toThrow();
  });
});

describe('readAncestorExit', () => {
  it('0은 조상, 1은 조상 아님이다', () => {
    expect(readAncestorExit(0)).toBe(true);
    expect(readAncestorExit(1)).toBe(false);
  });

  it('**그 밖의 코드는 던진다** — git이 깨진 것을 "조상 아님"으로 읽으면 재채번이 잘못 발동한다', () => {
    expect(() => readAncestorExit(128)).toThrow();
    expect(() => readAncestorExit(2)).toThrow();
  });
});

describe('firstParentChain (API 폴백)', () => {
  const chain = [
    { sha: 'c'.repeat(40), parents: [{ sha: 'b'.repeat(40) }, { sha: 'z'.repeat(40) }] },
    { sha: 'b'.repeat(40), parents: [{ sha: 'a'.repeat(40) }] },
    { sha: 'a'.repeat(40), parents: [] },
  ];

  it('**오래된 것부터 준다** — `--reverse`와 같은 순서다', () => {
    expect(firstParentChain(chain, 'c'.repeat(40), null)).toEqual(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]);
  });

  it('`from`은 결과에서 제외된다 — 반개구간이다', () => {
    expect(firstParentChain(chain, 'c'.repeat(40), 'a'.repeat(40))).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
  });

  it('**두 번째 부모를 따라가지 않는다** — first-parent가 아니면 시퀀스가 아니다', () => {
    expect(firstParentChain(chain, 'c'.repeat(40), null)).not.toContain('z'.repeat(40));
  });

  it('`from`과 `to`가 같으면 빈 구간이다', () => {
    expect(firstParentChain(chain, 'c'.repeat(40), 'c'.repeat(40))).toEqual([]);
  });

  it('**체인이 끊기면 던진다** — 추측해서 이으면 그 뒤 서수가 전부 밀린다', () => {
    const broken = [{ sha: 'c'.repeat(40), parents: [{ sha: 'b'.repeat(40) }] }];
    expect(() => firstParentChain(broken, 'c'.repeat(40), null)).toThrow(/체인이 끊겼다/);
  });

  it('**`from`이 체인에 없으면 던진다** — 다른 브랜치의 커밋으로 구간을 만들 수 없다', () => {
    expect(() => firstParentChain(chain, 'c'.repeat(40), 'd'.repeat(40))).toThrow(/체인에 없다/);
  });
});

describe('diskUsageRatio', () => {
  it('사용 비율을 낸다', () => {
    expect(diskUsageRatio({ blocks: 100, bfree: 15 })).toBeCloseTo(0.85);
  });

  it('**총량이 0이면 `null`이다** — 0을 내면 "여유롭다"로 읽힌다', () => {
    expect(diskUsageRatio({ blocks: 0, bfree: 0 })).toBeNull();
  });

  it('범위를 0~1로 자른다', () => {
    expect(diskUsageRatio({ blocks: 100, bfree: 200 })).toBe(0);
    expect(diskUsageRatio({ blocks: 100, bfree: -10 })).toBe(1);
  });
});
