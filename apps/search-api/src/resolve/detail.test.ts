/**
 * 상세 조회의 조인 비용 (WP-067 / CR-038, DEV-211).
 *
 * ## 왜 단위 시험인가
 *
 * "N+1이 아니다"는 **호출 횟수**에 대한 주장이라, 결과만 보는 통합 시험으로는
 * 증명되지 않는다 — 250번 왕복해도 응답 내용은 똑같이 맞다. 조회 횟수를 직접
 * 세는 것이 유일한 방법이다.
 *
 * 계약 자체(어떤 값이 실리는가)는 통합 시험이 실제 Elasticsearch로 판정한다.
 */

import { describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { AccessScope } from '@prs/authz';
import { getPullRequestDetail } from './detail.js';

const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: [1] };

function shaOf(index: number): string {
  return String(index).padStart(40, 'a');
}

/**
 * 조회 횟수를 세는 대역.
 *
 * 실제 응답 모양을 그대로 흉내 낸다 — 대역이 실제보다 관대하면 그만큼이
 * 사각지대다.
 */
function countingEs(shas: readonly string[]): { readonly es: Client; readonly calls: string[] } {
  const calls: string[] = [];
  const es = {
    search: (request: { index?: string }) => {
      const index = String(request.index ?? '');
      calls.push(index);

      if (index === 'prs-pull-requests') {
        return Promise.resolve({
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [
              {
                _source: {
                  repository: 'acme/payments',
                  repository_id: 1,
                  pr_number: 7,
                  source_commit_shas: [...shas],
                  source_commits_truncated: false,
                },
              },
            ],
          },
        });
      }

      return Promise.resolve({
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: shas.length, relation: 'eq' },
          hits: shas.map((sha) => ({
            _source: { commit_sha: sha, message: `subject ${sha}\nbody`, author: 'kim' },
          })),
        },
      });
    },
  } as unknown as Client;
  return { es, calls };
}

describe('PR 상세의 원본 커밋 조인 (CR-038, DEV-211)', () => {
  it('**커밋 250개를 조회 한 번으로 잇는다** — N+1이 아니다', async () => {
    const shas = Array.from({ length: 250 }, (_, index) => shaOf(index));
    const { es, calls } = countingEs(shas);

    const detail = await getPullRequestDetail('acme/payments', 7, SCOPE, { es });

    // PR 문서 1회 + 커밋 문서 1회. 커밋 수에 비례해 늘지 않는다.
    expect(calls).toEqual(['prs-pull-requests', 'prs-commits']);
    expect(calls.filter((index) => index === 'prs-commits')).toHaveLength(1);

    const items = detail?.['source_commits'] as Record<string, unknown>[];
    expect(items).toHaveLength(250);
    expect(items[0]?.['message']).toBe(`subject ${shaOf(0)}`);
    expect(items[0]?.['author']).toBe('kim');
  });

  it('원본 커밋이 없으면 커밋 조회를 아예 하지 않는다', async () => {
    const { es, calls } = countingEs([]);
    await getPullRequestDetail('acme/payments', 7, SCOPE, { es });
    expect(calls).toEqual(['prs-pull-requests']);
  });
});
