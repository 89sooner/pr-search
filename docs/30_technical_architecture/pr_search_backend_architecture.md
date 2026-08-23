# PR Search 백엔드 아키텍처

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

백엔드 모듈, 도메인 경계, 권한/정책 검사, 오케스트레이션, 외부 연동, 트랜잭션, 실패 처리를 정의한다. 이 문서는 `../10_requirements/srs_final.md`의 승인 범위를 구현 구조로 번역하며 범위를 추가하지 않는다.

스택 결정은 ADR-001(전 계층 TypeScript), ADR-002(이벤트 버스), ADR-004(PostgreSQL SoR), ADR-005(미러 우선), ADR-008(권한 강제)을 따른다.

## 2. 워크스페이스 구조

```text
packages/
  domain/       @prs/domain      도메인 타입, 시퀀스 공간, 관계 유형, 상수
  query/        @prs/query       구조화 질의 파서와 AST (서버·클라이언트 공용)
  contracts/    @prs/contracts   API DTO, 오류 코드
  es/           @prs/es          Elasticsearch 매핑 정의와 질의 빌더
  db/           @prs/db          PostgreSQL 스키마, 마이그레이션, 리포지터리
  github/       @prs/github      GHE REST 클라이언트, rate limit 관리, 미러 실행기
  bus/          @prs/bus         EventBus 포트와 Redis Streams 어댑터
apps/
  ingest-gateway/   웹훅 수신 HTTP 서비스
  pipeline-worker/  역할별 워커 (enrich / project / sequence / link / batch)
  search-api/       조회 HTTP 서비스
  web/              Next.js 대시보드
```

의존 방향은 `domain → query/contracts/es/db/github/bus → apps` 단방향이다. 역방향 참조를 CI에서 차단한다.

## 3. 모듈 맵

| 모듈 | 소속 앱 | 책임 | 관련 요구사항 | API | 데이터 |
| --- | --- | --- | --- | --- | --- |
| `ingestion` | ingest-gateway | 서명 검증, 원본 저장, 멱등, 아웃박스 enqueue, NDJSON 아카이브 | FR-ING-001, FR-ING-002, FR-ING-003, FR-ING-010 | API-ING-001 | ENT-ING-001 |
| `enrichment` | pipeline-worker | GHE API·미러에서 커밋·파일·리뷰 조회 후 병합 | FR-ING-004 | - | ENT-CORE-002, ENT-CORE-003 |
| `projection` | pipeline-worker | 정규화 문서 생성, 버전 조건부 업서트 | FR-ING-005 | - | ENT-CORE-002, ENT-CORE-003, ENT-REL-001 |
| `sequence` | pipeline-worker, search-api | first-parent 서수 채번, 에폭 관리, 앵커 정규화, 범위 조회, 이분 탐색, 안전 구간 표식 | FR-SEQ-001~007, FR-ADMIN-003 | API-SEQ-001~005 | ENT-SEQ-001~004 |
| `link` | pipeline-worker, search-api | 참조·되돌림·체리픽·스택 간선 파생, 관계 조회, 그래프 탐색 | FR-REL-002~008 | API-REL-001~004 | ENT-REL-002 |
| `search` | search-api | 식별자 해석, 질의 파싱, 필터·정렬·커서·패싯, 전문 검색, 저장된 검색, 내보내기 | FR-SRCH-001~012 | API-SRCH-001~006 | ENT-CORE-002, ENT-CORE-003, ENT-CORE-006 |
| `analytics` | search-api | 그룹·시계열·백분위·분포 집계 | FR-STAT-001~006 | API-STAT-001~004 | ENT-CORE-002 |
| `authz` | search-api (공용 미들웨어) | OIDC 세션, 접근 범위 산출·캐시, 강제 필터 결합 | FR-AUTH-001~003 | API-AUTH-001 | ENT-CORE-004, ENT-CORE-005 |
| `audit` | search-api, pipeline-worker | 감사 기록 적재·조회 | FR-AUTH-004 | API-ADM-005 | ENT-CORE-007 |
| `registry` | search-api | 저장소 등록·해제, 시퀀스 대상 브랜치 관리 | FR-ING-009 | API-ADM-001 | ENT-CORE-001 |
| `jobs` | pipeline-worker, search-api | 백필·조정 스캔·재색인·정합성 점검 잡 제어와 진행률 | FR-ING-006, FR-ING-008, FR-ING-011, FR-ADMIN-002 | API-ADM-002, API-ADM-004, API-ADM-007 | ENT-ING-004 |
| `ops` | search-api | 파이프라인 지표, 실패 대기열 조회·재처리 | FR-ING-007, FR-ADMIN-001 | API-ADM-003, API-ADM-006 | ENT-ING-002 |

## 4. 핵심 처리 경로

### 4.1 수집 게이트웨이 (FR-ING-001~003)

