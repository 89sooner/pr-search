/**
 * @prs/gh-cli/node — Node 전용 진입점.
 *
 * 바이너리 호출(인벤토리), manifest 파일, 토큰 봉인. 브라우저 번들에 들어가면 안 되는
 * 것들이며 `apps/web`은 이 경로를 가져오지 않는다 (회귀가 건다).
 */

export { diffInventory, extractInventory, readGhVersion } from './inventory.js';
export type { InventoryDiff, InventoryOptions } from './inventory.js';

export { checkDrift } from './drift.js';
export type { DriftCheck, DriftOptions, DriftStatus } from './drift.js';

export { MANIFEST_DIR, ManifestLoadError, loadManifest, manifestPath, writeManifest } from './manifest-file.js';

export { VAULT_KEY_BYTES, VaultUnsealError, parseVaultKey, sealSecret, unsealSecret } from './vault.js';
export type { VaultKey } from './vault.js';
