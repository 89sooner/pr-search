import type { NextConfig } from 'next';

const config: NextConfig = {
  // 워크스페이스 패키지는 빌드된 ESM을 그대로 소비한다.
  // `@prs/gh-cli`의 진입점은 브라우저 안전하다 (Node 전용은 `/node` 서브패스). 폼 검증이 서버와 같은 함수를 쓰기 위해 번들한다 (FR-GH-003 AC-8).
  transpilePackages: ['@prs/contracts', '@prs/query', '@prs/gh-cli'],

  /**
   * 서버 전용 패키지는 번들하지 않고 런타임에 `require`한다 (CR-018, DEV-068).
   *
   * `@prs/authz`의 진입점은 `@prs/db`를 거쳐 마이그레이션 실행기까지 끌어오고,
   * 그것은 디렉터리를 동적으로 읽으므로 **번들러가 해석할 수 없다.** `@prs/es`는
   * Node 전용 Elasticsearch 클라이언트를, `@prs/bus`는 ioredis를 끌어온다.
   *
   * 이 목록은 **서버 컴포넌트와 라우트 핸들러에만** 적용된다. 클라이언트
   * 컴포넌트는 여전히 이 패키지들을 가져올 수 없으므로, 역할 모델처럼
   * 클라이언트가 필요로 하는 것은 `@prs/authz/roles` 서브패스로 가져간다.
   *
   * **이 목록으로는 `pg`의 Cloudflare 전용 선택 의존성을 막지 못한다**
   * (`DEV-551`). `pg`나 `pg-cloudflare`를 여기 더해도 Turbopack이 만드는 해시
   * 이름 참조는 사라지지 않는다 — 재빌드로 확인했다. 그 결함은 이미지 빌드
   * 단계에서 다루며 근거는 `Dockerfile`의 `deploy-web` 단계에 적혀 있다.
   */
  serverExternalPackages: ['@prs/authz', '@prs/db', '@prs/es', '@prs/bus'],
};

export default config;
