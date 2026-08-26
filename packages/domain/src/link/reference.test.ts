import { describe, expect, it } from 'vitest';

import { FULL_SHA_LENGTH } from '../constants.js';
import {
  ABBREV_SHA_MAX,
  ABBREV_SHA_MIN,
  EVIDENCE_LIMIT,
  REFERENCE_LIMIT,
  commitReferenceKeys,
  extractReferences,
  pullRequestReferenceKeys,
  referenceKey,
  referenceLinkId,
} from './reference.js';

const SOURCE = { owner: 'acme', name: 'a' } as const;
const HOST = 'ghe.acme.example';

const keys = (text: string, options: Record<string, unknown> = {}): readonly string[] =>
  extractReferences(text, { sourceRepo: SOURCE, gheHost: HOST, ...options }).map((r) => r.reference_key);

const FULL = `${'a'.repeat(FULL_SHA_LENGTH - 1)}1`;

describe('패턴 6종 추출 (FR-REL-003 AC-1)', () => {
  it('`#N`', () => {
    expect(keys('fixes the bug in #123 somehow')).toEqual(['pr:123']);
  });

  it('`owner/repo#N` — 다른 저장소', () => {
    expect(keys('see acme/b#20')).toEqual(['x:acme/b:pr:20']);
  });

  it('GHE PR URL', () => {
    expect(keys(`https://${HOST}/acme/b/pull/77`)).toEqual(['x:acme/b:pr:77']);
  });

  it('GHE 커밋 URL', () => {
    expect(keys(`https://${HOST}/acme/b/commit/${FULL}`)).toEqual([`x:acme/b:commit:${FULL}`]);
  });

  it('트레일러 넷', () => {
    for (const word of ['Refs', 'Closes', 'Fixes', 'Resolves']) {
      expect(keys(`${word}: #7`)).toEqual(['pr:7']);
    }
  });

  it('40자 SHA', () => {
    expect(keys(`reverted ${FULL} yesterday`)).toEqual([`commit:${FULL}`]);
  });

  it('7자·12자 축약 SHA', () => {
    expect(keys('abcdef1 is the culprit')).toEqual(['commit-prefix:abcdef1']);
    expect(keys('abcdef123456 is the culprit')).toEqual(['commit-prefix:abcdef123456']);
  });

  it('대문자 SHA는 소문자로 정규화된다', () => {
    expect(keys('ABCDEF1 broke it')).toEqual(['commit-prefix:abcdef1']);
  });
});

describe('참조가 아닌 것', () => {
  it('6자 hex는 축약 SHA가 아니다 (ADR-012)', () => {
    expect(keys('abcdef broke it')).toEqual([]);
  });

  it('13자 hex는 축약도 전체도 아니다', () => {
    expect(keys('abcdef1234567 broke it')).toEqual([]);
  });

  it('41자 hex는 전체 SHA가 아니다', () => {
    expect(keys(`${FULL}b broke it`)).toEqual([]);
  });

  it('승인되지 않은 호스트의 URL은 참조가 아니다 (THR-036)', () => {
    expect(keys('https://github.com/acme/b/pull/20')).toEqual([]);
  });

  it('GHE 호스트가 구성되지 않으면 URL 참조를 만들지 않는다 (fail closed)', () => {
    expect(keys(`https://${HOST}/acme/b/pull/20`, { gheHost: null })).toEqual([]);
  });

  it('GHE 호스트의 다른 경로는 참조가 아니다', () => {
    expect(keys(`https://${HOST}/acme/b/issues/20`)).toEqual([]);
    expect(keys(`https://${HOST}/acme/b`)).toEqual([]);
  });

  it('GHE 커밋 URL의 SHA가 6자면 참조가 아니다', () => {
    expect(keys(`https://${HOST}/acme/b/commit/abcdef`)).toEqual([]);
  });

  it('빈 본문·null·undefined', () => {
    expect(keys('')).toEqual([]);
    expect(extractReferences(null, { sourceRepo: SOURCE })).toEqual([]);
    expect(extractReferences(undefined, { sourceRepo: SOURCE })).toEqual([]);
  });
});

