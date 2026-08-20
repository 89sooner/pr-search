/**
 * 웹훅 수신 게이트웨이 통합 테스트 (WP-004 DoD).
 *
 * 실제 PostgreSQL, 실제 HTTP. 목이 없다 — "저장되었는가"를 목으로 확인하면
 * 유실 없음을 증명한 게 아니다.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '@prs/db';
import {
  countRawEvents,
  migratedPool,
  postWebhook,
  startGateway,
  testConfig,
  truncateRawEvents,
  WEBHOOK_SECRET,
  type RunningGateway,
} from './helpers.js';
import { computeSignature } from '../src/signature.js';
import { MAX_BODY_BYTES } from '../src/config.js';

const PR_EVENT = JSON.stringify({
  action: 'closed',
  number: 1234,
  pull_request: { merged: true, merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5' },
  repository: { id: 4021, full_name: 'acme/payments' },
});

let pool: Pool;
let gateway: RunningGateway;

beforeAll(async () => {
  pool = await migratedPool();
  gateway = await startGateway(pool);
});

afterAll(async () => {
  await gateway.stop();
  await pool.end();
});

beforeEach(async () => {
  await truncateRawEvents(pool);
});

describe('DoD 1 — FR-ING-001 AC-3: 유효 서명 요청이 202를 반환하고 저장된다', () => {
  it('202와 API-ING-001 본문을 돌려주고 raw_event에 원본이 남는다', async () => {
    const deliveryId = 'dod1-72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5';
    const response = await postWebhook(gateway.baseUrl, {
      body: PR_EVENT,
      eventType: 'pull_request',
      deliveryId,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, delivery_id: deliveryId, duplicate: false });

    const row = await pool.query<{
      event_type: string;
      action: string | null;
      repository_id: string | null;
      payload: Record<string, unknown>;
      payload_hash: string;
      correlation_id: string;
      queued_at: Date | null;
    }>('SELECT * FROM raw_event WHERE delivery_id = $1', [deliveryId]);

    expect(row.rowCount).toBe(1);
    const stored = row.rows[0]!;
    expect(stored.event_type).toBe('pull_request');
    expect(stored.action).toBe('closed');
    expect(Number(stored.repository_id)).toBe(4021);
    // FR-ING-003 AC-1: payload 전문이 그대로 남는다.
    expect(stored.payload).toMatchObject({ number: 1234, repository: { full_name: 'acme/payments' } });
    expect(stored.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    // 큐 enqueue는 WP-005 범위다. 지금은 아웃박스가 비어 있어야 정상이다.
    expect(stored.queued_at).toBeNull();
  });

  it('화이트리스트 밖 이벤트도 저장한다 (AC-5: 저장 후 처리 대상에서만 제외)', async () => {
    const response = await postWebhook(gateway.baseUrl, {
      body: JSON.stringify({ action: 'created', repository: { id: 4021 } }),
      eventType: 'issue_comment',
      deliveryId: 'dod1-unsupported',
    });
    expect(response.status).toBe(202);
    expect(await countRawEvents(pool, 'dod1-unsupported')).toBe(1);
  });

  it('전달 식별자가 없으면 정규화 해시를 멱등 키로 저장한다 (FR-ING-002 AC-4)', async () => {
    const response = await postWebhook(gateway.baseUrl, { body: PR_EVENT, eventType: 'pull_request' });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { delivery_id: string };
    expect(body.delivery_id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await countRawEvents(pool, body.delivery_id)).toBe(1);

    // 같은 payload를 키 순서만 바꿔 다시 보내도 같은 키로 묶인다.
    const reordered = JSON.stringify({
      repository: { full_name: 'acme/payments', id: 4021 },
      pull_request: { merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5', merged: true },
      number: 1234,
      action: 'closed',
    });
    const again = await postWebhook(gateway.baseUrl, { body: reordered, eventType: 'pull_request' });
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(await countRawEvents(pool)).toBe(1);
  });
});

describe('DoD 2 — FR-ING-001 AC-2: 무효·변조 서명은 401이고 저장하지 않는다', () => {
  it('다른 시크릿으로 서명한 요청을 401로 거부한다', async () => {
    const response = await postWebhook(gateway.baseUrl, {
      body: PR_EVENT,
      eventType: 'pull_request',
      deliveryId: 'dod2-wrong-secret',
      secret: 'attacker-secret',
    });
    expect(response.status).toBe(401);
    expect(await countRawEvents(pool)).toBe(0);
  });

  it('본문을 한 바이트 바꾼 재생 요청을 401로 거부한다', async () => {
    const signature = computeSignature(Buffer.from(PR_EVENT, 'utf8'), WEBHOOK_SECRET);
    const tampered = PR_EVENT.replace('"number":1234', '"number":1235');
    const response = await postWebhook(gateway.baseUrl, {
      body: tampered,
      eventType: 'pull_request',
      deliveryId: 'dod2-tampered',
      signature,
    });
    expect(response.status).toBe(401);
    expect(await countRawEvents(pool)).toBe(0);
  });

  it('서명 헤더가 아예 없어도 401이다', async () => {
    const response = await fetch(`${gateway.baseUrl}/api/v1/webhooks/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      body: PR_EVENT,
    });
    expect(response.status).toBe(401);
    expect(await countRawEvents(pool)).toBe(0);
  });
});

describe('DoD 3 — FR-ING-002 AC-2: 재전송은 202 duplicate이고 행이 늘지 않는다', () => {
  it('같은 전달 식별자를 세 번 보내도 행은 하나다', async () => {
    const deliveryId = 'dod3-redelivery';
    const first = await postWebhook(gateway.baseUrl, {
      body: PR_EVENT,
      eventType: 'pull_request',
      deliveryId,
    });
    expect(((await first.json()) as { duplicate: boolean }).duplicate).toBe(false);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const resend = await postWebhook(gateway.baseUrl, {
        body: PR_EVENT,
        eventType: 'pull_request',
        deliveryId,
      });
      expect(resend.status).toBe(202);
      expect(await resend.json()).toEqual({ accepted: true, delivery_id: deliveryId, duplicate: true });
    }

    expect(await countRawEvents(pool, deliveryId)).toBe(1);
  });

  /**
   * 기본 키가 `(delivery_id, received_at)`이라 수신 시각이 다른 재전송은 키
   * 충돌을 일으키지 않는다 (DEV-009). 동시에 들어와도 한 행이어야 한다.
   */
  it('같은 전달 식별자가 동시에 여덟 번 들어와도 행은 하나다', async () => {
    const deliveryId = 'dod3-concurrent';
    const responses = await Promise.all(
      Array.from({ length: 8 }, async () =>
        postWebhook(gateway.baseUrl, { body: PR_EVENT, eventType: 'pull_request', deliveryId }),
      ),
    );

    expect(responses.every((response) => response.status === 202)).toBe(true);
    const bodies = (await Promise.all(responses.map(async (response) => response.json()))) as {
      duplicate: boolean;
    }[];
    expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
    expect(await countRawEvents(pool, deliveryId)).toBe(1);
  });
});

