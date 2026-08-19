# PR Search 데이터 모델

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

핵심 엔티티, 관계, 소유권, 수명주기, 마이그레이션, 보존, 백업/복구 기준을 정의한다. 엔티티 네이밍은 `../10_requirements/glossary.md`를 따른다.

저장소 분담은 ADR-004를 따른다. **PostgreSQL이 시스템 오브 레코드이고, Elasticsearch는 PostgreSQL만으로 전량 재구성 가능한 파생 뷰다.** 인덱스 전략은 ADR-003을 따른다.

## 2. 엔티티 카탈로그

| Entity ID | 엔티티 | 책임 | 주요 필드 | 소유 저장소 | 소유 모듈 | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-CORE-001 | Repository | 수집 대상 저장소 등록과 정책 | `repository_id`, `owner`, `name`, `org_id`, `visibility`, `sequence_branches[]`, `mirror_enabled`, `status` | PostgreSQL | registry | FR-ING-009 |
| ENT-CORE-002 | PullRequest | PR 검색 문서 | `pr_number`, `title`, `body`, `author`, `state`, `merged_at`, `merge_commit_sha`, `merge_seq`, `link_summary` | Elasticsearch | projection | FR-SRCH-003, FR-SRCH-006 |
| ENT-CORE-003 | Commit | 커밋 검색 문서 | `commit_sha`, `message`, `author`, `role`, `merge_seq`, `patch_id`, `changed_paths[]` | Elasticsearch | projection | FR-SRCH-002, FR-SRCH-004 |
| ENT-CORE-004 | Team | 팀 정보와 집계 그룹 단위 | `team_id`, `slug`, `org_id`, `member_ids[]` | PostgreSQL | registry | FR-AUTH-002, FR-STAT-001 |
| ENT-CORE-005 | User | 사용자와 접근 범위 | `user_id`, `login`, `email`, `roles[]`, `access_scope_version` | PostgreSQL | auth | FR-AUTH-001, FR-AUTH-003 |
| ENT-CORE-006 | SavedSearch | 저장된 질의 | `saved_search_id`, `name`, `query`, `visibility`, `owner_user_id` | PostgreSQL | search | FR-SRCH-010 |
| ENT-CORE-007 | AuditRecord | 감사 기록 | `audit_id`, `user_id`, `action`, `target`, `query`, `result_code`, `correlation_id`, `occurred_at` | PostgreSQL | audit | FR-AUTH-004 |
| ENT-SEQ-001 | MergeSequence | 시퀀스 서수-커밋 대응 | `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `commit_sha`, `pull_request_number` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-002 |
| ENT-SEQ-002 | SequenceSpace | 시퀀스 공간 상태 | `repository_id`, `base_branch`, `seq_epoch`, `head_sha`, `head_seq`, `state`, `last_assigned_at` | PostgreSQL | sequence | FR-SEQ-001, FR-SEQ-005 |
| ENT-SEQ-003 | SafeMarker | 안전 구간 표식 | `marker_id`, `repository_id`, `base_branch`, `seq_epoch`, `merge_seq`, `note`, `created_by` | PostgreSQL | sequence | FR-SEQ-006 |
| ENT-SEQ-004 | BisectSession | 이분 탐색 상태 | `session_id`, `user_id`, `repository_id`, `base_branch`, `seq_epoch`, `good_seq`, `bad_seq` | PostgreSQL | sequence | FR-SEQ-007 |
| ENT-REL-001 | Release | 릴리스 앵커 | `release_id`, `repository_id`, `tag_name`, `commit_sha`, `base_branch`, `merge_seq`, `released_at` | Elasticsearch | projection | FR-SEQ-004, FR-REL-002 |
| ENT-REL-002 | Link | 관계 간선 | `link_id`, `from_type`, `from_id`, `to_type`, `to_id`, `link_type`, `confidence`, `evidence`, `resolved` | Elasticsearch | link | FR-REL-003~008 |
| ENT-ING-001 | RawEvent | 원본 웹훅 이벤트 | `delivery_id`, `event_type`, `repository_id`, `received_at`, `payload`, `queued_at`, `processed_at` | PostgreSQL | ingestion | FR-ING-001, FR-ING-003 |
| ENT-ING-002 | DeadLetter | 실패 이벤트 격리 | `dead_letter_id`, `delivery_id`, `stage`, `error`, `retry_count`, `state` | PostgreSQL | ingestion | FR-ING-007 |
| ENT-ING-003 | RawEventArchive | 원본 아카이브 검색 문서 | `delivery_id`, `event_type`, `repository`, `received_at`, `payload` | Elasticsearch | filebeat | FR-ING-010 |
| ENT-ING-004 | Job | 잡 실행 상태 | `job_id`, `type`, `target`, `state`, `progress`, `cursor`, `started_at`, `finished_at` | PostgreSQL | jobs | FR-ADMIN-002, FR-ING-006 |

## 3. PostgreSQL 스키마

### 3.1 수집

```sql
CREATE TABLE raw_event (
  delivery_id     TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  action          TEXT,
  repository_id   BIGINT,
  received_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB       NOT NULL,
  payload_hash    TEXT        NOT NULL,          -- delivery_id 부재 시 대체 멱등 키 (FR-ING-002 AC-4)
  queued_at       TIMESTAMPTZ,                   -- 아웃박스: enqueue 시각
  processed_at    TIMESTAMPTZ,                   -- 투영 완료 시각
  correlation_id  UUID        NOT NULL,
  PRIMARY KEY (delivery_id, received_at)         -- 파티션 키 포함
) PARTITION BY RANGE (received_at);              -- 월별 파티션, 보존 만료는 파티션 드롭

