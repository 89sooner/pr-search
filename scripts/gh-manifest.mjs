#!/usr/bin/env node
/**
 * capability manifest 생성 (WP-045 `gh:inventory` + manifest 조립).
 *
 *   pnpm --filter @prs/gh-cli build
 *   GH_PINNED_BIN=/경로/gh pnpm gh:manifest
 *
 * 고정 버전의 gh 바이너리를 걸어 `gh <path> --help` 전체를 뽑고, 의미 오버라이드
 * (`packages/gh-cli/src/capabilities.ts`)와 합쳐 `packages/gh-cli/manifest/gh-<버전>.json`을
 * 쓴다. **바이너리 버전이 고정 값과 다르면 쓰지 않는다** — manifest는 그 버전의 것이다.
 *
 * 빌드된 `dist`를 읽는다. 시험이 아니라 산출물 생성 절차이므로 소스 별칭을 쓰지 않는다.
 */

import { GH_PINNED_VERSION } from '../packages/gh-cli/dist/index.js';
import { extractInventory, readGhVersion, writeManifest } from '../packages/gh-cli/dist/node.js';

const binary = process.env['GH_PINNED_BIN'] ?? process.argv[2];
if (binary === undefined || binary === '') {
  console.error('사용법: GH_PINNED_BIN=<gh 경로> pnpm gh:manifest  (또는 인자로 경로)');
  process.exit(2);
}

const version = readGhVersion(binary);
if (version !== GH_PINNED_VERSION) {
  console.error(`바이너리 버전 ${version}이 고정 버전 ${GH_PINNED_VERSION}과 다르다 — manifest를 만들지 않는다`);
  process.exit(1);
}

const started = Date.now();
const inventory = extractInventory({ binaryPath: binary });
const path = writeManifest(inventory);
const leaves = inventory.commands.filter((command) => !command.group && command.aliasOf === null).length;
console.log(
  `manifest 작성: ${path}\n  gh ${inventory.ghVersion} · command ${String(inventory.commands.length)} (leaf ${String(leaves)}) · help topic ${String(inventory.helpTopics.length)} · ${String(Date.now() - started)}ms`,
);
