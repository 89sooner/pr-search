-- 저장된 검색의 공유 계약 (WP-033 / CR-049, DEV-335·340).
--
-- ## 왜 필요한가
--
-- 마이그레이션 004가 `saved_search`를 만들면서 `team_id`를 nullable로 두고
-- `visibility` CHECK만 걸었다. 그래서 스키마가 두 가지 뜻 없는 상태를 함께
-- 허용한다: **`private`인데 팀을 가리키는 행**과 **`team`인데 대상이 없는 행**.
-- 앞의 것은 아무것도 뜻하지 않고, 뒤의 것은 "공유한다고 적혀 있는데 대상이
-- 없다" — 조회가 그것을 만나면 답할 것이 없다.
--
-- CR-049가 `team` 공개 범위를 **정확히 하나의 대상 팀**으로 정했으므로
-- (FR-SRCH-010 AC-1) 그 불변식을 스키마가 지킨다.
--
-- ## 무엇을 만들지 않는가
--
-- **새 표를 만들지 않는다.** 저장된 검색은 하나의 행이 하나의 자산이며 공유
-- 대상도 하나다 — 다대다가 아니다.
--
-- **팀 slug을 비정규화하지 않는다.** slug은 `(org_id, slug)`에서만 유일하므로
-- (DEV-331) 여기에 복사하면 같은 이름의 다른 조직 팀으로 공유가 새고, 팀
-- 개명이 이 표를 낡게 만든다. 대상은 언제나 `team_id`다.
--
-- **100건 상한을 CHECK로 강제하지 않는다** (DEV-336). PostgreSQL의 `CHECK`는
-- 다른 행을 볼 수 없어 "이 사용자의 행이 몇 개인가"를 물을 수 없다. 그 상한은
-- 소유자 행을 잠그는 트랜잭션이 지킨다.
--
-- **`updated_at`을 더하지 않는다.** 지금 그것을 읽는 계약이 없다.
--
-- ## CREATE INDEX CONCURRENTLY를 쓰지 않는 이유
--
-- 마이그레이션 러너가 하나를 단일 트랜잭션에서 실행한다
-- (`packages/db/src/migrate.ts`의 `withTransaction`). `CONCURRENTLY`는 트랜잭션
-- 블록 안에서 실행할 수 없다. 014가 같은 판단을 했다.

-- 사용자를 지우면 그의 저장 검색도 함께 사라진다 (DEV-347).
--
-- 데이터 모델 「보존과 삭제」 표가 `saved_search`를 **"영구 (사용자 삭제 시
-- 제거) · 하드 삭제"**로 정해 두었는데, 004의 외래 키에는 그 정책이 없어
-- `app_user` 삭제가 외래 키 위반으로 막혔다. **문서가 정한 것을 스키마가
-- 지키지 않던 자리**이며, 이 열을 처음 쓰는 WP가 그것을 드러냈다.
--
-- 004를 고치지 않는다 — 이미 적용된 마이그레이션은 수정하지 않는다. 제약을
-- 다시 만드는 것이 정상 경로다.
--
-- **`team_id`는 CASCADE로 하지 않는다.** 팀이 사라졌다고 저장자의 자산을
-- 지우는 것은 과하고, `SET NULL`은 아래 불변식을 깨뜨린다. 팀을 지우려면 그
-- 공유를 먼저 처리해야 한다는 뜻이며, 운영에는 팀 삭제 경로 자체가 없다.
ALTER TABLE saved_search DROP CONSTRAINT saved_search_owner_user_id_fkey;
ALTER TABLE saved_search
  ADD CONSTRAINT saved_search_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app_user(user_id) ON DELETE CASCADE;

-- 공개 범위와 대상 팀은 함께 성립하거나 함께 없다 (FR-SRCH-010 AC-1).
--
-- 004의 `saved_search_visibility_chk`는 값의 범위만 정한다. 이것은 두 열의
-- 관계를 정하므로 별도 제약이며, 004를 고치지 않는다 — 이미 적용된
-- 마이그레이션은 수정하지 않는다.
ALTER TABLE saved_search
  ADD CONSTRAINT saved_search_team_target_chk CHECK (
    (visibility = 'private' AND team_id IS NULL)
    OR (visibility = 'team' AND team_id IS NOT NULL)
  );

-- 목록 순회 인덱스 (FR-SRCH-010 AC-5).
--
-- 정렬은 `created_at DESC, saved_search_id DESC`로 고정돼 있고 커서는 그 쌍을
-- 키셋으로 쓴다. 인덱스가 같은 순서를 담아야 순회가 정렬 없이 끝난다.

-- `view=mine` — 내가 소유한 것 전부 (`private`와 `team` 모두).
CREATE INDEX saved_search_owner_idx
  ON saved_search (owner_user_id, created_at DESC, saved_search_id DESC);

-- `view=team` — 내가 구성원인 팀에 공유된 것.
--
-- `visibility = 'team'`인 행만 대상이므로 부분 인덱스다. `team_id`가 NULL인
-- 행은 위 CHECK가 보장하듯 `private`이고, 이 목록의 후보가 아니다.
CREATE INDEX saved_search_team_idx
  ON saved_search (team_id, created_at DESC, saved_search_id DESC)
  WHERE visibility = 'team';
