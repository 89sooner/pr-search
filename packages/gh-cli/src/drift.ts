/**
 * 드리프트 검출 — 실제 바이너리의 인벤토리와 승인된 manifest의 차이 (FR-GH-011 AC-2·AC-3, NFR-009,
 * WP-045 `gh:diff-capabilities`, JOB-GH-003 / CR-088). **Node 전용이다** — 바이너리를 띄운다.
 *
 * 순서: 바이너리 해시 → `gh --version` → 인벤토리 추출(격리 HOME, 토큰 없음) → command·flag·JSON
 * 필드 대조 → 인벤토리 해시 대조. 어느 단계가 실패하든 그 사실을 `status`로 말하고, 던지지 않는다 —
 * 호출부(실행기 기동·주기 검사·CLI)가 기록을 남겨야 하기 때문이다.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { diffInventory, extractInventory, extractInventoryAsync, readGhVersion, readGhVersionAsync, type InventoryDiff } from './inventory.js';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION } from './pin.js';
import type { GhCapabilityManifest } from './types.js';
import { inventoryHash, inventoryOfManifest } from './validate.js';

export type DriftStatus = 'match' | 'drift' | 'version_mismatch' | 'binary_mismatch' | 'error';

export interface DriftCheck {
  readonly status: DriftStatus;
  readonly ghVersionExpected: string;
  readonly ghVersionObserved: string | null;
  readonly binarySha256Expected: string;
  readonly binarySha256Observed: string | null;
  readonly inventoryHashExpected: string;
  readonly inventoryHashObserved: string | null;
  readonly diff: InventoryDiff | null;
  readonly error: string | null;
}

export interface DriftOptions {
  readonly binaryPath: string;
  readonly manifest: GhCapabilityManifest;
  readonly timeoutMs?: number;
}

export function checkDrift(options: DriftOptions): DriftCheck {
  const expected = inventoryOfManifest(options.manifest);
  const base = {
    ghVersionExpected: options.manifest.ghVersion,
    binarySha256Expected: GH_PINNED_LINUX_AMD64.binarySha256,
    inventoryHashExpected: inventoryHash(expected),
  };
  let binarySha256Observed: string | null = null;
  let ghVersionObserved: string | null = null;
  try {
    binarySha256Observed = createHash('sha256').update(readFileSync(options.binaryPath)).digest('hex');
    ghVersionObserved = readGhVersion(options.binaryPath, options.timeoutMs);
  } catch (error) {
    return { ...base, status: 'error', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: message(error) };
  }
  if (ghVersionObserved !== options.manifest.ghVersion || ghVersionObserved !== GH_PINNED_VERSION) {
    return { ...base, status: 'version_mismatch', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: null };
  }
  if (binarySha256Observed !== GH_PINNED_LINUX_AMD64.binarySha256) {
    return { ...base, status: 'binary_mismatch', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: null };
  }
  try {
    const actual = extractInventory({ binaryPath: options.binaryPath, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
    const diff = diffInventory(expected, actual);
    const inventoryHashObserved = inventoryHash(actual);
    const drifted = diff.addedCommands.length + diff.removedCommands.length + diff.changedCommands.length > 0 || inventoryHashObserved !== base.inventoryHashExpected;
    return { ...base, status: drifted ? 'drift' : 'match', ghVersionObserved, binarySha256Observed, inventoryHashObserved, diff, error: null };
  } catch (error) {
    return { ...base, status: 'error', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: message(error) };
  }
}

/**
 * `checkDrift`의 비동기 판 — 실행기의 주기 검사가 쓴다. 판정 규칙은 동기 판과 같고 이벤트 루프를 막지 않는다.
 */
export async function checkDriftAsync(options: DriftOptions): Promise<DriftCheck> {
  const expected = inventoryOfManifest(options.manifest);
  const base = {
    ghVersionExpected: options.manifest.ghVersion,
    binarySha256Expected: GH_PINNED_LINUX_AMD64.binarySha256,
    inventoryHashExpected: inventoryHash(expected),
  };
  let binarySha256Observed: string | null = null;
  let ghVersionObserved: string | null = null;
  try {
    binarySha256Observed = createHash('sha256').update(await readFile(options.binaryPath)).digest('hex');
    ghVersionObserved = await readGhVersionAsync(options.binaryPath, options.timeoutMs);
  } catch (error) {
    return { ...base, status: 'error', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: message(error) };
  }
  if (ghVersionObserved !== options.manifest.ghVersion || ghVersionObserved !== GH_PINNED_VERSION) {
    return { ...base, status: 'version_mismatch', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: null };
  }
  if (binarySha256Observed !== GH_PINNED_LINUX_AMD64.binarySha256) {
    return { ...base, status: 'binary_mismatch', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: null };
  }
  try {
    const actual = await extractInventoryAsync({ binaryPath: options.binaryPath, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
    const diff = diffInventory(expected, actual);
    const inventoryHashObserved = inventoryHash(actual);
    const drifted = diff.addedCommands.length + diff.removedCommands.length + diff.changedCommands.length > 0 || inventoryHashObserved !== base.inventoryHashExpected;
    return { ...base, status: drifted ? 'drift' : 'match', ghVersionObserved, binarySha256Observed, inventoryHashObserved, diff, error: null };
  } catch (error) {
    return { ...base, status: 'error', ghVersionObserved, binarySha256Observed, inventoryHashObserved: null, diff: null, error: message(error) };
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
