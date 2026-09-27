/**
 * CR-124 — 단일 호스트에서 참조를 파생하는 두 역할이 GHE 주소를 받는다 (DEV-776).
 *
 * 참조 추출(FR-REL-003 AC-1)은 승인된 GHE 호스트의 PR·커밋 URL만 인정한다(THR-036). 그 호스트는
 * 배포 설정의 `GHE_BASE_URL`에서 온다. 단일 호스트 compose의 `worker-link`·`worker-batch`는 그 값을
 * 받지 않았고, 워커는 비어 있는 값을 예시 호스트(`ghe.example.com`)로 채워 사내 GHE의 URL을 모두
 * 거절했다 — 단위 시험은 호스트를 직접 넣으므로 이 틈을 보지 못했다.
 *
 * 그래서 여기서는 **배선**을 건다: 실제 `docker compose config`의 렌더 → 워커가 쓰는 해석 함수 →
 * 참조 추출. docker가 없으면 실패다 — skip은 통과가 아니다(DEV-664와 같은 규율).
 *
 * 사내 주소를 대신하는 가상 호스트다. 실제 사내 주소는 공개 저장소에 싣지 않는다(2026-09-27 사용자 결정) —
 * 구조(네 단계 호스트, 가운데 `github`)를 맞췄고, 실제 값으로는 같은 시험을 격리 환경에서 돌렸다(원장 6.115장).
 * 렌더는 컨테이너를 띄우지 않으므로 어디에도 접속하지 않는다.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractReferences } from '@prs/domain';
import { resolveReferenceHost } from '@prs/github';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const CORP_GHE = 'https://team.github.corp.example';
/** 개인 키 자리에 넣는 표식. 두 역할의 렌더에 이 문자열이 보이면 자격이 샌 것이다. */
const KEY_MARKER = 'PRS-CR124-PRIVATE-KEY-MARKER';
/** 참조를 파생하는 두 역할. `link`는 평시 파생, `batch`는 prs-links 재색인이다. */
const REFERENCE_ROLES = ['worker-link', 'worker-batch'] as const;
/** 두 역할이 받으면 안 되는 GHE 자격·접속 값. 주소 하나만 받는다. */
const CREDENTIAL_KEYS = ['GHE_APP_ID', 'GHE_APP_PRIVATE_KEY', 'GHE_INSTALLATIONS', 'GHE_API_URL', 'GHE_WEBHOOK_SECRET'] as const;

type ServiceEnv = Record<string, string | undefined>;

/** compose가 `:?`로 요구하는 변수를 전부 채운 `.env` 머리. 값 자체는 관심사가 아니다. */
function composeBase(except: readonly string[] = []): string {
  const compose = read('deploy/single-host/compose.yml');
  const required = [...new Set([...compose.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1] ?? ''))].filter(
    (key) => key !== '' && !except.includes(key),
  );
  return required.map((key) => `${key}=x`).join('\n');
}