CREATE UNIQUE INDEX raw_event_delivery_uk ON raw_event (delivery_id, received_at);
CREATE INDEX raw_event_outbox_idx  ON raw_event (queued_at) WHERE processed_at IS NULL;
CREATE INDEX raw_event_repo_idx    ON raw_event (repository_id, received_at DESC);

CREATE TABLE dead_letter (
  dead_letter_id  BIGSERIAL   PRIMARY KEY,
  delivery_id     TEXT        NOT NULL,
  stage           TEXT        NOT NULL,          -- enrich | project | sequence | link
  error           TEXT        NOT NULL,
  retry_count     INT         NOT NULL DEFAULT 0,
  reprocess_count INT         NOT NULL DEFAULT 0,
  state           TEXT        NOT NULL,          -- pending | reprocessing | held
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dead_letter_state_idx ON dead_letter (state, created_at);
```

`raw_event`의 `queued_at`/`processed_at`이 아웃박스 역할을 한다. Redis 유실 시 `queued_at IS NOT NULL AND processed_at IS NULL`이면서 일정 시간이 지난 행을 재적재한다 (ADR-002 follow-up, `JOB-ING-007`).

### 3.2 시퀀스 (핵심)

```sql
CREATE TABLE sequence_space (
  repository_id    BIGINT      NOT NULL,
  base_branch      TEXT        NOT NULL,
  seq_epoch        INT         NOT NULL DEFAULT 1,
  head_sha         TEXT,                          -- 마지막 채번 시점의 브랜치 head
  head_seq         BIGINT      NOT NULL DEFAULT 0,
  state            TEXT        NOT NULL DEFAULT 'ok',  -- ok | stale | reassigning | unknown
  last_assigned_at TIMESTAMPTZ,
  last_error       TEXT,
  PRIMARY KEY (repository_id, base_branch)
);

CREATE TABLE merge_sequence (
  repository_id        BIGINT      NOT NULL,
  base_branch          TEXT        NOT NULL,
  seq_epoch            INT         NOT NULL,
  merge_seq            BIGINT      NOT NULL,
  commit_sha           TEXT        NOT NULL,
  pull_request_number  INT,                       -- 직접 푸시 커밋은 NULL (FR-SEQ-001 AC-3)
  committed_at         TIMESTAMPTZ NOT NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, base_branch, seq_epoch, merge_seq)
);

CREATE UNIQUE INDEX merge_sequence_commit_uk
  ON merge_sequence (repository_id, base_branch, seq_epoch, commit_sha);
CREATE INDEX merge_sequence_pr_idx
  ON merge_sequence (repository_id, pull_request_number)
  WHERE pull_request_number IS NOT NULL;
```

채번 동시성 제어는 PostgreSQL advisory lock을 사용한다 (FR-SEQ-001 AC-6).

```sql
SELECT pg_try_advisory_xact_lock(hashtext('seq:' || repository_id || ':' || base_branch));
```

락을 얻지 못하면 잡을 재큐에 넣고 종료한다. 대기하지 않는다.

```sql
CREATE TABLE safe_marker (
  marker_id     BIGSERIAL   PRIMARY KEY,
  repository_id BIGINT      NOT NULL,
  base_branch   TEXT        NOT NULL,
  seq_epoch     INT         NOT NULL,
  merge_seq     BIGINT      NOT NULL,
  note          TEXT        CHECK (char_length(note) <= 500),
  created_by    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ                        -- 이력 보존: 대체 시 시각 기록 (FR-SEQ-006 AC-1)
);
CREATE UNIQUE INDEX safe_marker_current_uk
  ON safe_marker (repository_id, base_branch) WHERE superseded_at IS NULL;

