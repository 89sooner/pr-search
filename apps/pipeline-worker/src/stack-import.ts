/**
 * 배포 전 스택 간선의 일회성 가져오기 (WP-104 / CR-121, FR-REL-006 AC-6, OD-017).
 *
 * ## 왜 필요한가
 *
 * CR-121 전에는 스택의 성립·해제가 Elasticsearch 간선에만 있었다. 이제 정본은 PostgreSQL
 * (`pull_request_stack`)이고 간선은 그 표에서 파생하지만, **배포 전에 이미 해제된 관계**는 현재
 * 스냅숏에서 다시 보이지 않는다(상위 PR 병합·하위 PR retarget). 그것을 옮기지 않은 채 prs-links를
 * 재색인하면 그 이력이 새 인덱스에서 사라진다. 그래서 서비스 인덱스의 `stacks_on` 간선을 **한 번**
 * 표로 옮긴다 — ES에서 PG로 가는 유일한 경로이며, 사용자가 이 방향을 한 번만 허용했다(OD-017).
 *
 * ## 규칙
 *
 * - **파생 행을 덮지 않는다** — 이미 있는 관계는 정본이 이긴다. 두 번 돌려도 같은 표다.
 * - **형식이 맞는 간선만 옮긴다** — 문서 ID가 `{저장소}:{PR 번호}`이고, 두 끝이 같은 저장소이며,
 *   근거·시각이 문자열인 것. 나머지는 세기만 하고 버리지 않는다(서비스 인덱스는 그대로다).
 * - **아무것도 지우지 않는다.** 서비스 인덱스도, 표도.
 */

import { prStackRepo, type Pool, type RepositoryRow, type StackImport } from '@prs/db';
import { LINKS_ALIAS } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

export interface StackImportDeps {
  readonly pool: Pool;
  readonly es: Client;
}

export interface StackImportResult {
  /** 서비스 인덱스에서 읽은 `stacks_on` 간선. */
  readonly scanned: number;
  /** 표에 새로 들어간(`--dry-run`이면 들어갈) 행. */
  readonly inserted: number;
  /** 이미 표에 있던 행 — 파생이 먼저 만들었거나 앞선 가져오기가 옮겼다. */
  readonly existing: number;
  /** 형식이 맞지 않아 옮기지 않은 간선. */
  readonly invalid: number;
}

const READ_PAGE = 1000;
const WRITE_BATCH = 500;

interface StoredStack {
  readonly from_id?: unknown;
  readonly to_id?: unknown;
  readonly to_repository_id?: unknown;
  readonly repository_id?: unknown;
  readonly evidence?: unknown;
  readonly created_at?: unknown;
  readonly detached?: unknown;
}

/** `{저장소}:{PR 번호}`에서 번호. 형식이 다르면 `undefined`다. */
function prNumberOf(repositoryId: number, docId: unknown): number | undefined {
  if (typeof docId !== 'string') return undefined;
  const prefix = `${String(repositoryId)}:`;
  if (!docId.startsWith(prefix)) return undefined;
  const key = docId.slice(prefix.length);
  if (!/^\d+$/.test(key)) return undefined;
  const number = Number(key);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function toImport(repositoryId: number, doc: StoredStack): StackImport | undefined {
  const child = prNumberOf(repositoryId, doc.from_id);
  const parent = prNumberOf(repositoryId, doc.to_id);
  if (child === undefined || parent === undefined || child === parent) return undefined;
  if (Number(doc.repository_id) !== repositoryId || Number(doc.to_repository_id) !== repositoryId) return undefined;
  if (typeof doc.evidence !== 'string' || typeof doc.created_at !== 'string') return undefined;
  // 스택 간선은 늘 `detached`를 싣는다(DEV-238) — 없으면 형식 오류다.
  if (typeof doc.detached !== 'boolean') return undefined;
  return {
    repositoryId,
    childPrNumber: child,
    parentPrNumber: parent,
    evidence: doc.evidence,
    edgeCreatedAt: doc.created_at,
    detached: doc.detached,
  };
}

/** 서비스 인덱스의 한 저장소 `stacks_on` 간선을 끝까지 읽는다. */
async function readServingStacks(es: Client, repositoryId: number): Promise<readonly StoredStack[]> {
  const out: StoredStack[] = [];
  let after: unknown[] | undefined;
  for (;;) {
    const response = await es.search<StoredStack>({
      index: LINKS_ALIAS,
      routing: String(repositoryId),
      size: READ_PAGE,
      _source: ['from_id', 'to_id', 'to_repository_id', 'repository_id', 'evidence', 'created_at', 'detached'],
      sort: [{ link_id: 'asc' }],
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }, { term: { link_type: 'stacks_on' } }] } },
      ...(after === undefined ? {} : { search_after: after as never }),
    });
    const hits = response.hits.hits;
    for (const hit of hits) if (hit._source !== undefined) out.push(hit._source);
    if (hits.length < READ_PAGE) return out;
    const last = hits[hits.length - 1];
    if (last?.sort === undefined) return out;
    after = last.sort;
  }
}

/**
 * 한 저장소의 서비스 `stacks_on` 간선을 스택 정본으로 옮긴다. `dryRun`이면 세기만 한다.
 */
export async function importServingStacks(
  deps: StackImportDeps,
  repository: RepositoryRow,
  options: { readonly dryRun: boolean },
): Promise<StackImportResult> {
  const repositoryId = Number(repository.repository_id);
  const stored = await readServingStacks(deps.es, repositoryId);
  const rows: StackImport[] = [];
  let invalid = 0;
  for (const doc of stored) {
    const row = toImport(repositoryId, doc);
    if (row === undefined) invalid += 1;
    else rows.push(row);
  }

  let inserted = 0;
  let existing = 0;
  for (let offset = 0; offset < rows.length; offset += WRITE_BATCH) {
    const batch = rows.slice(offset, offset + WRITE_BATCH);
    if (options.dryRun) {
      const found = await prStackRepo.findExistingPairs(
        deps.pool,
        repositoryId,
        batch.map((one) => ({ child: one.childPrNumber, parent: one.parentPrNumber })),
      );
      const present = batch.filter((one) => found.has(`${String(one.childPrNumber)}:${String(one.parentPrNumber)}`)).length;
      existing += present;
      inserted += batch.length - present;
      continue;
    }
    const result = await prStackRepo.importStacks(deps.pool, batch);
    inserted += result.inserted;
    existing += result.existing;
  }
  return { scanned: stored.length, inserted, existing, invalid };
}
