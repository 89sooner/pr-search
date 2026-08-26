/**
 * 되돌림·체리픽 파서와 파생 간선 ID (WP-030 / CR-041).
 *
 * 순수 함수라 실 서비스가 필요 없다. 여기서 지키는 것은 **무엇이 적혀 있는지**의
 * 판정이며, 그것이 무엇을 가리키는지는 통합 시험이 정본으로 확인한다.
 */

import { describe, expect, it } from 'vitest';

import { derivedLinkId } from './derived-id.js';
import { extractCherryPicks } from './cherry.js';
import { extractCommitReverts, extractReverts } from './revert.js';

const A = `${'a'.repeat(39)}1`;
const B = `${'b'.repeat(39)}2`;

describe('되돌림 추출 (FR-REL-004 AC-1·AC-2)', () => {
  it('`This reverts commit <40자>`는 exact이고 대상을 SHA로 지목한다', () => {
    const found = extractCommitReverts(`Revert "fix login"\n\nThis reverts commit ${A}.`);
    const exact = found.filter((entry) => entry.confidence === 'exact');
    expect(exact).toHaveLength(1);
    expect(exact[0]!.target).toEqual({ kind: 'commit', sha: A });
  });

  it('`Revert "<제목>"`은 heuristic이고 대상이 제목이다', () => {
    const found = extractCommitReverts('Revert "fix login"');
    expect(found).toHaveLength(1);
    expect(found[0]!.confidence).toBe('heuristic');
    expect(found[0]!.target).toEqual({ kind: 'title', title: 'fix login' });
  });

  it('PR 제목 접두 `Revert`가 따옴표 없이도 잡힌다 (AC-1의 셋째 패턴)', () => {
    const found = extractReverts('Revert: fix login', { isPullRequestTitle: true });
    expect(found).toHaveLength(1);
    expect(found[0]!.target).toEqual({ kind: 'title', title: 'fix login' });
  });

  it('**본문에서는 접두 규칙을 쓰지 않는다** — 서술문을 되돌림으로 승격시키지 않는다', () => {
    // 옵션이 없으면 접두 규칙은 적용되지 않는다.
    expect(extractReverts('Revert this later if it breaks')).toHaveLength(0);
  });

  it('축약 SHA는 되돌림으로 승격되지 않는다 — 접두 해석은 references가 소유한다', () => {
    expect(extractCommitReverts('This reverts commit abc1234')).toHaveLength(0);
  });

  it('코드 블록 안의 트레일러는 추출되지 않는다 (AC-4 규율 재사용)', () => {
    expect(extractCommitReverts(`설명\n\`\`\`\nThis reverts commit ${A}\n\`\`\`\n`)).toHaveLength(0);
  });

  it('인용 구간 안의 트레일러도 추출되지 않는다', () => {
    expect(extractCommitReverts(`> This reverts commit ${A}`)).toHaveLength(0);
  });

  it('같은 대상이 트레일러와 제목에 함께 나오면 **exact가 이긴다**', () => {
    const found = extractCommitReverts(`This reverts commit ${A}\nThis reverts commit ${A}`);
    expect(found).toHaveLength(1);
    expect(found[0]!.confidence).toBe('exact');
  });

  it('트레일러 둘이면 간선 후보도 둘이다', () => {
    const found = extractCommitReverts(`This reverts commit ${A}\nThis reverts commit ${B}`);
    expect(found.filter((one) => one.confidence === 'exact')).toHaveLength(2);
  });

  it('근거 텍스트가 그 표현이 나온 줄이다', () => {
    const found = extractCommitReverts(`머리말\nThis reverts commit ${A}.`);
    expect(found[0]!.evidence).toBe(`This reverts commit ${A}.`);
  });

  it('제목의 공백은 접어 정규화한다 — 인덱스 대조 키여야 한다', () => {
    const found = extractCommitReverts('Revert "fix   login"');
    expect(found[0]!.target).toEqual({ kind: 'title', title: 'fix login' });
  });

  it('빈 본문은 0건이다', () => {
    expect(extractReverts('')).toHaveLength(0);
  });
});

describe('체리픽 추출 (FR-REL-005 AC-1)', () => {
  it('`(cherry picked from commit <40자>)`를 잡는다', () => {
    const found = extractCherryPicks(`port\n\n(cherry picked from commit ${A})`);
    expect(found).toHaveLength(1);
    expect(found[0]!.sha).toBe(A);
  });

  it('같은 SHA가 두 번 나와도 하나다', () => {
    const message = `x\n(cherry picked from commit ${A})\n(cherry picked from commit ${A})`;
    expect(extractCherryPicks(message)).toHaveLength(1);
  });

  it('두 SHA는 **등장 순서를 보존한다** — 상한 판정이 결정론이어야 한다', () => {
    const message = `x\n(cherry picked from commit ${B})\n(cherry picked from commit ${A})`;
    expect(extractCherryPicks(message).map((one) => one.sha)).toEqual([B, A]);
  });

  it('코드 블록 안의 트레일러는 추출되지 않는다', () => {
    expect(extractCherryPicks(`\`\`\`\n(cherry picked from commit ${A})\n\`\`\``)).toHaveLength(0);
  });

  it('축약 SHA는 잡지 않는다', () => {
    expect(extractCherryPicks('(cherry picked from commit abc1234)')).toHaveLength(0);
  });
});

describe('파생 간선 ID (DEV-245)', () => {
  it('같은 입력은 같은 ID다 — 재파생이 중복 간선을 만들지 않는다', () => {
    expect(derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:b')).toBe(
      derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:b'),
    );
  });

  it('유형이 다르면 ID가 다르다', () => {
    expect(derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:b')).not.toBe(
      derivedLinkId('cherry_picks', 'commit', '1:a', 'commit', '1:b'),
    );
  });

  it('방향이 다르면 ID가 다르다 — 양방향이 한 문서로 접히지 않는다', () => {
    expect(derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:b')).not.toBe(
      derivedLinkId('reverts', 'commit', '1:b', 'commit', '1:a'),
    );
  });

  it('끝점 종류가 다르면 ID가 다르다', () => {
    expect(derivedLinkId('reverts', 'commit', '1:a', 'pull_request', '1:2')).not.toBe(
      derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:2'),
    );
  });

  it('구분자 때문에 이어 붙은 값이 충돌하지 않는다', () => {
    expect(derivedLinkId('reverts', 'commit', '1:a', 'commit', '1:bc')).not.toBe(
      derivedLinkId('reverts', 'commit', '1:ab', 'commit', '1:c'),
    );
  });
});