CREATE TABLE bisect_session (
  session_id    BIGSERIAL   PRIMARY KEY,
  user_id       TEXT        NOT NULL,
  repository_id BIGINT      NOT NULL,
  base_branch   TEXT        NOT NULL,
  seq_epoch     INT         NOT NULL,
  good_seq      BIGINT,
  bad_seq       BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, repository_id, base_branch)
);
```

`bisect_session`이 `seq_epoch`를 들고 있으므로, 에폭이 바뀌면 탐색 상태를 무효화할 수 있다 (FLOW-004 예외 흐름).

### 3.3 레지스트리와 권한

```sql
CREATE TABLE repository (
  repository_id     BIGINT      PRIMARY KEY,       -- GHE 숫자 ID
  owner             TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  org_id            BIGINT      NOT NULL,
  visibility        TEXT        NOT NULL,          -- public | internal | private
  sequence_branches TEXT[]      NOT NULL DEFAULT '{}',   -- 최대 10 (FR-ING-009 AC-2)
  mirror_enabled    BOOLEAN     NOT NULL DEFAULT true,
  status            TEXT        NOT NULL DEFAULT 'active', -- active | archived
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sequence_branches_limit CHECK (array_length(sequence_branches, 1) <= 10),
  UNIQUE (owner, name)
);

CREATE TABLE app_user (
  user_id               TEXT        PRIMARY KEY,
  login                 TEXT        NOT NULL UNIQUE,
  email                 TEXT,
  roles                 TEXT[]      NOT NULL DEFAULT '{developer}',
  access_scope_version  INT         NOT NULL DEFAULT 0,   -- 무효화 시 증가
  last_seen_at          TIMESTAMPTZ
);

