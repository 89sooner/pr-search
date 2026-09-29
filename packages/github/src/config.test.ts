/**
 * `GHE_INSTALLATIONS` 파싱 (CR-010, DEV-015).
 *
 * 이 표가 곧 "어느 조직이 어느 rate limit을 쓰는가"의 정의다. 잘못된 항목을
 * 조용히 건너뛰면 그 조직의 이벤트만 영문 모르게 실패 대기열로 간다.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIRROR_ROOT,
  deriveGraphqlUrl,
  parseInstallations,
  resolveGitHubConfig,
  resolveMirrorConfig,
  resolveReferenceHost,
} from './config.js';

describe('parseInstallations', () => {
  it('쉼표로 나뉜 org:installationId를 읽는다', () => {
    expect(parseInstallations({ GHE_INSTALLATIONS: 'acme:12345,contoso:67890' })).toEqual([
      { org: 'acme', installationId: 12345 },
      { org: 'contoso', installationId: 67890 },
    ]);
  });

  it('공백과 빈 항목을 견딘다', () => {
    expect(parseInstallations({ GHE_INSTALLATIONS: ' acme : 42 , , contoso:7 ' })).toEqual([
      { org: 'acme', installationId: 42 },
      { org: 'contoso', installationId: 7 },
    ]);
  });

  it('설정이 없으면 빈 목록이다 — 기동 거부는 호출 측이 정한다', () => {
    expect(parseInstallations({})).toEqual([]);
    expect(parseInstallations({ GHE_INSTALLATIONS: '  ' })).toEqual([]);
  });

  it('형식이 깨진 항목은 조용히 건너뛰지 않고 던진다', () => {
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: ':42' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:abc' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:0' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:-1' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:1.5' })).toThrow(/형식/);
  });

  it('같은 조직이 두 번 나오면 던진다 — 어느 설치를 쓸지 조용히 고르지 않는다', () => {
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:1,ACME:2' })).toThrow(/두 번/);
  });
});

/**
 * **빈 문자열은 미설정이 아니다** (`DEV-548`).
 *
 * `.env`가 `KEY=`로 배포하는 값은 `undefined`가 아니라 `''`로 도착한다. `??`만
 * 쓰면 그 빈 값이 그대로 URL이 되고, 경로만 남은 상대 요청이 `Failed to parse URL`로
 * 죽는다. 개별 키가 아니라 **불변식**을 고정한다 — 환경에서 URL·경로를 읽는 자리는
 * 비었거나 공백뿐이면 기본값으로 되돌린다.
 */
describe('환경 값이 비어 있을 때 기본값으로 되돌린다 (DEV-548)', () => {
  const blanks = ['', '   '];

  it.each(blanks)('GHE_BASE_URL이 %o면 기본 호스트를 쓴다', (blank) => {
    const config = resolveGitHubConfig({ GHE_BASE_URL: blank });
    expect(config.baseUrl).toBe('https://ghe.example.com');
  });

  it.each(blanks)('GHE_API_URL이 %o면 <base>/api/v3로 되돌린다', (blank) => {
    const config = resolveGitHubConfig({
      GHE_BASE_URL: 'https://ghe.internal.example',
      GHE_API_URL: blank,
    });
    expect(config.apiUrl).toBe('https://ghe.internal.example/api/v3');
  });

  it.each(blanks)('MIRROR_ROOT가 %o면 기본 루트를 쓴다 — 같은 규율이다', (blank) => {
    expect(resolveMirrorConfig({ MIRROR_ROOT: blank }).root).toBe(DEFAULT_MIRROR_ROOT);
  });

  it('어떤 조합에서도 절대 URL이 나온다 — 상대 경로 요청이 생기지 않는다', () => {
    for (const base of [undefined, '', '   ', 'https://ghe.internal.example/']) {
      for (const api of [undefined, '', '   ', 'https://ghe.internal.example/api/v3/']) {
        const config = resolveGitHubConfig({ GHE_BASE_URL: base, GHE_API_URL: api });
        expect(() => new URL('/app/installations/1/access_tokens', config.apiUrl)).not.toThrow();
        expect(config.apiUrl.endsWith('/')).toBe(false);
        expect(config.baseUrl.endsWith('/')).toBe(false);
      }
    }
  });

  it('명시한 값은 그대로 쓴다 — 끝의 슬래시만 뗀다', () => {
    const config = resolveGitHubConfig({
      GHE_BASE_URL: 'https://ghe.internal.example/',
      GHE_API_URL: 'https://ghe.internal.example/api/v3//',
    });
    expect(config.baseUrl).toBe('https://ghe.internal.example');
    expect(config.apiUrl).toBe('https://ghe.internal.example/api/v3');
  });
});

