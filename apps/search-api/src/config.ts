/**
 * search-api 설정 (WP-009, WP-010).
 *
 * 값은 환경 변수에서만 읽는다. 토큰은 코드·로그·응답 어디에도 남기지 않는다
 * (보안 문서 6장, NFR-005).
 */

import { resolveSessionReaderConfig, type SessionReaderConfig } from '@prs/authz';

export interface SearchApiEnv {
  readonly [key: string]: string | undefined;
}

/**
 * 관리 API를 부른 주체.
 *
 * **최종 권한은 `operator` 역할이며 그 판정은 WP-012의 OIDC 세션이 세운다.**
 * REL-001에는 사용자 신원 자체가 없어 그때까지의 임시 통제다 (CR-012, DEV-025).
 *
 * 이름을 붙이는 이유는 감사 기록 때문이다 (CR-013, DEV-030). FR-ING-009 AC-5가
 * 등록·해제를 감사 대상으로 정했는데, 토큰 하나만 있으면 "누가 했는가"에
 * 답할 수 없다. 이름 없는 단일 토큰은 `unnamed`로 남아 **모른다는 사실 자체가
 * 기록된다** — 아는 척하지 않는다.
 */
export interface AdminPrincipal {
  readonly name: string;
  readonly token: string;
}

export interface SearchApiConfig {
  readonly port: number;
  /**
   * 관리 API 토큰. 비어 있으면 관리 경로를 등록하지 않는다 — 인증 수단 없이
   * 열린 변경 API를 두는 것보다 없는 편이 낫다.
   */
  readonly adminTokens: readonly AdminPrincipal[];
  /**
   * 지표 저장소 질의 주소 (사내 Prometheus 호환, 인프라 4장).
   *
   * 없으면 단계별 지연을 `unavailable`로 둔다 (CR-013, DEV-029). 워커 복제본
   * 하나를 긁어 클러스터 전체인 양 내놓지 않는다.
   */
  readonly metricsQueryUrl: string | null;
  /** 세션 인증 구성 (WP-012). `enabled`가 false면 토큰 통제가 남는다. */
  readonly auth: SessionReaderConfig;
  /**
   * 이 GHE 인스턴스의 기준 URL (CR-017, DEV-064).
   *
   * 식별자 해석 1단계가 "GHE URL 패턴(호스트+경로)"인데, 무엇이 우리
   * 호스트인지 모르면 **아무 URL의 경로나 우리 저장소로 해석된다** —
   * `https://other.example/acme/payments/pull/1`이 우리 PR이 된다. 접근
   * 범위가 데이터를 막아 주더라도 엉뚱한 저장소로 해석하는 것 자체가 오답이다.
   *
   * 없으면(`null`) URL 해석을 **하지 않는다**. 추측하느니 안 하는 편이 낫다.
   */
  readonly gheBaseUrl: string | null;
}

/** `"alice:tok1,bob:tok2"`를 주체 목록으로. 이름이 없으면 `unnamed`. */
export function parseAdminTokens(env: SearchApiEnv): readonly AdminPrincipal[] {
  const principals: AdminPrincipal[] = [];
  const seen = new Set<string>();

  const add = (name: string, token: string): void => {
    if (token === '' || seen.has(token)) return;
    seen.add(token);
    principals.push({ name, token });
  };

  for (const entry of (env['ADMIN_API_TOKENS'] ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    // 이름 없이 값만 준 항목도 받는다. 구분자를 빠뜨렸다고 토큰을 통째로
    // 버리면 배포가 조용히 인증 불가 상태가 된다.
    if (separator < 0) {
      add('unnamed', trimmed);
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    // `:tok`처럼 이름이 비면 구분자를 토큰에 남기지 않는다. 남기면 그 토큰으로는
    // 영영 인증되지 않는다.
    add(name === '' ? 'unnamed' : name, trimmed.slice(separator + 1).trim());
  }

  add('unnamed', (env['ADMIN_API_TOKEN'] ?? '').trim());
  return principals;
}

export function resolveSearchApiConfig(env: SearchApiEnv = process.env): SearchApiConfig {
  const metricsUrl = (env['METRICS_QUERY_URL'] ?? '').trim();
  // `@prs/github`가 이미 쓰는 이름이다. 같은 인스턴스를 가리키므로 이름을 나누지 않는다.
  const gheBaseUrl = (env['GHE_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
  return {
    port: Number(env['SEARCH_API_PORT'] ?? '3002'),
    adminTokens: parseAdminTokens(env),
    metricsQueryUrl: metricsUrl === '' ? null : metricsUrl,
    auth: resolveSessionReaderConfig(env),
    gheBaseUrl: gheBaseUrl === '' ? null : gheBaseUrl,
  };
}

/** 감사 기록에 남는 주체 식별자. 사람 계정과 섞이지 않게 접두를 둔다. */
export function auditUserId(principal: AdminPrincipal): string {
  return `admin:${principal.name}`;
}
