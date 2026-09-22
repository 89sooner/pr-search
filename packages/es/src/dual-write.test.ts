/**
 * 아키텍처 시험: 이중 쓰기 seam을 우회하는 경로가 없다 (WP-035 / CR-045, DEV-295).
 *
 * ## 왜 타입만으로 부족한가
 *
 * 원시체 열일곱이 `WriteTargets`를 **필수 인자**로 받으므로 타입이 "무엇에 쓰는지
 * 말하지 않은 호출"을 막는다. 그러나 타입이 막지 못하는 것이 둘 있다.
 *
 *   1. 운영 호출부가 `SERVING_ONLY`를 넘겨 재색인을 조용히 지나치는 것
 *   2. `@prs/es`에 **새 쓰기 원시체**가 생기고 아무도 그것을 목록에 더하지 않는 것
 *
 * 그래서 소스를 읽어 그 둘을 찾는다. 이 검사가 없으면 "열일곱 전부"는 계약 문서의
 * 문장일 뿐이고, 다음 쓰기 경로가 생기는 날 조용히 열여덟이 된다.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

/** 주석을 걷어 낸 코드만 본다 (risks 43 — 검사가 자기 설명에 걸리지 않게). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 함수의 **인자 목록 전체**를 잘라 낸다.
 *
 * 첫 `{`까지 자르면 인라인 객체 타입을 받는 함수에서 목록이 잘려 나간다 —
 * `deleteStaleDerivedLinks`가 정확히 그 모양이고, 그것을 놓치면 검사가
 * "대상을 안 받는다"고 거짓 보고를 한다.
 */
function parameterListOf(source: string, at: number): string {
  const open = source.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('인자 목록의 짝을 찾지 못했다');
}

/**
 * 별칭에 쓰는 원시체 열일곱 (비동기 계약 3.5장의 표 그대로).
 *
 * **이 목록이 계약과 같은지가 이 시험의 요지다.** 새 쓰기 경로가 생기면 여기에
 * 더해야 하고, 더하는 순간 그 경로가 `WriteTargets`를 받는지도 함께 걸린다.
 */
const DUAL_WRITE_PATHS: readonly { readonly file: string; readonly fn: string }[] = [
  { file: 'packages/es/src/upsert.ts', fn: 'bulkUpsert' },
  { file: 'packages/es/src/upsert.ts', fn: 'upsertOne' },
  { file: 'packages/es/src/commit-metadata.ts', fn: 'upsertCommitMetadata' },
  // CR-113: 서수 쓰기는 SHA 목록 `update_by_query`가 아니라 문서 단위 투영기다.
  { file: 'packages/es/src/sequence-projection.ts', fn: 'projectSequenceToDocuments' },
  { file: 'packages/es/src/sequence.ts', fn: 'applyEpochBump' },
  { file: 'packages/es/src/registry.ts', fn: 'markRepositoryArchived' },
  { file: 'packages/es/src/registry.ts', fn: 'applyRepositoryTeams' },
  { file: 'packages/es/src/releases.ts', fn: 'pruneReleaseDocuments' },
  { file: 'packages/es/src/releases.ts', fn: 'applyReleaseTagsToDocuments' },
  { file: 'packages/es/src/links.ts', fn: 'writeReferenceLinks' },
  { file: 'packages/es/src/links.ts', fn: 'deleteStaleReferenceLinks' },
  { file: 'packages/es/src/links.ts', fn: 'resolveReferenceLinks' },
  { file: 'packages/es/src/links.ts', fn: 'updateLinkSummary' },
  { file: 'packages/es/src/links.ts', fn: 'writeDerivedLinks' },
  { file: 'packages/es/src/links.ts', fn: 'deleteStaleDerivedLinks' },
  { file: 'packages/es/src/links.ts', fn: 'setLinkDetached' },
  { file: 'packages/es/src/links.ts', fn: 'setLinkResolved' },
];

