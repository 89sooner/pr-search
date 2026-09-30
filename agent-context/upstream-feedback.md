# Upstream Feedback

## `git show`가 promisor remote에 원격 접근하여 rate limit 악순환 (구현 결함, 미해결)

> **상류 반영 (`CR-139` / WP-120, DEV-810·811, 2026-10-01, main `d4967a9` 병합) — 요청(`readCommit`의 `git show` → `git log -1`)을 받아들였다. 원인 설명 가운데 일부는 재현 결과로 정정한다.** 제목의 「미해결」은 사용자 원문이며, 상류의 처리 상태는 이 주석이 적는다.
>
> - **재현.** 원격은 실제 `git upload-pack`을 HTTP로 서빙하고 요청 수를 원격 쪽에서 셌다. 미러는 워커와 같은 명령(`clone --mirror --filter=blob:none`, 설치 토큰 헤더)으로 만들었다(`remote.origin.promisor=true`, `partialclonefilter=blob:none`, blob 0). Git은 pilot.20·pilot.21 워커 이미지와 같은 2.54.0과 2.34.1이다. 커밋 모양 13종을 쟀고, 수정만·추가만·정확한 이름 변경·추가만 있는 병합 같은 대조군을 함께 두었다.
> - **맞았던 부분.** `git show`가 blobless 미러에서 문제를 일으킨다는 것, `readCommit`의 `null`이 `FallbackCommitGraph`를 거쳐 GHE API 호출이 된다는 것, `git log -1 --no-patch`가 같은 값을 원격 없이 읽는다는 것, 그리고 요청한 수정 방향이 모두 맞았다.
> - **재현 결과로 정정한 부분.** (1) 워커의 기본 설정(`GIT_NO_LAZY_FETCH=1`)에서 `git show`는 원격에 연결하지 않는다 — 요청 0건으로 `fatal: could not fetch <blob> from promisor remote`(exit 128)가 난다. 원격 연결은 지연 인출이 허용된 실행(`MIRROR_ALLOW_BLOB_FETCH=true`, 또는 환경 변수 없이 손으로 돌린 `git show`)에서만 일어났고, 워커 경로에서는 그때도 설치 토큰 헤더가 실렸다. (2) 모든 커밋이 아니라 추가와 삭제가 함께 있는 커밋(이름 변경+수정, 삭제+무관한 추가)과 둘째 부모 기준으로 추가·삭제가 섞인 병합 커밋에서만 일어난다. (3) rate-limit 격리는 `tokenFor`를 `null`로 만들지 않는다 — `TokenPool.lease()`는 격리 상태를 보지 않고 캐시된 토큰을 돌려준다. `null`은 토큰 발급이 실패하거나 App 설정이 없을 때만이다(DEV-812). (4) worker-sequence의 `fetch_failed`는 git fetch 실패가 아니라 M 번호 근거의 GHE REST 조회 실패다. git fetch 실패는 `mirror_sync_failed`로 남는다. `readCommit`이 실패하면 M 번호 근거는 `profile_unverified`가 되어 60초마다 다시 본다. (5) PIPE는 워커와 같은 토큰 풀을 쓰지 않는다 — search-api는 자기 토큰 풀을 쓰고, 공유되는 것은 GHE 설치 하나의 rate-limit 예산이다. 그 예산이 10% 아래로 떨어지면 search-api가 스스로 격리하고 신원 확인이 `PERMISSION_UNAVAILABLE`(`ghe_user_lookup_failed`)이 된다. 이 연결은 코드 경로로만 확인했다.
> - **최종 원인.** `git show --no-patch`는 diff 출력만 끄고 diff 계산은 한다. 그 계산의 이름 변경 감지가 추가와 삭제가 함께 있는 커밋에서 blob 내용을 요구하고, blobless 미러에는 그 blob이 없다. 그래서 그런 커밋은 미러가 갖고 있는데도 `readCommit`이 결정적으로 `null`이 되었고, 폴백 로그는 「미러가 커밋을 갖고 있지 않다」고 적었다. 같은 커밋을 다시 볼 때마다(커밋 보강, M 번호 근거의 재확인) REST 호출이 되풀이된다. 이것이 한도를 깎는 몫 하나이며, 사내 한도 소진 전체가 이것 하나 때문인지는 사내 수치로만 알 수 있다.
> - **수정.** `readCommit`은 `git log -1 --no-patch --no-use-mailmap`이다(형식 문자열과 해석 규칙은 그대로). bare 미러의 `HEAD:.mailmap` blob을 읽지 않도록 `firstParentCommits`에도 `--no-use-mailmap`을 붙였다(DEV-811). 미러에 없는 커밋은 여전히 `null`이고 API 폴백이 답한다. `GIT_NO_LAZY_FETCH` 기본값은 그대로다.
> - **회귀 증거.** 수정 전 코드에서는 새 시험이 실패했다 — 유발 커밋의 `null`, 지연 인출 허용 시 원격 요청, 같은 커밋 100회 중 0회 성공, API 폴백 3건. 배포 이미지의 Git 2.54.0에서 빌드한 `MirrorCommitGraph`로도 같았다. 수정 뒤에는 13종 모두 원격 요청 0건으로 원본의 옛 명령 값과 필드마다 같고, 원격이 모든 요청을 거절해도 읽으며, 100회 반복에도 요청 0건·API 폴백 0건이다. mirror 모드 M 번호 근거는 API가 격리 중이어도 막히지 않는다. 기록은 원장 6.130장이다.
> - **병합.** PR #264(squash) → main `d4967a9`(2026-10-01). PR CI run 36758877260, 병합 커밋의 main CI run 36782003226 — verify·integration 모두 첫 시도에 success. 이 변경은 아직 어느 Release에도 들어가지 않았다(최신 발행 `0.1.0-pilot.21`은 이보다 앞선다).
> - **사내 재검증: `NOT RUN — internal environment required`.** 다음 Release를 반입한 뒤 RUNBOOK 7.M의 순서로 같은 시간창의 전·후 수치를 비교한다 — worker-mirror·worker-sequence의 `graph_fallback` 수, `mirror_sync_failed` 반복 여부, M 번호 근거의 `profile_unverified`·`fetch_failed`와 durable work 재시도, PIPE 연동 이벤트의 `PERMISSION_UNAVAILABLE`, GHE 쪽 설치 한도 잔량(PR Search는 잔량 지표를 내보내지 않는다 — DEV-814), sequence·M 번호와 미러 fetch. 수치는 이 항목에 적는다.
> - **이번에 고치지 않은 것.** 토큰 발급 실패를 캐시하지 않는 것(DEV-812), `getCommitDetail`의 404 주석(DEV-813), 한도 잔량 지표 미배선(DEV-814).

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
