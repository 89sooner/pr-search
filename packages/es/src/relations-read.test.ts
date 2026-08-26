/**
 * 관계 간선 조회 계층 (WP-031 / CR-042).
 *
 * 실 Elasticsearch 동작은 `apps/search-api/integration/relations/`가 건다.
 * 여기서 거는 것은 **질의의 모양과 실패 처분** — 대역으로만 만들 수 있는 상태다.
 */

import { describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { PartialSearchError } from './sort.js';
import {
  RELATION_LIMIT_DEFAULT,
  RELATION_LIMIT_MAX,
  clampRelationLimit,
  searchRelationLinks,
} from './relations-read.js';

interface Captured {
  readonly index?: unknown;
  readonly routing?: unknown;
  readonly size?: unknown;
  readonly sort?: unknown;
  readonly query?: unknown;
}

/**
 * 대역. **클래스를 스프레드하지 않는다** — 프로토타입 메서드가 사라진다
 * (risks 18). 필요한 것만 명시적으로 준다.
 */
function stubClient(options: {
  readonly hits?: number;
  readonly failedShards?: number;
  readonly seen?: Captured[];
}): Client {
  const total = options.hits ?? 0;
  return {
    search: (request: Captured) => {
      options.seen?.push(request);
      return Promise.resolve({
        _shards: { failed: options.failedShards ?? 0, total: 12, successful: 12, skipped: 0 },
        hits: {
          hits: Array.from({ length: total }, (_, i) => ({
            _source: {
              link_id: `l${String(i).padStart(3, '0')}`,
              link_type: 'references',
              repository_id: 1,
              confidence: 'derived',
              evidence: 'e',
              resolved: true,
            },
          })),
        },
      });
    },
  } as unknown as Client;
}

const INPUT = {
  scope: { kind: 'explicit', repositoryIds: [4021] } as const,
  linkType: 'references',
  direction: 'incoming' as const,
  anchorKind: 'pull_request' as const,
  anchorDocId: '4021:1234',
};

describe('부분 결과 처분 (PR #47 리뷰 P1)', () => {
  it('**샤드가 실패하면 던진다** — 짧아진 목록을 정상 응답으로 내지 않는다', async () => {
    await expect(
      searchRelationLinks(stubClient({ hits: 3, failedShards: 1 }), INPUT),
    ).rejects.toBeInstanceOf(PartialSearchError);
  });

  it('샤드가 온전하면 던지지 않는다', async () => {
    const page = await searchRelationLinks(stubClient({ hits: 3 }), INPUT);
    expect(page.items).toHaveLength(3);
  });

  it('부분 결과를 `truncated: false`와 함께 내보내지 않는다 — 그 조합이 거짓말이다', async () => {
    // 상한보다 적은 hits + 샤드 실패. 검사가 없으면 truncated:false로 조용히 나간다.
    await expect(
      searchRelationLinks(stubClient({ hits: 2, failedShards: 4 }), { ...INPUT, limit: 50 }),
    ).rejects.toBeInstanceOf(PartialSearchError);
  });
});

describe('질의의 모양', () => {
  it('**라우팅을 쓰지 않는다** — 저장소를 건너뛰는 참조를 놓친다 (DEV-250)', async () => {
    const seen: Captured[] = [];
    await searchRelationLinks(stubClient({ hits: 0, seen }), INPUT);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('routing');
  });

  it('`limit + 1`을 읽어 상한을 넘는지 판정한다 (DEV-252)', async () => {
    const seen: Captured[] = [];
    await searchRelationLinks(stubClient({ hits: 0, seen }), { ...INPUT, limit: 7 });
    expect(seen[0]?.size).toBe(8);
  });

  it('상한을 넘으면 `truncated: true`이고 항목은 `limit`개다', async () => {
    const page = await searchRelationLinks(stubClient({ hits: 8 }), { ...INPUT, limit: 7 });
    expect(page.items).toHaveLength(7);
    expect(page.truncated).toBe(true);
  });

  it('상한 안이면 `truncated: false`다', async () => {
    const page = await searchRelationLinks(stubClient({ hits: 5 }), { ...INPUT, limit: 7 });
    expect(page.truncated).toBe(false);
  });

  it('`link_id` 오름차순으로 정렬한다 — 같은 정본에서 같은 페이지 (ADR-004)', async () => {
    const seen: Captured[] = [];
    await searchRelationLinks(stubClient({ hits: 0, seen }), INPUT);
    expect(seen[0]?.sort).toEqual([{ link_id: 'asc' }]);
  });
});

describe('clampRelationLimit', () => {
  it('없으면 기본값', () => {
    expect(clampRelationLimit(undefined)).toBe(RELATION_LIMIT_DEFAULT);
  });
  it('상한을 넘으면 깎는다 — 거절하지 않는다', () => {
    expect(clampRelationLimit(5_000)).toBe(RELATION_LIMIT_MAX);
  });
  it('1 미만은 1이다', () => {
    expect(clampRelationLimit(0)).toBe(1);
    expect(clampRelationLimit(-3)).toBe(1);
  });
  it('유한하지 않으면 기본값 — NaN을 size로 넘기지 않는다', () => {
    expect(clampRelationLimit(Number.NaN)).toBe(RELATION_LIMIT_DEFAULT);
    expect(clampRelationLimit(Number.POSITIVE_INFINITY)).toBe(RELATION_LIMIT_DEFAULT);
  });
  it('소수는 내림한다', () => {
    expect(clampRelationLimit(7.9)).toBe(7);
  });
});
