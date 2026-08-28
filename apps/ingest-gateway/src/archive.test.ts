/**
 * NDJSON 아카이브 회전 (WP-036 / FR-ING-010 AC-7, CR-052 DEV-367).
 *
 * 여기서 재는 것은 **파일이 스스로를 제한하는가**다. 적재기가 멈춘 동안 파일이
 * 무한히 자라면 수집 노드의 디스크가 차고, 그때 레인 B의 정체가 레인 A를
 * 멈춘다 — AC-3이 지키려던 독립성이 디스크 수준에서 무너진다.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createArchiveWriter, type ArchiveRecord } from './archive.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prs-archive-'));
  path = join(dir, 'raw-events.ndjson');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(id: string, filler = ''): ArchiveRecord {
  return {
    delivery_id: id,
    event_type: 'pull_request',
    action: 'closed',
    repository: 'seg/payments',
    repository_id: 4021,
    received_at: '2026-08-28T11:00:00.000Z',
    correlation_id: 'c-1',
    payload: { filler },
  };
}

function segments(): string[] {
  return readdirSync(dir).sort();
}

describe('FR-ING-010 AC-7: 아카이브 파일은 스스로를 제한한다', () => {
  it('크기 상한을 넘기면 조각을 밀어내고 새 파일에 이어 쓴다', async () => {
    const writer = createArchiveWriter(path, { maxBytes: 400, keep: 5 });
    // 한 줄이 약 200바이트가 되도록 채운다.
    for (let i = 0; i < 4; i += 1) await writer.append(record(`d-${String(i)}`, 'x'.repeat(100)));
    await writer.close();

    expect(segments()).toContain('raw-events.ndjson');
    expect(segments()).toContain('raw-events.ndjson.1');
    // 마지막 줄은 현재 파일에 있다.
    expect(readFileSync(path, 'utf8')).toContain('d-3');
  });

  it('보관 개수를 넘기면 가장 오래된 조각부터 버린다', async () => {
    const writer = createArchiveWriter(path, { maxBytes: 250, keep: 3 });
    for (let i = 0; i < 10; i += 1) await writer.append(record(`d-${String(i)}`, 'y'.repeat(150)));
    await writer.close();

    // 현재 파일 + 조각 2개 = 3개를 넘지 않는다.
    expect(segments()).toHaveLength(3);
    expect(writer.droppedSegments()).toBeGreaterThan(0);
  });

  it('버린 조각의 내용은 남지 않는다 — 잃는 쪽을 택한 결과가 관측된다', async () => {
    const writer = createArchiveWriter(path, { maxBytes: 250, keep: 2 });
    for (let i = 0; i < 8; i += 1) await writer.append(record(`d-${String(i)}`, 'z'.repeat(150)));
    await writer.close();

    const all = segments()
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('');
    expect(all).not.toContain('d-0');
    expect(all).toContain('d-7');
    expect(writer.droppedSegments()).toBeGreaterThan(0);
  });

  it('기존 파일 크기를 이어서 센다 — 재기동이 상한을 초기화하지 않는다', async () => {
    const first = createArchiveWriter(path, { maxBytes: 400, keep: 5 });
    await first.append(record('d-0', 'a'.repeat(300)));
    await first.close();

    const second = createArchiveWriter(path, { maxBytes: 400, keep: 5 });
    await second.append(record('d-1', 'b'.repeat(300)));
    await second.close();

    // 두 번째 줄이 상한을 넘기므로 재기동 뒤에도 회전이 일어난다.
    expect(segments()).toContain('raw-events.ndjson.1');
  });

  /*
   * PR #66 리뷰 P1. 게이트웨이는 초당 200건을 지속으로 받으므로 여러 요청이
   * `append`의 `await` 경계에서 인터리빙된다. 직렬화가 없으면 경계를 넘는 순간
   * 여럿이 같은 `written`을 읽고 동시에 회전해 **한 번의 경계 통과가 여러 조각을
   * 버린다.** 그 실패는 오류를 내지 않고 지표에도 설계된 버림과 같은 모양으로 남는다.
   */
  it('동시 append가 조각을 겹쳐 밀지 않는다 (PR #66 리뷰 P1)', async () => {
    const writer = createArchiveWriter(path, { maxBytes: 250, keep: 4 });
    await Promise.all(
      Array.from({ length: 16 }, (_, i) => writer.append(record(`d-${String(i)}`, 'q'.repeat(150)))),
    );
    await writer.close();

    // 상한을 넘지도, 과다 삭제로 모자라지도 않는다.
    expect(segments()).toHaveLength(4);

    // 남은 줄은 모두 온전한 JSON이고, 버린 조각 수가 실제 회전 횟수와 맞는다.
    const lines = segments()
      .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n'))
      .filter((line) => line.length > 0);
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();

    // 16줄 중 마지막 것은 반드시 남아 있다.
    expect(lines.some((line) => line.includes('d-15'))).toBe(true);
  });

  it('보관 개수 1은 거절한다 — 밀 자리가 없으면 회전이 곧 유실이다', () => {
    expect(() => createArchiveWriter(path, { maxBytes: 100, keep: 1 })).toThrow(/2 이상/);
  });

  it('레코드는 저장소를 두 형태로 담는다 (DEV-366)', async () => {
    const writer = createArchiveWriter(path, { maxBytes: 1_000_000, keep: 5 });
    await writer.append(record('d-0'));
    await writer.close();

    const line = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>;
    // 필터의 재료와 조사자가 읽는 값 둘 다 있어야 한다. 하나만 담는 길은 없다.
    expect(line['repository_id']).toBe(4021);
    expect(line['repository']).toBe('seg/payments');
  });
});
