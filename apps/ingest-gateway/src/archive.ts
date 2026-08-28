/**
 * NDJSON 원본 아카이브 (ADR-002 레인 B, FR-ING-010).
 *
 * 한 줄에 이벤트 하나를 append한다. Filebeat **사이드카**가 이 파일을 읽어 ES
 * 아카이브 인덱스로 보낸다 (CR-052, DEV-373).
 *
 * 레인 B의 실패는 레인 A(PostgreSQL 저장)를 막지 않는다. 원본은 이미
 * PostgreSQL에 있고 그것이 시스템 오브 레코드다 (ADR-004).
 *
 * ## 파일은 스스로를 제한한다 (FR-ING-010 AC-7, CR-052 DEV-367)
 *
 * 이전 판은 단일 파일에 무한히 덧붙였다. 일 약 46만 건 x 8KB이면 Filebeat가
 * 멈춘 동안 며칠 만에 수집 노드의 디스크가 차고, **그때 레인 B의 정체가 레인 A를
 * 멈춘다** — AC-3이 지키려던 것이 바로 그 독립성이다. 그래서 크기 상한마다
 * 조각을 밀어내고 보관 개수를 넘으면 **가장 오래된 조각부터 버린다.**
 *
 * 적재기가 아직 읽지 않은 조각도 버린다. 보존 보증은 `raw_event`가 지고 ES
 * 아카이브는 그것으로부터 재구성할 수 있으므로(ADR-003: 백업 대상 아님),
 * **아카이브를 잃는 쪽이 수집을 지킨다.** 버린 조각 수는 지표로 남는다.
 *
 * ## 파드마다 자기 파일을 쓴다 (CR-052, DEV-369)
 *
 * 여러 replica가 하나의 공유 파일에 덧붙이는 구성을 쓰지 않는다. 평균 8KB인
 * payload는 `PIPE_BUF`(4KB)를 넘어 `O_APPEND`의 원자성이 보장되지 않고, 섞인
 * 줄은 **두 이벤트의 조각을 하나로 읽히게 한다** — 오류 없이 틀린 원본이 남는
 * 실패라 어떤 시험도 잡지 못한다.
 */

import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { once } from 'node:events';

export interface ArchiveRecord {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  /** `owner/name`. 조사자가 읽는 값 (CR-052, DEV-366). */
  readonly repository: string | null;
  /** 접근 범위 필터가 결합하는 재료. 미등록 저장소는 비어 있다. */
  readonly repository_id: number | null;
  readonly received_at: string;
  readonly correlation_id: string;
  readonly payload: unknown;
}

/** 조각 경계와 보관 개수 (FR-ING-010 AC-7). */
export interface ArchiveRotation {
  /** 한 조각의 크기 상한(바이트). 이 값을 넘기면 조각을 민다. */
  readonly maxBytes: number;
  /** 현재 파일을 **포함한** 보관 개수. 최소 2다 — 1이면 밀 자리가 없다. */
  readonly keep: number;
}

export const DEFAULT_ARCHIVE_ROTATION: ArchiveRotation = {
  maxBytes: 64 * 1024 * 1024,
  keep: 5,
};

export interface ArchiveWriter {
  append(record: ArchiveRecord): Promise<void>;
  close(): Promise<void>;
  /** 보관 한도 때문에 버린 조각 수. 지표가 읽는다 (AC-7). */
  droppedSegments(): number;
}

