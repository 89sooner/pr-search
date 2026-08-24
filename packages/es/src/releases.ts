/**
 * 릴리스를 색인에 비춘다 (WP-024 / CR-028, DEV-142).
 *
 * PostgreSQL `release`가 정본이고 여기는 **비추기만** 한다 (ADR-004). 포함
 * 판정·앵커 해석은 정본을 읽으므로, 여기서의 실패는 표시가 늦는 것이지
 * 답이 틀리는 것이 아니다 — 다음 갱신 회차가 다시 비춘다.
 */

import type { Client } from '@elastic/elasticsearch';
import { bulkUpsert, type BulkUpsertResult, type UpsertRequest } from './upsert.js';

/** 정본 한 행을 색인 문서로 옮기는 데 필요한 것. */
export interface ReleaseDocInput {
  readonly tagName: string;
  readonly commitSha: string;
  readonly baseBranch: string | null;
  readonly seqEpoch: number | null;
  readonly mergeSeq: number | null;
  readonly releasedAt: string;
  readonly source: string;
  /** 표시용 문자열 (DEV-119). 필터로 쓰지 않는다. */
  readonly sequenceSpace: string | null;
}

export interface ReleaseScope {
  readonly repositoryId: number;
  readonly orgId: number;
  readonly visibility: string;
  readonly repository: string;
}

/** `_id`. PR·커밋 문서와 같은 `{repo}:{key}` 규칙이다. */
export function releaseDocId(repositoryId: number, tagName: string): string {
  return `${String(repositoryId)}:${tagName}`;
}

/**
 * 정본 스냅숏을 색인에 업서트한다.
 *
 * `document_version`은 **동기화 시각**이다. 릴리스 문서는 웹훅이 나르는 엔티티
 * 상태가 아니라 정본 스냅숏의 사본이므로, "나중에 동기화된 스냅숏이 이긴다"가
 * 정확한 버전 의미다 — 늦게 도착한 옛 스냅숏의 재생이 새 값을 되돌리지 않는다.
 */
export async function upsertReleaseDocuments(
  client: Client,
  scope: ReleaseScope,
  releases: readonly ReleaseDocInput[],
  syncedAtMs: number,
): Promise<BulkUpsertResult> {
  if (releases.length === 0) return { outcomes: [], hasFailures: false };

  const requests: UpsertRequest[] = releases.map((release) => ({
    alias: 'prs-releases',
    id: releaseDocId(scope.repositoryId, release.tagName),
    routing: String(scope.repositoryId),
    doc: {
      document_version: syncedAtMs,
      release_id: releaseDocId(scope.repositoryId, release.tagName),
      repository_id: scope.repositoryId,
      org_id: scope.orgId,
      visibility: scope.visibility,
      tag_name: release.tagName,
      display_name: release.tagName,
      commit_sha: release.commitSha.toLowerCase(),
      released_at: release.releasedAt,
      source: release.source,
      indexed_at: new Date(syncedAtMs).toISOString(),
      // 체인 밖 태그는 서수 셋이 함께 없다 — 반쪽 상태를 만들지 않는다.
      ...(release.baseBranch === null ? {} : { base_branch: release.baseBranch }),
      ...(release.seqEpoch === null ? {} : { seq_epoch: release.seqEpoch }),
      ...(release.mergeSeq === null ? {} : { merge_seq: release.mergeSeq }),
      ...(release.sequenceSpace === null ? {} : { sequence_space: release.sequenceSpace }),
    },
  }));

  return bulkUpsert(client, requests);
}

/**
 * 원격에서 지워진 태그의 문서를 지운다 (DEV-143의 삭제 반영).
 *
 * `_id` 직접 삭제다 — 질의 삭제보다 정확하고, 라우팅을 알아 단일 샤드로 간다.
 * 404(이미 없음)는 성공으로 센다: 지우려던 것이 없는 상태가 곧 목표 상태다.
 */
