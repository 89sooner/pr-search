/**
 * 측정 결과의 출력과 비식별 (WP-074 FR-SEQ-008 AC-14 / 측정 가이드 5·6절).
 *
 * ## 무엇을 출력하지 않는가
 *
 * DSN·세션 파일 내용·HTTP 헤더·토큰·원본 payload·내부 hostname·PR 제목. 기본
 * 출력에서는 실제 PR 번호와 커밋 SHA도 뺀다 — 공유되는 보고에 조사 대상이
 * 그대로 실리지 않게 한다. `--detailed`는 저장소·PR 식별자를 되살리되 **비밀은
 * 어느 모드에서도 출력하지 않는다.**
 */

import { createHash } from 'node:crypto';
import type { StageStats } from './stats.js';
import { spaceLabel } from './stats.js';

export const SCHEMA_VERSION = 1;

/** NFR-002의 비교 목표. 이 도구는 그것을 **보증하지 않고 비교만** 한다. */
export const TARGET_P95_MS = 10_000;
export const TARGET_P99_MS = 60_000;

export function hashSpace(repositoryId: number, baseBranch: string): string {
  return createHash('sha256').update(`${String(repositoryId)}@${baseBranch}`).digest('hex');
}

export interface ReportDocument {
  readonly schema_version: number;
  readonly mode: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly cohort?: string;
  readonly spaces?: readonly string[];
  readonly requests?: number;
  readonly stages?: readonly StageStats[];
  readonly pending?: unknown;
  readonly baseline?: unknown;
  readonly capability?: unknown;
  readonly comparison?: unknown;
  readonly watch?: unknown;
  readonly notes?: readonly string[];
}

/** JSON 출력. 키 순서를 고정해 두 실행의 차이를 눈으로 비교할 수 있게 한다. */
export function renderJson(document: ReportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

/** 사람이 읽는 표. 숫자는 ms이며 `null`은 "재지 못했다"이지 0이 아니다. */
export function renderTable(document: ReportDocument): string {
  const lines: string[] = [];
  lines.push(`모드: ${document.mode}`);
  lines.push(`창: ${document.window.from} ~ ${document.window.to}`);
  if (document.cohort !== undefined) lines.push(`코호트: ${document.cohort}`);
  if (document.requests !== undefined) lines.push(`요청 수: ${String(document.requests)}`);
  if (document.spaces !== undefined && document.spaces.length > 0) {
    lines.push(`공간: ${document.spaces.join(', ')}`);
  }

  if (document.stages !== undefined) {
    lines.push('');
    lines.push('구간                          유효  p50     p95     p99     최대    누락 실패 대기 시계이상');
    for (const stage of document.stages) {
      lines.push(
        [
          stage.name.padEnd(28),
          String(stage.valid_samples).padStart(4),
          cell(stage.p50).padStart(7),
          cell(stage.p95).padStart(7),
          cell(stage.p99).padStart(7),
          cell(stage.max).padStart(7),
          String(stage.missing).padStart(4),
          String(stage.failed).padStart(4),
          String(stage.pending).padStart(4),
          String(stage.clock_anomaly_count).padStart(8),
        ].join(' '),
      );
    }
  }

  if (document.baseline !== undefined) {
    lines.push('');
    lines.push('기준 관측 (커밋 작성 → 채번 간격. 수신 지연이 아니다)');
    lines.push(JSON.stringify(document.baseline));
  }
  if (document.pending !== undefined) {
    lines.push('');
    lines.push(`대기: ${JSON.stringify(document.pending)}`);
  }
  if (document.capability !== undefined) {
    lines.push('');
    lines.push(`가용 구간: ${JSON.stringify(document.capability)}`);
  }
  if (document.watch !== undefined) {
    lines.push('');
    lines.push(`관측: ${JSON.stringify(document.watch)}`);
  }
  for (const note of document.notes ?? []) lines.push(`* ${note}`);
  return `${lines.join('\n')}\n`;
}

export function render(document: ReportDocument, format: 'table' | 'json'): string {
  return format === 'json' ? renderJson(document) : renderTable(document);
}

/** 저장소 식별자를 라벨로 치환한다. `--detailed`에서만 원래 값을 남긴다. */
export function spacesOf(
  rows: readonly { readonly repositoryId: number; readonly baseBranch: string }[],
  detailed: boolean,
): readonly string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(detailed ? `${String(row.repositoryId)}@${row.baseBranch}` : spaceLabel(hashSpace(row.repositoryId, row.baseBranch)));
  }
  return [...seen].sort();
}
