/**
 * NDJSON 원본 아카이브 (ADR-002 레인 B, FR-ING-010).
 *
 * 한 줄에 이벤트 하나를 append한다. Filebeat가 이 파일을 읽어 ES 아카이브
 * 인덱스로 보내는 일은 WP-036의 몫이고, 여기서는 파일까지가 범위다.
 *
 * 레인 B의 실패는 레인 A(PostgreSQL 저장)를 막지 않는다. 원본은 이미
 * PostgreSQL에 있고 그것이 시스템 오브 레코드다 (ADR-004).
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { once } from 'node:events';

export interface ArchiveRecord {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository_id: number | null;
  readonly received_at: string;
  readonly correlation_id: string;
  readonly payload: unknown;
}

export interface ArchiveWriter {
  append(record: ArchiveRecord): Promise<void>;
  close(): Promise<void>;
}

export function createArchiveWriter(filePath: string): ArchiveWriter {
  mkdirSync(dirname(filePath), { recursive: true });
  const stream: WriteStream = createWriteStream(filePath, { flags: 'a' });
  let streamError: Error | null = null;
  stream.on('error', (error: Error) => {
    streamError = error;
  });

  return {
    async append(record: ArchiveRecord): Promise<void> {
      if (streamError !== null) throw streamError;
      // 배압이 걸리면 drain을 기다린다. 기다리지 않고 계속 밀어 넣으면 버스트
      // 구간에서 메모리가 무한정 늘어난다 (지속 200/s, 버스트 2000/s).
      if (!stream.write(`${JSON.stringify(record)}\n`)) {
        await once(stream, 'drain');
      }
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        stream.end(() => {
          resolve();
        });
      });
    },
  };
}

/** 아카이브를 끈 경우(설정 공백)와 단위 테스트에서 쓰는 무동작 구현. */
export const NULL_ARCHIVE_WRITER: ArchiveWriter = {
  append: async (): Promise<void> => {
    /* 아무것도 하지 않는다 */
  },
  close: async (): Promise<void> => {
    /* 아무것도 하지 않는다 */
  },
};
