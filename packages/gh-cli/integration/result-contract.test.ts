/**
 * 실제 고정 gh `pr list` → 안전한 결과 → PR 참조 → 명시적 선택 → `pr view` 입력 호환 (CR-089, SRS 9.8 4항·5항).
 *
 * 목 GHE는 **실제 HTTPS 서버**이고 실행 파일은 해시를 대조한 gh 2.97.0이다(`ensurePinnedGh` — 없으면 실패, skip 아님).
 * 실행기와 같은 argv 빌더·환경 허용 목록을 쓰고, 결과 계약은 커밋된 manifest에서 읽는다.
 *
 * **pr view는 실행하지 않는다.** 목 서버가 받은 GraphQL 요청이 `pr list`의 것 하나뿐인지 센다 — 호환 판정은 실행이 아니다.
 * gh 프로세스는 이벤트 루프를 막지 않는 `spawn`으로 띄운다: 목 서버가 같은 프로세스에 있어 `spawnSync`면 TLS 핸드셰이크가
 * 시간 초과로 끝난다(착수 전 관측).
 *
 * 검증: `pnpm test:integration gh-cli/integration/result-contract`
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildArgv } from '../src/argv.js';
import { evaluateBinding, type GhPortEndpoint } from '../src/binding.js';
import { PR_LIST_CAPABILITY } from '../src/capabilities.js';
import { evaluateInvocation } from '../src/constraints.js';
import { buildExecutionEnv } from '../src/env.js';
import { loadManifest } from '../src/manifest-file.js';
import { GH_PINNED_VERSION } from '../src/pin.js';
import { parsePrListOutput, prListPortValue } from '../src/result.js';
import type { GhCapabilityManifest } from '../src/types.js';
import { startMockGhe, type MockGhe, type MockGheOptions } from '../testing/mock-ghe-tls.js';
import { ensurePinnedGh } from '../testing/pinned-gh.js';

const TOKEN = 'ghu_resultContractToken000000000001';
const REPOSITORY = { owner: 'acme', name: 'payments' } as const;
let binary = '';
let manifest: GhCapabilityManifest;

function endpoint(id: string, direction: 'input' | 'output', portId: string): GhPortEndpoint {
  const contract = manifest.commands.find((command) => command.id === id)?.classification?.result;
  if (contract === null || contract === undefined) throw new Error(`fixture: ${id}에 결과 계약이 없다`);
  const port = (direction === 'output' ? contract.outputPorts : contract.inputPorts).find((one) => one.id === portId);
  if (port === undefined) throw new Error(`fixture: ${id}의 ${direction} port ${portId}가 없다`);
  return { capabilityId: id, contract, port };
}

interface Run {
  readonly mock: MockGhe;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 실행기와 같은 빌더로 `pr list` argv를 만들어 실제 gh를 띄운다. 끝나면 목 서버를 닫는 것은 호출자다. */
async function runPrList(fields: readonly string[], options: MockGheOptions = {}): Promise<Run> {
  const mock = await startMockGhe({ expectedToken: TOKEN, ...options });
  const root = mkdtempSync(join(tmpdir(), 'prs-result-contract-'));
  try {
    const evaluated = evaluateInvocation(PR_LIST_CAPABILITY, { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'open', '--limit': 30 }, output: { json_fields: [...fields] } });
    if (!evaluated.ok) throw new Error(`invocation 거절: ${JSON.stringify(evaluated.violations)}`);
    const argv = buildArgv(PR_LIST_CAPABILITY, evaluated.invocation, { host: mock.host, repository: REPOSITORY });
    const workspace = { home: join(root, 'home'), configDir: join(root, 'config'), tmp: join(root, 'tmp') };
    for (const dir of Object.values(workspace)) mkdirSync(dir);
    const env = buildExecutionEnv({ host: mock.host, token: TOKEN, workspace, caFile: mock.caFile });
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(binary, argv, { env, cwd: root, shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });
    return { mock, ...result };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  binary = await ensurePinnedGh();
  manifest = loadManifest(GH_PINNED_VERSION);
}, 180_000);

