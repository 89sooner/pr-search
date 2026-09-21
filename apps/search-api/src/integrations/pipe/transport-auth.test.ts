/**
 * mTLS 전송 인증의 순수 부분 (CR-112). **실제 TLS 핸드셰이크는 통합 시험이 건다**
 * (`integration/integrations/pipe/transport.test.ts`) — 여기서 통과한 것을 mTLS 검증이라고 하지 않는다.
 */

import { PassThrough } from 'node:stream';
import type { KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PipeClientPolicy } from './config.js';
import { PsiError } from './errors.js';
import { authenticateTransport, subjectAltNames } from './transport-auth.js';

const CLIENT: PipeClientPolicy = {
  clientId: 'pipe-dev',
  status: 'active',
  policyVersion: 1,
  issuer: 'urn:test:pipe',
  audience: 'urn:test:prs',
  profile: 'search-read-v1',
  signingKeys: new Map<string, KeyObject>(),
  certificateSha256: new Set(),
  subjectAltNames: new Set(['URI:spiffe://test/pipe-dev']),
  repositoryIds: [1],
};

describe('subjectAltNames', () => {
  it('Node 표기(쉼표+공백)를 항목으로 나눈다', () => {
    expect(subjectAltNames('DNS:pipe.internal, URI:spiffe://test/pipe-dev, IP Address:10.0.0.1')).toEqual([
      'DNS:pipe.internal',
      'URI:spiffe://test/pipe-dev',
      'IP Address:10.0.0.1',
    ]);
    expect(subjectAltNames(undefined)).toEqual([]);
  });

  it('따옴표 안의 쉼표에서 자르지 않는다', () => {
    expect(subjectAltNames('URI:"http://a, b", DNS:x')).toEqual(['URI:"http://a, b"', 'DNS:x']);
  });
});

describe('authenticateTransport — TLS가 아닌 소켓', () => {
  it('평문 소켓은 CLIENT_AUTH_FAILED다. 헤더로 TLS 상태를 흉내 낼 방법이 없다', () => {
    try {
      authenticateTransport(new PassThrough(), [CLIENT]);
      throw new Error('통과하면 안 된다');
    } catch (error) {
      expect(error).toBeInstanceOf(PsiError);
      expect((error as PsiError).code).toBe('CLIENT_AUTH_FAILED');
      expect((error as PsiError).reason).toBe('not_tls');
    }
  });
});
