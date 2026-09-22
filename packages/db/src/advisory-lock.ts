/**
 * 시퀀스 채번 동시성 제어 (FR-SEQ-001 AC-6, 데이터 모델 3.2).
 *
 * 대기하지 않는 `pg_try_advisory_xact_lock`을 쓴다. 락을 얻지 못하면 잡을
 * 재큐에 넣고 종료한다 — 대기하면 워커가 묶이고 큐가 밀린다.
 */

import type { PoolClient } from 'pg';

/** 웹훅 멱등 처리 락 키. 전달 식별자 하나가 동시에 두 번 저장되지 않게 한다 (FR-ING-002). */
export function deliveryLockKey(deliveryId: string): string {
  return `ingest:${deliveryId}`;
}

/**
 * 잡 claim 직렬화 락 키 (CR-022, DEV-107).
 *
 * 유형 단위다. 동시 실행 상한이 `(type, state='running')`의 수에 대한
 * 제약이므로, 같은 유형을 잡으려는 워커들만 줄을 서면 된다 — 백필이
 * 재색인의 claim을 막을 이유는 없다.
 */
export function jobClaimLockKey(type: string): string {
  return `job:claim:${type}`;
}

/**
 * 미러 fetch 직렬화 락 키 (WP-074 / CR-079, ADR-023 C1, DEV-576).
 *
 * 저장소 단위 **세션** 락이다. `MirrorSync.sync`는 프로세스 간 동기화가 없어
 * sequence·mirror 스윕·release 세 호출자가 같은 디렉터리에 동시에 fetch할 수 있다.
 * 모든 `sync` 호출이 이 키를 지나면 한 저장소의 fetch는 언제나 하나다.
 *
 * `sequenceLockKey`와 나눈다 — 그 키는 트랜잭션 범위이고, fetch는 트랜잭션 밖에서
 * 돌아야 한다(네트워크 시간만큼 스냅숏을 붙잡지 않는다). 락 순서는 **미러 → 시퀀스
 * 트랜잭션**이며 반대 순서의 fetch를 만들지 않는다.
 */
export function mirrorSyncLockKey(repositoryId: number): string {
  return `mirror-sync:${String(repositoryId)}`;
}

/** 시퀀스 공간 하나에 대응하는 락 키 문자열. */
/**
 * PR↔커밋 관계 채택 락 (CR-116 / WP-101).
 *
 * `sequenceLockKey`와 나눈다 — 관계의 정체성은 base 브랜치에도 에폭에도 속하지
 * 않고, 채번을 기다리게 할 이유도 없다.
 */
export function pullRequestLinkLockKey(repositoryId: number, prNumber: number): string {
  return `prs:pr-link:${String(repositoryId)}:${String(prNumber)}`;
}

export function sequenceLockKey(repositoryId: number, baseBranch: string): string {
  return `seq:${String(repositoryId)}:${baseBranch}`;
}

/**
 * 안전 구간 표식 쓰기 락 키 (WP-041 / API-SEQ-004의 「멱등과 동시성」).
 *
 * **`sequenceLockKey`를 함께 쓰지 않는다.** 그 키는 채번 잡의 것이고 그쪽은
 * `try` + 재큐 방식이라, 표식 쓰기가 그것을 쥐고 있으면 **채번이 미뤄진다** —
 * 사람이 누르는 동기 요청이 파이프라인을 밀어내는 모양이 된다. 반대 방향도
 * 같다: 채번이 도는 동안 표식 등록이 막힐 이유가 없다. 표식과 채번은 같은
 * 공간을 가리키지만 **같은 행을 겨루지 않는다.**
 *
 * 공간 단위인 이유는 `safe_marker_current_uk`가 `(repository_id, base_branch)`에
 * 걸려 있기 때문이다 — 겨루는 것이 그 쌍이므로 줄을 서는 단위도 그것이다.
 */
export function safeMarkerLockKey(repositoryId: number, baseBranch: string): string {
  return `safe-marker:${String(repositoryId)}:${baseBranch}`;
}

