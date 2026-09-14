/**
 * manifest 조립·해시 (FR-GH-001 AC-5, ADR-015) 와 순수 SHA-256.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PR_LIST_CAPABILITY } from './capabilities.js';
import { buildManifest, canonicalJson, manifestHash, verifyManifestHash } from './manifest.js';
import { sha256Hex } from './sha256.js';
import type { GhInventory, GhInventoryCommand } from './types.js';

const command = (path: string[], overrides: Partial<GhInventoryCommand> = {}): GhInventoryCommand => ({
  path,
  aliases: [],
  summary: path.join(' '),
  usage: `gh ${path.join(' ')}`,
  group: false,
  section: 'CORE COMMANDS',
  flags: [],
  jsonFields: [],
  aliasOf: null,
  helpStatus: 'ok',
  ...overrides,
});

const PR_LIST_FLAGS = ['state', 'limit', 'json'].map((name) => ({
  name,
  short: null,
  valueType: 'string',
  description: '',
  defaultValue: null,
  repeatable: false,
  inherited: false,
}));

const inventory: GhInventory = {
  ghVersion: '2.97.0',
  commands: [
    command(['pr'], { group: true }),
    command(['pr', 'list'], { flags: PR_LIST_FLAGS, jsonFields: [...PR_LIST_CAPABILITY.options.flatMap((o) => (o.kind === 'json_fields' ? o.allowed : []))] }),
    command(['pr', 'merge']),
    command(['pr', 'frobnicate']),
    command(['co'], { aliasOf: ['pr', 'checkout'] }),
  ],
  helpTopics: ['environment'],
};

describe('순수 SHA-256', () => {
  it('node:crypto와 같은 값을 낸다 (빈 문자열·짧은·블록 경계·다바이트)', () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), '한글 manifest ✓']) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('FR-GH-001 AC-5: manifest는 버전과 내용 해시를 가진다', () => {
  it('오버라이드가 인벤토리와 합쳐지고 나머지는 미분류·미구현으로 정직하게 남는다', () => {
    const manifest = buildManifest({ inventory, capabilities: [PR_LIST_CAPABILITY], generatedAt: '2026-09-13T00:00:00Z' });
    const prList = manifest.commands.find((entry) => entry.id === 'pr.list');
    expect(prList).toMatchObject({ execution: 'allowed', support: 'supported', risk: 'R0', executionReason: null });
    // `pr merge`는 분류 표에 있다 — 분류는 되지만 실행은 열리지 않는다. 표가 실행을 넓히지 못한다는 것이 요점이다.
    const merge = manifest.commands.find((entry) => entry.id === 'pr.merge');
    expect(merge).toMatchObject({ execution: 'not_implemented', support: 'supported', risk: 'R2' });
    expect(merge?.executionReason).toMatch(/열지 않았다/);
    expect(merge?.classification).toMatchObject({ sideEffect: 'destructive', interaction: 'web_native' });
    // 표에 없는 leaf는 미분류로 정직하게 남는다.
    const unknown = manifest.commands.find((entry) => entry.id === 'pr.frobnicate');
    expect(unknown).toMatchObject({ execution: 'not_implemented', support: 'unknown', risk: null });
    expect(manifest.coverage).toMatchObject({
      leafCommands: 3,
      groupCommands: 1,
      aliasOnlyCommands: 1,
      executableCommands: 1,
      classifiedLeafCommands: 2,
      unclassifiedLeafCommands: 1,
    });
    expect(manifest.coverage.dimensions.find((dimension) => dimension.id === 'command_path')).toMatchObject({ total: 3, classified: 2, unclassifiedSample: ['pr frobnicate'] });
  });

  it('정책 차단 command는 실행 차원도 policy_blocked다 — 미구현으로 적지 않는다', () => {
    const manifest = buildManifest({
      inventory: { ...inventory, commands: [...inventory.commands, command(['auth', 'token'])] },
      capabilities: [PR_LIST_CAPABILITY],
      generatedAt: 'x',
    });
    const token = manifest.commands.find((entry) => entry.id === 'auth.token');
    expect(token).toMatchObject({ execution: 'policy_blocked', support: 'policy_blocked', risk: 'R3' });
    expect(token?.executionReason).toMatch(/열지 않기로/);
  });

  it('정의와 분류 표가 같은 command를 다르게 말하면 만들지 않는다', () => {
    expect(() =>
      buildManifest({ inventory, capabilities: [{ ...PR_LIST_CAPABILITY, risk: 'R1' }], generatedAt: 'x' }),
    ).toThrow(/분류 표.*다르다/);
  });

  it('CR-089: 판은 r0.3이고, 실행 정의는 결과 계약을 복사하지 않고 구현한 adapter로 계약의 출력 port를 가리킨다', () => {
    const manifest = buildManifest({ inventory, capabilities: [PR_LIST_CAPABILITY], generatedAt: 'x' });
    expect(manifest.manifestVersion).toBe('r0.3');
    expect(manifest.capabilities[0]).not.toHaveProperty('result');
    expect(manifest.capabilities[0]?.resultAdapter).toEqual({ mode: 'json', adapter: 'native_json', schema: 'pr_list_v2', outputPort: 'pull_requests' });
    const contract = manifest.commands.find((entry) => entry.id === 'pr.list')?.classification?.result;
    expect(contract?.outputPorts.map((port) => port.id)).toEqual(['pull_requests']);
    // 표에 없는 leaf는 결과 계약도 없다 — 미분류를 계약으로 꾸미지 않는다.
    expect(manifest.commands.find((entry) => entry.id === 'pr.frobnicate')?.classification?.result).toBeNull();
  });

  it('CR-089: 구현 adapter가 결과 계약의 port·스키마와 다르면 만들지 않는다', () => {
    const wrongPort = { ...PR_LIST_CAPABILITY, resultAdapter: { ...PR_LIST_CAPABILITY.resultAdapter, outputPort: 'pull_request' } };
    expect(() => buildManifest({ inventory, capabilities: [wrongPort], generatedAt: 'x' })).toThrow(/출력 port와 다르다/);
    const wrongSchema = { ...PR_LIST_CAPABILITY, resultAdapter: { ...PR_LIST_CAPABILITY.resultAdapter, schema: 'pr_list_v1' } };
    expect(() => buildManifest({ inventory, capabilities: [wrongSchema], generatedAt: 'x' })).toThrow(/출력 port와 다르다/);
    // 식별 필드 number가 인벤토리에 없으면 계약에 port가 생기지 않아 정의가 가리킬 port가 없다.
    const noNumber: GhInventory = { ...inventory, commands: inventory.commands.map((entry) => (entry.path.join(' ') === 'pr list' ? { ...entry, jsonFields: entry.jsonFields.filter((field) => field !== 'number') } : entry)) };
    expect(() => buildManifest({ inventory: noNumber, capabilities: [PR_LIST_CAPABILITY], generatedAt: 'x' })).toThrow();
  });

  it('키 순서와 무관하게 같은 해시이고 내용이 바뀌면 달라진다', () => {
    const a = buildManifest({ inventory, capabilities: [PR_LIST_CAPABILITY], generatedAt: 'x' });
    const b = buildManifest({ inventory: { ...inventory, commands: [...inventory.commands].reverse() }, capabilities: [PR_LIST_CAPABILITY], generatedAt: 'y' });
    // commands 순서는 내용이다 — 추출기가 정렬해서 주므로 순서가 다르면 다른 manifest다.
    expect(a.hash).not.toBe(b.hash);
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(verifyManifestHash(a)).toBe(true);
    expect(verifyManifestHash({ ...a, capabilities: [] })).toBe(false);
    expect(manifestHash(a)).toBe(a.hash);
  });

  it('인벤토리에 없는 path·flag·JSON 필드를 실행 가능으로 적을 수 없다', () => {
    expect(() =>
      buildManifest({ inventory, capabilities: [{ ...PR_LIST_CAPABILITY, id: 'repo.delete', path: ['repo', 'delete'] }], generatedAt: 'x' }),
    ).toThrow(/인벤토리에 없다/);
    expect(() =>
      buildManifest({
        inventory,
        capabilities: [{ ...PR_LIST_CAPABILITY, options: [{ kind: 'bool', flag: '--web', defaultValue: false, label: 'w' }] }],
        generatedAt: 'x',
      }),
    ).toThrow(/flag에 없다/);
  });
});