CREATE TABLE team (
  team_id BIGINT PRIMARY KEY,
  slug    TEXT   NOT NULL,
  org_id  BIGINT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE TABLE team_member (
  team_id BIGINT NOT NULL REFERENCES team(team_id),
  user_id TEXT   NOT NULL REFERENCES app_user(user_id),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE permission_cache (            -- Redis 미스 시 백업 (ADR-008)
  user_id      TEXT        PRIMARY KEY REFERENCES app_user(user_id),
  scope_kind   TEXT        NOT NULL,       -- explicit | org_team  (500개 초과 시 org_team)
  repository_ids BIGINT[],
  org_ids      BIGINT[],
  team_ids     BIGINT[],
  refreshed_at TIMESTAMPTZ NOT NULL
);
```

### 3.4 애플리케이션 상태

```sql
CREATE TABLE saved_search (
  saved_search_id BIGSERIAL   PRIMARY KEY,
  owner_user_id   TEXT        NOT NULL REFERENCES app_user(user_id),
  name            TEXT        NOT NULL,
  query           TEXT        NOT NULL,
  visibility      TEXT        NOT NULL DEFAULT 'private',  -- private | team
  team_id         BIGINT      REFERENCES team(team_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at     TIMESTAMPTZ,
  UNIQUE (owner_user_id, name)
);
-- 사용자당 100건 상한 (FR-SRCH-010 AC-4)은 애플리케이션 계층에서 검사한다.

CREATE TABLE job (
  job_id      BIGSERIAL   PRIMARY KEY,
  type        TEXT        NOT NULL,   -- backfill | reconcile | reindex | sequence_assign
                                      -- | sequence_integrity | link_rebuild | export
  target      TEXT        NOT NULL,   -- repository_id 또는 인덱스명 등
  state       TEXT        NOT NULL,   -- queued | running | paused | completed | failed | cancelled
  progress    JSONB       NOT NULL DEFAULT '{}',
  cursor      JSONB,                  -- 중단 후 재개 지점 (FR-ING-006 AC-4)
  requested_by TEXT       NOT NULL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error       TEXT
);
CREATE UNIQUE INDEX job_active_uk ON job (type, target)
  WHERE state IN ('queued', 'running', 'paused');   -- 동시 1개 (FR-ADMIN-002 AC-4)

CREATE TABLE audit_record (
  audit_id       BIGSERIAL   PRIMARY KEY,
  user_id        TEXT        NOT NULL,
  action         TEXT        NOT NULL,
  target         TEXT,
  query          TEXT,
  result_code    TEXT        NOT NULL,
  correlation_id UUID        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (occurred_at);      -- 월별 파티션, 1년 보존 (NFR-006)
CREATE INDEX audit_user_idx   ON audit_record (user_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON audit_record (action, occurred_at DESC);
```

`audit_record`에는 UPDATE·DELETE 권한을 애플리케이션 롤에 부여하지 않는다 (FR-AUTH-004 AC-3). 보존 만료 삭제는 별도 관리 롤이 파티션 드롭으로 수행한다.

## 4. Elasticsearch 매핑

공통 설정 (모든 엔티티 인덱스):

```json
{
  "settings": {
    "index.number_of_replicas": 1,
    "index.refresh_interval": "1s",
    "index.sort.field": ["repository_id", "merge_seq"],
    "index.sort.order": ["asc", "desc"],
    "index.sort.missing": ["_last", "_last"],
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": { "type": "custom", "filter": ["lowercase"] }
      },
      "analyzer": {
        "text_ko_en": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        },
        "path_analyzer": { "type": "custom", "tokenizer": "path_hierarchy" }
      }
    }
  }
}
```

- `text_ko_en`은 OD-005 결정에 따라 `nori_tokenizer` 기반으로 교체할 수 있다. 분석기 이름은 유지해 매핑 참조가 변하지 않게 한다 (FR-SRCH-011 AC-4).
- `index.sort`는 시퀀스 범위 질의와 기본 정렬(시퀀스 내림차순)에서 조기 종료를 얻기 위한 것이다 (ADR-003).
- `refresh_interval: 1s`는 수집 반영 SLO(p95 10초, NFR-002)와 색인 처리량의 절충값이다. 백필 중에는 해당 인덱스만 `30s`로 낮췄다가 복원한다.

### 4.1 `prs-pull-requests`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "document_version":    { "type": "long" },
      "repository_id":       { "type": "long" },
      "repository":          { "type": "keyword" },
      "org_id":              { "type": "long" },
      "visibility":          { "type": "keyword" },
      "allowed_team_ids":    { "type": "long" },

      "pr_number":           { "type": "integer" },
      "title":               { "type": "text", "analyzer": "text_ko_en",
                               "fields": { "raw": { "type": "keyword", "ignore_above": 512 } } },
      "body":                { "type": "text", "analyzer": "text_ko_en" },
      "state":               { "type": "keyword" },
      "draft":               { "type": "boolean" },

      "author":              { "type": "keyword" },
      "author_team_ids":     { "type": "long" },
      "reviewers":           { "type": "keyword" },
      "approved_by":         { "type": "keyword" },
      "labels":              { "type": "keyword" },

      "base_branch":         { "type": "keyword" },
      "head_branch":         { "type": "keyword" },
      "base_sha":            { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "head_sha":            { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "merge_commit_sha":    { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "source_commit_shas":  { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "source_commits_truncated": { "type": "boolean" },

      "merge_seq":           { "type": "long" },
      "seq_epoch":           { "type": "integer" },
      "sequence_space":      { "type": "keyword" },

      "created_at":          { "type": "date" },
      "updated_at":          { "type": "date" },
      "merged_at":           { "type": "date" },
      "closed_at":           { "type": "date" },
      "first_review_at":     { "type": "date" },

      "lead_time_seconds":        { "type": "long" },
      "first_review_wait_seconds":{ "type": "long" },

      "changed_files_count": { "type": "integer" },
      "additions":           { "type": "integer" },
      "deletions":           { "type": "integer" },
      "changed_paths":       { "type": "text", "analyzer": "path_analyzer",
                               "fields": { "raw": { "type": "keyword", "ignore_above": 1024 } } },
      "files_truncated":     { "type": "boolean" },

      "link_summary": {
        "properties": {
          "has_revert":        { "type": "boolean" },
          "is_reverted":       { "type": "boolean" },
          "has_cherry_pick":   { "type": "boolean" },
          "has_stack":         { "type": "boolean" },
          "reference_count":   { "type": "integer" }
        }
      },

      "release_tags":        { "type": "keyword" },
      "unreleased":          { "type": "boolean" },

      "enrichment_pending":  { "type": "boolean" },
      "links_pending":       { "type": "boolean" },
      "repository_archived": { "type": "boolean" },
      "last_delivery_id":    { "type": "keyword", "index": false },
      "indexed_at":          { "type": "date" }
    }
  }
}
```

`dynamic: "strict"`가 중요하다. 웹훅 payload에서 예기치 않은 필드가 흘러들어 소스 코드나 개인정보가 색인되는 것을 매핑 수준에서 차단한다 (NFR-005, SRS 11장 7항).

### 4.2 `prs-commits`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "document_version":  { "type": "long" },
      "repository_id":     { "type": "long" },
      "repository":        { "type": "keyword" },
      "org_id":            { "type": "long" },
      "visibility":        { "type": "keyword" },
      "allowed_team_ids":  { "type": "long" },

      "commit_sha":        { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "parent_shas":       { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "patch_id":          { "type": "keyword" },
      "patch_id_unavailable": { "type": "boolean" },

      "message":           { "type": "text", "analyzer": "text_ko_en",
                             "fields": { "subject": { "type": "keyword", "ignore_above": 512 } } },
      "author":            { "type": "keyword" },
      "committer":         { "type": "keyword" },
      "authored_at":       { "type": "date" },
      "committed_at":      { "type": "date" },

      "role":              { "type": "keyword" },
      "pull_request_numbers": { "type": "integer" },

      "base_branch":       { "type": "keyword" },
      "merge_seq":         { "type": "long" },
      "seq_epoch":         { "type": "integer" },
      "sequence_space":    { "type": "keyword" },

      "changed_paths":     { "type": "text", "analyzer": "path_analyzer",
                             "fields": { "raw": { "type": "keyword", "ignore_above": 1024 } } },
      "additions":         { "type": "integer" },
      "deletions":         { "type": "integer" },

      "link_summary": {
        "properties": {
          "has_revert":      { "type": "boolean" },
          "is_reverted":     { "type": "boolean" },
          "has_cherry_pick": { "type": "boolean" }
        }
      },

      "release_tags":      { "type": "keyword" },
      "enrichment_pending":{ "type": "boolean" },
      "last_delivery_id":  { "type": "keyword", "index": false },
      "indexed_at":        { "type": "date" }
    }
  }
}
```

`role`은 `merge_commit` / `source_commit` / `direct_push` 중 하나다 (FR-SRCH-002 AC-1~AC-3).

### 4.3 `prs-links`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "link_id":       { "type": "keyword" },
      "repository_id": { "type": "long" },
      "org_id":        { "type": "long" },
      "visibility":    { "type": "keyword" },
      "allowed_team_ids": { "type": "long" },

      "from_type":     { "type": "keyword" },
      "from_id":       { "type": "keyword" },
      "to_type":       { "type": "keyword" },
      "to_id":         { "type": "keyword" },
      "to_repository_id": { "type": "long" },

      "link_type":     { "type": "keyword" },
      "confidence":    { "type": "keyword" },
      "evidence":      { "type": "text", "index": false },
      "resolved":      { "type": "boolean" },
      "detached":      { "type": "boolean" },
      "created_at":    { "type": "date" }
    }
  }
}
```

- `link_id`는 `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`의 결정론적 해시다. 재파생이 중복 간선을 만들지 않는다.
- `link_type`: `contains` | `precedes` | `references` | `reverts` | `cherry_picks` | `stacks_on` | `co_changes`
- `confidence`: `exact` | `derived` | `heuristic`
- `precedes` 간선은 저장하지 않는다. 시퀀스 값 비교로 계산 가능하므로 간선으로 만들면 커밋 수만큼의 간선이 생겨 낭비다. `link_type` 어휘에는 남겨 두되, FR-REL-001은 `merge_sequence` 범위 질의로 구현한다.
- `co_changes` 간선도 저장하지 않는다. 조회 시점에 `changed_paths` 교집합으로 계산한다 (FR-REL-007). 미리 계산하면 PR 하나 추가에 O(N) 간선이 생긴다.

즉 **실제 저장되는 간선은 `references`, `reverts`, `cherry_picks`, `stacks_on`, `contains`(릴리스↔커밋) 다섯 종류다.**

### 4.4 `prs-releases`

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "release_id":     { "type": "keyword" },
      "repository_id":  { "type": "long" },
      "org_id":         { "type": "long" },
      "visibility":     { "type": "keyword" },
      "allowed_team_ids": { "type": "long" },

      "tag_name":       { "type": "keyword" },
      "display_name":   { "type": "keyword" },
      "commit_sha":     { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "base_branch":    { "type": "keyword" },
      "merge_seq":      { "type": "long" },
      "seq_epoch":      { "type": "integer" },
      "sequence_space": { "type": "keyword" },
      "released_at":    { "type": "date" },
      "source":         { "type": "keyword" },
      "indexed_at":     { "type": "date" }
    }
  }
}
```

`source`는 `git_tag` | `github_release` | `ci_deployment` (OD-004).

**릴리스 포함 판정은 간선이 아니라 시퀀스 비교다.** 커밋 C가 릴리스 R에 포함되었다 ⟺ 같은 시퀀스 공간에서 `C.merge_seq <= R.merge_seq` (FR-REL-002 AC-5). 릴리스 하나당 수만 개 `contains` 간선을 만드는 대신 정수 비교 하나로 끝난다. `release_tags` 비정규화 필드는 상위 5개 릴리스만 담아 목록 표시에 쓴다.

### 4.5 `prs-raw-events` (아카이브, ILM)

```json
{
  "mappings": {
    "dynamic": "false",
    "properties": {
      "delivery_id":  { "type": "keyword" },
      "event_type":   { "type": "keyword" },
      "action":       { "type": "keyword" },
      "repository":   { "type": "keyword" },
      "received_at":  { "type": "date" },
      "correlation_id": { "type": "keyword" },
      "payload":      { "type": "object", "enabled": false }
    }
  }
}
```

`payload`는 `enabled: false`로 저장만 하고 색인하지 않는다. 원본 보존과 `delivery_id` 대조가 목적이며 payload 내부 검색은 요구되지 않는다. 색인하면 5억 건의 임의 JSON이 매핑 폭발을 일으킨다.

## 5. 관계 및 일관성

| 관계 | 카디널리티 | 일관성 | 강제 지점 |
| --- | --- | --- | --- |
| Repository → SequenceSpace | 1:N (최대 10) | 강함 | PostgreSQL FK + CHECK |
| SequenceSpace → MergeSequence | 1:N | 강함 | PostgreSQL PK |
| MergeSequence → PullRequest | 1:0..1 | 최종적 | 투영 워커 |
| PullRequest → Commit | 1:N (머지 커밋 1 + 원본 N) | 최종적 | 보강 워커 |
| Commit → PullRequest | N:M (통상 N:1) | 최종적 | 보강 워커, `pull_request_numbers` 배열 |
| Release → Commit | 시퀀스 비교로 계산 | 계산 | 조회 시점 |
| Link.from / Link.to | N:M | 최종적, `resolved` 플래그 | 링크 워커 |
| PostgreSQL merge_sequence → ES merge_seq | 1:1 | 최종적 | 정합성 감시 잡 |

**최종적 일관성의 사용자 노출:** 보강·관계 파생이 끝나지 않은 문서는 `enrichment_pending` / `links_pending`을 `true`로 두고 화면이 이를 표시한다 (상태 매트릭스). 불완전한 데이터를 완전한 것처럼 보여주지 않는다.

**순서 역전 방지 (FR-ING-005 AC-1):** 모든 엔티티 문서에 `document_version`(이벤트 발생 시각의 밀리초 epoch)을 두고, Elasticsearch의 외부 버전 관리 또는 스크립트 조건부 업서트로 더 작은 버전의 갱신을 무시한다.

```json
{
  "script": {
    "source": "if (ctx._source.document_version == null || ctx._source.document_version < params.doc.document_version) { for (e in params.doc.entrySet()) { ctx._source[e.getKey()] = e.getValue(); } } else { ctx.op = 'noop'; }",
    "params": { "doc": { "...": "..." } }
  },
  "upsert": { "...": "..." }
}
```

## 6. 인덱스 및 조회 패턴

| 조회 패턴 | 대상 | 사용 필드/인덱스 | 성능 목표 | 관련 FR |
| --- | --- | --- | --- | --- |
| 40자 SHA → 커밋 | `prs-commits` | `term(commit_sha)` | p95 100ms | FR-SRCH-001 |
| 7~39자 접두 → 커밋 | `prs-commits` | `prefix(commit_sha)` (ADR-012) | p95 200ms | FR-SRCH-004 |
| SHA → PR | `prs-commits` → `pull_request_numbers` → `prs-pull-requests` (ID 조회) | 문서 ID `{repo}:{number}` | p95 200ms | FR-SRCH-002 |
| PR → 커밋 | `prs-pull-requests.source_commit_shas` + `merge_commit_sha` | 문서 내 배열 | p95 100ms | FR-SRCH-003 |
| 시퀀스 범위 | `prs-pull-requests` | `range(merge_seq)` + `term(sequence_space)`, `index.sort` 조기 종료 | p95 400ms @ 5000건 | FR-SEQ-002 |
| 선행·후행 | `prs-pull-requests` | `range(merge_seq)` 양방향 각 N건 | p95 200ms | FR-REL-001 |
| 다차원 필터 목록 | `prs-pull-requests` | 복합 `bool.filter` + `search_after` | p95 500ms @ 1000만 | FR-SRCH-006 |
| 패싯 | `prs-pull-requests` | `terms` 집계 6종, size 20 | 목록과 동일 요청 | FR-SRCH-009 |
| 전문 검색 | `prs-pull-requests` | `multi_match` (title^3, body, message) + highlight | p95 500ms | FR-SRCH-011 |
| 그룹 집계 | `prs-pull-requests` | `terms` 집계, size 500 | p95 1500ms | FR-STAT-001 |
| 시계열 | `prs-pull-requests` | `date_histogram(merged_at)` + timezone | p95 1500ms | FR-STAT-002 |
| 백분위 | `prs-pull-requests` | `percentiles(lead_time_seconds)` | p95 1500ms | FR-STAT-003 |
| 관계 조회 (정방향) | `prs-links` | `term(from_type) + term(from_id)` | p95 150ms | FR-REL-003 |
| 관계 조회 (역방향) | `prs-links` | `term(to_type) + term(to_id)` | p95 150ms | FR-REL-004 |
| 릴리스 포함 | `prs-releases` | `term(sequence_space) + range(merge_seq >= C.merge_seq)` | p95 150ms | FR-REL-002 |
| 체리픽 후보 | `prs-commits` | `term(patch_id) + term(repository_id)` | p95 200ms | FR-REL-005 |
| 동시 변경 | `prs-pull-requests` | `terms(changed_paths.raw)` + 날짜 범위 90일 | p95 800ms | FR-REL-007 |

**라우팅**: 모든 엔티티 문서를 `repository_id`로 라우팅한다. 저장소가 지정된 질의는 단일 샤드에서 끝난다. 저장소 미지정 전역 질의는 전 샤드 팬아웃이며 이는 의도된 동작이다.

**사전 계산 필드**: `lead_time_seconds`, `first_review_wait_seconds`, `changed_files_count`, `additions`, `deletions`, `link_summary.*`, `unreleased`는 모두 색인 시점에 계산해 저장한다. 조회 시점 `script` 필드나 runtime field를 집계에 사용하지 않는다 (NFR-001).

## 7. 마이그레이션 정책

### PostgreSQL

- 마이그레이션 도구를 워크스페이스에 두고 버전 순차 적용한다. 롤백 스크립트를 함께 작성한다.
- **backward compatible**: 컬럼 추가(NULL 허용), 인덱스 추가(`CONCURRENTLY`), 새 테이블. 무중단.
- **destructive**: 컬럼 삭제·타입 변경. 2단계로 나눈다 — (1) 새 컬럼 추가 + 이중 쓰기 + 백필, (2) 다음 릴리스에서 구 컬럼 삭제.
- **rollback**: 각 마이그레이션에 down 스크립트 필수. destructive의 1단계는 롤백 가능해야 한다.
- **seed/fixture**: 개발 환경용 시드는 실제 GHE 데이터를 쓰지 않는다. 합성 저장소 3개, PR 200건, 커밋 500건, 릴리스 10건, 관계 50건으로 구성해 모든 화면 상태를 재현할 수 있게 한다.

### Elasticsearch

- 매핑 변경은 **항상** 새 버전 인덱스 + 재색인 + 별칭 전환이다 (FR-ING-008). 기존 인덱스를 in-place 변경하지 않는다.
- 재색인 소스는 PostgreSQL이다 (ADR-004). Elasticsearch → Elasticsearch reindex는 매핑 호환 시에만 최적화 수단으로 사용한다.
- 재색인 중에는 새 이벤트를 구·신 인덱스 양쪽에 쓴다 (AC-2). 이중 쓰기 상태를 A-003에 표시한다.
- 전환은 alias 액션 1회로 원자적으로 수행한다 (AC-3).
- 이전 인덱스는 7일 보관 후 삭제한다 (AC-4).
- 매핑 정의는 `@prs/es` 패키지에 코드로 두고, 실제 클러스터 매핑과의 일치를 통합 테스트로 검증한다.

## 8. 보존/삭제/백업

| 데이터 | 보존 | 삭제 방식 | 백업 |
| --- | --- | --- | --- |
| `raw_event` | 기본 3년 (OD-003) | 월별 파티션 드롭 | 일 1회 전체 + WAL 연속 아카이브 |
| `prs-raw-events` (ES 아카이브) | ILM: hot 7일 → warm 90일 → delete (보존 기간 동기화) | ILM 자동 | 백업 안 함. `raw_event`에서 재구성 |
| `merge_sequence`, `sequence_space` | 영구 | 저장소 폐기 시에만 | PostgreSQL 백업에 포함 |
| `audit_record` | 1년 (NFR-006) | 월별 파티션 드롭 (관리 롤만) | PostgreSQL 백업에 포함 |
| 엔티티 ES 인덱스 | 영구 | 저장소 폐기 시 문서 삭제 | 백업 안 함. PostgreSQL에서 재구성 |
| `saved_search`, `safe_marker`, `bisect_session` | 영구 (사용자 삭제 시 제거) | 하드 삭제 | PostgreSQL 백업에 포함 |
| `job`, `dead_letter` | 90일 | 배치 삭제 | PostgreSQL 백업에 포함 |
| git 미러 | 캐시 | 재클론 가능 | 백업 안 함 |

**소프트 삭제 원칙**: 저장소 등록 해제는 문서를 삭제하지 않는다. `repository.status = 'archived'`, ES 문서에 `repository_archived: true`를 세팅한다 (FR-ING-009 AC-3). 조사 이력의 보존이 이 제품의 목적이므로, 데이터 삭제는 저장소 폐기라는 명시적 결정에서만 일어난다.

**복구 목표**: RPO 0(원본 이벤트 기준), RTO 30분 (NFR-004). PostgreSQL이 복구되면 Elasticsearch는 재색인으로 복구한다. 재색인이 4시간 걸리므로(NFR-008), 검색 서비스의 RTO 30분은 Elasticsearch 스냅샷 복원으로 달성하고 재색인은 최종 수단이다.

## 9. 데이터 분류

| 분류 | 데이터 | 취급 |
| --- | --- | --- |
| 소스 코드 | 저장하지 않음 | 매핑 `dynamic: strict`로 구조적 차단 (NFR-005) |
| 코드 메타데이터 | 변경 경로, 라인 수, 커밋 메시지, PR 본문 | 접근 범위 필터 적용 |
| 개인 식별 정보 | GHE 로그인, 이메일 | 사내 구성원 정보. 감사 기록에 포함. 외부 반출 금지 |
| 인증 정보 | GitHub 토큰, 웹훅 시크릿, OIDC 클라이언트 시크릿 | 클러스터 시크릿 저장소에만. 로그·응답·문서에 남기지 않음 |
| 운영 데이터 | 잡 상태, 큐 길이, 지표 | 운영자 역할만 |

## 10. 알려진 데이터 모델 제한

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| 원본 커밋 250건 초과 PR은 절삭 저장 | 초대형 PR의 일부 커밋이 SHA 검색에 잡히지 않음 | `source_commits_truncated: true` 표시, GHE 링크 제공 (FR-SRCH-003 AC-4) |
| 변경 파일 3000개 초과 PR은 절삭 저장 | 경로 필터에서 누락 가능 | `files_truncated: true` 표시 (FR-ING-004 AC-4) |
| `co_changes` 간선을 저장하지 않음 | 조회 시점 계산이므로 대형 PR에서 느림 | 변경 파일 200개 초과 PR 제외 (FR-REL-007 AC-4) |
| `precedes` 간선을 저장하지 않음 | 관계 그래프에서 선행·후행이 간선으로 보이지 않음 | W-007은 시퀀스 인접 노드를 조회 시점에 합성 |
| 저장소 간 patch-id 비교를 하지 않음 | 포크 간 체리픽 미탐지 | FR-REL-005 AC-3에 명시. 필요 시 CR |
| 접근 범위 500 저장소 초과 시 조직·팀 조건으로 치환 | 예외적으로 접근 범위가 넓은 사용자의 필터 정밀도가 낮아질 수 있음 | `visibility`와 `allowed_team_ids`로 정확도 유지, 권한 매트릭스 테스트로 검증 (ADR-008) |