```ts
// apps/ingest-gateway — 처리 순서. 이 순서가 곧 무손실 보장이다.
async function handleWebhook(req) {
  const raw = await readRawBody(req);                      // 원문 그대로. 파싱 전 서명 검증
  if (!verifyHmacSha256(raw, req.headers['x-hub-signature-256'], secret)) {
    metrics.rejected.inc();
    return reply(401);                                     // payload 저장하지 않음 (AC-2)
  }
  if (raw.length > 25 * 1024 * 1024) return reply(413);    // AC-6

  const deliveryId = req.headers['x-github-delivery'] ?? sha256(canonicalize(raw));  // AC-4
  const correlationId = randomUUID();

  try {
    await db.tx(async (t) => {
      await t.insertRawEvent({ deliveryId, ..., queuedAt: now() });  // UNIQUE 충돌 시 예외
    });
  } catch (e) {
    if (isUniqueViolation(e)) { metrics.duplicate.inc(); return reply(202); }  // AC-2
    return reply(500);                                     // GHE 재전송 유도
  }

  await archiveWriter.append(ndjsonLine);                  // 레인 B. 실패해도 레인 A에 영향 없음
  await bus.publish('ingest', String(repositoryId), envelope);  // 실패해도 아웃박스가 복구
  return reply(202);                                       // 여기까지 p95 300ms (AC-4)
}
```

중요한 순서 규칙: **서명 검증 → durable 저장 → 응답**. 큐 enqueue 실패는 202를 막지 않는다. `raw_event.queued_at`이 있고 `processed_at`이 없는 행을 아웃박스 재적재 잡(`JOB-ING-007`)이 복구하기 때문이다.

### 4.2 보강 (FR-ING-004)

```text
enrich 워커
  ├─ 미러 사용 가능? ── 예 → git 명령으로 커밋 목록·부모·patch-id 확보
  │                    아니오 → GHE REST로 커밋 목록 확보
  ├─ 변경 파일: GHE REST /pulls/{n}/files (미러로는 얻지 않음 — blobless라 diff 불가)
  ├─ 리뷰: GHE REST /pulls/{n}/reviews
  ├─ rate limit 잔여 < 10% → 지연 + 한도 회복 시각에 재시도 예약 (AC-2)
  └─ 실패 → 부분 문서를 enrichment_pending: true 로 먼저 색인 (AC-3)
```

**핸들러 처분 (CR-010, DEV-014).** enrich 핸들러는 던지거나 정상 반환하는 대신 처분을 돌려준다.

| 상황 | 처분 | 재시도 예산 |
| --- | --- | --- |
| 네트워크·5xx·타임아웃 | `retry` | 소비 (5회) |
| 주 한도 소진, `retry-after` | `defer(retryAt)` | **소비하지 않음** |
| 404 (삭제된 PR), 필수 식별자 없음 | `dead_letter` | - |
| 정상 (부분 성공 포함) | `ack` | - |

`defer`가 없으면 한도 회복까지 30초마다 재전달되어 회복 전에 5회를 소진하고 멀쩡한 이벤트가 실패 대기열로 간다.

**보강 결과를 별도 테이블에 두지 않는 이유 (CR-010, DEV-013).** `EVT-ING-002`가 투영에 필요한 것을 다 실어 보낸다. 중간 테이블을 두면 쓰기가 한 번 더 늘고, 그 테이블의 보존·정리 규칙을 또 정해야 한다. 원본이 필요하면 `raw_event`가 있고(ADR-004) 그것이 시스템 오브 레코드다. 대신 이벤트 크기를 묶어 둔다 — 커밋 250건, 파일 3000건, patch/diff·소스 코드 없음.

**부분 문서 우선 색인이 이 설계의 요점이다.** 보강은 외부 의존이라 언제든 느려질 수 있는데, 그 때문에 PR이 검색에 아예 나타나지 않으면 "방금 머지한 PR이 안 보인다"는 최악의 사용자 경험이 된다. 웹훅 payload만으로 만들 수 있는 필드(번호, 제목, 작성자, 브랜치, 머지 시각, 머지 커밋 SHA)를 먼저 색인하면 SHA→PR 역추적의 핵심 경로는 즉시 동작한다.

`@prs/github`의 rate limit 관리:

- 저장소가 속한 조직별로 GitHub App 설치 토큰을 발급받아 토큰 풀을 구성한다.
- 응답 헤더의 `x-ratelimit-remaining` / `x-ratelimit-reset`을 읽어 토큰별 잔여를 추적한다.
- 잔여 10% 미만 토큰은 회복 시각까지 풀에서 제외한다.
- `secondary rate limit`(429 + `retry-after`) 수신 시 해당 토큰을 지정 시간만큼 격리한다.
- 백필 워커와 실시간 워커가 같은 풀을 쓰되, 실시간이 우선 배분을 받는다.

### 4.2.1 실패 격리와 재처리 (FR-ING-007)

```
워커 (enrich | project)
  └─ 표준 재시도 5회 소진, 또는 재시도 불가 오류
       └─ dead_letter 업서트 (delivery_id, stage) ─ 유일 제약이 멱등 키다
            └─ ack 해서 파티션을 푼다 (CR-010: dead_letter 처분)

ops 모듈 (search-api)
  GET  /api/v1/admin/dead-letters              ─ 단계·상태·저장소 필터
  POST /api/v1/admin/dead-letters/reprocess
       └─ raw_event에서 원본 조회 (delivery_id)
            ├─ 없음 → skipped: raw_event_missing
            └─ 있음 → EVT-ING-001 재발행 (prs:ingest) + state = 'reprocessing'
                        └─ 파이프라인이 처음부터 다시 돈다 (멱등)
                             ├─ 성공 → project가 processed_at을 찍는 자리에서 resolved
                             └─ 실패 → 업서트가 reprocess_count += 1, 3회면 held
```

