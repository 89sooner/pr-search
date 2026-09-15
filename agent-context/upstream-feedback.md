# Upstream Feedback

---

## DEV-577 companion — `SESSION_COOKIE_SECURE=false` 허용 플래그 미구현

**발견**: 0.1.0-pilot.6 반입 후 로그인 시도 (2026-09-15)
**현상**: `AUTH_PROVIDER=github`으로 GHE OAuth 로그인 시도 시, `GHE_OAUTH_REDIRECT_URI=http://{호스트}/auth/callback`(HTTP)으로 설정했을 때 OAuth state 쿠키(`Secure` 속성)를 브라우저가 콜백 시 전송 거부 → `왕복 쿠키가 없거나 읽을 수 없다`로 인증 실패. `SESSION_COOKIE_SECURE=false` + `NODE_ENV=production` 조합은 `web`이 기동 자체를 거부해 우회 불가
**올바른 구성**: `GHE_OAUTH_REDIRECT_URI=https://{호스트}/auth/callback` + TLS 필수
**요청**: `ALLOW_INSECURE_COOKIES=true` 명시 플래그 또는 동등한 완화 조치 추가 (파일럿·개발 환경 대응)

---

## FR-SESSION-OPS — 세션 인증 전환 후 `operator` 역할 취득 불가

**발견**: 0.1.0-pilot.6 `AUTH_PROVIDER=github` 전환 후 저장소 등록 시도 (2026-09-15)
**현상**: `/ops/repositories` 등 운영 콘솔 화면이 `operator` 역할을 요구하지만, `GHE_TEAM_ROLE_MAP`에서 부여 가능한 역할은 `manager`·`qa` 뿐 (CR-015, DEV-049). `ADMIN_API_TOKENS`는 `AUTH_ENABLED=true`와 공존 불가 (DEV-048). 결과적으로 세션 인증 전환 후 어떤 방법으로도 `operator` 역할을 얻을 수 없음
**요청**: `GHE_TEAM_ROLE_MAP`에서 `operator` 매핑을 허용하거나, `/ops/*` 화면의 역할 요구사항을 `manager`로 조정

---

## DEV-048 운영 충돌 — `AUTH_ENABLED=true`와 `ADMIN_API_TOKENS` 공존 불가

**발견**: 0.1.0-pilot.6 반입 후 `AUTH_ENABLED=true` 전환 시 (2026-09-15)
**현상**: `search-api`가 기동 즉시 `OIDC 세션과 ADMIN_API_TOKENS를 함께 구성할 수 없다`로 crash-loop. 파일럿에서 `AUTH_ENABLED=false` → `true` 전환 시 이전 `.env`에 `ADMIN_API_TOKENS` 잔존이 전형적 함정임
**사내 임시 조치**: `.env`에서 `ADMIN_API_TOKENS=` 값 제거 후 `prsctl upgrade`
**요청**: `upgrade` 시 또는 `prsctl` health 판정 전에 이 충돌을 사전 감지해 명확한 안내 출력