/**
 * URL 참조의 승인 호스트 (THR-036, CR-124 / DEV-776).
 *
 * 사내 주소를 대신하는 가상 호스트다. 실제 사내 주소는 공개 저장소에 싣지 않는다(2026-09-27 사용자 결정) —
 * 구조(네 단계 호스트, 가운데 `github`)를 맞췄고, 실제 값으로는 같은 시험을 격리 환경에서 돌렸다(원장 6.115장). 접속하지 않는다.
 */
describe('resolveReferenceHost — 배포 설정의 GHE 주소에서 호스트만 읽는다', () => {
  const CORP_GHE = 'https://team.github.corp.example';

  it('사내 GHE 주소의 호스트를 돌려준다', () => {
    expect(resolveReferenceHost({ GHE_BASE_URL: CORP_GHE })).toBe('team.github.corp.example');
  });

  it('끝의 슬래시·경로·대문자·앞뒤 공백·기본 포트는 호스트를 바꾸지 않는다', () => {
    for (const value of [`${CORP_GHE}/`, `${CORP_GHE}/ghe/`, 'HTTPS://TEAM.GITHUB.CORP.EXAMPLE', `  ${CORP_GHE}  `, `${CORP_GHE}:443`]) {
      expect(resolveReferenceHost({ GHE_BASE_URL: value }), value).toBe('team.github.corp.example');
    }
  });

  it('기본이 아닌 포트는 호스트의 일부다 — 다른 포트의 URL을 같은 서버로 보지 않는다', () => {
    expect(resolveReferenceHost({ GHE_BASE_URL: 'https://team.github.corp.example:8443' })).toBe('team.github.corp.example:8443');
  });

  it('스킴이 없으면 https로 읽는다', () => {
    expect(resolveReferenceHost({ GHE_BASE_URL: 'team.github.corp.example' })).toBe('team.github.corp.example');
  });

  it('**주소에 붙은 사용자 정보는 돌려주지 않는다** — 로그에 남는 값이다', () => {
    const host = resolveReferenceHost({ GHE_BASE_URL: 'https://someone:s3cret@team.github.corp.example' });
    expect(host).toBe('team.github.corp.example');
    expect(host).not.toContain('s3cret');
  });

  it('**비었으면 null이다 — 예시 호스트로 채우지 않는다** (fail closed, DEV-776)', () => {
    expect(resolveReferenceHost({})).toBeNull();
    expect(resolveReferenceHost({ GHE_BASE_URL: '' })).toBeNull();
    expect(resolveReferenceHost({ GHE_BASE_URL: '   ' })).toBeNull();
    // 접속 설정은 여전히 예시 호스트로 채운다 — 두 함수의 차이가 이 CR의 요점이다.
    expect(resolveGitHubConfig({}).baseUrl).toBe('https://ghe.example.com');
  });

  it('해석되지 않는 값은 null이다', () => {
    expect(resolveReferenceHost({ GHE_BASE_URL: 'https://' })).toBeNull();
    expect(resolveReferenceHost({ GHE_BASE_URL: 'http://exa mple.com' })).toBeNull();
  });
});

/**
 * GraphQL 끝점 (CR-135). GHES의 GraphQL은 REST 루트(`/api/v3`)의 **형제**인 `/api/graphql`이다 — `/api/v3/graphql`은
 * 없는 경로라, 도출을 틀리면 blame이 사내에서 전부 404(`client`)로 끝난다.
 */
