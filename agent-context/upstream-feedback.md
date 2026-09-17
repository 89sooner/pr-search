# Upstream Feedback

## M-번호 채번 — NULL-PR 커밋 및 unsupported profile 이 전체 채번을 차단 (버그)

> **2026-09-17: 이 항목을 `CR-100`(WP-088, 원장 6.94장)으로 처리했다.** 요청 1·2는 **운영자 확인서**(`prsctl mnumber attest`)로, 관찰 4는 결함 수정(`DEV-715`)으로 반영했고, 요청 3은 기각했다. 사내 임시 조치(SQL 근거 삽입·blocker 초기화·work 재투입)는 더 이상 필요 없다 — 손으로 넣은 `direct_confirmed` 행은 그대로 유효하고 워커가 덮지 않는다. 다음 반입 뒤 `./prsctl mnumber attest --repository-id 399 --base-branch main --seq-epoch 1 --reason "…"`를 실행하고(RUNBOOK 7.D) `worker-sequence` 로그의 `attested`·`assigned`와 세 저장소의 M 번호가 끝까지 붙는지 이 항목 아래에 적어 달라.

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

> **상류 반영 (`CR-100` / `DEV-715`) — 원인은 경합이었다.** 회차는 근거를 트랜잭션 밖에서 읽고 GHE를 조회한 뒤 트랜잭션에서 저장하는데, 그 사이에 넣은 `direct_confirmed`를 오래된 읽기로 판정한 `unresolved`가 덮었다(seq=1은 회차가 읽기 전에 넣어서 살아남았다). 이제 트랜잭션 안에서 잠근 채 다시 읽어 근거가 바뀌었으면 그 회차를 버리고 다음 회차가 새 근거로 판정하며, SQL도 확정 → 미확정을 거절한다.

### 사내 임시 조치

`mnumber_evidence` 테이블에 직접 SQL 으로 `direct_confirmed` 기록 삽입 후,
`sequence_space` 블로커 초기화, `sequence_work` 큐에 reconcile 작업 수동 삽입 반복 수행.
1877 저장소 기준으로 167개 M-번호 부여 확인.

### 요청

1. **`unsupported_merge_profile`은 blocker 가 아니라 skip 대상으로 처리** — squash-only 프로파일에서
   2-parent 머지는 numbered 가 아니므로 번호를 부여하지 않으면서 다음 서수로 진행해야 함. 현재는 전체
   채번이 중단되는 것이 버그로 판단됨.

> **상류 반영 (`CR-100` / FR-SEQ-008 AC-15) — 확인서가 있으면 지나간다.** 무조건 스킵으로 만들지 않은 이유: 2-parent 커밋이 실제로는 merge-commit으로 머지된 PR일 수 있고(AC-1은 PR이 있는 항목마다 번호를 준다), AC-9는 머지·리베이스 항목을 직접 푸시로 오판하지 않는다고 정한다. 그래서 「이 저장소의 프로파일 밖 항목은 번호 없이 지나간다」는 판단을 운영자가 확인서로 내리고, 시스템은 그 결정을 근거(`operator_attestation`, `proof.attestation_id`)로 남긴다.

2. **squash-only 환경에서 NULL-PR 커밋은 자동 `direct_confirmed`** — 사내 squash-only 가 확정된 환경에서
   PR 이 없는 커밋은 직접 푸시로 99% 확정 가능. 설정 기반 자동 스킵 로직 필요. DEV-581 의 전제(PR 과
   직접 푸시가 혼재하는 환경)가 사내에 부합하지 않음.

> **상류 반영 (`CR-100` / AC-15) — 「설정 기반 자동 스킵」 대신 확인서.** DEV-581의 전제는 「PR과 직접 푸시가 혼재하는 환경」이 아니라 「공식 GHE 읽기 계약에 부재 증서가 없다」는 것이었고, 그것은 squash-only 환경에서도 같다 — 방금 squash된 PR을 검색 색인이 아직 모르면 빈 응답이 온다. 확인서는 설계 2.2가 열어 둔 「사내 승인된 증거 소스」이며, 유예(기본 24시간, 커밋의 `committed_at` 기준, `--grace-hours`)가 늦은 PR 정보에 먼저 확정될 기회를 준다. 과거 이력(41·17건)은 첫 회차에 한 번에 지나가고, 새 직접 푸시는 유예 뒤 러너가 스스로 다시 본다. 확인서는 (저장소, 브랜치, 에폭)마다 하나이고 force-push로 에폭이 오르면 새 확인서가 필요하며, `--through-seq`로 과거 이력만 덮을 수도 있다.

3. **batch 내 unresolved 커밋은 skip 하며 진행** — 한 회차에서 모든 서수를 스캔하고, PR 이 있는 것부터
   번호 부여, 없는 건 건너뛰며 진행해야 함. 현재는 첫 unresolved 에서 전체가 중단됨.

> **기각 (`CR-100`).** 「PR이 있는 것부터 번호를 주고 없는 건 건너뛰며 진행」은 앞 항목이 나중에 PR로 확인될 때 뒤 번호가 밀린다는 뜻이고, 그것이 FR-SEQ-008 AC-2(빈틈 없는 조밀 서수)·AC-3(앞이 미확정이면 멈추고 이미 부여된 번호는 옮기지 않는다)가 금지하는 바로 그 일이다 — 과거에 인용된 M 번호가 조용히 다른 PR을 가리키게 된다. 확인서가 1·2를 해결하면 흩어진 blocker(근본 원인 3)도 한 확인서로 한 회차에 지나가므로 반복 중재가 사라진다.

---
