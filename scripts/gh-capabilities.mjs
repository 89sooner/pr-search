#!/usr/bin/env node
/**
 * capability 레지스트리 CLI (WP-045 `gh:inventory` · `gh:validate-capabilities` · `gh:diff-capabilities`, CR-088).
 *
 *   pnpm gh:inventory               [--binary <gh>] [--out <file>]     고정 바이너리에서 인벤토리를 뽑아 JSON으로 낸다
 *   pnpm gh:validate-capabilities   [--report <file>] [--diagnostic]   커밋된 manifest를 검증한다 — 구조·분류·커버리지·실행 범위
 *   pnpm gh:diff-capabilities       [--binary <gh>] [--report <file>]  설치된 gh와 커밋된 manifest의 차이(드리프트)를 낸다
 *
 * 종료 코드: 0 성공 · 1 실패(구조 오류·드리프트·미분류) · 2 사용법·입력 오류. `--diagnostic`은 미분류(incomplete)를
 * 실패로 세지 않는다 — 구조 오류(failed)는 언제나 실패다. 보고서에는 시각이 없어 같은 입력이면 같은 내용이다.
 *
 * `packages/gh-cli`의 빌드 산출물을 읽는다 — 먼저 `pnpm --filter @prs/gh-cli build`. 실행기(JOB-GH-003)와 CI의
 * 시험(`validate.test.ts`·`integration/drift.test.ts`)이 같은 함수를 부른다 — 구현은 하나다.
 */

import { writeFileSync } from 'node:fs';
import { GH_PINNED_VERSION, inventoryHash, reportHash, validateManifest } from '../packages/gh-cli/dist/index.js';
import { checkDrift, extractInventory, loadManifest, readGhVersion } from '../packages/gh-cli/dist/node.js';

const [command, ...rest] = process.argv.slice(2);
const flags = new Map();
for (let index = 0; index < rest.length; index += 1) {
  const item = rest[index];
  if (!item.startsWith('--')) continue;
  const next = rest[index + 1];
  if (next !== undefined && !next.startsWith('--')) {
    flags.set(item.slice(2), next);
    index += 1;
  } else {
    flags.set(item.slice(2), true);
  }
}

function usage(code) {
  console.error('사용법: gh-capabilities.mjs <inventory|validate|diff> [--binary <gh>] [--out <file>] [--report <file>] [--diagnostic]');
  process.exit(code);
}

function binaryPath() {
  const path = flags.get('binary') ?? process.env['GH_PINNED_BIN'];
  if (typeof path !== 'string' || path === '') {
    console.error('바이너리 경로가 없다 — --binary <gh> 또는 GH_PINNED_BIN');
    process.exit(2);
  }
  return path;
}

function write(target, value) {
  if (typeof target !== 'string') return;
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.error(`보고서: ${target}`);
}

function printDimensions(dimensions) {
  for (const dimension of dimensions) {
    const ratio = dimension.total === 0 ? '  n/a' : `${String(Math.floor((dimension.classified / dimension.total) * 100)).padStart(3)}%`;
    console.log(`  ${dimension.gate.padEnd(13)} ${dimension.id.padEnd(16)} ${String(dimension.classified).padStart(5)}/${String(dimension.total).padEnd(5)} ${ratio}${dimension.unclassified > 0 ? `  미분류 ${String(dimension.unclassified)}` : ''}`);
  }
}

if (command === 'inventory') {
  const binary = binaryPath();
  const version = readGhVersion(binary);
  if (version !== GH_PINNED_VERSION) {
    console.error(`바이너리 버전 ${version}이 고정 버전 ${GH_PINNED_VERSION}과 다르다`);
    process.exit(1);
  }
  const inventory = extractInventory({ binaryPath: binary });
  const hash = inventoryHash(inventory);
  const out = flags.get('out');
  if (typeof out === 'string') {
    write(out, inventory);
  } else {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  }
  console.error(`gh ${inventory.ghVersion} · command ${String(inventory.commands.length)} · help topic ${String(inventory.helpTopics.length)} · inventory hash ${hash}`);
  process.exit(0);
}

if (command === 'validate') {
  const manifest = loadManifest(GH_PINNED_VERSION);
  const report = validateManifest(manifest);
  console.log(`manifest ${report.manifestVersion} (gh ${report.ghVersion}) · hash ${report.manifestHash.slice(0, 12)}… ${report.hashVerified ? '검증됨' : '불일치'} · inventory ${report.inventoryHash.slice(0, 12)}…`);
  console.log(`validator ${report.validatorVersion} · rules ${report.rulesVersion} · report ${reportHash(report).slice(0, 12)}…`);
  console.log(`실행 허용: ${report.execution.allowed.join(', ') || '없음'} (코드 표: ${report.execution.definitions.join(', ') || '없음'})`);
  console.log('차원:');
  printDimensions(report.dimensions);
  console.log('게이트:');
  for (const gate of report.gates) console.log(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} — ${gate.detail}`);
  const errors = report.findings.filter((finding) => finding.severity === 'error');
  const gaps = report.findings.filter((finding) => finding.severity === 'gap');
  for (const finding of errors) console.log(`  ERROR ${finding.code} ${finding.subject}: ${finding.message}`);
  for (const finding of gaps.slice(0, 30)) console.log(`  GAP   ${finding.code} ${finding.subject}`);
  if (gaps.length > 30) console.log(`  … 미분류 ${String(gaps.length - 30)}건 더 (보고서 파일 참조)`);
  console.log(`상태: ${report.status} (오류 ${String(errors.length)} · 미분류 ${String(gaps.length)})`);
  write(flags.get('report'), report);
  if (report.status === 'failed') process.exit(1);
  if (report.status === 'incomplete' && flags.get('diagnostic') !== true) process.exit(1);
  process.exit(0);
}

if (command === 'diff') {
  const manifest = loadManifest(GH_PINNED_VERSION);
  const result = checkDrift({ binaryPath: binaryPath(), manifest });
  console.log(`상태: ${result.status}`);
  console.log(`gh 기대 ${result.ghVersionExpected} / 관측 ${String(result.ghVersionObserved)} · 바이너리 sha256 기대 ${result.binarySha256Expected.slice(0, 12)}… / 관측 ${String(result.binarySha256Observed).slice(0, 12)}…`);
  console.log(`inventory hash 기대 ${result.inventoryHashExpected.slice(0, 12)}… / 관측 ${String(result.inventoryHashObserved).slice(0, 12)}…`);
  if (result.diff !== null) {
    console.log(`added ${String(result.diff.addedCommands.length)} · removed ${String(result.diff.removedCommands.length)} · changed ${String(result.diff.changedCommands.length)}`);
    for (const one of result.diff.addedCommands) console.log(`  + ${one}`);
    for (const one of result.diff.removedCommands) console.log(`  - ${one}`);
    for (const one of result.diff.changedCommands) console.log(`  ~ ${one}`);
  }
  if (result.error !== null) console.log(`오류: ${result.error}`);
  write(flags.get('report'), result);
  process.exit(result.status === 'match' ? 0 : result.status === 'error' ? 2 : 1);
}

usage(2);