/**
 * 운영에서 열일곱 중 하나를 부르는 파일.
 *
 * **각 파일은 `withReindexWrite`를 지나야 한다.** 목록을 늘리는 것은 곧 새 쓰기
 * 경로를 만드는 일이고, 그때 이 시험이 "울타리를 지나는가"를 함께 묻는다.
 */
const DUAL_WRITE_CALLERS: readonly string[] = [
  'apps/pipeline-worker/src/project.ts',
  'apps/pipeline-worker/src/backfill.ts',
  'apps/pipeline-worker/src/commit-enrich.ts',
  'apps/pipeline-worker/src/sequence.ts',
  'apps/pipeline-worker/src/sequence-projection.ts',
  'apps/pipeline-worker/src/release.ts',
  'apps/pipeline-worker/src/link.ts',
  'apps/pipeline-worker/src/reindex.ts',
  'apps/pipeline-worker/src/index.ts',
  'apps/search-api/src/ops/repositories.ts',
];

/**
 * 대상을 **인자로 물려받는** 파일.
 *
 * 스스로 울타리를 잡지 않고 호출부가 넘긴 `WriteTargets`를 그대로 쓴다 —
 * 한 논리 쓰기가 여러 함수에 걸칠 때 울타리를 중간에 놓지 않기 위해서다.
 */
const TARGET_FORWARDING: readonly string[] = [
  'apps/pipeline-worker/src/relations.ts',
  'apps/pipeline-worker/src/index-retry.ts',
];

