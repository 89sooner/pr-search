/**
 * 시험이 쓰는 고정 gh 바이너리 확보 (FR-GH-011 AC-1).
 *
 * **호스트에 깔린 gh를 쓰지 않는다.** 개발자 로컬의 2.4.0이나 CI 이미지의 우연한
 * 버전은 제품 실행 기준이 아니다. 순서는 셋이다:
 *
 * 1. `GH_PINNED_BIN` 환경 변수 — 이미 준비된 경로. 해시를 대조한다.
 * 2. 캐시 `<tmpdir>/prs-pinned-gh/<버전>/gh` — 해시가 맞으면 재사용.
 * 3. 공식 릴리스에서 내려받아 자산 해시와 바이너리 해시를 **둘 다** 대조한 뒤 캐시.
 *
 * 어느 단계에서든 해시가 어긋나면 던진다. 내려받기가 막힌 환경에서는 실패다 —
 * **건너뛰지 않는다.** 건너뛴 시험은 통과가 아니다.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, ghPinnedAssetUrl } from '../src/pin.js';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verified(path: string): boolean {
  return existsSync(path) && sha256File(path) === GH_PINNED_LINUX_AMD64.binarySha256;
}

export async function ensurePinnedGh(): Promise<string> {
  const explicit = process.env['GH_PINNED_BIN'];
  if (explicit !== undefined && explicit !== '') {
    if (!verified(explicit)) {
      throw new Error(`GH_PINNED_BIN(${explicit})의 SHA-256이 고정 값과 다르다 — 그 바이너리는 ${GH_PINNED_VERSION}이 아니다`);
    }
    return explicit;
  }

  const dir = join(tmpdir(), 'prs-pinned-gh', GH_PINNED_VERSION);
  const binary = join(dir, 'gh');
  if (verified(binary)) return binary;

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, GH_PINNED_LINUX_AMD64.file);
  const response = await fetch(ghPinnedAssetUrl(), { redirect: 'follow' });
  if (!response.ok) throw new Error(`gh 자산 내려받기 실패: HTTP ${String(response.status)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const assetHash = createHash('sha256').update(bytes).digest('hex');
  if (assetHash !== GH_PINNED_LINUX_AMD64.sha256) {
    throw new Error(`gh 자산의 SHA-256이 고정 값과 다르다 (${assetHash})`);
  }
  writeFileSync(archive, bytes);

  const extracted = join(dir, `gh_${GH_PINNED_VERSION}_linux_amd64`, 'bin', 'gh');
  const tar = spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error('gh 자산을 풀지 못했다 (tar 종료 코드 ' + String(tar.status) + ')');
  if (!existsSync(extracted)) throw new Error('아카이브 안에 bin/gh가 없다');
  chmodSync(extracted, 0o755);
  renameSync(extracted, binary);
  if (!verified(binary)) throw new Error('풀어낸 gh 바이너리의 SHA-256이 고정 값과 다르다');
  return binary;
}
