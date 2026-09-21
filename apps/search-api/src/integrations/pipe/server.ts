/**
 * PIPE 연동 private 리스너 (CR-112 / ADR-025, 공통 계약 3.3).
 *
 * ## 같은 프로세스, 다른 리스너
 *
 * 새 게이트웨이 서비스를 만들지 않는다. search-api 프로세스 안에 **별도 Fastify 인스턴스**를 띄우고
 * 공개 리스너와 다른 포트에서 듣는다. 그래서 "공개 리스너로 들어온 요청은 인증값을 알아도 거부"가
 * 구조로 성립한다 — 공개 앱에는 `/internal/*` 경로가 하나도 없고, web의 프록시는 `/api/v1` 접두만
 * 만든다(`buildUpstreamUrl`).
 *
 * ## TLS를 이 프로세스가 끝낸다
 *
 * `requestCert` + `rejectUnauthorized`: client 인증서가 없거나 설정한 CA가 발급하지 않았으면 핸드셰이크
 * 에서 끊긴다. 검증을 끄는 설정은 없다. 프록시는 TLS passthrough(L4)로만 둔다 (ADR-025).
 *
 * - HEAD 자동 경로를 끈다 — GET 조회가 HEAD로 열리지 않는다 (PSI-D03).
 * - 본문은 JSON 하나만, 16KiB까지 받는다. `text/plain` 해석기를 지운다.
 * - 요청 상한 60초. BFF 전체 기한(계약 10장 제안 35초)보다 길고, 매달린 연결이 무한히 남지 않는다.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { PipeIntegrationEnabled } from './config.js';
import { registerIntegrationRoutes, type IntegrationRouteDeps } from './routes.js';

export const INTEGRATION_BODY_LIMIT = 16 * 1024;
export const INTEGRATION_REQUEST_TIMEOUT_MS = 60_000;

export interface IntegrationServerOptions {
  readonly tls: PipeIntegrationEnabled['tls'];
  readonly routes: IntegrationRouteDeps;
}

export function buildIntegrationServer(options: IntegrationServerOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    https: {
      key: options.tls.key,
      cert: options.tls.cert,
      ca: options.tls.clientCa,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    exposeHeadRoutes: false,
    bodyLimit: INTEGRATION_BODY_LIMIT,
    requestTimeout: INTEGRATION_REQUEST_TIMEOUT_MS,
    return503OnClosing: true,
  });
  app.removeContentTypeParser('text/plain');
  registerIntegrationRoutes(app, options.routes);
  return app;
}
