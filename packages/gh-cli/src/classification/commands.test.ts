/**
 * 분류 표와 커밋된 manifest의 1:1 (FR-GH-001 AC-2·AC-4, NFR-009 / CR-088).
 *
 * 표는 사람이 적는 자산이다. 인벤토리가 바뀌면(gh 업그레이드) 행이 남거나 빠진다 — 그것을
 * 여기서 잡는다. 커밋된 manifest 파일을 **직접 읽는다**(빌드 산출물이 아니다).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GhCapabilityManifest } from '../types.js';
import { COMMAND_ROWS, COMMAND_ROW_COUNT, NEVER_ASSIGNED_SUPPORT } from './commands.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const leaves = manifest.commands.filter((command) => !command.group && command.aliasOf === null);

describe('표와 인벤토리의 1:1', () => {
  it('leaf 196개 전부에 행이 있고, 행마다 인벤토리 leaf가 있다', () => {
    const paths = new Set(leaves.map((command) => command.path.join(' ')));
    const missing = [...paths].filter((path) => !(path in COMMAND_ROWS));
    const orphan = Object.keys(COMMAND_ROWS).filter((path) => !paths.has(path));
    expect(missing, `표에 없는 leaf: ${missing.join(', ')}`).toEqual([]);
    expect(orphan, `인벤토리에 없는 행: ${orphan.join(', ')}`).toEqual([]);
    expect(COMMAND_ROW_COUNT).toBe(leaves.length);
  });

  it('행마다 근거가 비어 있지 않고, 쓰지 않기로 한 support 값은 실제로 0건이다', () => {
    for (const [path, row] of Object.entries(COMMAND_ROWS)) {
      expect(row.note.trim().length, path).toBeGreaterThan(10);
      expect(NEVER_ASSIGNED_SUPPORT, `${path}: ${row.support}`).not.toContain(row.support);
    }
  });

  it('위험도는 부작용과 어긋나지 않는다 — 읽기는 R0이 아니면 이유가 있고, 파괴는 R2 이상이다', () => {
    for (const [path, row] of Object.entries(COMMAND_ROWS)) {
      if (row.sideEffect === 'destructive') expect(['R2', 'R3'], path).toContain(row.risk);
      if (row.sideEffect === 'read' && row.risk !== 'R0') {
        // 읽기인데 R0이 아닌 것은 결과가 비밀인 경우뿐이다 (`auth token`).
        expect(row.sensitivity, path).toBe('secret');
      }
    }
  });

  it('정책 차단은 자격·셸·실행기 설정에만 쓴다', () => {
    const blocked = Object.entries(COMMAND_ROWS).filter(([, row]) => row.support === 'policy_blocked').map(([path]) => path.split(' ')[0]);
    expect(new Set(blocked)).toEqual(new Set(['alias', 'auth', 'config']));
  });

  it('비밀을 찍는 command는 secret으로, 값을 찍는 variable은 sensitive로 적혀 있다', () => {
    expect(COMMAND_ROWS['auth token']?.sensitivity).toBe('secret');
    expect(COMMAND_ROWS['secret set']?.sensitivity).toBe('secret');
    expect(COMMAND_ROWS['variable list']?.sensitivity).toBe('sensitive');
    expect(COMMAND_ROWS['variable get']?.sensitivity).toBe('sensitive');
    expect(COMMAND_ROWS['secret list']?.sensitivity).toBe('internal');
    expect(COMMAND_ROWS['api']?.sideEffect).toBe('arbitrary');
  });
});
