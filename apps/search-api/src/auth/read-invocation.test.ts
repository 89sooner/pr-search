import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from './context.js';
import { sessionInvocation } from './read-invocation.js';

describe('sessionInvocation — correlation ID는 요청의 request.id다 (CR-129)', () => {
  it('조회가 응답·감사·진단에 싣는 ID와 공통 오류 처리가 쓰는 ID가 같다', () => {
    const request = { id: '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8', headers: {} } as unknown as FastifyRequest;
    const invocation = sessionInvocation(request, {} as AuthContext);
    expect(invocation.correlationId).toBe(request.id);
  });
});
