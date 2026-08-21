/**
 * `search-api` 프록시 (WP-015 / 프런트엔드 문서 10장).
 *
 * 순서는 넷이다:
 *   1. 세션 쿠키 검증 (없으면 401 + 재인증 힌트)
 *   2. 상관 ID 생성·전파
 *   3. `search-api`로 전달 — **세션 쿠키만** (CR-018, DEV-067)
 *   4. 응답 통과. 오류 DTO를 변형하지 않는다
 *
 * 무엇을 전달하고 무엇을 막는가는 `lib/proxy.ts`가 정한다. 이 파일은 그
 * 규칙을 Next.js 런타임에 붙이기만 한다.
 */

import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@prs/authz';
import {
  CORRELATION_HEADER,
  buildProxyHeaders,
  buildResponseHeaders,
  buildUpstreamUrl,
  resolveProxyAuth,
} from '../../../lib/proxy';
import { resolveWebConfig } from '../../../lib/server/config';
import { sessionStore } from '../../../lib/server/session';

/** 프록시는 캐시하지 않는다 — 응답이 사용자의 접근 범위에 달려 있다. */
export const dynamic = 'force-dynamic';

/** 본문이 있는 메서드. 나머지는 본문을 읽지 않는다. */
const WITH_BODY: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

function unauthenticated(correlationId: string, loginPath: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'UNAUTHENTICATED',
        message: '세션이 없거나 만료되었습니다',
        detail: { login_path: loginPath },
      },
      correlation_id: correlationId,
    },
    { status: 401, headers: { [CORRELATION_HEADER]: correlationId } },
  );
}

async function proxy(request: NextRequest, segments: readonly string[]): Promise<NextResponse> {
  const correlationId = randomUUID();
  const config = resolveWebConfig();

  /*
   * 1. 세션 쿠키. **Redis에서 실제로 살아 있는지**까지 본다 — 쿠키가 있다는
   *    것만으로 백엔드를 부르면 만료된 세션이 401을 두 번 왕복한다.
   *
   * 판정은 `lib/proxy.ts`의 순수 함수가 한다. 저장소 장애(503)와 그런
   * 세션이 없음(401)을 가르는 것이 이 프록시의 보안 경계이므로, Redis
   * 없이도 세 갈래 전부를 시험할 수 있어야 한다.
   */
  const auth = await resolveProxyAuth(request.cookies.get(SESSION_COOKIE_NAME)?.value, (id) =>
    sessionStore().load(id),
  );

  if (auth.kind === 'unauthenticated') {
    return unauthenticated(correlationId, config.session.loginPath);
  }

  if (auth.kind === 'unavailable') {
    /*
     * 세션 저장소에 닿지 못하면 **401이 아니라 503이다.**
     *
     * 401은 "다시 로그인하라"는 뜻인데, Redis가 죽은 것은 사용자가 고칠 수
     * 있는 일이 아니다 — 다시 로그인해도 같은 곳에서 막힌다. `search-api`가
     * 접근 범위를 못 구했을 때 503을 내는 것과 같은 판단이다 (FR-AUTH-002 AC-3).
     */
    return NextResponse.json(
      {
        error: { code: 'PERMISSION_UNAVAILABLE', message: '세션을 확인할 수 없습니다' },
        correlation_id: correlationId,
      },
      { status: 503, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  }

  // 3. 전달.
  const url = buildUpstreamUrl(config.searchApiUrl, segments, request.nextUrl.search);
  const headers = buildProxyHeaders({ headers: request.headers, sessionId: auth.sessionId, correlationId });

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      ...(WITH_BODY.has(request.method) ? { body: await request.text() } : {}),
      // 리다이렉트를 따라가지 않는다 — 백엔드가 우리를 다른 곳으로 보낼 이유가 없다.
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    /*
     * `search-api`에 닿지 못했다.
     *
     * **원인을 클라이언트에 적지 않는다** — 내부 주소와 연결 오류 문구가
     * 그대로 새어 나간다. 상관 ID로 로그에서 찾는다.
     */
    return NextResponse.json(
      {
        error: { code: 'UPSTREAM_UNAVAILABLE', message: '검색 서비스에 연결할 수 없습니다' },
        correlation_id: correlationId,
      },
      { status: 502, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  }

  /*
   * 4. 통과.
   *
   * 상태 코드도 본문도 그대로 넘긴다. 오류의 `code`와 `detail`을 프런트엔드가
   * 재해석하지 않는다 (프런트엔드 문서 10장) — 화면이 서버가 정한 코드로
   * 분기해야 두 곳의 판단이 갈리지 않는다.
   */
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: buildResponseHeaders(upstream.headers, correlationId),
  });
}

type Context = { readonly params: Promise<{ readonly path?: string[] }> };

async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  return proxy(request, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
