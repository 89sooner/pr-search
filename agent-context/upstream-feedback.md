# Upstream Feedback

---

## DEV-577 companion — `SESSION_COOKIE_SECURE=false` 허용 플래그 미구현

> **상류 반영 완료 (2026-09-15, `CR-091` / `DEV-694`, PR #191).** `ALLOW_INSECURE_COOKIES=true`를 `SESSION_COOKIE_SECURE=false`와 **함께** 적으면 인증을 켠 채 기동한다(파일럿 전용, 두 값 모두 필요). 기동마다 web 로그와 `./prsctl health`가 경고한다. **쿠키 이름이 `prs_session`·`prs_oidc`로 바뀐다** — `__Host-` 접두 쿠키는 `Secure` 없이 브라우저가 저장하지 않아, 플래그만 두면 같은 자리에서 다시 실패했을 것이다. GHE OAuth App callback도 `http://`로 맞춘다. 절차는 런북 6장 「운영에는 TLS가 필요하다」. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.6 반입 후 로그인 시도 (2026-09-15)
**현상**: `AUTH_PROVIDER=github`으로 GHE OAuth 로그인 시도 시, `GHE_OAUTH_REDIRECT_URI=http://{호스트}/auth/callback`(HTTP)으로 설정했을 때 OAuth state 쿠키(`Secure` 속성)를 브라우저가 콜백 시 전송 거부 → `왕복 쿠키가 없거나 읽을 수 없다`로 인증 실패. `SESSION_COOKIE_SECURE=false` + `NODE_ENV=production` 조합은 `web`이 기동 자체를 거부해 우회 불가
**올바른 구성**: `GHE_OAUTH_REDIRECT_URI=https://{호스트}/auth/callback` + TLS 필수
**요청**: `ALLOW_INSECURE_COOKIES=true` 명시 플래그 또는 동등한 완화 조치 추가 (파일럿·개발 환경 대응)

---

## FR-SESSION-OPS — 세션 인증 전환 후 `operator` 역할 취득 불가

> **상류 반영 완료 (2026-09-15, `CR-091` / `DEV-695`, PR #191) — 제안과 다르게 고쳤다.** 원인은 경계가 아니라 **관리자 지정 경로가 코드에 없었던 것**이다(역할 합집합이 요청 경로에 없었고 지정 명령도 없었다). 팀 매핑에 `operator` 허용·`/ops/*`를 `manager`로 하향은 CR-015 경계를 넓혀 택하지 않았다(사용자 결정). 대신: 운영자가 한 번 로그인한 뒤 서버에서 `./prsctl role grant <GHE 로그인> operator` → 화면 새로 고침(재로그인 불필요). `list`·`revoke`도 있고 감사에 남는다. 절차는 런북 6장 「운영 역할 지정하기」. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.6 `AUTH_PROVIDER=github` 전환 후 저장소 등록 시도 (2026-09-15)
**현상**: `/ops/repositories` 등 운영 콘솔 화면이 `operator` 역할을 요구하지만, `GHE_TEAM_ROLE_MAP`에서 부여 가능한 역할은 `manager`·`qa` 뿐 (CR-015, DEV-049). `ADMIN_API_TOKENS`는 `AUTH_ENABLED=true`와 공존 불가 (DEV-048). 결과적으로 세션 인증 전환 후 어떤 방법으로도 `operator` 역할을 얻을 수 없음
**요청**: `GHE_TEAM_ROLE_MAP`에서 `operator` 매핑을 허용하거나, `/ops/*` 화면의 역할 요구사항을 `manager`로 조정

---

## DEV-048 운영 충돌 — `AUTH_ENABLED=true`와 `ADMIN_API_TOKENS` 공존 불가

> **상류 반영 완료 (2026-09-15, `CR-091` / `DEV-696`, PR #191).** `./prsctl load`·`install`·`upgrade`·`health`가 시작 전에 이 공존을 search-api와 같은 판정으로 보고 **컨테이너를 바꾸기 전에** 멈추며 처방(값 비우기, `prsctl role grant`)을 말한다. 같은 자리에서 `ALLOW_INSECURE_COOKIES` 오타와 플래그 없이 `Secure`만 끈 구성도 먼저 멈춘다. 사내 확인은 `NOT RUN`.

**발견**: 0.1.0-pilot.6 반입 후 `AUTH_ENABLED=true` 전환 시 (2026-09-15)
**현상**: `search-api`가 기동 즉시 `OIDC 세션과 ADMIN_API_TOKENS를 함께 구성할 수 없다`로 crash-loop. 파일럿에서 `AUTH_ENABLED=false` → `true` 전환 시 이전 `.env`에 `ADMIN_API_TOKENS` 잔존이 전형적 함정임
**사내 임시 조치**: `.env`에서 `ADMIN_API_TOKENS=` 값 제거 후 `prsctl upgrade`
**요청**: `upgrade` 시 또는 `prsctl` health 판정 전에 이 충돌을 사전 감지해 명확한 안내 출력
