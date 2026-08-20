/**
 * 수신 처리 순서와 분기 (FR-ING-001, FR-ING-002, FR-ING-003).
 *
 * 여기서 증명하려는 것은 "무엇을 저장하는가"가 아니라 **"어떤 순서로 하는가"**다.
 * 저장 자체는 실제 PostgreSQL을 쓰는 `integration/webhook.test.ts`가 본다.
 */

import { describe, expect, it } from 'vitest';
import { NULL_ARCHIVE_WRITER, type ArchiveRecord, type ArchiveWriter } from './archive.js';
import { ingestWebhook, type IngestDeps, type LogEntry, type WebhookRequest } from './ingest.js';
import { createIngestMetrics } from './metrics.js';
import { MAX_BODY_BYTES } from './config.js';

const BODY = Buffer.from('{"action":"opened","repository":{"id":4021}}', 'utf8');

interface Harness {
  readonly deps: IngestDeps;
  readonly calls: string[];
  readonly logs: LogEntry[];
  readonly archived: ArchiveRecord[];
}

function harness(overrides: Partial<IngestDeps> = {}): Harness {
  const calls: string[] = [];
  const logs: LogEntry[] = [];
  const archived: ArchiveRecord[] = [];

  const archive: ArchiveWriter = {
    append: async (record: ArchiveRecord): Promise<void> => {
      calls.push('archive');
      archived.push(record);
    },
    close: NULL_ARCHIVE_WRITER.close,
  };

  const deps: IngestDeps = {
    verifySignature: (): boolean => {
      calls.push('verifySignature');
      return true;
    },
    parsePayload: (rawBody: Buffer): unknown => {
      calls.push('parsePayload');
      return JSON.parse(rawBody.toString('utf8')) as unknown;
    },
    store: async () => {
      calls.push('store');
      return { duplicate: false };
    },
    enqueue: async (): Promise<void> => {
      calls.push('enqueue');
    },
    archive,
    metrics: createIngestMetrics(),
    maxBodyBytes: MAX_BODY_BYTES,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    newCorrelationId: () => '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
    log: (entry: LogEntry): void => {
      logs.push(entry);
    },
    ...overrides,
  };

  return { deps, calls, logs, archived };
}

const request = (overrides: Partial<WebhookRequest> = {}): WebhookRequest => ({
  rawBody: BODY,
  signature: 'sha256=deadbeef',
  eventType: 'pull_request',
  deliveryId: '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
  ...overrides,
});

