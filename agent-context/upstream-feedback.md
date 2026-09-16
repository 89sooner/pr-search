# Upstream Feedback

## DEV-smoke-worker-roles — `prsctl smoke` 워커 기동 로그 9/10 간헐적 실패

**발견**: 0.1.0-pilot.8 반입 후 smoke 실행 (2026-09-16)
**현상**: `prsctl smoke`가 `✗ 워커 기동 로그 9/10`을 보고하며 실패. `prsctl health`는 전 서비스 정상. `compose logs --tail 200 worker-*` 수동 확인 시 10개 전부 `roles:` 포함. smoke 스크립트 루프에서 한 워커의 `compose logs` 호출이 빈 결과를 반환하는 타이밍 이슈로 추정
**사내 임시 조치**: `prsctl health` 결과로 운영 판정. smoke 9/10는 무시
**요청**: smoke 워커 로그 확인에 재시도 로직 추가 또는 `prsctl health`와 동일 방식으로 교체

---

## DEV-bundle-offline — `--release` 없는 사내 빌드 절차 (RUNBOOK 2.A 보완)

**발견**: 0.1.0-pilot.8-rc 빌드 시도 (2026-09-16)
**현상**: 사내 빌드 머신(WSL2)에서 Docker 컨테이너가 외부 네트워크(npmjs.org, dl-cdn.alpinelinux.org)에 접근 불가. 호스트는 접근 가능. `build-bundle.sh`를 그대로 실행하면 `pnpm install`과 `apk add git`이 `ECONNRESET`/`TLS handshake timeout`으로 실패.

**사내 우회 절차 요약**:

1. `npm install -g verdaccio && verdaccio --listen 0.0.0.0:4873 &` — 호스트에서 npm 프록시 실행
2. 커스텀 `node:22-alpine` 이미지 빌드 — pnpm 캐시 + verdaccio ENV(`npm_config_registry=http://172.17.0.1:4873`) + git(기존 pilot 이미지에서 복사) 포함
3. docker 래퍼 스크립트 생성 — 코드 변경 없는 타겟(pipeline-worker, migrate, es-bootstrap, gh-executor)은 기존 이미지 재태깅하고 빌드 건너뜀
4. `PATH=/tmp/docker-wrapper:$PATH ./deploy/single-host/build-bundle.sh <버전>` 실행

**요청**: RUNBOOK 2.A 「외부망 — 번들 생성」에 「Docker 컨테이너 외부 네트워크 차단 환경에서의 빌드 절차」 항목 추가

---