**재처리가 성공을 스스로 확인하지 않는 이유.** 재투입은 비동기다. API가 응답할 시점에 파이프라인은 아직 돌지도 않았다. 그래서 "성공"의 판정을 API가 아니라 **끝까지 간 자리**에 둔다 — 투영이 `raw_event.processed_at`을 찍는 그 지점이다. 거기 말고 성공을 아는 곳이 없다.

**재처리 결과를 폴링으로 기다리지 않는다.** 운영자는 목록을 다시 조회해 상태가 `resolved`로 바뀌었는지 본다. A-001이 30초 주기로 지표를 갱신하는 것과 같은 리듬이다.

### 4.3 시퀀스 채번 (FR-SEQ-001, FR-SEQ-005)

```ts
// packages/domain + apps/pipeline-worker (sequence 역할)
async function assignSequence(repositoryId: number, baseBranch: string) {
  return db.tx(async (t) => {
    const locked = await t.tryAdvisoryLock(`seq:${repositoryId}:${baseBranch}`);
    if (!locked) { return deferUntil(in5s, 'sequence_space_locked'); }  // 대기하지 않고 미룬다 (AC-6)

    const space = await t.getSequenceSpace(repositoryId, baseBranch);
    const newHead = await graph.resolveHead(repositoryId, baseBranch);   // 미러 또는 API

    if (space.headSha && !(await graph.isAncestor(space.headSha, newHead))) {
      return reassign(t, space, newHead);                       // FR-SEQ-005
    }

    const range = space.headSha ? `${space.headSha}..${newHead}` : newHead;
    const shas = await graph.firstParentRevList(repositoryId, baseBranch, range);  // --reverse

    let seq = space.headSeq;
    for (const sha of shas) {
      seq += 1;
      await t.upsertMergeSequence({ repositoryId, baseBranch, epoch: space.seqEpoch,
                                    mergeSeq: seq, commitSha: sha });   // 멱등 (AC-4)
    }
    await t.updateSequenceSpace({ headSha: newHead, headSeq: seq, state: 'ok' });
    await bus.publish('sequence.assigned', String(repositoryId), { from: space.headSeq, to: seq });
  });
}

async function reassign(deps, repository, baseBranch, storedHead, newHead) {
  // 1) 밖에서 보이는 상태. 본 작업은 트랜잭션 하나라 그 안의 상태 변경은
  //    커밋 전까지 아무도 못 본다 — 표시가 먼저 따로 커밋되어야 한다.
  await markReassigning(pool, ...);

  return tx(async (t) => {                                      // 실패 시 통째로 롤백 — 부분 상태 없음
    if (!(await trySequenceSpaceLock(t, ...))) return rewritten; // 다음 회차가 잇는다
    const space = await findSequenceSpace(t, ...);
    if (space.headSha !== storedHead) return skipped;           // 그새 누가 처리했다 — 옛 판정으로 안 잇는다

    const base = await graph.mergeBase(ref, storedHead, newHead);
    let baseSeq = base ? await findSeqByCommit(t, ..., space.seqEpoch, base) : null;
    // **merge-base가 first-parent 체인 밖일 수 있다 (CR-026, DEV-125).**
    // 못 찾으면 처음부터 전부 다시 건다 — walk가 결정론이라 히스토리가 같은
    // 구간은 같은 서수가 재현되므로, 복사는 최적화지 정확성의 조건이 아니다.
    if (baseSeq === null) { baseSeq = 0; base = null; }

    const newEpoch = await bumpEpoch(t, ...);
    await copySequencesUpTo(t, ..., space.seqEpoch, newEpoch, baseSeq);  // PR 번호처럼 나중에 채워진 값을 잃지 않는다
    const commits = await graph.firstParentCommits(ref, { from: base, to: newHead });
    // numberCommits(baseSeq, commits) → upsert(..., epoch: newEpoch)
    await advanceHead(t, ..., newHead, toSeq);                  // state='ok'
  });
  // COMMIT 뒤 (실패해도 재채번은 성공 — PostgreSQL이 정본, ADR-004):
  //   applyEpochBump + applySequenceToDocuments               // ES (DEV-129)
  //   publish EVT-SEQ-002                                     // 알림 소비자는 REL-005 (DEV-127)
  //   recordAudit({ userId: 'system:sequence', ... })          // AC-5
}
```

주의점:

