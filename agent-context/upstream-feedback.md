# Upstream Feedback

---

## DEV-561 — `git` 서브프로세스가 사내 CA를 신뢰하지 않아 미러 초기화 실패

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
