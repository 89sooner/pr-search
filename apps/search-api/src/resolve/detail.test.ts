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

/**
 * PR 문서의 원시 목록과 커밋 문서의 연결 PR을 함께 흉내 내는 대역 (CR-117).
 *
 * `numbers`가 `undefined`인 커밋은 `pull_request_numbers` 필드가 없는 문서(아직 투영 전)이고,
 * `missing`인 커밋은 문서 자체가 없다.
 */
function linkedEs(
  prNumber: number,
  commits: readonly { readonly sha: string; readonly numbers?: readonly number[]; readonly missing?: boolean }[],
  options: { readonly truncated?: boolean } = {},
): Client {
  return {
    search: (request: { index?: string; _source?: readonly string[] }) => {
      if (String(request.index) === 'prs-pull-requests') {
        return Promise.resolve({
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [
              {
                _source: {
                  repository: 'acme/payments',
                  repository_id: 1,
                  pr_number: prNumber,
                  source_commit_shas: commits.map((commit) => commit.sha),
                  source_commits_truncated: options.truncated === true,
                },
              },
            ],
          },
        });
      }
      // 조인 조회가 연결 PR을 함께 읽는지도 여기서 본다 — 읽지 않으면 필터가 늘 「모름」으로 통과시킨다.
      const asked = new Set(request._source ?? []);
      const present = commits.filter((commit) => commit.missing !== true);
      return Promise.resolve({
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: present.length, relation: 'eq' },
          hits: present.map((commit) => ({
            _source: {
              commit_sha: commit.sha,
              ...(commit.numbers !== undefined && asked.has('pull_request_numbers') ? { pull_request_numbers: [...commit.numbers] } : {}),
            },
          })),
        },
      });
    },
  } as unknown as Client;
}

describe('원본 커밋은 그 PR이 새로 가져온 커밋이다 (CR-117 / FR-SRCH-003 AC-5)', () => {
  it('**연결 PR에 이 PR이 없는 커밋은 뺀다** — `git merge dev`로 받아 온 dev 체인 커밋', async () => {
    const own1 = shaOf(1);
    const own2 = shaOf(2);
    const devCommit = shaOf(3); // 다른 PR(#1671)이 dev에 올린 머지 커밋
    const directPush = shaOf(4); // dev에 직접 푸시된 커밋 — 연결 없음(`[]`)도 사실이다
    const es = linkedEs(983, [
      { sha: own1, numbers: [983] },
      { sha: devCommit, numbers: [1671] },
      { sha: own2, numbers: [983, 2001] },
      { sha: directPush, numbers: [] },
    ]);

    const detail = await getPullRequestDetail('acme/payments', 983, SCOPE, { es });

    const items = (detail?.['source_commits'] as Record<string, unknown>[]).map((item) => item['commit_sha']);
    expect(items).toEqual([own1, own2]);
    expect(detail?.['source_commits_excluded']).toBe(2);
    // 총계는 뺀 뒤 남은 수다. 원시 목록 길이(4)를 두면 목록과 총계가 다른 것을 센다.
    expect(detail?.['source_commits_total']).toBe(2);
  });

  it('**모름은 빼지 않는다** — 연결이 아직 투영되지 않았거나 문서가 없으면 원본 커밋으로 둔다', async () => {
    const notProjected = shaOf(5);
    const noDocument = shaOf(6);
    const es = linkedEs(983, [{ sha: notProjected }, { sha: noDocument, missing: true }]);

    const detail = await getPullRequestDetail('acme/payments', 983, SCOPE, { es });

    expect((detail?.['source_commits'] as Record<string, unknown>[]).map((item) => item['commit_sha'])).toEqual([notProjected, noDocument]);
    // 뺀 것이 없다는 것도 사실이다 — 키를 빼지 않고 0을 싣는다.
    expect(detail?.['source_commits_excluded']).toBe(0);
  });

  it('절삭된 목록에서도 읽은 범위 안에서 빼고, 총계는 여전히 모른다', async () => {
    const es = linkedEs(983, [{ sha: shaOf(7), numbers: [983] }, { sha: shaOf(8), numbers: [1671] }], { truncated: true });

    const detail = await getPullRequestDetail('acme/payments', 983, SCOPE, { es });

    expect(detail?.['source_commits_excluded']).toBe(1);
    expect(detail).not.toHaveProperty('source_commits_total');
    expect(detail?.['source_commits_truncated']).toBe(true);
  });
});