- **advisory lock을 트랜잭션 스코프로 잡는다.** 트랜잭션이 끝나면 자동 해제되므로 워커가 죽어도 락이 남지 않는다.
- **락 획득 실패 시 대기하지 않고 미룬다.** 대기하면 워커 슬롯이 묶여 다른 저장소 처리가 밀린다. **포트에 `requeueLater`는 없다 (CR-025, DEV-117)** — `HandlerDisposition`의 `deferUntil`이 그 동작이고, 락 실패는 실패가 아니라 "지금은 다른 워커가 쥐고 있음"이므로 재시도 예산을 소모하는 `retry`가 아니라 `defer`가 맞다.
- **재채번 시 merge-base까지의 시퀀스를 새 에폭으로 복사한다.** 그 구간은 값이 동일하므로 이전 에폭 인용 중 상당수가 여전히 같은 커밋을 가리킨다. 다만 화면은 안전을 위해 전부 무효로 표시한다.
- **안전 구간 표식·이분 탐색 세션·인용에는 아무것도 쓰지 않는다 (CR-026, DEV-126).** 그들은 `seq_epoch`를 저장하고 있으므로 조회가 **현재 에폭과 비교해** `epoch_stale`을 계산한다 — FR-SEQ-005 AC-4 후반부가 정의한 그대로다. 이전 판의 `invalidateSafeMarkers`는 쓸 수단이 스키마에 없는 호출이었다. 저장된 검색의 `seq:` 조건은 `saved_search`를 만드는 WP-033이 같은 규칙(에폭 저장 + 조회 시 비교)을 따른다.
- Elasticsearch 문서의 `merge_seq` 갱신은 별도 작업으로 이어진다. **PostgreSQL 커밋이 먼저다** — 색인 반영이 실패해도 시퀀스 값은 살아 있고 다음 회차가 다시 비춘다 (ADR-004). 갱신은 `update_by_query`이며 `document_version`을 올리지 않는다 — 시퀀스는 웹훅이 나르는 엔티티 상태가 아니라 git 히스토리에서 파생한 값이라 버전 비교의 대상이 아니다.
- **`upsertMergeSequence`가 `pull_request_number`를 나중에 채운다 (CR-025, DEV-118).** push가 그 PR의 투영보다 먼저 도착하면 채번 시점에는 대응 PR을 모르므로 `null`이 된다. `COALESCE(기존, 신규)`로 두어 모르는 값은 나중에 채워지되 **이미 아는 값이 `null`로 덮이지 않게** 한다. 같은 서수에 다른 SHA가 오면 조용히 넘기지 않고 던진다 — 그것은 경합이 아니라 손상이다.
- **PR 조회는 저장소 하나짜리 `explicit` 접근 범위로 필수 필터를 통과한다 (CR-025, DEV-123).** 채번 잡에는 요청자가 없지만 그렇다고 필터를 우회하지 않는다 — 이 잡이 볼 수 있는 것은 자기가 채번하는 저장소 하나이고, 그것을 접근 범위로 적으면 예외 없이 성립한다.
- **재작성 감지는 WP-021이 하고 재채번은 WP-022가 한다.** 감지한 공간은 `stale`로 두고 기존 값을 보존하며 소리를 낸다. 첫 채번에서 그래프를 읽지 못한 경우도 마찬가지로 `stale`이 되어야 하므로, 그 표시는 `UPDATE`가 아니라 **upsert**다 — `UPDATE`면 롤백된 트랜잭션 탓에 갱신할 행이 없어 아무 신호도 남지 않는다 (CR-025, DEV-122).

### 4.4 관계 파생 (FR-REL-003~006)

```text
link 워커 입력: 색인 완료된 PR 또는 커밋 문서
  ├─ 텍스트 스캔 (제목, 본문, 커밋 메시지)
  │    ├─ 코드 블록·인용 구간 제거 (AC-4)
  │    ├─ #N, owner/repo#N, GHE URL, 40자/7~12자 hex, Refs:/Closes:/Fixes:/Resolves:
  │    └─ → references 간선 (트레일러면 derived, 본문 언급이면 heuristic)
  ├─ 되돌림 탐지
  │    ├─ "This reverts commit <sha>" 트레일러 → exact
  │    └─ 제목 접두 Revert "<원본 제목>" → 제목 대조 → heuristic
  ├─ 체리픽 탐지
  │    ├─ "(cherry picked from commit <sha>)" 트레일러 → exact
  │    └─ patch_id 동일 커밋 검색 (동일 저장소 내) → derived
  ├─ 스택 탐지: base_branch == 다른 열린 PR의 head_branch → derived
  └─ 간선 쓰기 + link_summary 비정규화 갱신 (같은 벌크 요청, ADR-009)

문서당 간선 상한 100건 (AC-5)
```

미해결 참조 처리: 대상이 아직 색인되지 않았으면 `resolved: false`로 저장한다. 새 문서가 색인될 때마다 그 문서를 가리키는 미해결 간선을 조회해 해결 상태로 갱신한다 (FR-REL-003 AC-3).

### 4.5 검색 질의 처리 (FR-SRCH-*, FR-AUTH-002)

```ts
// apps/search-api — 이 파이프라인이 모든 조회의 단일 경로다
async function search(rawQuery: string, opts: SearchOptions, ctx: RequestContext) {
  const ast = parseQuery(rawQuery);                      // @prs/query. 실패 시 오프셋 포함 400
  const scope = await authz.resolveAccessScope(ctx.user); // 실패 시 503, 부분 결과 없음 (AC-3)
  const esQuery = buildEsQuery(ast, opts);
  const guarded = applyMandatoryScopeFilter(esQuery, scope);   // ← 단일 강제 지점 (ADR-008)
  const res = await es.search(guarded);
  audit.recordAsync({ action: 'search', query: rawQuery, ... });
  return mapToDto(res, opts);
}
```