describe('제외 구간 (AC-4)', () => {
  it('펜스 코드 블록 안은 추출하지 않는다', () => {
    expect(keys('before #1\n```\nsee #2 and abcdef1\n```\nafter #3')).toEqual(['pr:1', 'pr:3']);
  });

  it('물결 펜스도 같다', () => {
    expect(keys('~~~\n#2\n~~~\n#3')).toEqual(['pr:3']);
  });

  it('닫히지 않은 펜스는 끝까지 코드다', () => {
    expect(keys('#1\n```\n#2\n#3')).toEqual(['pr:1']);
  });

  it('인라인 코드 안은 추출하지 않는다', () => {
    expect(keys('use `#2` not #3')).toEqual(['pr:3']);
  });

  it('여러 백틱 스팬이 섞여도 짝만 덮는다', () => {
    expect(keys('``#1`` then #2 then `#3` then #4')).toEqual(['pr:2', 'pr:4']);
  });

  it('짝 없는 백틱은 코드가 아니다', () => {
    expect(keys('a ` b #5')).toEqual(['pr:5']);
  });

  it('인용 구간 안은 추출하지 않는다', () => {
    expect(keys('> quoted #2\nreal #3')).toEqual(['pr:3']);
  });

  it('들여쓴 인용도 인용이다', () => {
    expect(keys('   > #2\n#3')).toEqual(['pr:3']);
  });
});

describe('신뢰도 (AC-2)', () => {
  const refs = (text: string): readonly { reference_key: string; confidence: string }[] =>
    extractReferences(text, { sourceRepo: SOURCE, gheHost: HOST }).map((r) => ({
      reference_key: r.reference_key,
      confidence: r.confidence,
    }));

  it('트레일러는 derived', () => {
    expect(refs('Refs: #10')).toEqual([{ reference_key: 'pr:10', confidence: 'derived' }]);
  });

  it('본문 언급은 heuristic', () => {
    expect(refs('related to #10')).toEqual([{ reference_key: 'pr:10', confidence: 'heuristic' }]);
  });

  it('**트레일러는 줄 첫머리여야 한다** — 문장 가운데의 `Refs:`는 산문이다', () => {
    expect(refs('#10 Refs: #11')).toEqual([
      { reference_key: 'pr:10', confidence: 'heuristic' },
      { reference_key: 'pr:11', confidence: 'heuristic' },
    ]);
  });

  it('같은 본문에서 트레일러 줄과 산문 줄이 갈린다', () => {
    expect(refs('mentions #10\nRefs: #11')).toEqual([
      { reference_key: 'pr:10', confidence: 'heuristic' },
      { reference_key: 'pr:11', confidence: 'derived' },
    ]);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(refs('RESOLVES: #10')).toEqual([{ reference_key: 'pr:10', confidence: 'derived' }]);
  });
});

describe('중복 제거와 신뢰도 우선순위', () => {
  it('본문과 트레일러에 같은 참조가 있으면 간선 하나, derived가 이긴다', () => {
    const refs = extractReferences('mentions #123 in prose\n\nRefs: #123', {
      sourceRepo: SOURCE,
      gheHost: HOST,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.confidence).toBe('derived');
    expect(refs[0]?.evidence).toBe('Refs: #123');
  });

  it('트레일러가 먼저 나와도 derived가 유지된다', () => {
    const refs = extractReferences('Refs: #123\n\nalso #123', { sourceRepo: SOURCE, gheHost: HOST });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.confidence).toBe('derived');
  });

  it('source 저장소를 명시한 참조는 `#N`과 같은 키로 접힌다', () => {
    const refs = extractReferences('#20 and acme/a#20', { sourceRepo: SOURCE, gheHost: HOST });
    expect(refs.map((r) => r.reference_key)).toEqual(['pr:20']);
  });

  it('source 저장소 URL도 같은 키로 접힌다', () => {
    const refs = extractReferences(`#20 and https://${HOST}/acme/a/pull/20`, {
      sourceRepo: SOURCE,
      gheHost: HOST,
    });
    expect(refs.map((r) => r.reference_key)).toEqual(['pr:20']);
  });

  it('저장소 이름의 대소문자는 정체성이 아니다', () => {
    const refs = extractReferences('acme/B#20 and ACME/b#20', { sourceRepo: SOURCE, gheHost: HOST });
    expect(refs.map((r) => r.reference_key)).toEqual(['x:acme/b:pr:20']);
  });
});

describe('상한 (AC-5)', () => {
  const many = (count: number): string =>
    Array.from({ length: count }, (_, index) => `#${String(index + 1)}`).join(' ');

  it('고유 참조 100건까지', () => {
    expect(keys(many(REFERENCE_LIMIT))).toHaveLength(REFERENCE_LIMIT);
  });

  it('101건이면 앞의 100건만, 등장 순서를 보존한다', () => {
    const got = keys(many(REFERENCE_LIMIT + 1));
    expect(got).toHaveLength(REFERENCE_LIMIT);
    expect(got[0]).toBe('pr:1');
    expect(got[REFERENCE_LIMIT - 1]).toBe(`pr:${String(REFERENCE_LIMIT)}`);
    expect(got).not.toContain(`pr:${String(REFERENCE_LIMIT + 1)}`);
  });

  it('다시 돌려도 같은 100건이 나온다', () => {
    const text = many(REFERENCE_LIMIT + 50);
    expect(keys(text)).toEqual(keys(text));
  });

  it('**원시 일치가 아니라 고유 참조에 상한이 걸린다** — 중복 200건은 1건이다', () => {
    expect(keys(Array.from({ length: 200 }, () => '#1').join(' '))).toEqual(['pr:1']);
  });

  it('상한을 넘겨도 이미 들어온 참조는 derived로 승격된다', () => {
    const refs = extractReferences(`${many(REFERENCE_LIMIT)} #999\n\nRefs: #1`, {
      sourceRepo: SOURCE,
      gheHost: HOST,
    });
    expect(refs).toHaveLength(REFERENCE_LIMIT);
    expect(refs.find((r) => r.reference_key === 'pr:1')?.confidence).toBe('derived');
    expect(refs.map((r) => r.reference_key)).not.toContain('pr:999');
  });
});

