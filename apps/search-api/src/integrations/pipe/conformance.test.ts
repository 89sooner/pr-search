/**
 * handoff 적합성 벡터가 구현과 일치한다 (CR-112).
 *
 * PIPE 담당 세션은 `handoff/pipe-search-integration/v1/conformance/vectors.json`으로 자기 서명기를 대조한다.
 * 그 파일의 기대 결과(통과·거절 사유)가 이 저장소의 `verifyAssertion`과 어긋나면 인수인계 자료가 거짓이
 * 되므로 여기서 전부 돌려 본다. 벡터의 키는 공개된 시험 키다 — 운영 자격이 아니다.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyAssertion, type AssertionPurpose } from './assertion.js';
import type { PipeClientPolicy } from './config.js';
import { PsiError } from './errors.js';

interface Vector {
  readonly id: string;
  readonly purpose: AssertionPurpose;
  readonly now: number;
  readonly token: string;
  readonly expect: { readonly result: 'accept' | 'reject'; readonly code?: string; readonly reason?: string };
}

interface VectorDocument {
  readonly protocol_version: string;
  readonly fixture_only: boolean;
  readonly client: { client_id: string; issuer: string; audience: string; profile: string; kid: string };
  readonly public_key_pem: string;
  readonly vectors: readonly Vector[];
}

const document = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../handoff/pipe-search-integration/v1/conformance/vectors.json', import.meta.url)),
    'utf8',
  ),
) as VectorDocument;

const CLIENT: PipeClientPolicy = {
  clientId: document.client.client_id,
  status: 'active',
  policyVersion: 1,
  issuer: document.client.issuer,
  audience: document.client.audience,
  profile: 'search-read-v1',
  signingKeys: new Map<string, KeyObject>([[document.client.kid, createPublicKey(document.public_key_pem)]]),
  certificateSha256: new Set(),
  subjectAltNames: new Set(['URI:spiffe://fixture/pipe-conformance']),
  repositoryIds: [1],
};

describe('PSI-1.0 적합성 벡터', () => {
  it('fixture 전용 표식과 프로토콜 버전을 갖는다', () => {
    expect(document.protocol_version).toBe('PSI-1.0');
    expect(document.fixture_only).toBe(true);
    expect(document.vectors.length).toBeGreaterThanOrEqual(20);
  });

  it.each(document.vectors.map((vector) => [vector.id, vector] as const))('%s', async (_id, vector) => {
    const run = verifyAssertion(vector.token, { client: CLIENT, purpose: vector.purpose, nowMs: vector.now * 1000 });
    if (vector.expect.result === 'accept') {
      await expect(run).resolves.toMatchObject({ purpose: vector.purpose });
      return;
    }
    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PsiError);
    expect((error as PsiError).code).toBe(vector.expect.code);
    expect((error as PsiError).reason).toBe(vector.expect.reason);
  });
});