/**
 * 릴리스 스냅숏 갱신 락 키 (WP-024 / JOB-REL-007).
 *
 * 저장소 단위다 — 갱신이 전량 diff(upsert + 스냅숏 밖 삭제)라, 두 갱신이
 * 겹치면 한쪽의 upsert를 다른 쪽의 삭제가 지운다. 파티션이 저장소당 직렬을
 * 이미 만들지만 6시간 보정 스윕은 파티션 밖에서 돌므로 락이 이중 안전장치다.
 */
export function releaseLockKey(repositoryId: number): string {
  return `release:${String(repositoryId)}`;
}

/**
 * 조직 팀 동기화 락 키 (WP-069 / CR-058, DEV-482).
 *
 * 조직 단위다 — 동기화가 그 조직의 팀 구성원을 **전량 교체**하므로, 두 동기화가
 * 겹치면 한쪽이 지운 자리에 다른 쪽이 옛 스냅숏을 넣는다.
 *
 * **`repositoryScopeLockKey`와 나눈다.** 그쪽은 저장소가 겨루는 단위이고
 * (`repository.allowed_team_ids` 한 행), 이쪽은 조직이 겨루는 단위다
 * (`team_membership`의 그 조직 몫 전체). 하나로 묶으면 같은 조직의 저장소
 * 등록 여럿이 서로의 팀 동기화를 막는다.
 */
export function orgTeamSyncLockKey(orgId: number): string {
  return `org:teams:${String(orgId)}`;
}

/**
 * 저장소 접근 범위 동기화 락 키 (CR-037, DEV-191).
 *
 * 저장소 단위다. 같은 저장소의 팀 목록을 GHE에서 읽어 정본과 색인에 쓰는 일이
 * 여러 진입점(등록·팀 웹훅·조정 스캔)에서 동시에 일어날 수 있고, 각자 다른
 * 스냅숏을 읽어 조건 없이 덮어쓰면 **늦게 끝난 옛 호출이 회수를 되돌린다.**
 * 권한 스트림은 `team_id`로만 파티션되므로 그 직렬화는 여기에 닿지 않는다.
 */
export function repositoryScopeLockKey(repositoryId: number): string {
  return `repo:scope:${String(repositoryId)}`;
}

/**
 * 표기 실행자 배제 키 (WP-075 안전성 보강 / DEV-629).
 *
 * ## 무엇을 막는가
 *
 * 같은 정본 DB를 보는 표기 프로세스가 **둘 이상 뜨는 것**을 막는다. 회차 겹침을
 * 프로세스 안 promise 체인으로 막은 것은 파드 하나 안에서만 참이고, 배포가
 * `replica 1`이라는 사실은 사람이 값을 올리는 순간 사라진다. 락은 그 값을 올려도
 * **두 번째 프로세스가 쓰지 못하게** 한다.
 *
 * ## 무엇을 막지 못하는가
 *
 * **보장 범위는 이 DB를 공유하는 프로세스들뿐이다.** 서로 다른 DB를 보는 두 배포가
 * 같은 GHE를 고치는 것은 여기서 막히지 않으며, GHE 자신이 fencing token을 검증하지
 * 않으므로 네트워크 분할에서의 exactly-once도 보장하지 않는다. 락을 쥔 프로세스가
 * 이미 보낸 요청은 락을 잃은 뒤에도 서버에 닿을 수 있다 — 그래서 **쓰기 직전마다**
 * 락 커넥션으로 정본을 다시 묻고, 그 질의가 실패하면 요청을 보내지 않는다.
 *
 * 키가 하나인 이유는 배제하려는 것이 저장소가 아니라 **실행자**이기 때문이다.
 * 저장소별로 나누면 두 프로세스가 서로 다른 저장소를 동시에 쓰게 되고, 그때
 * 변경 요청 간격이 실행자 전체에서 지켜지지 않는다.
 */
export function annotateRunnerLockKey(): string {
  return 'annotate:runner';
}