describe('CR-135 FR-SRC-005 GraphQL 끝점 — GHE_GRAPHQL_URL과 도출', () => {
  it('GHES 기본값은 /api/graphql이다 — /api/v3/graphql이 아니다', () => {
    expect(resolveGitHubConfig({ GHE_BASE_URL: 'https://ghe.internal.example' }).graphqlUrl).toBe('https://ghe.internal.example/api/graphql');
    expect(resolveGitHubConfig({}).graphqlUrl).toBe('https://ghe.example.com/api/graphql');
    expect(resolveGitHubConfig({ GHE_BASE_URL: 'https://ghe.internal.example/' }).graphqlUrl).not.toContain('/api/v3');
  });

  it('GHE_API_URL을 바꾸면 그 루트에서 도출한다 — /api/v3로 끝나면 꼬리만 바꾸고, 아니면 루트 아래에 붙인다', () => {
    expect(resolveGitHubConfig({ GHE_BASE_URL: 'https://ghe.internal.example', GHE_API_URL: 'https://proxy.internal.example/ghe/api/v3/' }).graphqlUrl)
      .toBe('https://proxy.internal.example/ghe/api/graphql');
    expect(resolveGitHubConfig({ GHE_API_URL: 'https://proxy.internal.example/github' }).graphqlUrl).toBe('https://proxy.internal.example/github/graphql');
    // 꼬리가 아닌 자리의 `/api/v3`는 바꾸지 않는다.
    expect(deriveGraphqlUrl('https://ghe.internal.example/api/v3/proxy')).toBe('https://ghe.internal.example/api/v3/proxy/graphql');
  });

  it('github.com 모양(REST 루트가 api.github.com)이면 https://api.github.com/graphql이다', () => {
    expect(resolveGitHubConfig({ GHE_API_URL: 'https://api.github.com' }).graphqlUrl).toBe('https://api.github.com/graphql');
    expect(deriveGraphqlUrl('https://api.github.com')).toBe('https://api.github.com/graphql');
  });

  it.each(['', '   '])('GHE_GRAPHQL_URL이 %o면 도출한다 — 빈 값은 미설정이다 (DEV-548)', (blank) => {
    expect(resolveGitHubConfig({ GHE_BASE_URL: 'https://ghe.internal.example', GHE_GRAPHQL_URL: blank }).graphqlUrl).toBe('https://ghe.internal.example/api/graphql');
  });

  it('명시한 값은 그대로 쓴다 — 끝의 슬래시만 떼고 REST 루트와 무관하다', () => {
    const config = resolveGitHubConfig({
      GHE_BASE_URL: 'https://ghe.internal.example',
      GHE_API_URL: 'https://ghe.internal.example/api/v3',
      GHE_GRAPHQL_URL: ' https://gql.internal.example/custom/graphql/ ',
    });
    expect(config.graphqlUrl).toBe('https://gql.internal.example/custom/graphql');
    expect(config.apiUrl).toBe('https://ghe.internal.example/api/v3');
    expect(resolveGitHubConfig({ GHE_GRAPHQL_URL: 'http://127.0.0.1:8080/api/graphql' }).graphqlUrl).toBe('http://127.0.0.1:8080/api/graphql');
  });

  it('잘못된 명시 값은 기동 시점에 던진다 — http(s)가 아니거나, URL이 아니거나, query·fragment가 붙었다', () => {
    for (const value of [
      'ftp://ghe.internal.example/api/graphql',
      'ghe.internal.example/api/graphql',
      'not a url',
      'https://ghe.internal.example/api/graphql?token=abc',
      'https://ghe.internal.example/api/graphql?',
      'https://ghe.internal.example/api/graphql#frag',
    ]) {
      expect(() => resolveGitHubConfig({ GHE_GRAPHQL_URL: value }), value).toThrow(/GHE_GRAPHQL_URL/);
    }
  });

  it('오류 메시지에 설정 값을 싣지 않는다 — 주소에 자격 증명이 붙어 있을 수 있다', () => {
    const value = 'ftp://someone:s3cret@ghe.internal.example/api/graphql';
    expect(() => resolveGitHubConfig({ GHE_GRAPHQL_URL: value })).toThrow(/GHE_GRAPHQL_URL/);
    try {
      resolveGitHubConfig({ GHE_GRAPHQL_URL: value });
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cret');
    }
  });
});