`applyMandatoryScopeFilter`를 거치지 않는 Elasticsearch 호출 경로가 존재하지 않는다는 것을 아키텍처 테스트로 강제한다. 구체적으로: `@prs/es`의 클라이언트 래퍼가 `scopeApplied` 브랜드 타입을 요구하고, 그 타입은 `applyMandatoryScopeFilter`만 생성할 수 있게 한다. 타입 시스템으로 우회를 막는다.

**식별자 해석 순서** (FR-SRCH-001):

```text
입력 문자열
 1. GHE URL 패턴 (호스트+경로)   → pull_request | commit + repository 확정
 2. owner/repo#N                 → pull_request + repository 확정
 3. #N 또는 순수 정수            → pull_request (repository 미확정 → 접근 범위 내 후보 조회)
 4. 40자 hex                     → commit (term 질의)
 5. 7~39자 hex                   → commit (prefix 질의, ADR-012)
 6. 7자 미만 hex                 → 400 sha_prefix_too_short
 7. seq: 형태 또는 태그 패턴     → release | sequence  ← WP-014에서는 도달하지 않는다 (CR-017, DEV-065)
 8. 그 외                        → text (전문 검색 위임)
```

4번에서 40자 hex가 커밋으로 안 잡히면 `merge_commit_sha` / `head_sha` / `base_sha` 필드도 순차 확인한다. 아직 커밋 문서가 색인되지 않았지만 PR 문서에는 SHA가 들어 있는 경우가 있기 때문이다.

1번의 **호스트 비교는 생략할 수 없다** (CR-017, DEV-064). `GHE_BASE_URL`이 가리키는 호스트와 다른 URL은 경로가 같은 모양이어도 `text`로 떨어진다. 호스트를 보지 않고 경로만 파싱하면 외부 URL이 우리 저장소의 PR로 해석된다.

7번은 **WP-014 범위 밖이다** (CR-017, DEV-065). 릴리스 태그의 패턴이 어디에도 정의되어 있지 않고 `prs-releases`도 비어 있다(WP-024). 패턴을 추측해 넣으면 `v1`·`build-2` 같은 문자열이 릴리스로 오분류되어 전문 검색으로 가야 할 질의가 0건이 된다. 릴리스를 색인하는 WP-024가 패턴을 정의할 때까지 태그처럼 보이는 문자열은 8번으로 간다.

**커밋 상세는 커밋 문서가 가진 것만 낸다** (CR-017, DEV-060). 커밋 문서는 SHA·역할·소속 PR 번호·대상 브랜치만 갖는다 — `EVT-ING-002`가 커밋에 대해 SHA만 나르기 때문이다. SHA → PR 역추적(FR-SRCH-002)의 AC-4가 요구하는 PR 번호·제목·작성자·리뷰어·머지 시각은 **PR 문서를 조인해** 채운다(데이터 모델 6장의 `prs-commits` → `pull_request_numbers` → `prs-pull-requests` 경로). 커밋 자체의 메시지·작성자·부모 SHA는 미러 기반 보강(WP-020)이 채운다.

## 5. 동기/비동기 경계

| 작업 | 방식 | Job/Event | 사용자 피드백 |
| --- | --- | --- | --- |
| 웹훅 수신 | sync (저장까지) | → EVT-ING-001 | 202, 사용자 없음 |
| 보강 | async | JOB-ING-002 | 문서의 `enrichment_pending` 배지 |
| 문서 투영 | async | JOB-ING-003 | 검색 반영 (p95 10초) |
| 시퀀스 채번 | async | JOB-SEQ-001 | 시퀀스 배지 표시 |
| 관계 파생 | async | JOB-REL-001~004 | 문서의 `links_pending` 배지 |
| 검색·집계·상세 조회 | sync | - | 즉시 응답 |
| 시퀀스 범위 조회 | sync | - | 즉시 응답 |
| 앵커 정규화 | sync | - | 즉시 응답 |
| 관계 그래프 탐색 | sync (2초 예산) | - | 부분 그래프 + truncated |
| 저장된 검색 CRUD | sync | - | 즉시 응답 |
| 안전 구간 표식 등록 | sync | - | 즉시 응답 |
| 이분 탐색 표시 | sync | - | 즉시 응답 |
| 내보내기 (1000건 이하) | sync | - | 파일 다운로드 |
| 내보내기 (1000건 초과) | async | JOB-SRCH-001 | 잡 ID + 진행률 + 다운로드 링크 |
| 백필 | async | JOB-ING-004 | A-003 진행률 |
| 조정 스캔 | async | JOB-ING-005 | A-001 결과 카드 |
| 재색인 | async | JOB-ING-006 | A-003 진행률 + 이중 쓰기 표시 |
| 정합성 점검 | async | JOB-SEQ-003 | A-003 보고서 |
| 재채번 | async | JOB-SEQ-002 | A-003 진행률 + 알림 |
| DLQ 재처리 | async | JOB-ING-009 | A-001 진행률 |
| 권한 캐시 갱신 | async | JOB-AUTH-001 | 없음 (투명) |