describe('DoD 4 — FR-ING-001 AC-6: 25MB 초과 요청은 413이다', () => {
  it('25MB를 넘는 본문을 413으로 끊고 저장하지 않는다', async () => {
    const oversized = Buffer.from(
      JSON.stringify({ repository: { id: 4021 }, pad: 'x'.repeat(MAX_BODY_BYTES) }),
      'utf8',
    );
    expect(oversized.length).toBeGreaterThan(MAX_BODY_BYTES);

    const response = await postWebhook(gateway.baseUrl, {
      body: oversized,
      eventType: 'push',
      deliveryId: 'dod4-oversized',
    });

    expect(response.status).toBe(413);
    expect(await countRawEvents(pool)).toBe(0);
  });

  it('상한 바로 아래 본문은 통과한다', async () => {
    const padding = 'x'.repeat(MAX_BODY_BYTES - 1024);
    const response = await postWebhook(gateway.baseUrl, {
      body: JSON.stringify({ repository: { id: 4021 }, pad: padding }),
      eventType: 'push',
      deliveryId: 'dod4-under-limit',
    });
    expect(response.status).toBe(202);
    expect(await countRawEvents(pool, 'dod4-under-limit')).toBe(1);
  });
});

describe('DoD 5 — FR-ING-001 예외 처리: 저장 실패는 500이다', () => {
  /**
   * 파티션이 없는 시각으로 INSERT하면 PostgreSQL이 실제로 거부한다.
   * 목을 쓰지 않고 진짜 저장 실패를 만드는 방법이다.
   */
  it('파티션 밖 수신 시각으로 저장이 실패하면 500을 반환한다', async () => {
    const broken = await startGateway(pool, { now: () => new Date('2000-01-01T00:00:00.000Z') });
    try {
      const response = await postWebhook(broken.baseUrl, {
        body: PR_EVENT,
        eventType: 'pull_request',
        deliveryId: 'dod5-no-partition',
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('partition');
      expect(await countRawEvents(pool, 'dod5-no-partition')).toBe(0);
    } finally {
      await broken.stop();
    }
  });
});

describe('DoD 8 — QA-A001-01: 수신 지표가 노출된다', () => {
  it('수신·거부·중복·응답시간이 Prometheus 형식으로 나온다', async () => {
    const local = await startGateway(pool, { config: testConfig() });
    try {
      await postWebhook(local.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId: 'm-1' });
      await postWebhook(local.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId: 'm-1' });
      await postWebhook(local.baseUrl, {
        body: PR_EVENT,
        eventType: 'push',
        deliveryId: 'm-2',
        secret: 'wrong',
      });

      const metrics = await (await fetch(`${local.baseUrl}/metrics`)).text();
      expect(metrics).toContain('ingest_received_total{event_type="push",supported="true"} 2');
      expect(metrics).toContain('ingest_duplicate_total 1');
      expect(metrics).toContain('ingest_rejected_total{reason="invalid_signature"} 1');
      expect(metrics).toContain('ingest_response_seconds_count{status="202"} 2');
      expect(metrics).toContain('ingest_response_seconds_count{status="401"} 1');
    } finally {
      await local.stop();
    }
  });
});

