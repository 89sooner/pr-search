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

/*
 * 실제 웹훅은 `repository.full_name`을 언제나 담는다. 이전 픽스처는 `id`만
 * 담았고, 그래서 아카이브 레코드의 `repository`를 `null`로 고정하는 변이가
 * **살아남았다** — 픽스처가 실제보다 빈약하면 그만큼이 사각지대다.
 */
const BODY = Buffer.from(
  '{"action":"opened","repository":{"id":4021,"full_name":"acme/payments"}}',
  'utf8',
);

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
    droppedSegments: NULL_ARCHIVE_WRITER.droppedSegments,
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
    publishPermissionInvalidation: async (): Promise<void> => {
      calls.push('permission');
    },
    publishSequenceRequest: async (): Promise<void> => {
      calls.push('sequence');
    },
    publishReleaseRequest: async (): Promise<void> => {},
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
      // 저장소를 **두 형태로** 담는다 (CR-052, DEV-366). `repository_id`는 접근
      // 범위 필터의 재료이고 `repository`는 조사자가 읽는 값이며, 하나만 담으면
      // 각각 필터를 걸 수 없거나 저장소를 알아볼 수 없다.
      repository: 'acme/payments',
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
        droppedSegments: NULL_ARCHIVE_WRITER.droppedSegments,
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

describe('EVT-AUTH-001: 권한 캐시 무효화 발행 (CR-015, DEV-042)', () => {
  const memberBody = Buffer.from(
    JSON.stringify({
      action: 'removed',
      member: { login: 'kim', id: 501 },
      repository: { id: 4021 },
      organization: { login: 'acme', id: 1 },
    }),
  );

  it('`member` 이벤트에서 발행한다', async () => {
    const published: unknown[] = [];
    const { deps } = harness({
      publishPermissionInvalidation: async (target): Promise<void> => {
        published.push(target);
      },
    });

    await ingestWebhook(deps, request({ eventType: 'member', rawBody: memberBody }));
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ reason: 'member', githubUserIds: [501], logins: ['kim'] });
  });

  it('`team`·`repository` 이벤트에서도 발행한다', async () => {
    for (const [eventType, body, expected] of [
      ['team', { team: { id: 77, slug: 'core' }, organization: { login: 'acme', id: 1 } }, { teamId: 77 }],
      ['repository', { action: 'privatized', repository: { id: 4021 } }, { repositoryId: 4021 }],
    ] as const) {
      const published: unknown[] = [];
      const { deps } = harness({
        publishPermissionInvalidation: async (target): Promise<void> => {
          published.push(target);
        },
      });

      await ingestWebhook(deps, request({ eventType, rawBody: Buffer.from(JSON.stringify(body)) }));
      expect(published[0]).toMatchObject(expected);
    }
  });

  it('PR 이벤트에서는 발행하지 않는다', async () => {
    const { deps, calls } = harness();
    await ingestWebhook(deps, request());
    expect(calls).not.toContain('permission');
  });

  it('게이트웨이가 팀을 구성원으로 펼치지 않는다 (NFR-002 수신 p95 300ms)', async () => {
    const published: { githubUserIds: readonly number[] }[] = [];
    const { deps } = harness({
      publishPermissionInvalidation: async (target): Promise<void> => {
        published.push(target);
      },
    });

    await ingestWebhook(
      deps,
      request({
        eventType: 'team',
        rawBody: Buffer.from(JSON.stringify({ team: { id: 77, slug: 'core' } })),
      }),
    );
    // 펼치려면 GHE 동기 호출이 필요하고, 그것이 수신 응답 시간을 무너뜨린다.
    expect(published[0]?.githubUserIds).toEqual([]);
  });

  it('발행이 실패해도 202를 막지 않고 오류로 남긴다', async () => {
    const { deps, logs } = harness({
      publishPermissionInvalidation: async (): Promise<void> => {
        throw new Error('Redis 연결 없음');
      },
    });

    const outcome = await ingestWebhook(deps, request({ eventType: 'member', rawBody: memberBody }));
    expect(outcome.status).toBe(202);
    expect(logs.some((entry) => entry.reason === 'permission_publish_failed')).toBe(true);
  });

  it('중복 전달은 다시 발행하지 않는다', async () => {
    const { deps, calls } = harness({ store: async () => ({ duplicate: true }) });
    await ingestWebhook(deps, request({ eventType: 'member', rawBody: memberBody }));
    expect(calls).not.toContain('permission');
  });

  it('모양이 다른 payload에서는 발행하지 않는다 — 빈 무효화를 만들지 않는다', async () => {
    const { deps, calls } = harness();
    await ingestWebhook(
      deps,
      request({ eventType: 'member', rawBody: Buffer.from(JSON.stringify({ action: 'added' })) }),
    );
    expect(calls).not.toContain('permission');
  });
});

describe('EVT-REL-001: 릴리스 갱신 신호 발행 (WP-024 / CR-028, DEV-144·145)', () => {
  const tagPushBody = Buffer.from(
    JSON.stringify({ ref: 'refs/tags/v1.2.0', repository: { id: 4021 } }),
  );

  it('**태그 push에서 발행한다** — 채번(5c)이 skip하는 바로 그 이벤트다', async () => {
    const published: unknown[] = [];
    const { deps } = harness({
      publishReleaseRequest: async (signal, correlationId): Promise<void> => {
        published.push({ signal, correlationId });
      },
    });

    await ingestWebhook(deps, request({ eventType: 'push', rawBody: tagPushBody }));
    expect(published).toEqual([
      {
        signal: { repositoryId: 4021 },
        correlationId: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
      },
    ]);
  });

  it('브랜치 push에서는 발행하지 않는다 — push마다 전량 diff를 돌리지 않는다', async () => {
    const published: unknown[] = [];
    const { deps } = harness({
      publishReleaseRequest: async (signal): Promise<void> => {
        published.push(signal);
      },
    });

    await ingestWebhook(
      deps,
      request({
        eventType: 'push',
        rawBody: Buffer.from(JSON.stringify({ ref: 'refs/heads/main', repository: { id: 4021 } })),
      }),
    );
    expect(published).toEqual([]);
  });

  it('**발행이 실패해도 202다** — 다음 신호나 6시간 스윕이 같은 결과에 도달한다', async () => {
    const { deps, logs } = harness({
      publishReleaseRequest: async (): Promise<void> => {
        throw new Error('Redis 연결 없음');
      },
    });

    const outcome = await ingestWebhook(deps, request({ eventType: 'push', rawBody: tagPushBody }));
    expect(outcome.status).toBe(202);
    expect(deps.metrics.releasePublishFailed.get()).toBe(1);
    expect(logs.some((entry) => entry.reason === 'release_publish_failed')).toBe(true);
  });

  it('발행이 실패해도 아카이브(레인 B)는 그대로 돈다', async () => {
    const { deps, archived } = harness({
      publishReleaseRequest: async (): Promise<void> => {
        throw new Error('발행 실패');
      },
    });

    await ingestWebhook(deps, request({ eventType: 'push', rawBody: tagPushBody }));
    expect(archived).toHaveLength(1);
  });

  it('중복 전달은 다시 발행하지 않는다', async () => {
    const published: unknown[] = [];
    const { deps } = harness({
      store: async () => ({ duplicate: true }),
      publishReleaseRequest: async (signal): Promise<void> => {
        published.push(signal);
      },
    });

    await ingestWebhook(deps, request({ eventType: 'push', rawBody: tagPushBody }));
    expect(published).toEqual([]);
  });
});
