/**
 * GHE 저장소 조회 어댑터 (FR-ING-009 예외 처리).
 *
 * `GitHubClient`를 `ops` 모듈이 쓰는 좁은 포트로 옮긴다. 등록 로직이 토큰
 * 풀·스케줄러·rate limit을 알 필요는 없다 — 그것들은 `@prs/github`이 이미
 * 계약 시험으로 덮고 있다.
 *
 * **404와 403을 구분하지 않는다.** GitHub은 권한 없는 저장소를 404로 감추므로
 * 둘을 가르려는 시도 자체가 추측이 된다. 어느 쪽이든 "이 설치로는 볼 수 없다"가
 * 사실이고, 등록을 거부하며 필요한 권한을 알려 주는 대응도 같다.
 */

import { GitHubApiError, resolveVisibility, type GitHubClient } from '@prs/github';
import type { GheRepositoryFacts, GheRepositoryLookup } from './repositories.js';

export function createGheLookup(
  client: GitHubClient,
  installationFor: (org: string) => number | undefined,
): GheRepositoryLookup {
  return async (owner: string, name: string): Promise<GheRepositoryFacts | null> => {
    // 설치가 없으면 호출해 봐야 인증 실패다. HTTP까지 가지 않는다.
    if (installationFor(owner) === undefined) return null;

    try {
      const summary = await client.getRepository({ owner, repo: name });
      return {
        repository_id: summary.id,
        org_id: summary.owner.id,
        visibility: resolveVisibility(summary),
        default_branch: summary.default_branch,
      };
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 403 || error.status === 404)) {
        return null;
      }
      // 그 밖의 오류는 "접근 권한 없음"이 아니다. 5xx나 타임아웃을 403으로
      // 옮기면 일시적 장애가 영구적 거부처럼 보인다.
      throw error;
    }
  };
}
