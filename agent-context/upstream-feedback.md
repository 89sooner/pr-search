# Upstream Feedback

## `git show`가 promisor remote에 원격 접근하여 rate limit 악순환 (구현 결함, 미해결)

발견: 0.1.0-pilot.22 사내 운영 (2026-09-30)
관련: `packages/github/src/mirror-graph.ts` / `packages/github/src/mirror-sync.ts` / `packages/github/src/token-pool.ts`

### 현상

PIPE 연동 API가 `PERMISSION_UNAVAILABLE` (503)으로 실패한다. 원인은 GHE API rate limit이 10% 미만(quarantine 임계)으로 떨어져 토큰 풀이 격리되면서, PIPE 연동의 identity binding(`findUserByLogin`)과 scope resolver가 GHE API를 호출하지 못하기 때문이다.

### 근본 원인: `git show`가 blobless clone의 promisor remote를 건드린다

1. mirror-graph.ts의 `readCommit`이 `git show --no-patch --format=... <sha>`로 커밋 메타데이터를 읽는다
2. mirror는 `--filter=blob:none` (blobless clone)이며 `remote.origin.promisor=true`가 설정되어 있다
3. `git show`는 promisor remote의 객체에 접근하려고 원격 URL에 인증 없이 연결을 시도한다
4. `tokenFor`가 rate limit으로 `null`을 반환하면 `authArgs(null)` → 인증 헤더 없음 → `git show` 실패
5. `readCommit`이 `null` 반환 → worker-mirror가 GHE API로 폴백 → rate limit 추가 소모
6. worker-sequence도 같은 `tokenFor` 사용 → `git fetch`도 인증 없이 실패 → `fetch_failed` 무한 재시도
7. 악순환: rate limit 소모 → tokenFor null → fetch/show 실패 → 재시도 → rate limit 더 소모
8. PIPE 연동도 같은 토큰 풀 공유 → quarantine 상태 → `PERMISSION_UNAVAILABLE`

`git log -1 --no-patch --format=... <sha>`는 promisor를 건드리지 않고 로컬 객체에서 읽는다 (확인함).

### 영향

- worker-sequence가 `fetch_failed`로 무한 재시도하며 GHE API rate limit을 소진
- PIPE 연동 전체가 503으로 차단
- rate limit 리셋 후 일시 복구되나, worker 재기동 후 시간이 지나면 재발

### 요청

`mirror-graph.ts`의 `readCommit`에서 `git show`를 `git log -1`로 변경. 동일한 포맷 인자와 `--no-patch`를 사용하며, promisor remote 원격 접근을 발생시키지 않는다.

---