describe('근거 텍스트 (NFR-005)', () => {
  it('참조가 나온 줄이다', () => {
    const refs = extractReferences('line one\nrelated to #5 here\nline three', {
      sourceRepo: SOURCE,
      gheHost: HOST,
    });
    expect(refs[0]?.evidence).toBe('related to #5 here');
  });

  it('본문을 통째로 복제하지 않는다 — 상한을 넘으면 자른다', () => {
    const long = `${'x'.repeat(500)} #5`;
    const refs = extractReferences(long, { sourceRepo: SOURCE, gheHost: HOST });
    expect(refs[0]?.evidence.length).toBeLessThanOrEqual(EVIDENCE_LIMIT);
  });
});

describe('reference_key 형식', () => {
  it('저장소 구간은 다른 저장소일 때만 붙는다', () => {
    expect(referenceKey({ kind: 'pull_request', repo: null, number: 3 })).toBe('pr:3');
    expect(referenceKey({ kind: 'pull_request', repo: { owner: 'o', name: 'r' }, number: 3 })).toBe(
      'x:o/r:pr:3',
    );
  });

  it('커밋과 접두를 구분한다', () => {
    expect(referenceKey({ kind: 'commit', repo: null, sha: FULL })).toBe(`commit:${FULL}`);
    expect(referenceKey({ kind: 'commit_prefix', repo: null, prefix: 'abcdef1' })).toBe(
      'commit-prefix:abcdef1',
    );
  });
});

describe('link_id는 대상이 아니라 표현으로 만든다 (DEV-217)', () => {
  it('같은 표현이면 같은 ID', () => {
    expect(referenceLinkId('pull_request', '1:2', 'pr:10')).toBe(
      referenceLinkId('pull_request', '1:2', 'pr:10'),
    );
  });

  it('표현이 다르면 다른 ID', () => {
    expect(referenceLinkId('pull_request', '1:2', 'pr:10')).not.toBe(
      referenceLinkId('pull_request', '1:2', 'pr:11'),
    );
  });

  it('source가 다르면 다른 ID', () => {
    expect(referenceLinkId('pull_request', '1:2', 'pr:10')).not.toBe(
      referenceLinkId('pull_request', '1:3', 'pr:10'),
    );
  });

  it('from_type이 다르면 다른 ID — 구분자가 값 안에 나타나지 않는다', () => {
    expect(referenceLinkId('commit', '1:2', 'pr:10')).not.toBe(
      referenceLinkId('pull_request', '1:2', 'pr:10'),
    );
  });
});

describe('역방향 조회 후보 (JOB-REL-005)', () => {
  it('커밋은 전체 하나 + 접두 여섯 = 일곱', () => {
    const candidates = commitReferenceKeys(FULL, null);
    expect(candidates).toHaveLength(1 + (ABBREV_SHA_MAX - ABBREV_SHA_MIN + 1));
    expect(candidates[0]).toBe(`commit:${FULL}`);
    expect(candidates).toContain(`commit-prefix:${FULL.slice(0, 7)}`);
    expect(candidates).toContain(`commit-prefix:${FULL.slice(0, 12)}`);
  });

  it('추출된 축약 참조의 키가 후보에 실제로 들어 있다', () => {
    const extracted = extractReferences(`caused by ${FULL.slice(0, 9)}`, {
      sourceRepo: SOURCE,
      gheHost: HOST,
    });
    expect(commitReferenceKeys(FULL, null)).toContain(extracted[0]?.reference_key);
  });

  it('다른 저장소 후보는 저장소 구간을 갖는다', () => {
    expect(commitReferenceKeys(FULL, { owner: 'acme', name: 'b' })[0]).toBe(`x:acme/b:commit:${FULL}`);
  });

  it('PR 후보는 하나다', () => {
    expect(pullRequestReferenceKeys(20, null)).toEqual(['pr:20']);
    expect(pullRequestReferenceKeys(20, { owner: 'acme', name: 'a' })).toEqual(['x:acme/a:pr:20']);
  });
});
