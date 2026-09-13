/**
 * 실행별 임시 workspace (FR-GH-007 AC-1·AC-5, NFR-010, ADR-016).
 *
 * 실행마다 새 디렉터리를 만들고 끝나면 지운다. `HOME`·`GH_CONFIG_DIR`·`TMPDIR`이 전부
 * 그 아래이므로 gh가 무엇을 쓰든(`hosts.yml`, `state.yml`, 텔레메트리 device-id) 실행과
 * 함께 사라진다. 모드는 0700이다 — 같은 호스트의 다른 실행이 들여다보지 못한다.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface Workspace {
  readonly root: string;
  readonly home: string;
  readonly configDir: string;
  readonly tmp: string;
}

export function createWorkspace(parent: string): Workspace {
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, 'exec-'));
  const workspace = { root, home: join(root, 'home'), configDir: join(root, 'config'), tmp: join(root, 'tmp') };
  for (const dir of [workspace.home, workspace.configDir, workspace.tmp]) mkdirSync(dir, { mode: 0o700 });
  return workspace;
}

/** 지운다. 실패하면 던진다 — 정리 실패는 경보 대상이다 (FR-GH-007 예외 처리). */
export function destroyWorkspace(workspace: Workspace): void {
  rmSync(workspace.root, { recursive: true, force: true, maxRetries: 3 });
  if (existsSync(workspace.root)) throw new Error(`workspace를 지우지 못했다: ${workspace.root}`);
}
