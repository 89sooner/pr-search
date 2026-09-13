/**
 * 헬스체크가 사실을 말한다 (인프라 3.1 · 12장, WP-077 / CR-086).
 *
 * `healthz`가 초록이면서 아무것도 실행하지 않는 배포가 있을 수 있다 — 그 사실을 응답이
 * 밝혀야 한다(`execution: disabled`). 그리고 백킹 서비스 확인은 **주어졌을 때만** 한다:
 * 꺼진 실행기는 DB를 쓰지 않으므로 그 확인을 넘기지 않고, 그때 DB가 없어도 200이어야
 * 번들의 오프라인 런타임 검사가 성립한다.
 */

import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type HealthDetail, type ServerOptions } from './server.js';

const DETAIL: HealthDetail = { execution: 'disabled', ghVersion: null, manifestVersion: null, manifestHash: null };

const servers: ReturnType<typeof buildServer>[] = [];

async function listen(options: ServerOptions): Promise<string> {
  const server = buildServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('GET /healthz', () => {
  it('꺼진 실행기는 백킹 서비스 없이도 200이며 execution: disabled를 밝힌다', async () => {
    const base = await listen({ detail: () => DETAIL });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'gh-executor', execution: 'disabled', ghVersion: null });
  });

  it('켜진 실행기는 백킹 서비스 확인을 지나고, 실패하면 503이며 ok를 내지 않는다', async () => {
    const enabled: HealthDetail = { execution: 'enabled', ghVersion: '2.97.0', manifestVersion: 'r0.1', manifestHash: 'ad00' };
    const healthy = await listen({ detail: () => enabled, checkBackingServices: async () => undefined });
    expect(await (await fetch(`${healthy}/healthz`)).json()).toMatchObject({ status: 'ok', execution: 'enabled', ghVersion: '2.97.0' });

    const broken = await listen({
      detail: () => enabled,
      checkBackingServices: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const response = await fetch(`${broken}/healthz`);
    expect(response.status).toBe(503);
    // `ok`를 내면 Docker가 healthy로 보고한다 — 그것이 DEV-577의 재발 경로다.
    expect(await response.json()).not.toMatchObject({ status: 'ok' });
  });

  it('확인이 걸리면 기다리지 않고 503이다 — 헬스체크가 매달리지 않는다', async () => {
    const base = await listen({ detail: () => DETAIL, checkBackingServices: () => new Promise<void>(() => undefined) });
    const started = Date.now();
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it('그 밖의 경로는 404다', async () => {
    const base = await listen({ detail: () => DETAIL });
    expect((await fetch(`${base}/anything`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  });
});