/**
 * GitHub Operations 운영 정책 잠금 키 (CR-090, 마이그레이션 030).
 *
 * 배포 범위(`GHE_BASE_URL`의 호스트) 단위다. **SQL도 같은 문자열로 잡는다** — 정책 변경 함수(배타)와 실행기 검증 기록·
 * 실행권 확정 트리거(공유)가 `hashtext('gh:policy:' || scope)`를 쓴다. 문자열이 어긋나면 직렬화가 조용히 풀리므로
 * 이 함수와 마이그레이션의 접두를 시험이 함께 건다.
 */
export function ghPolicyLockKey(scope: string): string {
  return `gh:policy:${scope}`;
}

/**
 * 재색인 울타리 키 (WP-035 / CR-045·046, DEV-296·308).
 *
 * ## 왜 키가 하나인가
 *
 * 계약은 "별칭 단위 advisory lock"이라고 적는다. 그런데 논리 쓰기 하나가 **여러
 * 별칭에 걸친다** — 한 이벤트가 PR 문서와 커밋 문서를 같은 벌크로 쓴다. 별칭마다
 * 키를 나누면 그 쓰기가 락 여럿을 순서대로 잡아야 하고, 그 순간 교착 가능성이
 * 생긴다.
 *
 * **동시 실행 상한이 1이므로**(DEV-300) 재색인 중인 별칭은 언제나 하나뿐이고,
 * 키 하나는 별칭별 키와 **정확히 같은 배제 집합**을 만든다. 상한을 올리게 되면
 * 그때 키를 나누고 잠금 순서를 정한다.
 *
 * ## 공유·배타로 가른다
 *
 * 논리 쓰기는 **공유**로 잡는다 — 서로를 막지 않으므로 평시 처리량이 그대로다.
 * 활성화와 전환은 **배타**로 잡아 "진행 중인 논리 쓰기가 하나도 없을 때만"을
 * 데이터베이스가 보장하게 한다 (DEV-308). 배타 하나가 모든 쓰기를 막는 것은
 * 전환이 걸리는 몇 밀리초뿐이다.
 */
export function reindexFenceKey(): string {
  return 'reindex:fence';
}

/**
 * 세션 범위 **공유** advisory lock을 잡는다 (WP-035, DEV-296).
 *
 * 공유끼리는 서로를 막지 않고 배타만 막는다. 논리 쓰기가 이것을 쥔 동안에는
 * 활성화도 전환도 진행하지 못한다.
 *
 * 트랜잭션 범위가 아닌 이유는 `acquireAdvisorySessionLock`과 같다 — 이 락은
 * **Elasticsearch 왕복을 감싸야** 하고, 그동안 트랜잭션을 열어 두면 커넥션과
 * 스냅숏을 네트워크 시간만큼 붙잡는다.
 *
 * @returns 잡았으면 `true`. `lockTimeoutMs` 안에 잡지 못하면 `false` —
 *   호출부는 **쓰기를 진행하지 않는다.** 울타리 없이 쓰면 그 쓰기가 shadow에서
 *   빠질 수 있고, 그것이 이 락이 막으려는 유일한 것이다.
 */