export async function deleteReleaseDocuments(
  client: Client,
  repositoryId: number,
  tagNames: readonly string[],
): Promise<void> {
  if (tagNames.length === 0) return;

  await client.bulk({
    refresh: true,
    operations: tagNames.map((tagName) => ({
      delete: {
        _index: 'prs-releases',
        _id: releaseDocId(repositoryId, tagName),
        routing: String(repositoryId),
      },
    })),
  });
}

/** 비정규화에 쓰는 릴리스 하나. `released_at` 오름차순으로 정렬해 넘긴다. */
export interface DenormRelease {
  readonly tagName: string;
  readonly mergeSeq: number;
}

/** 비정규화 대상 태그 상한. 넘치면 잘라 보내되 **로그로 말한다** — 조용한 절삭 금지. */
export const DENORM_TAG_LIMIT = 1_000;

/** 목록 배지에 담는 릴리스 수 (데이터 모델 5장: 가장 이른 5개, DEV-148). */
export const RELEASE_TAGS_LIMIT = 5;

export interface ApplyReleaseTagsInput {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  /** **`released_at` 오름차순.** 순서가 곧 "가장 이른 5개"의 정의다 (DEV-148). */
  readonly releases: readonly DenormRelease[];
}

/**
 * PR·커밋 문서에 `release_tags`(가장 이른 5개)와 `unreleased`를 붙인다.
 *
 * **표시 전용이다** (DEV-142). 판정의 정본은 PostgreSQL이고, 이 갱신이 늦거나
 * 실패해도 `/containments`의 답은 변하지 않는다 — 다음 갱신 회차가 다시 계산해
 * 수렴한다(전량 재계산이라 멱등).
 *
 * `seq_epoch`까지 거른다 (DEV-149): 재채번 직후 옛 에폭 서수를 단 문서에 새
 * 에폭의 릴리스 목록을 대조하면 틀린 배지가 붙는다. 그런 문서는 에폭 전환
 * 갱신(`applyEpochBump`)이 끝난 다음 회차에 잡힌다.
 */
export async function applyReleaseTagsToDocuments(
  client: Client,
  input: ApplyReleaseTagsInput,
): Promise<number> {
  const releases = input.releases.slice(0, DENORM_TAG_LIMIT);

  let total = 0;
  for (const alias of ['prs-pull-requests', 'prs-commits'] as const) {
    const response = await client.updateByQuery({
      index: alias,
      routing: String(input.repositoryId),
      refresh: true,
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [
            { term: { repository_id: input.repositoryId } },
            { term: { base_branch: input.baseBranch } },
            { term: { seq_epoch: input.seqEpoch } },
            { exists: { field: 'merge_seq' } },
          ],
        },
      },
      script: {
        lang: 'painless',
        /*
         * 문서마다 "나를 포함하는 가장 이른 릴리스 5개"를 계산한다. params가
         * 이미 시각 오름차순이므로 앞에서부터 걷다가 5개에서 멈추면 된다.
         *
         * 값이 안 바뀌면 `noop`으로 끝낸다 — 갱신은 저장소의 문서 전체를
         * 도는데, 실제로 달라지는 것은 새 릴리스보다 앞의 문서뿐이다.
         */
        source:
          'def seq = ctx._source.merge_seq; if (seq == null) { ctx.op = "noop"; return; }' +
          ' def tags = new ArrayList(); for (r in params.releases) {' +
          ' if (seq <= r.seq) { tags.add(r.tag); if (tags.size() >= params.limit) break; } }' +
          ' def unreleased = tags.isEmpty();' +
          ' if (tags.equals(ctx._source.release_tags) && unreleased == ctx._source.unreleased) { ctx.op = "noop"; return; }' +
          ' ctx._source.release_tags = tags; ctx._source.unreleased = unreleased;',
        params: {
          releases: releases.map((release) => ({ tag: release.tagName, seq: release.mergeSeq })),
          limit: RELEASE_TAGS_LIMIT,
        },
      },
    });
    total += Number(response.updated ?? 0);
  }
  return total;
}
