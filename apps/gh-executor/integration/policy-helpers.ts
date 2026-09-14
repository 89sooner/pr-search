/**
 * 운영 정책 시험 도우미 (CR-090).
 *
 * **정책 검사를 대역으로 바꾸지 않는다.** 승인은 실제 경로로만 만든다 — 실행기의 레지스트리 검사가 검증 기록을 남기고,
 * search-api의 조회가 승인 미리보기를 계산하고, search-api의 변경 함수가 DB 함수를 부른다. 다른 배포 범위(다른 목 GHE)의
 * 근거가 필요하면 실제 고정 바이너리로 한 번 얻은 드리프트 결과를 그 범위의 기록으로 다시 남긴다 — 인벤토리 추출(수십 초)을
 * 범위마다 반복하지 않되, 관측값을 지어내지 않는다.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from '@prs/db';
import type { GhCapabilityManifest } from '@prs/gh-cli';
import type { DriftCheck } from '@prs/gh-cli/node';
import type { ExecutorConfig } from '../src/config.js';
import { createExecutorMetrics } from '../src/metrics.js';
import { runRegistryCheck, type RegistryCheckResult } from '../src/registry-check.js';
import { changePolicy, parsePolicyChange, policyStatus, type PolicyChangeOutcome, type PolicyDeps } from '../../search-api/src/gh/policy.js';

export function policyDepsFor(pool: Pool, manifest: GhCapabilityManifest, scope: string): PolicyDeps {
  return { pool, manifest, scope, operationsEnabled: true };
}

/** 실행기의 기동 검사 한 회차를 실제로 돌려 이 배포 범위의 검증 기록을 남긴다. `drift`를 주면 그 실측 결과를 재사용한다. */
export async function recordExecutorEvidence(pool: Pool, config: ExecutorConfig, manifest: GhCapabilityManifest, drift?: DriftCheck): Promise<RegistryCheckResult> {
  const result = await runRegistryCheck(
    { pool, config, manifest, metrics: createExecutorMetrics(), log: () => undefined, retryDelaysMs: [1, 1, 1], ...(drift === undefined ? {} : { drift: () => drift }) },
    'startup',
  );
  if (result.status !== 'passed' || result.verificationId === null) {
    throw new Error(`실제 레지스트리 검사가 통과해 기록되지 않았다: ${result.status} ${String(result.detail)} ${String(result.recordError)}`);
  }
  return result;
}

let keySequence = 0;

/** 운영자 한 명의 정책 변경 — 본문 파싱부터 DB 함수까지 search-api와 같은 경로다. */
export async function operatorChange(deps: PolicyDeps, body: Record<string, unknown>, actor = 'u-operator'): Promise<PolicyChangeOutcome> {
  keySequence += 1;
  const request = parsePolicyChange(body, deps.manifest);
  return changePolicy(deps, actor, request, `test-${String(Date.now())}-${String(keySequence)}`, randomUUID());
}

export interface PreviewView {
  readonly eligible: boolean;
  readonly reasons: readonly { readonly code: string; readonly detail: string | null }[];
  readonly snapshot_id: number | null;
  readonly verification_id: number | null;
  readonly report_hash: string | null;
}

export async function readPreview(deps: PolicyDeps): Promise<{ readonly revision: number; readonly preview: PreviewView; readonly approvedMatches: boolean }> {
  const status = await policyStatus(deps);
  const policy = status['policy'] as { revision: number; approval: { matches_served: boolean } | null };
  return { revision: policy.revision, preview: status['approval_preview'] as PreviewView, approvedMatches: policy.approval?.matches_served === true };
}

/** 현재 적재 정의를 미리보기대로 승인한다. 이미 승인돼 있으면 그 revision을 돌려준다. */
export async function approveServed(deps: PolicyDeps, reason = '시험 전제 — 현재 정의 운영 승인'): Promise<number> {
  const { revision, preview, approvedMatches } = await readPreview(deps);
  if (approvedMatches) return revision;
  if (!preview.eligible) throw new Error(`승인 자격이 없다: ${JSON.stringify(preview.reasons)}`);
  const outcome = await operatorChange(deps, {
    action: 'approve',
    expected_revision: revision,
    reason,
    snapshot_id: preview.snapshot_id,
    verification_id: preview.verification_id,
    report_hash: preview.report_hash,
  });
  return outcome.revision;
}

/** 이 실행기 설정의 배포 범위에 근거를 남기고 승인까지 한다. */
export async function evidenceAndApproval(pool: Pool, config: ExecutorConfig, manifest: GhCapabilityManifest, drift?: DriftCheck): Promise<{ readonly revision: number; readonly check: RegistryCheckResult }> {
  if (config.host === null) throw new Error('실행기 설정에 호스트가 없다');
  const check = await recordExecutorEvidence(pool, config, manifest, drift);
  const revision = await approveServed(policyDepsFor(pool, manifest, config.host));
  return { revision, check };
}