export async function acquireAdvisorySharedLock(
  client: PoolClient,
  key: string,
  lockTimeoutMs = 30_000,
): Promise<boolean> {
  await client.query(`SET lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  try {
    await client.query('SELECT pg_advisory_lock_shared(hashtext($1))', [key]);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return false;
    throw error;
  } finally {
    await client.query('RESET lock_timeout').catch(() => undefined);
  }
}

/** 세션 범위 공유 advisory lock을 푼다. */
export async function releaseAdvisorySharedLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock_shared(hashtext($1))', [key]);
}

/**
 * 세션 범위 advisory lock을 잡는다 (CR-037, DEV-191).
 *
 * ## 왜 트랜잭션 범위가 아닌가
 *
 * 이 락은 **GHE 왕복을 감싸야** 한다 — 조회와 쓰기 사이에 다른 호출이 끼어드는
 * 것이 막으려는 경주이기 때문이다. 트랜잭션 범위 락을 쓰면 네트워크 왕복 내내
 * 트랜잭션이 열려 있어야 하고, 그것은 커넥션과 스냅숏을 GHE 응답 시간만큼
 * 붙잡는다. 세션 락은 트랜잭션과 수명이 분리되므로 그럴 필요가 없다.
 *
 * ## 반드시 풀어야 한다
 *
 * 세션 락은 커넥션이 풀로 돌아가도 **남는다.** 풀지 않고 반납하면 그 커넥션을
 * 다음에 쓰는 쪽이 영원히 잠긴 키를 물려받는다. 호출부는 `finally`에서
 * `releaseAdvisorySessionLock`을 부른 뒤 반납한다.
 *
 * @returns 잡았으면 `true`. `lockTimeoutMs` 안에 잡지 못하면 `false`.
 */
export async function acquireAdvisorySessionLock(
  client: PoolClient,
  key: string,
  lockTimeoutMs = 30_000,
): Promise<boolean> {
  await client.query(`SET lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    return true;
  } catch (error) {
    // 55P03 lock_not_available — 다른 세션이 쥐고 있다. 던지지 않고 알린다.
    if ((error as { code?: string }).code === '55P03') return false;
    throw error;
  } finally {
    // 세션 설정이라 반납 후 다음 사용자에게 새어 나간다. 반드시 되돌린다.
    await client.query('RESET lock_timeout').catch(() => undefined);
  }
}

/**
 * 세션 범위 advisory lock을 **기다리지 않고** 시도한다 (WP-074, 상세 설계 4.1).
 *
 * `acquireAdvisorySessionLock`은 `lock_timeout`까지 기다린다. 채번의 선행 fetch는
 * 기다리면 워커 슬롯이 묶이므로 즉시 답을 받아 `defer`한다 — 채번 자체가
 * `trySequenceSpaceLock`으로 같은 규율을 쓴다 (CR-025, DEV-117).
 *
 * 세션 락이므로 **반드시 `releaseAdvisorySessionLock`으로 푼다.** 풀지 못한
 * 커넥션은 풀에 돌려보내지 않고 폐기한다 (`client.release(true)`).
 *
 * @returns 잡았으면 `true`. 다른 세션이 쥐고 있으면 즉시 `false`.
 */
export async function tryAdvisorySessionLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
    [key],
  );
  return result.rows[0]?.locked === true;
}

/** 세션 범위 advisory lock을 푼다. 잡지 않은 키를 풀어도 경고뿐이다. */
export async function releaseAdvisorySessionLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
}

/**
 * 트랜잭션 범위 advisory lock을 시도한다.
 *
 * @returns 락을 얻었으면 `true`. 다른 트랜잭션이 쥐고 있으면 즉시 `false`.
 */
export async function tryAdvisoryXactLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
    [key],
  );
  return result.rows[0]?.locked === true;
}

/**
 * 대기하는 트랜잭션 범위 advisory lock.
 *
 * 채번과 달리 수집 경로는 **기다려야** 한다. 같은 전달 식별자가 동시에 두 번
 * 도착했을 때 재큐할 곳이 없기 때문이다 — 앞선 트랜잭션이 커밋할 때까지
 * 기다렸다가 중복인지 다시 본다. `lock_timeout`으로 대기를 잘라 수신 응답
 * 예산(NFR-002 p95 300ms)이 무한정 밀리지 않게 한다.
 */
export async function advisoryXactLock(
  client: PoolClient,
  key: string,
  lockTimeoutMs = 2_000,
): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}

/** 시퀀스 공간 락. `tryAdvisoryXactLock`에 키 생성을 합친 것이다. */
export async function trySequenceSpaceLock(
  client: PoolClient,
  repositoryId: number,
  baseBranch: string,
): Promise<boolean> {
  return tryAdvisoryXactLock(client, sequenceLockKey(repositoryId, baseBranch));
}
