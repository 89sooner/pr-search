#!/usr/bin/env node
/**
 * handoff `manifest.json` 생성기 (CR-112).
 *
 * 이 디렉터리의 모든 파일(manifest.json 자신은 빼고)에 대해 **CRLF를 LF로 바꾼 UTF-8 바이트**의 SHA-256을
 * 적는다. 작업 트리가 CRLF여도(core.autocrlf) 커밋된 내용과 같은 값이 나오게 하려는 것이다. 계약 checksum은
 * OpenAPI와 operation map을 그 순서로 이어 붙인 LF 바이트의 SHA-256이다 — PIPE는 두 파일만으로 다시 계산해
 * 자기가 구현한 계약이 이 판인지 확인한다.
 *
 * 실행: `node handoff/pipe-search-integration/v1/tools/generate-manifest.mjs`
 * pr-search의 계약 시험(`apps/search-api/src/integrations/pipe/contract.test.ts`)이 결과를 다시 계산해 대조한다.
 * handoff 파일을 고친 뒤에는 이 스크립트를 다시 돌린다.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OPENAPI = 'pipe-integration-v1.openapi.yaml';
const OPERATION_MAP = 'operation-map.json';

/** 파일의 역할. 여기 없는 파일은 경로로 역할을 정한다. */
const ROLES = {
  [OPENAPI]: 'contract — 경로·요청·응답·오류 스키마 (정본)',
  [OPERATION_MAP]: 'contract — operation ↔ 원본 조회·query key·상한·오류 코드 (정본)',
  'PIPE_INTEGRATION_HANDOFF.md': 'guide — 먼저 읽을 문서',
  'CONTRACT_DIFF.md': 'guide — 제안 계약 PSI-1.0과 구현의 차이',
  'DEPLOYMENT_AND_ROLLBACK.md': 'guide — 배포·키 교체·회수·롤백',
  'TEST_RESULTS.md': 'evidence — 실행한 명령과 수용 시험 결과',
};

function roleOf(path) {
  if (ROLES[path] !== undefined) return ROLES[path];
  if (path.startsWith('examples/')) return 'fixture — 합성 wire 예시';
  if (path.startsWith('conformance/keys/')) return 'fixture — 공개 시험 키 (운영 금지)';
  if (path.startsWith('conformance/')) return 'fixture — assertion 적합성 벡터와 생성기';
  if (path.startsWith('deploy-examples/')) return 'example — 배포 설정 예시 (값은 자리표시자)';
  if (path.startsWith('tools/')) return 'tool — 계약 검증 도구 입력';
  return 'other';
}

function list(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const lf = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const files = list(ROOT)
  .map((absolute) => relative(ROOT, absolute).split('\\').join('/'))
  .filter((path) => path !== 'manifest.json')
  .sort()
  .map((path) => ({ path, sha256: sha256(lf(path)), role: roleOf(path) }));

const manifest = {
  schema: 'pipe-search-integration-manifest/v1',
  protocol_version: 'PSI-1.0',
  repository: '89sooner/pr-search',
  baseline_head: '52cf27f191abca4622bb4c8d408111b1efe538de',
  implementation: {
    branch: 'feature/pipe-integration-auth',
    commit: '28a3c21eb56ab3fc1be59ef7d4465aa26be00f6d',
    pull_request: 220,
    merge_commit: 'e7b4cb4ab333f615836097ca6884781aadd1efdc',
    state: 'main에 squash 병합됨(2026-09-21). 병합은 운영 활성화가 아니다 — 사내 CA·운영 HAProxy·실제 GHE·PIPE 서버와의 end-to-end는 NOT_RUN이다',
    change_request: 'CR-112',
    work_package: 'WP-097',
  },
  fixture_only: ['examples/', 'conformance/', 'deploy-examples/'],
  checksum_algorithm: 'SHA-256 over UTF-8 bytes after CRLF→LF normalization',
  contract_checksum_inputs: [OPENAPI, OPERATION_MAP],
  contract_checksum: sha256(lf(OPENAPI) + lf(OPERATION_MAP)),
  files,
};

writeFileSync(join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`manifest.json: ${String(files.length)} files, contract ${manifest.contract_checksum}\n`);
