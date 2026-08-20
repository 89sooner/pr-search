/**
 * 게이트웨이 설정 (WP-004).
 *
 * 값은 환경 변수에서만 읽는다. 웹훅 시크릿은 코드·로그·응답 어디에도 남기지
 * 않는다 (보안 문서 6장, NFR-005).
 */

export interface GatewayEnv {
  readonly [key: string]: string | undefined;
}

/** payload 크기 상한. FR-ING-001 AC-6이 25MB로 못 박았다. */
export const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** graceful shutdown 유예. 진행 중인 수신을 끝까지 저장하고 나간다. */
export const SHUTDOWN_GRACE_MS = 30_000;

/** 큐 발행 마감. NFR-002의 300ms 예산 안에서 저장 뒤에 남는 몫이다. */
export const ENQUEUE_TIMEOUT_MS = 150;

export interface GatewayConfig {
  readonly port: number;
  /**
   * 서명 검증에 시도할 시크릿. 회전 중에는 구·신 두 값을 모두 담는다
   * (보안 문서 6장: "회전 기간 동안 구·신 두 값 모두로 서명 검증을 시도한다").
   */
  readonly webhookSecrets: readonly string[];
  readonly maxBodyBytes: number;
  /** NDJSON 원본 아카이브 파일 경로 (ADR-002 레인 B). 빈 값이면 아카이브를 끈다. */
  readonly archivePath: string | null;
  readonly shutdownGraceMs: number;
  /**
   * 큐 발행 마감(ms).
   *
   * 수신 응답 예산 300ms(NFR-002)에서 저장에 쓰고 남는 몫이다. 넘기면 발행을
   * 포기하고 아웃박스에 맡긴다.
   */
  readonly enqueueTimeoutMs: number;
}

export function resolveGatewayConfig(env: GatewayEnv = process.env): GatewayConfig {
  const secrets = [env['GHE_WEBHOOK_SECRET'], env['GHE_WEBHOOK_SECRET_PREVIOUS']].filter(
    (value): value is string => value !== undefined && value !== '',
  );

  const archivePath = env['INGEST_ARCHIVE_PATH'] ?? './var/archive/raw-events.ndjson';

  return {
    port: Number(env['INGEST_GATEWAY_PORT'] ?? '3001'),
    webhookSecrets: secrets,
    maxBodyBytes: Number(env['INGEST_MAX_BODY_BYTES'] ?? String(MAX_BODY_BYTES)),
    archivePath: archivePath === '' ? null : archivePath,
    shutdownGraceMs: Number(env['INGEST_SHUTDOWN_GRACE_MS'] ?? String(SHUTDOWN_GRACE_MS)),
    enqueueTimeoutMs: Number(env['INGEST_ENQUEUE_TIMEOUT_MS'] ?? String(ENQUEUE_TIMEOUT_MS)),
  };
}
