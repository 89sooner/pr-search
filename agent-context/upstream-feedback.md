# Upstream Feedback

---

## DEV-561 — `git` 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패

> **상류 반영 완료 (2026-09-11, `CR-082`).** `compose.yml`의 `x-app-env` 앵커에 `GIT_SSL_CAINFO`를 더해 `git`을 부르는 세 서비스에 한 자리로 닿게 했고, `.env.example`과 런북 6장·8장을 갱신했다. 회귀가 서비스별 최종 환경 키 집합을 계산해 그것을 강제한다. 원장 `DEV-561` **resolved**, 검증 6.77장.
>
> **사내에서 할 것:** 다음 반입에서 임시 조치(`.env`와 `compose.yml` 직접 수정)를 되돌리고 번들 기본값으로 미러 초기화가 성립하는지 확인한다. `.env`의 `GIT_SSL_CAINFO`는 그대로 두면 된다 — 이제 상류가 같은 키를 읽는다. 사내 재적용은 아직 `NOT RUN`이다.

**발견**: 0.1.0-pilot.4 업그레이드 중 (2026-09-11)
**현상**: JOB-MIR-001(git clone) 실행 시 `SSL certificate problem: unable to get local issuer certificate`
**원인**: `NODE_EXTRA_CA_CERTS`는 Node.js 런타임만 읽는다. git 서브프로세스는 별도로 `GIT_SSL_CAINFO`를 받아야 한다 (RUNBOOK 6장에 명시됨, 실제 compose.yml에는 없었다)
**사내 임시 조치**: `.env`에 `GIT_SSL_CAINFO=/certs/ghe-ca.crt`, compose.yml x-app-env에 `GIT_SSL_CAINFO: ${GIT_SSL_CAINFO:-}` 추가

### 반영해야 할 파일

**`deploy/single-host/compose.yml`**

- `x-app-env` 앵커의 `NODE_EXTRA_CA_CERTS:` 바로 아래에 추가:
  ```yaml
  NODE_EXTRA_CA_CERTS: ${NODE_EXTRA_CA_CERTS:-}
  GIT_SSL_CAINFO: ${GIT_SSL_CAINFO:-} # ← 이 줄 추가
  ```

**`deploy/single-host/.env.example`**

- `NODE_EXTRA_CA_CERTS=` 아래에 추가:
  ```
  GIT_SSL_CAINFO=                # git 서브프로세스용 CA 파일 경로. NODE_EXTRA_CA_CERTS와 같은 값을 준다 (컨테이너 안 경로)
  ```

**`deploy/single-host/RUNBOOK.md`**

- 6장 「사설 CA」 절에 추가:
  ```
  **`git` 서브프로세스는 `NODE_EXTRA_CA_CERTS`를 보지 않는다.** 미러 초기화(JOB-MIR-001)와
  미러 fetch는 git을 직접 호출하므로, `.env`의 `GIT_SSL_CAINFO`에 컨테이너 안 CA 파일 경로를
  따로 설정해야 한다. `NODE_EXTRA_CA_CERTS`와 같은 값을 준다 (DEV-561).
  ```
- 8장 문제 해결 표에 추가:
  ```
  | JOB-MIR-001이 SSL 오류로 실패하고 미러 볼륨이 비어 있다
  | git이 사내 CA를 신뢰하지 않는다. `.env`에 GIT_SSL_CAINFO=/certs/ghe-ca.crt 추가,
    compose.yml x-app-env에 GIT_SSL_CAINFO: ${GIT_SSL_CAINFO:-} 추가 후 prsctl upgrade (DEV-561) |
  ```

**`docs/40_delivery/pr_search_implementation_traceability.md`**

- 5장 DEV 표 상단에 추가:
  ```
  | DEV-561 | 2026-09-11 | git 서브프로세스가 사내 CA를 신뢰하지 않아 JOB-MIR-001 실패.
    NODE_EXTRA_CA_CERTS는 Node.js만 읽고 git은 GIT_SSL_CAINFO를 별도로 필요로 한다.
    compose.yml x-app-env와 .env.example에 GIT_SSL_CAINFO 항목 추가 필요 |
    worker-mirror / JOB-MIR-001 | 운영 발견 | 없음 | open |
  ```

---

## FR-NEW — 사내 GHE OAuth2 직접 인증 지원

**요청 배경**: 사내망 배포 환경에서 별도 OIDC IdP(Keycloak 등) 없이 **이미 있는 사내 GHE 계정으로 바로 로그인**하고 싶다. 현재 코드는 표준 OIDC(JWT + JWKS 검증)만 지원하는데, 사내 GHE는 OIDC 디스커버리 엔드포인트가 없어 직접 쓸 수 없다. Dex 같은 미들웨어를 따로 띄우는 것은 운영 부담이 크다.

**추가 요청**: 파일럿·개발 환경에서 TLS 없이 테스트할 수 있도록 `SESSION_COOKIE_SECURE=false` + `NODE_ENV=production` 조합을 허용하는 옵션도 함께 검토해달라. 현재 코드가 이 조합에서 web 기동을 거부한다 (DEV-577).

### 필요한 변경

**인증 흐름 추가**

- `AUTH_PROVIDER=github` 같은 새 환경 변수로 OIDC/GHE 중 선택
- GHE OAuth2 Authorization Code Flow 구현:
  - 인가: `https://<GHE_BASE_URL>/login/oauth/authorize`
  - 토큰: `https://<GHE_BASE_URL>/login/oauth/access_token`
  - 사용자 정보: `https://<GHE_API_URL>/user` + `/user/teams`
- 기존 OIDC 흐름은 그대로 유지 (하위 호환)

**권한(Role) 매핑**

- OIDC의 `OIDC_GROUP_ROLE_MAP`(그룹 클레임 기반) 대신 GHE 팀/조직 멤버십으로 역할 결정
- 예: `GHE_TEAM_ROLE_MAP=cpswdev-team/pipe-admins=admin,cpswdev-team/pipe-users=viewer`
- GHE App 자격(`GHE_APP_ID`, `GHE_APP_PRIVATE_KEY`)이 이미 있으므로 팀 멤버십 조회 가능

**`.env.example` 추가 항목**

```
# GHE OAuth2 인증 (OIDC 대신 사내 GHE를 직접 쓸 때)
AUTH_PROVIDER=oidc          # oidc(기본) | github
GHE_OAUTH_CLIENT_ID=        # GHE에 등록한 OAuth App의 Client ID
GHE_OAUTH_CLIENT_SECRET=    # GHE OAuth App의 Client Secret
GHE_TEAM_ROLE_MAP=          # <org>/<team>=<role> 쌍, 쉼표 구분
```

**`SESSION_COOKIE_SECURE` 완화 (선택)**

- `NODE_ENV=production` + `SESSION_COOKIE_SECURE=false` 조합을 `AUTH_ENABLED=false` 일 때만 허용하는 방향으로 검토
- 또는 별도 `ALLOW_INSECURE_COOKIES=true` 명시 플래그로 분리
