/**
 * 릴리스 투영·비정규화가 실제 Elasticsearch에서 돈다 (WP-024 / CR-028).
 *
 * 단위·통합 계층은 "무엇을 보냈는가"를 대역으로 기록해 확인한다. 여기서 거는
 * 것은 **보낸 것이 진짜 색인에서 받아들여지고, painless가 진짜로 컴파일되어
 * 맞는 문서만 고치는가**다. 특히 셋:
 *
 * 1. `dynamic: strict` 매핑이 릴리스 문서와 비정규화 필드를 받아들이는가 —
 *    매핑에 필드 하나가 빠지면 **모든** 업서트가 거부되는데, 대역은 그것을
 *    영원히 모른다 (DEV-141과 같은 계층의 결함).
 * 2. 비정규화 스크립트가 저장소·브랜치·에폭 경계를 지키는가 (DEV-149).
 * 3. "가장 이른 5개"와 noop 수렴이 painless 안에서 실제로 성립하는가 (DEV-148).
 *
 * 실행: `pnpm test:integration packages/es/integration/releases` (실제 ES 필요)
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMappings } from '../src/bootstrap.js';
import {
  RELEASE_TAGS_LIMIT,
  applyReleaseTagsToDocuments,
  pruneReleaseDocuments,
  releaseDocId,
  upsertReleaseDocuments,
  type ReleaseDocInput,
} from '../src/releases.js';
import { createTestClient, waitForCluster } from './helpers.js';

let es: Client;

const REPOSITORY_ID = 7201;
const OTHER_REPOSITORY_ID = 7202;
const BRANCH = 'main';
const SCOPE = {
  repositoryId: REPOSITORY_ID,
  orgId: 1,
  visibility: 'internal',
  repository: 'acme/payments',
} as const;

function release(tagName: string, mergeSeq: number | null, releasedAt: string): ReleaseDocInput {
  return {
    tagName,
    commitSha: 'ABC123'.padEnd(40, '0'),
    baseBranch: mergeSeq === null ? null : BRANCH,
    seqEpoch: mergeSeq === null ? null : 1,
    mergeSeq,
    releasedAt,
    source: 'git_tag',
    sequenceSpace: mergeSeq === null ? null : 'acme/payments@main',
  };
}

async function releaseDoc(tagName: string): Promise<Record<string, unknown> | undefined> {
  const response = await es.get<Record<string, unknown>>(
    {
      index: 'prs-releases',
      id: releaseDocId(REPOSITORY_ID, tagName),
      routing: String(REPOSITORY_ID),
    },
    { ignore: [404] },
  );
  return response.found === true ? (response._source ?? {}) : undefined;
}

/** 서수를 단 PR·커밋 문서를 심는다 — 비정규화가 고칠 대상이다. */
async function seedSequencedDocs(): Promise<void> {
  const doc = (repositoryId: number, mergeSeq: number | null, seqEpoch: number) => ({
    document_version: 1,
    repository_id: repositoryId,
    base_branch: BRANCH,
    ...(mergeSeq === null ? {} : { merge_seq: mergeSeq, seq_epoch: seqEpoch }),
  });
  const id = (repositoryId: number, key: string) => `${String(repositoryId)}:${key}`;

  await es.bulk({
    refresh: true,
    operations: [
      // 서수 1·3·6 — 릴리스 (2, 5) 기준으로 "둘 다·하나·없음"을 가른다.
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '1'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 1, 1), doc_id: id(REPOSITORY_ID, '1'), pr_number: 1 },
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '3'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 3, 1), doc_id: id(REPOSITORY_ID, '3'), pr_number: 3 },
      // 서수 5 = rel-b의 서수 — 경계는 `<=`다. `<`로 새면 이 문서가 미배포로 뒤집힌다.
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '5'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 5, 1), doc_id: id(REPOSITORY_ID, '5'), pr_number: 5 },
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '6'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 6, 1), doc_id: id(REPOSITORY_ID, '6'), pr_number: 6 },
      // 이전 에폭 문서 — 건드리면 안 된다 (DEV-149).
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '9'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 9, 0), doc_id: id(REPOSITORY_ID, '9'), pr_number: 9 },
      // 서수 없는 문서(열린 PR) — 건드리면 안 된다.
      { index: { _index: 'prs-pull-requests', _id: id(REPOSITORY_ID, '7'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, null, 1), doc_id: id(REPOSITORY_ID, '7'), pr_number: 7 },
      // 다른 저장소의 같은 서수 — 경계 검사.
      { index: { _index: 'prs-pull-requests', _id: id(OTHER_REPOSITORY_ID, '1'), routing: String(OTHER_REPOSITORY_ID) } },
      { ...doc(OTHER_REPOSITORY_ID, 1, 1), doc_id: id(OTHER_REPOSITORY_ID, '1'), pr_number: 1 },
      // 커밋 문서도 같은 짝을 받는다 (W-003의 배지).
      { index: { _index: 'prs-commits', _id: id(REPOSITORY_ID, 'c1'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 1, 1), doc_id: id(REPOSITORY_ID, 'c1'), commit_sha: '1'.repeat(40) },
      { index: { _index: 'prs-commits', _id: id(REPOSITORY_ID, 'c6'), routing: String(REPOSITORY_ID) } },
      { ...doc(REPOSITORY_ID, 6, 1), doc_id: id(REPOSITORY_ID, 'c6'), commit_sha: '6'.repeat(40) },
    ],
  });
}

