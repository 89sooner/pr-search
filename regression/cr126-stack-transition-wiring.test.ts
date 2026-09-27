/**
 * CR-126 — 업그레이드 직후 스택의 전환기 보완은 **이벤트 소비자에만** 켜진다 (DEV-773).
 *
 * 링크 워커는 같은 deps로 두 일을 한다 — 스트림 이벤트 소비(`startLinkWorker`)와 JOB-REL-006 전량 재파생
 * (`startReferenceRebuildRunner`). 재색인은 `batch` 역할의 다른 deps(`reindexLinkDeps`)를 쓴다. 전환기 보완
 * (`servingStackImport`)은 이벤트 소비자에만 켜야 한다: 재파생이나 재색인에 켜면 저장소 전체를 옮기는 두 번째
 * 이전 경로가 되고, 재색인의 전환 전 검증(옮기지 않은 간선이 남으면 전환하지 않는다, FR-REL-006 AC-6)이 제
 * 뜻을 잃는다. 통합 시험은 deps를 직접 넘기므로 이 배선을 보지 못한다 — 그래서 진입점의 소스를 건다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('DEV-773: 스택의 전환기 보완은 이벤트 소비자에만 켜진다', () => {
  const index = read('apps/pipeline-worker/src/index.ts');

  it('이벤트 소비자는 `servingStackImport: true`를 더한 deps로 선다', () => {
    expect(index).toMatch(/startLinkWorker\(\{\s*\.\.\.linkDeps,\s*servingStackImport:\s*true\s*\}\)/);
  });

  it('JOB-REL-006 재파생은 켜지 않은 공유 deps로 선다', () => {
    expect(index).toMatch(/startReferenceRebuildRunner\(linkDeps\)/);
  });

  it('진입점에서 한 번만 켠다 — 공유 `linkDeps`나 재색인의 `reindexLinkDeps`에 두지 않는다', () => {
    expect(index.match(/servingStackImport/g)).toHaveLength(1);
    const reindexDeps = /const reindexLinkDeps: LinkDeps = \{[\s\S]*?\n {2}\};/.exec(index)?.[0] ?? '';
    expect(reindexDeps).toContain('gheHost');
    expect(reindexDeps).not.toContain('servingStackImport');
  });

  it('파생은 설정이 켜졌을 때만 옮긴다 — 기본값은 끔이다', () => {
    const relations = read('apps/pipeline-worker/src/relations.ts');
    const helper = /async function importLegacyStacks\([\s\S]*?\n\}/.exec(relations)?.[0] ?? '';
    expect(helper).toMatch(/if \(deps\.servingStackImport !== true\) return;/);
  });
});