## 6. 권한/정책/감사

### 6.1 조회 경로

모든 조회는 다음 순서를 거친다.

1. 세션 검증 — `search-api`가 세션 쿠키를 Redis에서 **직접** 해석한다. 신원을 주장하는 헤더는 읽지 않는다 (CR-015, DEV-047). 미인증 → 401 + OIDC 리다이렉트 힌트
2. 접근 범위 산출 (실패 → 503 `permission_unavailable`, 부분 결과 없음)
3. 역할 검사 (운영·감사 화면만 해당. 부족 → 403)
4. 강제 필터 결합 (우회 불가)
5. 조회 실행 — 여러 인덱스를 함께 도는 조회는 **모든 정렬 키에 `unmapped_type`을 붙이고 `_shards.failed`를 검사한다** (CR-016, DEV-054). 한쪽 인덱스에만 있는 필드로 정렬하면 Elasticsearch가 HTTP 200에 샤드 부분 실패를 붙여 주는데, 그대로 내보내면 한 인덱스가 통째로 빠진 결과가 정상처럼 보인다
6. 감사 기록 (비동기, 실패해도 응답에 영향 없음)

접근 범위 산출 (`authz.resolveAccessScope`):

```text
Redis 캐시 조회 (TTL 5분)
 ├─ 적중 → 반환
 └─ 미스 → PostgreSQL permission_cache 조회
     ├─ 신선(5분 이내) → Redis 채우고 반환
     └─ 오래됨/없음 → GHE API 조회
         ├─ 성공 → Redis + PostgreSQL 갱신 후 반환
         └─ 실패 → 만료 캐시를 사용하지 않고 오류 (AC-3, 기본 거부)
```

접근 저장소가 500개를 넘으면 `scope_kind: 'org_team'`으로 전환해 `org_id` + `visibility` + `allowed_team_ids` 조건으로 치환한다 (AC-6).

### 6.2 쓰기 액션

| 액션 | actor | resource | 권한 검사 | 정책 검사 | 멱등 키 | 감사 | 복구 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 저장된 검색 생성·수정·삭제 | 인증 사용자 | 본인 소유 | 소유자 일치 | 100건 상한 | `(user_id, name)` | 기록 | 사용자 재시도 |
| 안전 구간 표식 등록 | `release_manager` | 시퀀스 공간 | 역할 | 시퀀스 존재, 에폭 일치 | `(repo, branch, seq, epoch)` | 기록 | 이전 표식 이력 보존 |
| 이분 탐색 표시 | 인증 사용자 | 본인 세션 | 소유자 일치 | good < bad 일관성 | `(user, repo, branch)` | 미기록 | 초기화 |
| 저장소 등록·해제 | `operator` | 저장소 | 역할 + GHE 접근 확인 | 브랜치 10개 상한 | `repository_id` | 기록 | 해제는 문서 유지 |
| 백필·재색인·스캔 실행 | `operator` | 저장소/인덱스 | 역할 | 동일 대상 잡 1개 | `(type, target)` | 기록 | 잡 중단·재개 |
| DLQ 재처리 | `operator` | 이벤트 | 역할 | 3회 실패 시 보류 | `delivery_id` | 기록 | 실패 시 대기열 유지 |
| 재채번 | `operator` | 시퀀스 공간 | 역할 | 저장소명 2단계 확인 | `(repo, branch, epoch)` | 기록 | 비가역 — 실패 시 `stale` |
| 내보내기 | 인증 사용자 | 검색 결과 | 접근 범위 | 10만 건 상한 | 잡 ID | 기록 | 잡 재실행 |

**재채번만 비가역이다.** 나머지 쓰기 액션은 모두 되돌릴 수 있다. 그래서 재채번에만 2단계 확인과 영향 범위 산출을 요구한다 (FLOW-008).

## 7. 외부 연동

| 연동 | 목적 | 인증 | rate limit | 장애 모드 | 대응 |
| --- | --- | --- | --- | --- | --- |
| GHE 웹훅 (수신) | 실시간 수집 | HMAC-SHA256 | 없음 (수신 측) | 유실·지연 | 조정 스캔 (FR-ING-011) |
| GHE REST API | 보강, 백필, 권한, 릴리스 | GitHub App 설치 토큰 (조직별 풀) | 시간당 상한, secondary limit | 429, 5xx, 타임아웃 | 토큰 풀 로테이션, 지수 백오프, 부분 문서 우선 |
| GHE Git 전송 | 미러 fetch | App 토큰 (HTTPS) | 없음 (동시성 제한 권장) | fetch 실패, 디스크 부족 | 시퀀스 공간 `stale`, API 폴백 |
| OIDC IdP | 인증 | client_secret + PKCE | 없음 | 로그인 불가 | 기존 세션 유지, 상관 ID 표시 |
| Elasticsearch | 색인·검색 | API 키 또는 mTLS | 서킷 브레이커, 429 | 색인 거부, 검색 실패 | 지수 백오프, 저하 모드 |
| PostgreSQL | SoR | 인증서/암호 | 커넥션 풀 상한 | 연결 실패 | 게이트웨이 500 → GHE 재전송 |
| Redis | 큐·캐시 | 암호 | 메모리 상한 | 유실 | 아웃박스 재적재, 권한은 PostgreSQL 백업 |
| 알림 채널 | 경보 | 웹훅 URL + 토큰 | 채널 정책 | 발송 실패 | 재시도 3회 후 로그만 |

