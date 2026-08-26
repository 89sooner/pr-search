# 배포 매니페스트 (WP-010, CR-034)

REL-001 배포 단위(`ingest-gateway`, `pipeline-worker` enrich/project, `search-api`)에
REL-003의 두 워커 역할이 더해졌다 — `sequence`, `reconcile` (CR-034, DEV-183).
`web`·`filebeat`·`gh-executor`와 나머지 역할은 그것을 소유한 WP가 더한다
(인프라 문서 3장).

**역할에 manifest가 없으면 그 기능은 배포되지 않는다.** WP-021~028이 만든
채번·재채번·정합성 점검·조정 스캔이 배포 단위 없이 "완료"로 기록돼 있던 것이
CR-034가 찾은 결함 하나다. 새 워커 역할을 만드는 WP는 manifest를 함께 낸다.

## 주기 스윕이 있는 역할은 replica 1이다

`pipeline-worker-sequence`와 `pipeline-worker-reconcile`은 이벤트 소비자이면서
**주기 스윕**을 함께 갖는다. 스윕에는 리더 선출이 없으므로 여러 파드가 같은
주기에 같은 대상을 중복 처리한다 — 결과가 틀리지는 않지만(채번은
`trySequenceSpaceLock`이, 큐는 `claimNextJob`의 advisory lock이 막는다) GHE 한도를
그만큼 더 쓰고, **한도 소진은 조정 스캔이 다음 주기로 미루는 조건**이라 자기
발등을 찍는다.

수평 확장이 필요하면 **리더 선출이나 claim 규칙을 먼저 세운다.** replica를 먼저
올리지 않는다.

## 적용 순서

인프라 3장이 정한 순서를 그대로 따른다. **어기면 워커가 없는 컬럼을 읽는다.**

```sh
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
# 시크릿은 저장소에 두지 않는다. secret.example.yaml을 보고 만든다.
kubectl apply -f migrate-job.yaml   # 1. DB 마이그레이션
kubectl wait --for=condition=complete job/prs-migrate -n pr-search --timeout=300s
kubectl apply -f pipeline-worker-enrich.yaml pipeline-worker-project.yaml   # 2. 워커 (REL-001)
kubectl apply -f pipeline-worker-sequence.yaml pipeline-worker-reconcile.yaml  #    워커 (REL-003)
kubectl apply -f pipeline-worker-mirror.yaml                                #    워커 (REL-003, 미러 PVC 포함)
kubectl apply -f search-api.yaml ingest-gateway.yaml                        # 3. API
```

**여기 없는 manifest는 배포되지 않는다.** `pipeline-worker-mirror.yaml`이 그 예였다 —
파일은 있고 회귀 시험도 그것을 확인했지만 이 목록에 없어, 절차를 따르는 운영자는
JOB-MIR-001·JOB-MIR-002를 **끝내 만들지 않았다** (CR-038 / PR #42 리뷰). 회귀 시험이
이제 `deploy/k8s/*.yaml` 전부가 이 목록에 있는지 함께 본다.

마이그레이션은 항상 하위 호환이어야 한다 (데이터 모델 7장). 파괴적 변경은
두 릴리스에 나눠 한다.

## 시크릿

`secret.example.yaml`에는 **자리표시자만** 있다. 실제 값은 사내 시크릿 관리에서
주입한다 (보안 문서 6장). 저장소에 커밋된 값은 시크릿이 아니다.

| 키 | 쓰는 곳 | 없으면 |
| --- | --- | --- |
| `GHE_WEBHOOK_SECRET` | 게이트웨이 서명 검증 | 모든 웹훅이 401 |
| `GHE_APP_ID`, `GHE_APP_PRIVATE_KEY` | 보강, 저장소 등록, 조정 스캔, 정합성 점검 API | `enrich`·`reconcile` 역할이 기동을 거부한다. search-api는 뜨되 **API-ADM-007을 등록하지 않고 기동 로그의 `capabilities`가 그 사실을 밝힌다** (CR-034, DEV-177) |
| `GHE_INSTALLATIONS` | `org → installationId` (CR-010, DEV-015) | 위와 같다 |
| `DATABASE_URL` | 전 서비스 | 기동 실패 |
| `ADMIN_API_TOKENS` | 관리 API (CR-013, DEV-030) | **관리 경로를 등록하지 않는다** |

`ADMIN_API_TOKENS`는 `이름:토큰` 쌍을 쉼표로 잇는다. 이름이 감사 기록의
주체가 되므로 사람마다 다른 값을 준다 — 하나를 공유하면 "누가 했는가"에
답할 수 없다. WP-012의 OIDC 세션이 이 통제를 대체한다.

## 지표

세 배포 단위 모두 `/metrics`를 노출하고 Prometheus 스크레이프 애노테이션을
갖는다. `search-api`가 `METRICS_QUERY_URL`로 지표 저장소를 **되질의**하는 것은
단계별 지연 하나뿐이다 (CR-013, DEV-029). 설정하지 않으면 그 항목만
`unavailable`로 나가고 나머지는 정상이다.

## 검증되지 않은 것

이 매니페스트는 **클러스터에 적용해 본 적이 없다.** 이 실행 환경에 Kubernetes가
없다. 문법은 `kubectl apply --dry-run=client`로도 확인하지 않았다 — `kubectl`
자체가 없다. REL-001 프로비저닝 때 실제 클러스터에서 확인해야 한다 (원장 7장).
