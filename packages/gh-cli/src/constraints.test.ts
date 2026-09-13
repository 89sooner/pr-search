/**
 * 의미 제약 평가기 (FR-GH-003, ADR-017, WP-061).
 *
 * 실제 오버라이드(`pr.list`)와 합성 정의를 둘 다 건다 — 합성 정의는 `pr.list`가
 * 쓰지 않는 관계 제약이 실제로 평가되는지 보기 위한 것이다.
 */

import { describe, expect, it } from 'vitest';
import { PR_LIST_CAPABILITY } from './capabilities.js';
import { evaluateInvocation, evaluateRelations, parseRepositorySlug } from './constraints.js';
import type { GhCapabilityDefinition, GhInvocation } from './types.js';

const valid = (overrides: Partial<GhInvocation> = {}): GhInvocation => ({
  capability_id: 'pr.list',
  context: { repository: 'acme/payments' },
  flags: { '--state': 'open', '--limit': 20 },
  output: { json_fields: ['number', 'title'] },
  ...overrides,
});

describe('FR-GH-003 AC-3·AC-5: pr.list의 값 검증', () => {
  it('정상 입력은 정규화된 invocation이 된다', () => {
    const result = evaluateInvocation(PR_LIST_CAPABILITY, valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invocation.repository).toEqual({ owner: 'acme', name: 'payments' });
    expect(result.invocation.options).toEqual([
      { flag: '--state', value: 'open' },
      { flag: '--limit', value: 20 },
    ]);
    expect(result.invocation.jsonFields).toEqual(['number', 'title']);
  });

  it('생략한 옵션은 기본값이다', () => {
    const result = evaluateInvocation(PR_LIST_CAPABILITY, valid({ flags: {}, output: { json_fields: [] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invocation.options).toEqual([
      { flag: '--state', value: 'open' },
      { flag: '--limit', value: 30 },
    ]);
    expect(result.invocation.jsonFields.length).toBeGreaterThan(0);
  });

  it('열거값 밖은 거절한다 — 임의 문자열이 argv로 가지 않는다', () => {
    const result = evaluateInvocation(PR_LIST_CAPABILITY, valid({ flags: { '--state': 'open; rm -rf /' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((violation) => violation.code)).toEqual(['enum_value']);
  });

  it('정수 범위를 서버가 강제한다 — 0·101·소수·문자열', () => {
    for (const limit of [0, 101, 1.5, 'ten', -1]) {
      const result = evaluateInvocation(PR_LIST_CAPABILITY, valid({ flags: { '--limit': limit as number } }));
      expect(result.ok, String(limit)).toBe(false);
    }
    // 정수 문자열은 받는다 — 폼이 문자열로 보내는 값이다.
    expect(evaluateInvocation(PR_LIST_CAPABILITY, valid({ flags: { '--limit': '5' } })).ok).toBe(true);
  });

  it('모르는 flag는 거절한다 (선행 하이픈·--web·--jq 포함)', () => {
    for (const flag of ['--web', '--jq', '-R', '--repo', '--search']) {
      const result = evaluateInvocation(PR_LIST_CAPABILITY, valid({ flags: { [flag]: 'x' } }));
      expect(result.ok, flag).toBe(false);
      if (result.ok) continue;
      expect(result.violations.some((violation) => violation.code === 'unknown_flag')).toBe(true);
    }
  });

  it('positional·stdin·files·argv·command는 이 capability가 받지 않는다', () => {
    for (const key of ['positional', 'stdin', 'files', 'argv', 'command']) {
      const result = evaluateInvocation(PR_LIST_CAPABILITY, { ...valid(), [key]: ['x'] } as GhInvocation);
      expect(result.ok, key).toBe(false);
    }
  });

  it('JSON 필드는 허용 목록 안·중복 없음·정렬 고정이다', () => {
    const notAllowed = evaluateInvocation(PR_LIST_CAPABILITY, valid({ output: { json_fields: ['body'] } }));
    expect(notAllowed.ok).toBe(false);
    const duplicate = evaluateInvocation(PR_LIST_CAPABILITY, valid({ output: { json_fields: ['title', 'title'] } }));
    expect(duplicate.ok).toBe(false);
    const reordered = evaluateInvocation(PR_LIST_CAPABILITY, valid({ output: { json_fields: ['title', 'number'] } }));
    expect(reordered.ok && reordered.invocation.jsonFields).toEqual(['number', 'title']);
  });

  it('저장소 슬러그 형식을 강제한다', () => {
    for (const repository of ['acme', 'acme/pay/ments', '-acme/x', 'acme/x y', '../x', 'acme/', '']) {
      expect(parseRepositorySlug(repository), repository).toBeNull();
      expect(evaluateInvocation(PR_LIST_CAPABILITY, valid({ context: { repository } })).ok, repository).toBe(false);
    }
    expect(parseRepositorySlug('acme/smp-1900.core')).toEqual({ owner: 'acme', name: 'smp-1900.core' });
  });

  it('AC-8: 같은 입력은 같은 답이다 (결정론)', () => {
    const a = JSON.stringify(evaluateInvocation(PR_LIST_CAPABILITY, valid()));
    const b = JSON.stringify(evaluateInvocation(PR_LIST_CAPABILITY, valid()));
    expect(a).toBe(b);
  });
});

/** 관계 제약 시험용 합성 정의. `pr.list`에는 없는 종류를 실제로 평가하는지 본다. */
const SYNTHETIC: GhCapabilityDefinition = {
  ...PR_LIST_CAPABILITY,
  id: 'synthetic.cmd',
  path: ['synthetic', 'cmd'],
  options: [
    { kind: 'bool', flag: '--a', defaultValue: false, label: 'a' },
    { kind: 'bool', flag: '--b', defaultValue: false, label: 'b' },
    { kind: 'bool', flag: '--c', defaultValue: false, label: 'c' },
    { kind: 'enum', flag: '--mode', values: ['x', 'y'], defaultValue: 'x', label: 'mode' },
    { kind: 'bool', flag: '--body', defaultValue: false, label: 'body' },
    { kind: 'bool', flag: '--body-file', defaultValue: false, label: 'body-file' },
  ],
  constraints: [
    { kind: 'requires', flag: '--a', requires: ['--b'] },
    { kind: 'conflicts', flags: ['--b', '--c'] },
    { kind: 'implies', flag: '--mode', whenValue: 'y', implies: '--c' },
    { kind: 'required_if', flag: '--a', when: { flag: '--mode', value: 'x' } },
    { kind: 'input_source_exclusive', sources: ['--body', '--body-file'] },
  ],
};

describe('FR-GH-003 AC-7: 관계 제약 13종 중 옵션 사이 제약', () => {
  const run = (flags: GhInvocation['flags']): string[] => {
    const result = evaluateInvocation(SYNTHETIC, { ...valid(), capability_id: 'synthetic.cmd', flags, output: { json_fields: [] } });
    return result.ok ? [] : result.violations.map((violation) => violation.code);
  };

  it('requires·conflicts·implies·required_if·input_source_exclusive', () => {
    expect(run({ '--a': true })).toEqual(['requires']); // a는 b를 요구 · mode=x는 a를 요구(만족)
    expect(run({ '--a': true, '--b': true })).toEqual([]);
    expect(run({ '--a': true, '--b': true, '--c': true })).toEqual(['conflicts']);
    expect(run({ '--mode': 'y' })).toEqual(['implies']); // mode=y는 c를 요구; mode≠x라 required_if 미적용
    expect(run({ '--mode': 'y', '--c': true })).toEqual([]);
    expect(run({})).toEqual(['required_if']); // mode 기본값 x → a 필요
    expect(run({ '--a': true, '--b': true, '--body': true, '--body-file': true })).toEqual(['input_source_exclusive']);
  });

  it('one_of·exactly_one·at_least_one·context_required', () => {
    const present = new Map<string, string | number | boolean | readonly string[]>([['--x', true]]);
    expect(evaluateRelations([{ kind: 'one_of', flags: ['--x', '--y'] }], present, { repository: true, host: true })).toEqual([]);
    expect(
      evaluateRelations([{ kind: 'exactly_one', flags: ['--y', '--z'] }], present, { repository: true, host: true }).map((v) => v.code),
    ).toEqual(['exactly_one']);
    expect(
      evaluateRelations([{ kind: 'at_least_one', flags: ['--y', '--z'] }], present, { repository: true, host: true }).map((v) => v.code),
    ).toEqual(['at_least_one']);
    expect(
      evaluateRelations([{ kind: 'context_required', context: 'repository' }], present, { repository: false, host: true }).map((v) => v.code),
    ).toEqual(['context_required']);
  });

  it('값이 틀린 옵션은 관계 판정에 넣지 않는다 — 위반 메시지가 겹치지 않는다', () => {
    expect(run({ '--a': 'yes' as unknown as boolean })).toEqual(['bool_format', 'required_if']);
  });
});