async function prDoc(number: number): Promise<Record<string, unknown>> {
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-pull-requests',
    id: `${String(REPOSITORY_ID)}:${String(number)}`,
    routing: String(REPOSITORY_ID),
  });
  return response._source ?? {};
}

async function commitDoc(key: string): Promise<Record<string, unknown>> {
  const response = await es.get<Record<string, unknown>>({
    index: 'prs-commits',
    id: `${String(REPOSITORY_ID)}:${key}`,
    routing: String(REPOSITORY_ID),
  });
  return response._source ?? {};
}

/** 시각 오름차순 릴리스 목록 (rel-a=2, rel-b=5). */
const RELEASES_ASC = [
  { tagName: 'rel-a', mergeSeq: 2 },
  { tagName: 'rel-b', mergeSeq: 5 },
] as const;

function denorm(releases: readonly { tagName: string; mergeSeq: number }[]): Promise<number> {
  return applyReleaseTagsToDocuments(es, {
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    releases,
  });
}

beforeAll(async () => {
  es = createTestClient();
  await waitForCluster(es);
  await applyMappings(es);
}, 120_000);

afterAll(async () => {
  await es.close();
});

beforeEach(async () => {
  // 먼저 refresh하고 지운다 — delete_by_query는 검색이다 (sequence.test.ts와 같은 이유).
  await es.indices.refresh({ index: 'prs-commits,prs-pull-requests,prs-releases' });
  await es.deleteByQuery({
    index: 'prs-commits,prs-pull-requests,prs-releases',
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
});

describe('릴리스 문서 투영 (ENT-REL-001)', () => {
  it('**strict 매핑이 릴리스 문서를 받아들이고, 조회로 돌아온다**', async () => {
    const result = await upsertReleaseDocuments(
      es,
      SCOPE,
      [release('v1.0', 2, '2026-08-14T09:00:00Z')],
      1_000,
    );
    expect(result.hasFailures).toBe(false);

    const doc = await releaseDoc('v1.0');
    expect(doc?.['tag_name']).toBe('v1.0');
    expect(doc?.['merge_seq']).toBe(2);
    expect(doc?.['repository_id']).toBe(REPOSITORY_ID);
    // 정본의 SHA가 대문자여도 소문자로 실린다 (조회 규칙과의 일치).
    expect(doc?.['commit_sha']).toBe('abc123'.padEnd(40, '0'));
  });

  it('체인 밖 태그는 서수 셋 **키 자체가 없다** — null 반쪽 상태를 만들지 않는다', async () => {
    await upsertReleaseDocuments(es, SCOPE, [release('off-chain', null, '2026-08-16T09:00:00Z')], 1_000);
    const doc = await releaseDoc('off-chain');
    expect(doc).toBeDefined();
    expect(doc).not.toHaveProperty('base_branch');
    expect(doc).not.toHaveProperty('seq_epoch');
    expect(doc).not.toHaveProperty('merge_seq');
  });

  it('**늦게 도착한 옛 스냅숏이 새 값을 되돌리지 않는다** — document_version=동기화 시각', async () => {
    await upsertReleaseDocuments(es, SCOPE, [release('v1.0', 2, '2026-08-14T09:00:00Z')], 2_000);
    // 같은 태그가 다른 커밋을 가리키던 **옛** 스냅숏의 재생.
    const replay = await upsertReleaseDocuments(
      es,
      SCOPE,
      [{ ...release('v1.0', 9, '2026-08-14T09:00:00Z'), commitSha: 'f'.repeat(40) }],
      1_000,
    );
    expect(replay.hasFailures).toBe(false);
    expect((await releaseDoc('v1.0'))?.['merge_seq']).toBe(2);
  });

  it('**스냅숏 밖 문서가 걷힌다** — 남길 것 목록의 질의 삭제라 놓친 삭제도 다음 회차에 아문다', async () => {
    await upsertReleaseDocuments(
      es,
      SCOPE,
      [release('keep-me', 2, '2026-08-14T09:00:00Z'), release('doomed', 3, '2026-08-15T09:00:00Z')],
      1_000,
    );
    await pruneReleaseDocuments(es, REPOSITORY_ID, ['keep-me']);
    expect(await releaseDoc('doomed')).toBeUndefined();
    expect((await releaseDoc('keep-me'))?.['tag_name']).toBe('keep-me');
  });

  it('남길 것이 없으면 저장소의 릴리스 문서가 전부 걷힌다 — 다른 저장소는 그대로다', async () => {
    await upsertReleaseDocuments(es, SCOPE, [release('only', 1, '2026-08-14T09:00:00Z')], 1_000);
    await upsertReleaseDocuments(
      es,
      { ...SCOPE, repositoryId: OTHER_REPOSITORY_ID },
      [release('other-repo-tag', 1, '2026-08-14T09:00:00Z')],
      1_000,
    );
    await pruneReleaseDocuments(es, REPOSITORY_ID, []);
    expect(await releaseDoc('only')).toBeUndefined();

    const other = await es.get<Record<string, unknown>>(
      {
        index: 'prs-releases',
        id: releaseDocId(OTHER_REPOSITORY_ID, 'other-repo-tag'),
        routing: String(OTHER_REPOSITORY_ID),
      },
      { ignore: [404] },
    );
    expect(other.found).toBe(true);
  });
});

describe('release_tags 비정규화 (DEV-148·149)', () => {
  it('**painless가 실제로 컴파일되고, 서수 경계대로 배지가 갈린다**', async () => {
    await seedSequencedDocs();
    await denorm(RELEASES_ASC);

    // 서수 1 <= 2,5 — 둘 다. 서수 3 <= 5 — 하나. 서수 6 — 없음(미배포).
    expect((await prDoc(1))['release_tags']).toEqual(['rel-a', 'rel-b']);
    expect((await prDoc(1))['unreleased']).toBe(false);
    expect((await prDoc(3))['release_tags']).toEqual(['rel-b']);
    // 릴리스 커밋 자신(서수 5 = rel-b)은 그 릴리스에 포함된다 — 경계는 `<=`다.
    expect((await prDoc(5))['release_tags']).toEqual(['rel-b']);
    expect((await prDoc(5))['unreleased']).toBe(false);
    expect((await prDoc(6))['release_tags']).toEqual([]);
    expect((await prDoc(6))['unreleased']).toBe(true);

    // 커밋 문서도 같은 짝을 받는다 — `unreleased`가 커밋 매핑에도 있어야 한다.
    expect((await commitDoc('c1'))['release_tags']).toEqual(['rel-a', 'rel-b']);
    expect((await commitDoc('c6'))['unreleased']).toBe(true);
  });

  it('**저장소·에폭 경계를 넘지 않는다** — 이전 에폭·다른 저장소·서수 없는 문서는 그대로다', async () => {
    await seedSequencedDocs();
    await denorm(RELEASES_ASC);

    // 이전 에폭(0)의 서수 9 문서 — 새 에폭 릴리스로 배지를 달면 틀린 답이다 (DEV-149).
    expect(await prDoc(9)).not.toHaveProperty('release_tags');
    // 서수 없는 열린 PR.
    expect(await prDoc(7)).not.toHaveProperty('release_tags');
    // 다른 저장소의 같은 서수.
    const other = await es.get<Record<string, unknown>>({
      index: 'prs-pull-requests',
      id: `${String(OTHER_REPOSITORY_ID)}:1`,
      routing: String(OTHER_REPOSITORY_ID),
    });
    expect(other._source).not.toHaveProperty('release_tags');
  });

  it('**가장 이른 5개에서 멈춘다** (데이터 모델 5장, DEV-148)', async () => {
    await seedSequencedDocs();
    const many = Array.from({ length: 8 }, (_, index) => ({
      tagName: `r-${String(index + 1).padStart(2, '0')}`,
      mergeSeq: index + 2, // 전부 서수 1을 포함한다.
    }));
    await denorm(many);

    const tags = (await prDoc(1))['release_tags'];
    expect(tags).toEqual(many.slice(0, RELEASE_TAGS_LIMIT).map((one) => one.tagName));
  });

  it('값이 안 바뀌면 noop이다 — 두 번째 갱신의 updated가 0이다', async () => {
    await seedSequencedDocs();
    await denorm(RELEASES_ASC);
    expect(await denorm(RELEASES_ASC)).toBe(0);
  });

  it('릴리스가 다 지워지면 배지도 미배포로 돌아간다 — 자가 치유의 색인 쪽 절반', async () => {
    await seedSequencedDocs();
    await denorm(RELEASES_ASC);
    await denorm([]);
    expect((await prDoc(1))['release_tags']).toEqual([]);
    expect((await prDoc(1))['unreleased']).toBe(true);
  });
});