export function createArchiveWriter(
  filePath: string,
  rotation: ArchiveRotation = DEFAULT_ARCHIVE_ROTATION,
): ArchiveWriter {
  if (rotation.keep < 2) {
    throw new Error(`아카이브 보관 개수는 2 이상이어야 한다 (받은 값: ${rotation.keep})`);
  }
  if (rotation.maxBytes <= 0) {
    throw new Error(`아카이브 조각 상한은 양수여야 한다 (받은 값: ${rotation.maxBytes})`);
  }

  mkdirSync(dirname(filePath), { recursive: true });

  let stream: WriteStream = createWriteStream(filePath, { flags: 'a' });
  let streamError: Error | null = null;
  let written = currentSize(filePath);
  let dropped = 0;

  stream.on('error', (error: Error) => {
    streamError = error;
  });

  function attach(next: WriteStream): void {
    stream = next;
    streamError = null;
    stream.on('error', (error: Error) => {
      streamError = error;
    });
  }

  async function endStream(): Promise<void> {
    const closing = stream;
    await new Promise<void>((resolve) => {
      closing.end(() => {
        resolve();
      });
    });
  }

  /**
   * 조각을 뒤로 밀고 새 파일을 연다.
   *
   * 가장 오래된 것을 **먼저** 버린다. 밀고 나서 버리면 그 사이에 조각이 한 개
   * 더 존재하는 순간이 생기고, 그 순간의 디스크 사용량이 한도를 넘는다.
   */
  async function rotate(): Promise<void> {
    await endStream();

    const oldest = `${filePath}.${rotation.keep - 1}`;
    if (removeIfPresent(oldest)) dropped += 1;

    for (let index = rotation.keep - 2; index >= 1; index -= 1) {
      renameIfPresent(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    }
    renameIfPresent(filePath, `${filePath}.1`);

    attach(createWriteStream(filePath, { flags: 'a' }));
    written = 0;
  }

  async function appendOne(record: ArchiveRecord): Promise<void> {
    if (streamError !== null) throw streamError;

    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);

    // 이 줄을 쓰면 상한을 넘는 경우에만 민다. 넘긴 뒤에 밀면 조각이 상한보다
    // 커지고, 그 초과분이 보관 개수만큼 곱해진다.
    if (written > 0 && written + size > rotation.maxBytes) {
      await rotate();
    }

    // 배압이 걸리면 drain을 기다린다. 기다리지 않고 계속 밀어 넣으면 버스트
    // 구간에서 메모리가 무한정 늘어난다 (지속 200/s, 버스트 2000/s).
    if (!stream.write(line)) {
      await once(stream, 'drain');
    }
    written += size;
  }

  /**
   * 직전 append가 끝난 뒤에 다음 append가 시작한다 (PR #66 리뷰 P1).
   *
   * ## 왜 필요한가
   *
   * `appendOne`은 `await` 경계를 둘 갖는다(회전, 배압). 게이트웨이는 초당 200건을
   * 지속으로 받으므로 여러 요청이 그 경계에서 인터리빙된다. 직렬화가 없으면
   * **경계를 넘는 순간 여러 append가 같은 `written`을 읽고 동시에 `rotate()`에
   * 들어간다** — 조각 사슬이 여러 번 밀리고 같은 자리가 반복해서 삭제되어
   * 보관 개수보다 많이 잃으며, 교체된 스트림이 닫히지 않은 채 남는다.
   *
   * 한 번의 경계 통과가 여러 조각을 버리는 이 실패는 **오류를 내지 않는다.**
   * 지표에는 "버렸다"만 남고 그것은 설계된 동작과 구분되지 않는다.
   *
   * 체인은 실패로 끊기지 않는다 — 한 요청의 append 실패가 다음 요청의 append를
   * 막으면 레인 B의 일시 장애가 영구 장애가 된다.
   */
  let tail: Promise<void> = Promise.resolve();

  return {
    async append(record: ArchiveRecord): Promise<void> {
      const run = tail.then(
        () => appendOne(record),
        () => appendOne(record),
      );
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async close(): Promise<void> {
      await endStream();
    },
    droppedSegments(): number {
      return dropped;
    },
  };
}

function currentSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function removeIfPresent(filePath: string): boolean {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function renameIfPresent(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    /* 없으면 밀 것이 없다 */
  }
}

/** 아카이브를 끈 경우(설정 공백)와 단위 테스트에서 쓰는 무동작 구현. */
export const NULL_ARCHIVE_WRITER: ArchiveWriter = {
  append: async (): Promise<void> => {
    /* 아무것도 하지 않는다 */
  },
  close: async (): Promise<void> => {
    /* 아무것도 하지 않는다 */
  },
  droppedSegments: (): number => 0,
};
