/**
 * 드리프트 검출 — **실제 고정 gh 바이너리**와 커밋된 manifest (FR-GH-011 AC-2·AC-3, NFR-009 GATE-GH-02,
 * WP-045 DoD, JOB-GH-003 / CR-088).
 *
 * CI의 integration 잡이 이 시험을 돌린다 — 그것이 「설치 gh와 manifest 불일치 시 CI 실패」의 실체다.
 * 바이너리는 `ensurePinnedGh`가 확보한다(없으면 실패, skip 아님). 인벤토리 추출은 격리 HOME·토큰 없음이며
 * `--help`만 부른다 — 생성·삭제·토큰 출력·extension 실행을 호출하지 않는다.
 *
 * 검증: `pnpm test:integration gh-cli/integration/drift`
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, inventoryHash, inventoryOfManifest, type GhCapabilityManifest } from '../src/index.js';
import { checkDrift, loadManifest } from '../src/node.js';
import { ensurePinnedGh } from '../testing/pinned-gh.js';

let binary: string;
let manifest: GhCapabilityManifest;

beforeAll(async () => {
  binary = await ensurePinnedGh();
  manifest = loadManifest(GH_PINNED_VERSION);
}, 180_000);

describe('GATE-GH-02: 설치된 gh와 커밋된 manifest가 같은 인벤토리다', () => {
  it('실제 바이너리에서 뽑은 인벤토리가 manifest와 일치한다 — command·flag·JSON 필드·해시', () => {
    const result = checkDrift({ binaryPath: binary, manifest });
    expect(result.status, JSON.stringify(result.diff)).toBe('match');
    expect(result.ghVersionObserved).toBe(GH_PINNED_VERSION);
    expect(result.binarySha256Observed).toBe(GH_PINNED_LINUX_AMD64.binarySha256);
    expect(result.inventoryHashObserved).toBe(result.inventoryHashExpected);
    expect(result.inventoryHashExpected).toBe(inventoryHash(inventoryOfManifest(manifest)));
    expect(result.diff).toEqual({ addedCommands: [], removedCommands: [], changedCommands: [] });
  }, 120_000);

  it('manifest에서 flag 하나를 지우면 그 command가 changed로, command를 지우면 added로, 없는 command를 더하면 removed로 잡힌다', () => {
    const withoutFlag: GhCapabilityManifest = {
      ...manifest,
      commands: manifest.commands.map((command) => (command.path.join(' ') === 'pr list' ? { ...command, flags: command.flags.filter((flag) => flag.name !== 'state') } : command)),
    };
    const changed = checkDrift({ binaryPath: binary, manifest: withoutFlag });
    expect(changed.status).toBe('drift');
    expect(changed.diff?.changedCommands).toEqual(['pr list']);

    const withoutCommand: GhCapabilityManifest = { ...manifest, commands: manifest.commands.filter((command) => command.path.join(' ') !== 'pr checkout') };
    expect(checkDrift({ binaryPath: binary, manifest: withoutCommand }).diff?.addedCommands).toEqual(['pr checkout']);

    const phantom = manifest.commands.find((command) => command.path.join(' ') === 'pr list')!;
    const withPhantom: GhCapabilityManifest = { ...manifest, commands: [...manifest.commands, { ...phantom, path: ['pr', 'frobnicate'], id: 'pr.frobnicate' }] };
    expect(checkDrift({ binaryPath: binary, manifest: withPhantom }).diff?.removedCommands).toEqual(['pr frobnicate']);
  }, 300_000);

  it('gh 버전이 다르면 인벤토리를 뽑지 않고 version_mismatch이고, 바이너리가 없으면 error다', () => {
    const other = checkDrift({ binaryPath: binary, manifest: { ...manifest, ghVersion: '2.96.0' } });
    expect(other.status).toBe('version_mismatch');
    expect(other.inventoryHashObserved).toBeNull();
    const missing = checkDrift({ binaryPath: '/nonexistent/gh', manifest });
    expect(missing.status).toBe('error');
    expect(missing.error).not.toBeNull();
  }, 30_000);
});