describe('보안 문서 9장: 서명 검증이 JSON 파싱보다 먼저 수행된다', () => {
  it('정상 경로의 호출 순서가 검증 → 파싱 → 저장 → 아카이브다', async () => {
    const { deps, calls } = harness();
    await ingestWebhook(deps, request());
    expect(calls).toEqual(['verifySignature', 'parsePayload', 'store', 'enqueue', 'archive']);
  });

  it('서명이 틀리면 파서를 아예 부르지 않는다', async () => {
    const { deps, calls } = harness({ verifySignature: (): boolean => false });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(401);
    expect(calls).toEqual([]);
    expect(calls).not.toContain('parsePayload');
  });

  /**
   * 순서가 뒤바뀌면 이 요청은 파싱 오류로 400/500이 된다. 401이 나온다는 것은
   * 파서가 본문을 보기 전에 서명에서 끊겼다는 뜻이다.
   */
  it('서명이 틀린 깨진 JSON은 파싱 오류가 아니라 401이 된다', async () => {
    const { deps, calls } = harness({ verifySignature: (): boolean => false });
    const outcome = await ingestWebhook(deps, request({ rawBody: Buffer.from('{"action":', 'utf8') }));
    expect(outcome.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('저장에 실패하면 아카이브까지 가지 않는다', async () => {
    const { deps, calls } = harness({
      store: async () => {
        calls.push('store');
        throw new Error('insert failed');
      },
    });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(500);
    expect(calls).toEqual(['verifySignature', 'parsePayload', 'store']);
  });
});

describe('FR-ING-001: 수신 응답과 거부', () => {
  it('유효 서명 요청이 202와 전달 식별자를 돌려준다', async () => {
    const { deps } = harness();
    const outcome = await ingestWebhook(deps, request());
    expect(outcome).toEqual({
      status: 202,
      body: {
        accepted: true,
        delivery_id: '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
        duplicate: false,
      },
    });
  });

  it('AC-2: 서명 불일치는 401이고 저장하지 않으며 거부 지표를 올린다', async () => {
    const { deps, calls } = harness({ verifySignature: (): boolean => false });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(401);
    expect(calls).not.toContain('store');
    expect(deps.metrics.rejected.get({ reason: 'invalid_signature' })).toBe(1);
  });

  it('본문이 없으면 401이다', async () => {
    const { deps } = harness();
    const outcome = await ingestWebhook(deps, request({ rawBody: undefined }));
    expect(outcome.status).toBe(401);
    expect(deps.metrics.rejected.get({ reason: 'missing_body' })).toBe(1);
  });

  it('AC-6: 상한을 넘는 본문은 413이다', async () => {
    const { deps, calls } = harness({ maxBodyBytes: 8 });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(413);
    expect(calls).toEqual(['verifySignature']);
    expect(deps.metrics.rejected.get({ reason: 'payload_too_large' })).toBe(1);
  });

  it('오류 응답에 내부 정보를 담지 않는다', async () => {
    const { deps } = harness({
      store: async () => {
        throw new Error('relation "raw_event" does not exist');
      },
    });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(500);
    expect(JSON.stringify(outcome.body)).not.toContain('raw_event');
    expect(outcome.body).toEqual({ accepted: false, correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8' });
  });

  it('서명은 맞지만 JSON이 깨졌으면 500으로 재전송을 유도한다', async () => {
    const { deps } = harness();
    const outcome = await ingestWebhook(deps, request({ rawBody: Buffer.from('{"action":', 'utf8') }));
    expect(outcome.status).toBe(500);
    expect(deps.metrics.rejected.get({ reason: 'malformed_payload' })).toBe(1);
  });
});

describe('FR-ING-002: 멱등 처리', () => {
  it('AC-2·AC-3: 중복은 202 duplicate true이고 중복 지표가 오른다', async () => {
    const { deps, archived } = harness({ store: async () => ({ duplicate: true }) });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome).toEqual({
      status: 202,
      body: { accepted: true, delivery_id: '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5', duplicate: true },
    });
    expect(deps.metrics.duplicate.get()).toBe(1);
    // 중복은 아카이브에도 다시 쓰지 않는다. 레인 B도 한 번이어야 한다.
    expect(archived).toHaveLength(0);
  });

  it('AC-4: 전달 식별자가 없으면 정규화 해시를 멱등 키로 쓴다', async () => {
    const { deps } = harness();
    const outcome = await ingestWebhook(deps, request({ deliveryId: undefined }));
    expect(outcome.status).toBe(202);
    const body = outcome.body as { delivery_id: string };
    expect(body.delivery_id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('AC-4: 키 순서만 다른 같은 payload는 같은 멱등 키가 된다', async () => {
    const first = await ingestWebhook(
      harness().deps,
      request({ deliveryId: undefined, rawBody: Buffer.from('{"a":1,"b":2}', 'utf8') }),
    );
    const second = await ingestWebhook(
      harness().deps,
      request({ deliveryId: undefined, rawBody: Buffer.from('{"b":2,"a":1}', 'utf8') }),
    );
    expect((first.body as { delivery_id: string }).delivery_id).toBe(
      (second.body as { delivery_id: string }).delivery_id,
    );
  });
});

describe('FR-ING-003 / API-ING-001: 원본 보관과 화이트리스트', () => {
  it('화이트리스트 밖 이벤트도 저장하고 202를 준다', async () => {
    const { deps, calls } = harness();
    const outcome = await ingestWebhook(deps, request({ eventType: 'issue_comment' }));
    expect(outcome.status).toBe(202);
    expect(calls).toContain('store');
    expect(deps.metrics.received.get({ event_type: 'other', supported: 'false' })).toBe(1);
  });

  it('지원 유형은 supported 라벨이 true로 기록된다', async () => {
    const { deps } = harness();
    await ingestWebhook(deps, request({ eventType: 'push' }));
    expect(deps.metrics.received.get({ event_type: 'push', supported: 'true' })).toBe(1);
  });

  it('아카이브에 전달 식별자·유형·payload가 한 줄로 남는다', async () => {
    const { deps, archived } = harness();
    await ingestWebhook(deps, request());
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      delivery_id: '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
      event_type: 'pull_request',
      action: 'opened',
      repository_id: 4021,
      received_at: '2026-08-20T00:00:00.000Z',
    });
  });

  it('아카이브(레인 B) 실패가 202를 막지 않는다', async () => {
    const { deps } = harness({
      archive: {
        append: async (): Promise<void> => {
          throw new Error('disk full');
        },
        close: NULL_ARCHIVE_WRITER.close,
      },
    });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(202);
    expect(deps.metrics.archiveFailed.get()).toBe(1);
  });

  it('큐 enqueue 실패가 202를 막지 않는다 (ADR-002 follow-up)', async () => {
    const { deps, calls } = harness({
      enqueue: async (): Promise<void> => {
        calls.push('enqueue');
        throw new Error('Redis 연결 없음');
      },
    });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(202);
    expect(deps.metrics.enqueueFailed.get()).toBe(1);
    // 발행에 실패해도 아카이브까지 간다. 레인 A와 레인 B는 서로 독립이다.
    expect(calls).toEqual(['verifySignature', 'parsePayload', 'store', 'enqueue', 'archive']);
  });

  it('저장한 행에 아웃박스 표식(queued_at)이 찍힌다 — 재적재의 근거다', async () => {
    let stored: { queued_at?: Date | null } | undefined;
    const { deps } = harness({
      store: async (event) => {
        stored = event;
        return { duplicate: false };
      },
    });
    await ingestWebhook(deps, request());
    expect(stored?.queued_at).toEqual(new Date('2026-08-20T00:00:00.000Z'));
  });

  it('중복은 다시 발행하지 않는다', async () => {
    const { deps, calls } = harness({ store: async () => ({ duplicate: true }) });
    const outcome = await ingestWebhook(deps, request());
    expect(outcome.status).toBe(202);
    expect(calls).not.toContain('enqueue');
  });

  it('구조화 로그에 본문이나 서명이 실리지 않는다 (NFR-005)', async () => {
    const { deps, logs } = harness();
    await ingestWebhook(deps, request());
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('sha256=deadbeef');
    expect(serialized).not.toContain('"action":"opened"');
    expect(logs.at(-1)).toMatchObject({ message: 'webhook accepted', supported: true });
  });
});
