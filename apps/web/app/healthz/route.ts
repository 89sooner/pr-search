import type { HealthResponse } from '@prs/contracts';

import { webConfigFailure } from '../../lib/server/config';

export const dynamic = 'force-dynamic';

/**
 * 인프라 3장이 정의한 `web`의 헬스체크 경로.
 *
 * **구성을 함께 본다** (`DEV-577`). 이 핸들러는 원래 아무것도 읽지 않고 늘
 * `ok`를 냈다. 그래서 운영 계약을 어긴 배포에서도 Docker가 `healthy`를
 * 보고했고, 사람이 여는 화면만 500이 되는 상태가 초록으로 가려졌다 — 사내
 * 반입(`0.1.0-pilot.3`)이 막힌 자리다.
 *
 * `instrumentation.ts`가 기동을 막으므로 잘못된 구성은 여기까지 오지 못하는
 * 것이 정상이다. 그럼에도 여기서 다시 보는 이유는, 기동 검증이 프레임워크의
 * 훅 하나에 걸려 있기 때문이다. 그 훅이 언젠가 돌지 않게 되더라도
 * **헬스체크가 거짓말하는 상태로 돌아가서는 안 된다.**
 *
 * **백킹 서비스는 확인하지 않는다.** 이것은 liveness 신호이며, PostgreSQL이
 * 잠깐 끊겼다고 `web` 컨테이너를 죽이는 것은 이 신호의 목적이 아니다.
 * 여기서 보는 것은 네트워크 없이 판정되는 구성 계약뿐이다.
 */
export function GET(): Response {
  const failure = webConfigFailure();
  if (failure !== null) {
    /*
     * **본문은 이유를 반사하지 않는다.** 이 경로는 호스트 포트에 열려 있고
     * (compose의 `WEB_BIND`), 판정 문구에는 구성 값이 실릴 수 있다 —
     * `parseGroupRoleMap`은 잘못된 항목을 그대로 담아 던진다. 자세한 내용은
     * 운영자만 읽는 컨테이너 로그로 보낸다 (NFR-005).
     */
    console.error(`web 구성이 성립하지 않는다: ${failure}`);
    return Response.json({ status: 'error', service: 'web' }, { status: 503 });
  }

  const body: HealthResponse = {
    status: 'ok',
    service: 'web',
    version: process.env['npm_package_version'] ?? '0.1.0',
  };
  return Response.json(body);
}
