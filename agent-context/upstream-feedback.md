# Upstream Feedback

## M-번호 채번 — NULL-PR 커밋 및 unsupported profile 이 전체 채번을 차단 (버그)

**발견**: 0.1.0-pilot.11 사내 반입, `MNUMBER_ENABLED=true` 후 M-번호 채번 테스트 (2026-09-17)
**관련**: WP-074 / FR-SEQ-008 / DEV-581 / ADR-023 / 상세 설계 §2.2, §3

### 현상

`MNUMBER_ENABLED=true`로 활성화 후 `sequence-work-runner`이 `reconcile` 회차를 실행하지만,
**`pull_request_number IS NULL`인 첫 커밋에서 채번이 전체 중단**되며, 번호가 영영 부여되지 않는다.

```
"M 채번 회차 완료","repository_id":399,"base_branch":"main","seq_epoch":1,
"assigned":0,"blocked_seq":1,"blocked_reason":"negative_evidence_unavailable"
```

삼 저장소(119, 399, 1877) 모두 동일하게 merge_seq=1에서 `negative_evidence_unavailable`로 막혔다.

### 근본 원인

1. **NULL-PR 커밋이 blocker로 작용** — `pull_request_number IS NULL`인 커밋(직접 푸시 초기 커밋) 을
   `mnumber_evidence`에 `unresolved` / `negative_evidence_unavailable`로 기록하고,
   채번 planner 가 그 앞에서 중단한다. PR 머지가 뒤따라도 번호가 부여되지 않음.

2. **`unsupported_merge_profile`이 blocker로 작용** — squash-only 환경에서도 2-parent 머지 커밋이
   존재하면(예: 저장소 399의 seq=3), `unresolved` / `unsupported_merge_profile`로 기록되고
   동일하게 전체 채번이 중단됨. numbered 가 아닌 커밋은 번호 부여를 넘겨야 하는데 skip 하지 않음.

3. **흩어진 blocker 가 반복 중재를 필요로 함** — 한 저장소에 NULL-PR 커밋이 수십 개 흩어져 있으면
   (저장소 399 기준 41개, 1877 기준 17개), 각각에서 순차적으로 멈춘다. seq=1 통과 후 seq=2,
   seq=5, seq=13... 에서 다시 멈추며, 매번 수동 evidence 업데이트 + 블로커 해제 + work 큐 재투입 필요.

4. **워커가 수동 삽입 evidence 를 덮어씀** — `direct_confirmed`로 수동 업데이트한 기록을 워커의
   GHE API 조회가 `unresolved` / `negative_evidence_unavailable`로 다시 덮어씀.
   seq=1은 보존되었으나(타이밍상 워커 실행 전 업데이트 완료), seq=2 이상은 덮어씌워짐.

### 사내 임시 조치

`mnumber_evidence` 테이블에 직접 SQL 으로 `direct_confirmed` 기록 삽입 후,
`sequence_space` 블로커 초기화, `sequence_work` 큐에 reconcile 작업 수동 삽입 반복 수행.
1877 저장소 기준으로 167개 M-번호 부여 확인.

### 요청

1. **`unsupported_merge_profile`은 blocker 가 아니라 skip 대상으로 처리** — squash-only 프로파일에서
   2-parent 머지는 numbered 가 아니므로 번호를 부여하지 않으면서 다음 서수로 진행해야 함. 현재는 전체
   채번이 중단되는 것이 버그로 판단됨.

2. **squash-only 환경에서 NULL-PR 커밋은 자동 `direct_confirmed`** — 사내 squash-only 가 확정된 환경에서
   PR 이 없는 커밋은 직접 푸시로 99% 확정 가능. 설정 기반 자동 스킵 로직 필요. DEV-581 의 전제(PR 과
   직접 푸시가 혼재하는 환경)가 사내에 부합하지 않음.

3. **batch 내 unresolved 커밋은 skip 하며 진행** — 한 회차에서 모든 서수를 스캔하고, PR 이 있는 것부터
   번호 부여, 없는 건 건너뛰며 진행해야 함. 현재는 첫 unresolved 에서 전체가 중단됨.

---