/** 같은 `.env`로 compose가 서비스에 실제로 넘길 환경을 JSON 렌더에서 읽는다. */
function render(envText: string): Record<string, ServiceEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'prs-cr124-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, `${envText}\n`);
    const json = JSON.parse(
      execFileSync(
        'docker',
        ['compose', '--project-name', 'prs-cr124-test', '--env-file', envFile, '-f', join(root, 'deploy/single-host/compose.yml'), 'config', '--format', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    ) as { services: Record<string, { environment?: ServiceEnv }> };
    return Object.fromEntries(Object.entries(json.services).map(([name, service]) => [name, service.environment ?? {}]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 사내 운영 `.env`와 같은 모양 — 주소와 Data App 자격이 함께 있다. */
const PRODUCTION_LIKE = [
  composeBase(['GHE_BASE_URL']),
  `GHE_BASE_URL=${CORP_GHE}`,
  'GHE_APP_ID=4242',
  `GHE_APP_PRIVATE_KEY=${KEY_MARKER}`,
  'GHE_INSTALLATIONS=acme:1',
  'GHE_API_URL=https://team.github.corp.example/api/v3',
].join('\n');

describe('DEV-776: 참조를 파생하는 두 역할이 GHE 주소를 받는다 — 실제 docker compose', () => {
  it('worker-link·worker-batch가 compose 렌더에서 `.env`의 GHE_BASE_URL을 그대로 받는다', () => {
    const services = render(PRODUCTION_LIKE);
    for (const role of REFERENCE_ROLES) {
      expect(services[role]?.['GHE_BASE_URL'], role).toBe(CORP_GHE);
    }
    // 같은 값이 수집 경로(Data App)에도 간다 — 두 역할만 다른 주소를 볼 수 없다.
    expect(services['worker-enrich']?.['GHE_BASE_URL']).toBe(CORP_GHE);
  }, 120_000);

  it('**주소만 받는다** — App 자격·설치 표·API 주소·웹훅 비밀은 두 역할에 가지 않는다', () => {
    const services = render(PRODUCTION_LIKE);
    for (const role of REFERENCE_ROLES) {
      const env = services[role] ?? {};
      for (const key of CREDENTIAL_KEYS) expect(env[key], `${role} ${key}`).toBeUndefined();
      expect(JSON.stringify(env), role).not.toContain(KEY_MARKER);
    }
    // 대조군: 수집 역할은 여전히 자격을 받는다 — 표식이 렌더에 실제로 실린다는 뜻이다.
    expect(services['worker-enrich']?.['GHE_APP_PRIVATE_KEY']).toBe(KEY_MARKER);
  }, 120_000);

  it('렌더된 값이 워커의 해석 → 참조 추출까지 이어진다 — 사내 PR·커밋 URL은 참조, 다른 호스트는 아니다', () => {
    const full = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const body = [
      `재현: https://team.github.corp.example/acme/b/pull/123`,
      `수정: https://team.github.corp.example/acme/b/commit/${full}`,
      `외부: https://github.com/acme/b/pull/9`,
      '기존: #7 acme/b#8',
    ].join('\n');
    const services = render(PRODUCTION_LIKE);
    for (const role of REFERENCE_ROLES) {
      const host = resolveReferenceHost(services[role] ?? {});
      expect(host, role).toBe('team.github.corp.example');
      const keys = extractReferences(body, { sourceRepo: { owner: 'acme', name: 'a' }, gheHost: host }).map(
        (reference) => reference.reference_key,
      );
      expect(keys, role).toEqual(['x:acme/b:pr:123', `x:acme/b:commit:${full}`, 'pr:7', 'x:acme/b:pr:8']);
    }
  }, 120_000);

  it('GHE_BASE_URL이 비면 렌더가 실패한다 — 두 역할이 주소 없이 조용히 서지 않는다', () => {
    const blank = [composeBase(['GHE_BASE_URL']), 'GHE_BASE_URL='].join('\n');
    expect(() => render(blank)).toThrow(/GHE_BASE_URL/);
  }, 120_000);

  it('워커 진입점의 두 파생 경로가 같은 해석 함수를 쓴다 — 예시 호스트로 채우는 접속 설정이 아니다', () => {
    const index = read('apps/pipeline-worker/src/index.ts');
    expect(index).not.toMatch(/gheHost:\s*resolveGitHubConfig\(\)\.baseUrl/);
    expect(index.match(/gheHost:\s*referenceHostFor\('(link|batch)'\)/g)?.sort()).toEqual([
      "gheHost: referenceHostFor('batch')",
      "gheHost: referenceHostFor('link')",
    ]);
    const helper = /function referenceHostFor\([\s\S]*?\n\}/.exec(index)?.[0] ?? '';
    expect(helper).toContain('resolveReferenceHost()');
  });

  it('Kubernetes 형상은 두 역할이 설정 묶음에서 같은 주소를 받는다', () => {
    for (const manifest of ['deploy/k8s/pipeline-worker-link.yaml', 'deploy/k8s/pipeline-worker-batch.yaml']) {
      expect(read(manifest), manifest).toContain('configMapRef: { name: prs-config }');
    }
    expect(read('deploy/k8s/configmap.yaml')).toMatch(/^\s+GHE_BASE_URL:/m);
  });
});