## 8. 실패 처리

| 실패 유형 | 처리 | 사용자 노출 |
| --- | --- | --- |
| 검증 실패 (질의 문법, 잘못된 앵커, 범위 역전) | 400 + 사유 코드 + 필드/오프셋 | 입력 오류 위치 강조 |
| 인증 실패 | 401 + OIDC 리다이렉트 힌트 | 재인증 (경로 보존) |
| 권한 부족 (역할) | 403 + 필요 역할명 | 필요 역할 표시 |
| 접근 범위 밖 (리소스) | 404 | 존재 여부 미노출 |
| 접근 범위 산출 실패 | 503 `permission_unavailable` | 재시도 안내, 부분 결과 없음 |
| 의존 타임아웃 (ES 검색 3초) | 408/504 + 사유 코드 | 조건 축소 안내 |
| 집계 타임아웃 (5초) | 504 `aggregation_timeout` | 기간 축소 안내 |
| 부분 실패 (패싯만, 섹션만) | 200 + 부분 플래그 | 실패 영역만 오류 표시 |
| 보강 재시도 소진 | DLQ + 부분 문서 유지 | `enrichment_pending` 배지 |
| 색인 거부 (429) | 지수 백오프, 5분 지속 시 경보 | 수집 지연 지표 |
| 시퀀스 채번 실패 | 공간 `stale`, 기존 값 보존, 재시도 예약 | 시퀀스 경고 배너 |
| 잡 중복 요청 | 409 + 실행 중 잡 ID | 기존 잡 확인 유도 |
| 재처리 3회 실패 | 이벤트 `held` 상태, 자동 재처리 제외 | 운영자 개입 요청 |
| 예상치 못한 예외 | 500 + 상관 ID, 스택은 로그만 | 상관 ID 표시 |

**절대 하지 않는 것**: 권한 확인 실패 시 부분 결과 반환, 보강 실패 시 문서 미색인, 시퀀스 채번 실패 시 기존 시퀀스 삭제, 재채번 중 부분 상태로 남기기.

## 9. 트랜잭션 경계

| 경계 | 범위 | 이유 |
| --- | --- | --- |
| 웹훅 수신 | `raw_event` INSERT 1건 | 멱등 제약 위반을 트랜잭션으로 감지 |
| 시퀀스 채번 | advisory lock + `merge_sequence` 다건 upsert + `sequence_space` 갱신 | 부분 채번 상태를 남기지 않는다 |
| 재채번 | 위와 동일 + 표식 무효화 | 에폭 증가와 재채번이 원자적이어야 한다 |
| 저장소 등록 | `repository` upsert + `sequence_space` 초기화 | 브랜치 없는 저장소를 남기지 않는다 |
| 잡 생성 | `job` INSERT (부분 유니크 인덱스로 중복 차단) | 동시 실행 방지 |
| Elasticsearch 벌크 | 트랜잭션 없음 — 문서별 버전 조건부 업서트 | ES에 트랜잭션이 없으므로 멱등으로 대체 |

Elasticsearch와 PostgreSQL 사이에는 분산 트랜잭션을 쓰지 않는다. PostgreSQL이 진실이고 Elasticsearch는 재구성 가능하므로, 불일치는 정합성 감시 잡(`JOB-ING-008`)이 발견해 재투영으로 해소한다.

## 10. 성능 설계

| 대상 | 기법 | 근거 |
| --- | --- | --- |
| 목록·집계 필드 | 색인 시점 사전 계산 (`lead_time_seconds` 등) | 조회 시점 script/runtime field는 집계에서 느리다 (NFR-001) |
| 저장소 범위 질의 | `_routing = repository_id` | 단일 샤드 조회로 축소 |
| 시퀀스 범위 질의 | `index.sort` 조기 종료 | 정렬 순서와 색인 순서 일치 |
| 깊은 페이징 | `search_after` 커서 | 오프셋 페이징 금지 (ADR-010) |
| 총 건수 | `track_total_hits: 10000` | 정확한 총계는 집계 엔드포인트에서 |
| 패싯 | 목록 요청과 동일 질의에 집계 첨부 | 왕복 1회 |
| 집계 격리 | 별도 엔드포인트 | 집계 지연이 목록을 막지 않는다 (FR-STAT-006 AC-4) |
| 관계 그래프 | 깊이당 1회 `terms` 질의 (최대 3회) | 노드당 질의를 만들지 않는다 |
| 릴리스 포함 | 시퀀스 정수 비교 | 릴리스당 수만 간선 생성 회피 (ADR-009) |
| 커밋 그래프 | blobless 미러 | API rate limit 회피 (ADR-005) |
| 백필 | 전용 소비자 그룹 + 낮은 우선순위 | 실시간 지연 미영향 (FR-ING-006 AC-3) |
| 백필 중 색인 | 해당 인덱스 `refresh_interval`을 `30s`로 (기본 `1s`) | 색인 처리량 확보. 복원은 `finally` + **다음 잡 시작 시 무조건 되돌리기** (CR-022, DEV-105) |

