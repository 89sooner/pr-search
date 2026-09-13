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
    const merge = manifest.commands.find((entry) => entry.id === 'pr.merge');
    expect(merge).toMatchObject({ execution: 'not_implemented', support: 'unknown', risk: null });
    expect(merge?.executionReason).toMatch(/열지 않았다/);
    expect(manifest.coverage).toMatchObject({
      leafCommands: 2,
      groupCommands: 1,
      aliasOnlyCommands: 1,
      executableCommands: 1,
      classifiedLeafCommands: 1,
      unclassifiedLeafCommands: 1,
    });
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
