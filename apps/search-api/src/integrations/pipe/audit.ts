/**
 * 연동 보안 이벤트 기록 (CR-112 / ENT-INT-005, 공통 계약 11장, PSI-G03·G04).
 *
 * ## 무엇을 남기고 무엇을 남기지 않는가
 *
 * 남긴다: 행위 주체(client), canonical 사용자, operation, 대상 저장소(`owner/repo` 형식이 맞을 때만),
 * 결과 코드, HTTP 상태, 서버 correlation ID, PIPE가 보낸 correlation ID(UUID일 때만), grant ID,
 * binding·정책 버전, 거절 사유 코드.
 *
 * 남기지 않는다: grant 원문, assertion, 쿠키, 인증 헤더, 검색어 전문, 파일 경로·내용, 응답 본문.
 *
 * 조회 자체의 감사(`audit_record`)는 **기존 기록기가 그대로** 남긴다 — 이 연동이 우회하지 않는다.
 * 여기 남기는 행은 같은 correlation ID로 그 감사 행에 이어진다.
 *
 * ## 실패는 주 동작을 바꾸지 않는다
 *
 * `recordAuditBestEffort`와 같은 규율이다 (FR-AUTH-004 AC-6): 기다리되 던지지 않는다. grant 발급·회수
 * 자체는 grant·문맥 표가 정본으로 남기므로 이 행이 빠져도 사실이 사라지지 않는다.
 */

import { pipeIntegrationRepo, type IntegrationEventInput, type Pool } from '@prs/db';
import { Counter } from '../../metrics.js';

/** 이벤트 적재 실패. 라벨은 유한하다 (event type). */
export const integrationEventFailedTotal = new Counter(
  'pipe_integration_event_failed_total',
  'PIPE 연동 이벤트 기록 실패 건수. 0이 아니면 연동 요청의 행위 주체가 남지 않고 있다',
);

/** 연동 요청 결과 (operation·결과 코드 라벨 — 사용자·저장소·질의를 라벨로 쓰지 않는다). */
export const integrationRequestTotal = new Counter(
  'pipe_integration_request_total',
  'PIPE 연동 요청 건수. 라벨 operation, outcome(ok 또는 오류 코드)',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TARGET = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

/** PIPE가 보낸 `X-Correlation-Id`. UUID가 아니면 버린다 — 임의 문자열을 기록 식별자로 쓰지 않는다. */
export function upstreamCorrelationId(header: string | string[] | undefined): string | null {
  return typeof header === 'string' && UUID.test(header) ? header.toLowerCase() : null;
}

/** 대상 저장소 표기. 형식이 맞지 않으면 남기지 않는다. */
export function safeTarget(repository: unknown): string | null {
  return typeof repository === 'string' && SAFE_TARGET.test(repository) ? repository : null;
}

export async function recordIntegrationEvent(
  pool: Pool,
  event: IntegrationEventInput,
  log?: (entry: { readonly level: string; readonly message: string; readonly correlation_id?: string }) => void,
): Promise<boolean> {
  try {
    await pipeIntegrationRepo.recordEvent(pool, event);
    return true;
  } catch {
    integrationEventFailedTotal.inc({ event_type: event.eventType });
    // 원인 문자열에는 SQL 파라미터 조각이 섞일 수 있다. 싣지 않는다.
    log?.({ level: 'error', message: `PIPE 연동 이벤트 기록 실패 (${event.eventType})`, correlation_id: event.correlationId });
    return false;
  }
}