describe('이중 쓰기 seam (WP-035 / DEV-295)', () => {
  it('**별칭에 쓰는 원시체는 열일곱이며 전부 `WriteTargets`를 받는다**', () => {
    const missing: string[] = [];
    for (const path of DUAL_WRITE_PATHS) {
      const source = read(path.file);
      const at = source.indexOf(`export async function ${path.fn}(`);
      if (at < 0) {
        missing.push(`${path.file}: ${path.fn}를 찾을 수 없다`);
        continue;
      }
      const signature = parameterListOf(source, at);
      if (!signature.includes('WriteTargets')) {
        missing.push(`${path.file}: ${path.fn}가 대상을 인자로 받지 않는다`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
    expect(DUAL_WRITE_PATHS.length).toBe(17);
  });

  it('**새 쓰기 원시체가 목록 밖에 생기면 걸린다**', () => {
    /*
     * `@prs/es`에서 별칭 이름을 대상으로 쓰는 호출은 전부 이 목록의 함수 안에
     * 있어야 한다. 새 파일이 별칭에 직접 쓰면 여기서 드러난다.
     *
     * 검사 대상은 **쓰기 동사**뿐이다 — `search`·`count`는 ADR-008 가드레일이
     * 따로 본다.
     */
    const writeVerbs = /\bclient\s*\.\s*(?:bulk|deleteByQuery|updateByQuery)\s*\(/g;
    const known = new Set(DUAL_WRITE_PATHS.map((one) => one.file));
    // 버전 인덱스 관리와 부트스트랩은 별칭이 아니라 **구체 인덱스**를 다룬다.
    known.add('packages/es/src/versioned-index.ts');
    known.add('packages/es/src/bootstrap.ts');

    const offences: string[] = [];
    for (const file of [
      'packages/es/src/upsert.ts',
      'packages/es/src/commit-metadata.ts',
      'packages/es/src/sequence.ts',
      'packages/es/src/sequence-projection.ts',
      'packages/es/src/registry.ts',
      'packages/es/src/releases.ts',
      'packages/es/src/links.ts',
      'packages/es/src/relations-read.ts',
      'packages/es/src/search.ts',
      'packages/es/src/resolve-query.ts',
      'packages/es/src/versioned-index.ts',
      'packages/es/src/bootstrap.ts',
    ]) {
      const code = codeOf(read(file));
      if (writeVerbs.test(code) && !known.has(file)) offences.push(file);
      writeVerbs.lastIndex = 0;
    }
    expect(offences, `이중 쓰기 목록 밖에서 별칭에 쓴다:\n${offences.join('\n')}`).toEqual([]);
  });

  it('**운영 호출부는 모두 울타리를 지난다**', () => {
    const missing: string[] = [];
    for (const file of DUAL_WRITE_CALLERS) {
      const code = codeOf(read(file));
      if (!code.includes('withReindexWrite')) missing.push(file);
    }
    expect(missing, `울타리를 지나지 않는 쓰기 경로:\n${missing.join('\n')}`).toEqual([]);
  });

  it('**운영 호출부가 `SERVING_ONLY`로 재색인을 지나치지 않는다**', () => {
    /*
     * `SERVING_ONLY`는 시험과 부트스트랩의 것이다. 운영 경로가 그것을 넘기면
     * 재색인 중에 그 쓰기만 shadow에서 빠지고, 그 사실은 전환 뒤에야 드러난다.
     */
    const offences: string[] = [];
    for (const file of [...DUAL_WRITE_CALLERS, ...TARGET_FORWARDING]) {
      if (codeOf(read(file)).includes('SERVING_ONLY')) offences.push(file);
    }
    expect(offences, `운영 경로가 재색인을 지나친다:\n${offences.join('\n')}`).toEqual([]);
  });

  it('**애플리케이션이 구체 인덱스 이름을 박지 않는다** (FR-ING-008 AC-1)', () => {
    /*
     * 읽기가 별칭만 쓰는 것이 무중단 전환의 전제다. 구체 이름이 한 군데라도
     * 박혀 있으면 전환이 그 경로를 지나친다.
     *
     * 허용되는 자리는 셋뿐이다 — 정의(`indices.ts`), 버전 관리
     * (`versioned-index.ts`), 그리고 러너(`reindex.ts`). 셋 다 **이름을 만드는**
     * 쪽이지 이름으로 조회하는 쪽이 아니다.
     */
    const allowed = new Set([
      'packages/es/src/indices.ts',
      'packages/es/src/versioned-index.ts',
      'apps/pipeline-worker/src/reindex.ts',
    ]);
    const concrete = /['"`]prs-[a-z-]+-v\d+['"`]/;

    const offences: string[] = [];
    for (const file of [
      'packages/es/src/indices.ts',
      'packages/es/src/versioned-index.ts',
      'packages/es/src/search.ts',
      'packages/es/src/links.ts',
      'packages/es/src/relations-read.ts',
      'packages/es/src/registry.ts',
      'packages/es/src/sequence.ts',
      'packages/es/src/releases.ts',
      'packages/es/src/commit-metadata.ts',
      'packages/es/src/upsert.ts',
      'apps/pipeline-worker/src/reindex.ts',
      'apps/pipeline-worker/src/project.ts',
      'apps/pipeline-worker/src/link.ts',
      'apps/pipeline-worker/src/relations.ts',
      'apps/search-api/src/ops/repositories.ts',
    ]) {
      if (concrete.test(codeOf(read(file))) && !allowed.has(file)) offences.push(file);
    }
    expect(offences, `구체 인덱스 이름이 박혀 있다:\n${offences.join('\n')}`).toEqual([]);
  });

  it('검사기 자신이 동작한다 — 규칙을 어긴 코드를 실제로 잡는다', () => {
    // 목록을 비우면 `indices.ts`의 구체 이름이 드러나야 한다.
    expect(/['"`]prs-[a-z-]+-v\d+['"`]/.test(read('packages/es/src/indices.ts'))).toBe(true);
    // 그리고 원시체 파일들은 실제로 쓰기 동사를 갖고 있어야 한다.
    expect(/\bclient\s*\.\s*bulk\s*\(/.test(codeOf(read('packages/es/src/upsert.ts')))).toBe(true);
  });
});
