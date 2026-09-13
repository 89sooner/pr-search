/**
 * 커밋된 manifest 파일 (ADR-015 「validated capability manifest (버전 + 해시)」).
 *
 * `packages/gh-cli/manifest/gh-<버전>.json`이 정본이다. 배포 이미지에 그대로 실리며
 * `search-api`와 `gh-executor`가 같은 파일을 읽는다. 읽을 때 해시를 다시 계산해
 * 파일이 손으로 고쳐지지 않았는지 확인한다 — 어긋나면 기동을 거부한다.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXECUTABLE_CAPABILITIES } from './capabilities.js';
import { buildManifest, verifyManifestHash } from './manifest.js';
import { GH_PINNED_VERSION } from './pin.js';
import type { GhCapabilityManifest, GhInventory } from './types.js';

export const MANIFEST_DIR = fileURLToPath(new URL('../manifest/', import.meta.url));

export function manifestPath(ghVersion: string = GH_PINNED_VERSION): string {
  return `${MANIFEST_DIR}gh-${ghVersion}.json`;
}

export class ManifestLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestLoadError';
  }
}

/**
 * 커밋된 manifest를 읽고 검증한다.
 *
 * @throws {ManifestLoadError} 파일이 없거나, 해시가 내용과 어긋나거나, 고정 gh 버전과 다르면.
 */
export function loadManifest(ghVersion: string = GH_PINNED_VERSION): GhCapabilityManifest {
  const path = manifestPath(ghVersion);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ManifestLoadError(`manifest 파일을 읽지 못했다 (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: GhCapabilityManifest;
  try {
    parsed = JSON.parse(raw) as GhCapabilityManifest;
  } catch (error) {
    throw new ManifestLoadError(`manifest JSON이 깨졌다 (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.ghVersion !== ghVersion) {
    throw new ManifestLoadError(`manifest의 gh 버전(${parsed.ghVersion})이 요청한 버전(${ghVersion})과 다르다`);
  }
  if (!verifyManifestHash(parsed)) {
    throw new ManifestLoadError('manifest 해시가 내용과 어긋난다 — 파일이 손으로 고쳐졌거나 손상됐다');
  }
  return parsed;
}

/** 인벤토리와 오버라이드로 manifest를 만들어 파일로 쓴다 (`pnpm gh:manifest`). */
export function writeManifest(inventory: GhInventory, generatedAt: string = new Date().toISOString()): string {
  const manifest = buildManifest({ inventory, capabilities: EXECUTABLE_CAPABILITIES, generatedAt });
  const path = manifestPath(inventory.ghVersion);
  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}