## 11. 테스트 전략

| 계층 | 대상 | 방식 |
| --- | --- | --- |
| 단위 | 질의 파서, 식별자 해석, EARS 규칙별 분기, 관계 추출 정규식 | Vitest. FR/AC ID를 테스트 이름에 기재 |
| 계약 | `EventBus` 어댑터, `@prs/es` 매핑과 실제 클러스터 매핑 일치, API DTO | 계약 테스트 |
| 통합 | 시퀀스 채번(정상·재작성), 멱등, 버전 조건부 업서트, 권한 강제 | testcontainers (PostgreSQL + Elasticsearch) |
| 아키텍처 | 강제 필터 우회 경로 부재, 패키지 의존 방향, `dynamic: strict` 매핑 | 정적 검사 + 타입 브랜딩 |
| E2E | 7개 플로우(FLOW-001~008) 전 경로 | Playwright |
| 성능 | NFR-001·NFR-002 목표 | 1000만 문서 합성 데이터셋 부하 시험 |
| 회귀(정확성) | 시퀀스 값 안정성, SHA↔PR 매핑, `git log --first-parent` 대조 | QA 6장 회귀 검수 자동화 |

**시퀀스 회귀 테스트가 이 제품의 가장 중요한 테스트다.** 합성 저장소에 강제 푸시·리베이스·직접 푸시·병합 커밋을 섞은 히스토리를 만들고, 채번 결과가 `git rev-list --first-parent --reverse`와 정확히 일치하는지 검증한다.

## 12. GitHub Operations 모듈 (CR-005 신규)

### 12.1 모듈

| 모듈 | 배포 단위 | 책임 | 관련 FR |
| --- | --- | --- | --- |
| `gh-registry` | `search-api` | capability manifest 로드·검색·버전 대조 | FR-GH-001, FR-GH-011 |
| `gh-command` | `search-api` + `@prs/gh-cli` | 구조화 명령 모델, 제약 검증, argv 조립 | FR-GH-002, FR-GH-003 |
| `gh-policy` | `search-api` | 위험도 판정, 정책 평가, 확인·승인 게이트 | FR-GH-009, FR-GH-013 |
| `gh-identity` | `search-api` | Operations App 인가, 위임 토큰 수명주기, 권한 교집합 판정 | FR-GH-008 |
| `gh-exec` | `gh-executor` | 프로세스 실행, workspace, 스트리밍, 취소, 타임아웃 | FR-GH-002, FR-GH-006, FR-GH-007 |
| `gh-recipe` | `search-api` + `gh-executor` | Recipe 정의 검증, 단계 진행, 출력 바인딩 | FR-GH-005 |
| `gh-audit` | `search-api` | 실행 감사 선기록, 이력 조회, 재실행 | FR-GH-012 |

### 12.2 실행 처리 경로

```text
1. 요청 수신          중복 방지 키 확인 → 기존 실행이면 그것을 반환
2. capability 해석    manifest에 없으면 GH_CAPABILITY_UNKNOWN
3. 버전 대조          실행기 gh ≠ manifest → GH_REGISTRY_STALE
4. 제약 검증          conflicts/requires/oneOf → GH_CONSTRAINT_VIOLATION
5. 신원 확인          위임 연결 없음/만료 → GH_IDENTITY_REQUIRED
6. 권한 판정          App 권한 ∩ 사용자 권한 → GH_PERMISSION_DENIED
7. 정책 평가          차단 → GH_POLICY_BLOCKED
8. 위험도 게이트      R2+ 확인 미수행 → GH_CONFIRMATION_REQUIRED
                     R3 승인 필요 → GH_APPROVAL_REQUIRED
9. 대상 재조회        R2+ 상태 변화 → GH_TARGET_CHANGED
10. 자원 잠금         상충 작업 진행 중 → GH_RESOURCE_LOCKED
11. 감사 선기록       실패 시 실행하지 않는다
12. 큐 적재           prs:gh:executions
13. 실행기 처리       토큰 주입 → spawn → 스트리밍 → 종료 → 토큰 폐기
14. 결과 기록         종료 코드, 출력 해시, 아티팩트
```

11번이 12번보다 앞선다. 감사 없이 시작된 쓰기 실행은 존재할 수 없다 (FR-GH-012 AC-6, NFR-012).

### 12.3 실패 처리

- **쓰기 작업은 자동 재시도하지 않는다.** 타임아웃된 `pr merge`가 실제로 머지되었는지 실행기는 알 수 없다. 재시도 판단은 결과를 본 사용자가 한다.
- 실행기 장애로 남은 `running` 행은 JOB-GH-007이 `failed`로 회수한다.
- 스트리밍 연결이 끊겨도 실행은 계속된다. 재접속 시 현재 상태와 누적 출력을 다시 전달한다.
