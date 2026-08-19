import type { HealthResponse } from '@prs/contracts';

export const dynamic = 'force-dynamic';

/** 인프라 3장이 정의한 `web`의 헬스체크 경로. */
export function GET(): Response {
  const body: HealthResponse = {
    status: 'ok',
    service: 'web',
    version: process.env['npm_package_version'] ?? '0.1.0',
  };
  return Response.json(body);
}