describe('FR-ING-003 / ADR-002 레인 B: NDJSON 아카이브', () => {
  it('저장된 이벤트가 아카이브 파일에 한 줄로 append된다', async () => {
    const local = await startGateway(pool, { withArchive: true });
    const archivePath = local.archivePath!;
    const deliveryId = 'archive-1';
    let contents: string;
    try {
      await postWebhook(local.baseUrl, { body: PR_EVENT, eventType: 'pull_request', deliveryId });
      // 스트림을 닫아야 버퍼가 파일로 내려간다.
      await local.app.close();
      await local.archive.close();
      contents = readFileSync(archivePath, 'utf8');
    } finally {
      await local.stop();
    }

    const lines = contents
      .split('\n')
      .filter((entry) => entry !== '')
      .map((entry) => JSON.parse(entry) as { delivery_id: string; payload: { number: number } });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.delivery_id).toBe(deliveryId);
    expect(lines[0]?.payload.number).toBe(1234);
  });

  it('중복 재전송은 아카이브에 두 줄을 남기지 않는다', async () => {
    const local = await startGateway(pool, { withArchive: true });
    const archivePath = local.archivePath!;
    const deliveryId = 'archive-duplicate';
    let contents: string;
    try {
      await postWebhook(local.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId });
      await postWebhook(local.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId });
      await local.app.close();
      await local.archive.close();
      contents = readFileSync(archivePath, 'utf8');
    } finally {
      await local.stop();
    }

    expect(contents.split('\n').filter((entry) => entry !== '')).toHaveLength(1);
  });
});

describe('인프라 3장: 헬스체크가 PostgreSQL 연결을 확인한다', () => {
  it('연결이 살아 있으면 200이다', async () => {
    const response = await fetch(`${gateway.baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'ingest-gateway' });
  });
});
