# 구현 작업 워크플로

## 1. 목적

본 문서는 PR Search 문서 세트를 아이디어에서 구현·동기화까지 어떤 순서와 게이트로 진행할지 정의한다.

## 2. 작업 원칙

1. 항상 상위 요구사항을 먼저 확인하고 파생 문서는 그 다음에 본다.
2. 각 Phase는 게이트를 통과해야 다음 Phase로 넘어간다. 게이트 통과는 `change_control.md`에 기록한다.
3. 충돌이 발생하면 `srs_final.md`를 기준으로 되돌아간다.
4. 구현 전 범위, 우선순위, 예외 상태, 권한 정책을 잠근다(`baseline`).
5. 구현 완료 판단은 WP의 완료 기준과 QA 체크리스트, 상태 매트릭스까지 통과해야 한다.

## 3. Phase 정의

### Phase 0. 인테이크

- 입력: 제품 아이디어, 참고 제품, 소스 문서, 인터뷰, 제약
- 산출물: 대상 사용자, 목표, 명시적 제외, 가정, 오픈 결정(OD), 초기 용어(glossary)
- 게이트: 핵심 사실이 없으면 가정/OD로 기록되어 있는가

### Phase 1. 요구사항 확정

- 작성: `feature.md` -> `prd.md` -> `glossary.md` -> `srs_final.md`
- 게이트: 모든 FR이 수용 기준과 검증 방법을 가지는가, 모호어가 없는가, Must FR에 미결 OD가 없는가

### Phase 2. 추적성

- 작성: `requirements_screen_traceability_matrix.md`
- 게이트: 승인된 모든 FR이 화면 또는 간접 노출 지점과 연결되는가

### Phase 3. 화면 번역

- 작성: IA -> wireframe -> flow -> state -> component -> tokens -> QA checklist
- 게이트: 모든 화면 ID가 IA에 선언되고, 상태/예외/권한이 정의되는가

### Phase 4. 기술 아키텍처

- 작성: system -> frontend -> backend -> API -> data -> async -> security -> infra -> observability -> ADR
- 게이트: 고위험 요구사항이 FE/BE/API/데이터/인프라 작업으로 매핑되는가, 스택 결정이 ADR로 기록되는가

### Phase 5. 딜리버리 계획

- 작성: `implementation_roadmap.md` -> `release_validation_plan.md` -> `work_packages.md`
- 게이트: 모든 REL이 WP로 분해되고, 각 WP가 FR 참조와 검증 가능한 완료 기준을 가지는가

### Phase 6. 핸드오프

- 작성: `ai_agent_implementation_request.md` -> `ai_agent_execution_brief.md`
- 선행: `srs_final.md` 상태를 사용자 승인으로 `baseline` 설정, validator `--strict` 통과
- 게이트: 브리프만 읽은 에이전트가 첫 WP를 실행할 수 있는가

### Phase 7. 구현 실행과 동기화

- 실행: WP 단위 구현 -> DoD 검증 -> `implementation_traceability.md` 갱신
- 동기화: 문서/코드 불일치는 DEV 등록 -> CR -> cascade 갱신 -> WP 상태 재설정
- 게이트: 원장이 커밋/PR과 일치하고, 열린 DEV가 모두 CR로 연결되어 있는가

## 4. 검증 명령

```bash
python3 <skill-dir>/scripts/validate_srs_prd_env.py --root .            # 오류/경고
python3 <skill-dir>/scripts/validate_srs_prd_env.py --root . --report   # 단계 판정과 다음 작업
python3 <skill-dir>/scripts/validate_srs_prd_env.py --root . --strict   # 핸드오프 게이트
```

## 5. 요구사항 변경 시 역방향 갱신

요구사항이 바뀌면 `change_control.md`에 CR을 등록하고 `srs_final.md`부터 시작해 `docs/README.md`의 cascade 순서대로 갱신한 뒤, cascade 기록과 validator 결과로 CR을 종료한다.