describe('실제 gh pr list 결과 → PR 참조 → 명시적 선택 → pr view 입력', () => {
  it('두 번째 PR을 `/1`로 골라 pr view에 이으면 호환이다 — 실행은 열리지 않았고 pr view 요청은 나가지 않았다', async () => {
    const run = await runPrList(['number', 'title', 'state', 'url']);
    try {
      expect(run.status, run.stderr).toBe(0);
      const parsed = parsePrListOutput(run.stdout, ['number', 'title', 'state', 'url'], 30, { host: run.mock.host, repository: REPOSITORY });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.result.schema).toBe('pr_list_v2');
      expect(parsed.result.references.refs.map((ref) => [ref.kind, ref.host, ref.repository, ref.number])).toEqual([
        ['pull_request', run.mock.host, 'acme/payments', 12],
        ['pull_request', run.mock.host, 'acme/payments', 11],
      ]);
      // 행의 url(목이 https://127.0.0.1/…로 준다)은 참조의 호스트가 되지 않는다 — 호스트는 실행 컨텍스트다.
      expect(parsed.result.rows[0]?.url).toContain('https://127.0.0.1/');
      expect(parsed.result.references.refs[0]?.host).not.toBe('127.0.0.1');

      const outcome = evaluateBinding({
        binding: { source: { capabilityId: 'pr.list', port: 'pull_requests' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '/1' },
        source: endpoint('pr.list', 'output', 'pull_requests'),
        target: endpoint('pr.view', 'input', 'pull_request'),
        value: prListPortValue(parsed.result),
        targetContext: { host: run.mock.host, repository: REPOSITORY },
      });
      expect(outcome).toMatchObject({ ok: true, ref: { kind: 'pull_request', number: 11 }, argument: { value: '11' }, executable: false });
      expect(manifest.commands.find((command) => command.id === 'pr.view')?.execution).toBe('not_implemented');
      // 목이 받은 GraphQL은 pr list의 질의 하나뿐이다.
      const graphql = run.mock.graphqlRequests();
      expect(graphql).toHaveLength(1);
      expect(graphql[0]?.rawBody).toContain('pullRequests');
    } finally {
      await run.mock.close();
    }
  }, 60_000);

  it('title만 고른 실제 조회는 성공하고 행이 보이지만, 참조가 없어 바인딩은 거절된다 — v1은 row_shape로 실패했다', async () => {
    const run = await runPrList(['title']);
    try {
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual([{ title: expect.any(String) as unknown }, { title: 'Add thing' }]);
      const parsed = parsePrListOutput(run.stdout, ['title'], 30, { host: run.mock.host, repository: REPOSITORY });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.result.rows.map((row) => row.number)).toEqual([null, null]);
      expect(parsed.result.references).toMatchObject({ status: 'unavailable', reason: 'identity_field_not_selected' });
      const outcome = evaluateBinding({
        binding: { source: { capabilityId: 'pr.list', port: 'pull_requests' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '/0' },
        source: endpoint('pr.list', 'output', 'pull_requests'),
        target: endpoint('pr.view', 'input', 'pull_request'),
        value: prListPortValue(parsed.result),
        targetContext: { host: run.mock.host, repository: REPOSITORY },
      });
      expect(outcome).toEqual({ ok: false, reason: 'value_unavailable', detail: 'identity_field_not_selected' });
    } finally {
      await run.mock.close();
    }
  }, 60_000);

  it('GraphQL이 number null을 주면 gh는 0을 찍고, 결과는 invalid_identifier로 거절된다 — 0을 번호로 받지 않는다', async () => {
    const node = { title: 't', state: 'OPEN', url: 'https://127.0.0.1/acme/payments/pull/7', author: { login: 'alice' }, headRefName: 'h', baseRefName: 'main', isDraft: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' };
    const run = await runPrList(['number', 'title'], { rawPullRequestNodes: [{ ...node, number: null }] });
    try {
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual([{ number: 0, title: 't' }]);
      expect(parsePrListOutput(run.stdout, ['number', 'title'], 30, { host: run.mock.host, repository: REPOSITORY })).toEqual({ ok: false, reason: 'invalid_identifier' });
    } finally {
      await run.mock.close();
    }
  }, 60_000);

  it('빈 목록은 성공이고, 없는 원소를 고르면 바인딩이 실패한다 — 기본값으로 채우지 않는다', async () => {
    const run = await runPrList(['number', 'title'], { rawPullRequestNodes: [] });
    try {
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('[]');
      const parsed = parsePrListOutput(run.stdout, ['number', 'title'], 30, { host: run.mock.host, repository: REPOSITORY });
      expect(parsed.ok && parsed.result.references.refs).toEqual([]);
      if (!parsed.ok) return;
      const outcome = evaluateBinding({
        binding: { source: { capabilityId: 'pr.list', port: 'pull_requests' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '/0' },
        source: endpoint('pr.list', 'output', 'pull_requests'),
        target: endpoint('pr.view', 'input', 'pull_request'),
        value: prListPortValue(parsed.result),
        targetContext: { host: run.mock.host, repository: REPOSITORY },
      });
      expect(outcome).toMatchObject({ ok: false, reason: 'selection_invalid', detail: 'index_out_of_range (0)' });
    } finally {
      await run.mock.close();
    }
  }, 60_000);

  it('실제 결과의 참조는 다른 저장소 컨텍스트의 pr view에 이어지지 않는다', async () => {
    const run = await runPrList(['number']);
    try {
      expect(run.status, run.stderr).toBe(0);
      const parsed = parsePrListOutput(run.stdout, ['number'], 30, { host: run.mock.host, repository: REPOSITORY });
      if (!parsed.ok) throw new Error('parse');
      const outcome = evaluateBinding({
        binding: { source: { capabilityId: 'pr.list', port: 'pull_requests' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '/0' },
        source: endpoint('pr.list', 'output', 'pull_requests'),
        target: endpoint('pr.view', 'input', 'pull_request'),
        value: prListPortValue(parsed.result),
        targetContext: { host: run.mock.host, repository: { owner: 'acme', name: 'other' } },
      });
      expect(outcome).toMatchObject({ ok: false, reason: 'repository_mismatch' });
    } finally {
      await run.mock.close();
    }
  }, 60_000);
});
