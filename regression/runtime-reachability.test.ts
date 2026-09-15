/**
 * 운영 도달성 (CR-034 / WP-028 post-merge).
 *
 * ## 왜 회귀 계층인가
 *
 * WP-028의 다섯 결함은 전부 같은 모양이었다 — **함수는 있고 시험은 초록인데
 * 운영 프로세스가 그것을 부르지 않는다.** 단위·통합 시험은 "코드가 설계대로
 * 도는가"를 묻고 그 질문에는 전부 통과했다.
 *
 * 이 파일은 다른 질문을 한다: **"선언한 기능이 배포에서 실제로 실행되는가."**
 * 선언(계약) → 기동(entrypoint) → 종료(shutdown) → 배포(manifest)가 한 줄로
 * 이어지는지를 소스에서 직접 확인한다.
 *
 * 문자열 검사라 정교하지 않다. 그래도 **"start를 지웠는데 아무 시험도 안 죽는
 * 상태"보다는 낫다** — 그 상태가 이 CR의 원인이었다.
 *
 * 실행: `pnpm test:regression`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// **판정을 문자열로 세지 않고 실제로 부른다** (DEV-615). 계약 함수를 그대로 들여온다.
import { ACTIVE_AUDIT_ACTIONS, NOT_ACTIVATED_AUDIT_ACTIONS } from '@prs/domain';
import { LOGICAL_CONSUMERS, TOPICS, consumerGroup } from '@prs/bus';
import { annotateConfigFailure, resolveAnnotateConfig, resolveAnnotateEnabled } from '@prs/github-annotate';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, redactString } from '@prs/gh-cli';
import { redact as redactGitHub } from '@prs/github';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8');

const WORKER_INDEX = read('apps/pipeline-worker/src/index.ts');
const API_RUNTIME = read('apps/search-api/src/runtime.ts');
const API_INDEX = read('apps/search-api/src/index.ts');

/**
 * 운영 도달성 표 (CR-034).
 *
 * 한 줄이 한 기능이다. `start`가 entrypoint에 없으면 그 기능은 배포에서 돌지
 * 않는다 — 그것이 WP-028에서 일어난 일이다.
 */
const CAPABILITIES = [
  {
    id: 'JOB-AUTH-001',
    what: '권한 캐시 무효화 워커',
    process: 'pipeline-worker',
    role: 'authz',
    start: 'authzSubscription = await startAuthzWorker(',
    stop: 'authzSubscription?.close()',
    manifest: 'deploy/k8s/pipeline-worker-authz.yaml',
  },
  {
    id: 'JOB-ING-006',
    what: '무중단 재색인 러너',
    process: 'pipeline-worker',
    role: 'batch',
    start: 'reindexRunner = startReindexRunner(',
    stop: 'reindexRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-batch.yaml',
  },
  {
    id: 'JOB-ING-006-retention',
    what: '재색인 보관 정리 스윕',
    process: 'pipeline-worker',
    role: 'batch',
    start: 'retentionSweeper = startRetentionSweeper(',
    stop: 'retentionSweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-batch.yaml',
  },
  {
    id: 'JOB-SRCH-001',
    what: '검색 결과 내보내기 러너',
    process: 'pipeline-worker',
    role: 'batch',
    start: 'exportRunner = startExportRunner(',
    stop: 'exportRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-batch.yaml',
  },
  {
    id: 'JOB-AUD-001',
    what: '감사·원본 파티션 수명 (생성 + 만료 드롭)',
    process: 'pipeline-worker',
    role: 'batch',
    start: 'partitionRetention = startRetentionRunner(',
    stop: 'partitionRetention?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-batch.yaml',
  },
  {
    id: 'API-ADM-005',
    what: '감사 기록 조회 API',
    process: 'search-api',
    role: null,
    start: 'audit: {',
    stop: null,
    manifest: 'deploy/k8s/search-api.yaml',
  },
  {
    id: 'API-ADM-004',
    what: '무중단 재색인 시작 API',
    process: 'search-api',
    role: null,
    start: 'reindex: buildReindexDeps(',
    stop: null,
    manifest: 'deploy/k8s/search-api.yaml',
  },
  {
    id: 'API-ADM-007',
    what: '시퀀스 정합성 점검·재채번 API',
    process: 'search-api',
    role: null,
    start: 'buildServer(buildServerDeps(',
    stop: null,
    manifest: 'deploy/k8s/search-api.yaml',
  },
  {
    id: 'JOB-SEQ-002',
    what: '수동 재채번 러너',
    process: 'pipeline-worker',
    role: 'sequence',
    start: 'repairRunner = startSequenceRepairRunner(',
    stop: 'repairRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-sequence.yaml',
  },
  {
    id: 'JOB-SEQ-001-manual',
    what: '수동 채번 러너 (CR-055)',
    process: 'pipeline-worker',
    role: 'sequence',
    start: 'assignRunner = startSequenceAssignRunner(',
    stop: 'assignRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-sequence.yaml',
  },
  {
    id: 'JOB-SEQ-003',
    what: '정합성 점검 스윕',
    process: 'pipeline-worker',
    role: 'sequence',
    start: 'integritySweeper = startIntegritySweeper(',
    stop: 'integritySweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-sequence.yaml',
  },
  {
    id: 'JOB-ING-005',
    what: '조정 스캔',
    process: 'pipeline-worker',
    role: 'reconcile',
    start: 'reconcileSweeper = startReconcileSweeper(',
    stop: 'reconcileSweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-reconcile.yaml',
  },
  {
    id: 'JOB-ING-010',
    what: '정본 스냅숏 부트스트랩',
    process: 'pipeline-worker',
    role: 'reconcile',
    start: 'snapshotBootstrapRunner = startSnapshotBootstrapRunner(',
    stop: 'snapshotBootstrapRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-reconcile.yaml',
  },
  {
    id: 'JOB-MIR-002',
    what: '커밋 메타데이터 보강',
    process: 'pipeline-worker',
    role: 'mirror',
    start: 'commitEnrichSubscription = await startCommitEnrichWorker(',
    stop: 'commitEnrichSubscription?.close()',
    manifest: 'deploy/k8s/pipeline-worker-mirror.yaml',
  },
  {
    id: 'JOB-MIR-002-sweep',
    what: '커밋 보강 잔여분 스윕',
    process: 'pipeline-worker',
    role: 'mirror',
    start: 'commitEnrichSweeper = startCommitEnrichSweeper(',
    stop: 'commitEnrichSweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-mirror.yaml',
  },
  {
    id: 'JOB-REL-001',
    what: '참조 간선 파생·해결',
    process: 'pipeline-worker',
    role: 'link',
    start: 'linkSubscription = await startLinkWorker(',
    stop: 'linkSubscription?.close()',
    manifest: 'deploy/k8s/pipeline-worker-link.yaml',
  },
  {
    id: 'JOB-REL-006',
    what: '참조 간선 전량 재파생',
    process: 'pipeline-worker',
    role: 'link',
    start: 'referenceRebuildRunner = startReferenceRebuildRunner(',
    stop: 'referenceRebuildRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-link.yaml',
  },
  {
    id: 'JOB-ING-008',
    what: 'PG↔ES 정합성 감시',
    process: 'pipeline-worker',
    role: 'project',
    start: 'consistencySweeper = startConsistencySweeper(',
    stop: 'consistencySweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-project.yaml',
  },
  /*
   * WP-074. **durable 러너가 없으면 push 의도가 표에만 쌓이고 아무도 집지 않는다** —
   * DEV-178·DEV-180이 정확히 그 모양이었다(잡 행은 만들어지는데 러너가 없었다).
   * M 기능이 꺼져 있어도 이 러너는 refresh를 처리해 DEV-576을 닫으므로 언제나 선다.
   */
  {
    id: 'JOB-SEQ-004',
    what: 'M 번호 durable work 러너',
    process: 'pipeline-worker',
    role: 'sequence',
    start: 'sequenceWorkRunner = startSequenceWorkRunner(',
    stop: 'sequenceWorkRunner?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-sequence.yaml',
  },
  {
    id: 'JOB-SEQ-004-cleanup',
    what: 'M 운영 메타데이터 정리',
    process: 'pipeline-worker',
    role: 'batch',
    start: 'sequenceMetadataCleanup = startSequenceMetadataCleanup(',
    stop: 'sequenceMetadataCleanup?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-batch.yaml',
  },
  /*
   * WP-075 / JOB-SEQ-005. 이 제품이 사람의 지시 없이 GHE에 쓰는 유일한 경로다.
   * 구독과 잔여 스윕이 **둘 다** 있어야 한다 — 구독만 있으면 이벤트가 유실된
   * PR의 표기가 영영 빠지고, 스윕만 있으면 하루를 기다린다.
   */
  {
    id: 'JOB-SEQ-005',
    what: 'PR 제목 M 넘버 표기 구독',
    process: 'pipeline-worker',
    role: 'annotate',
    start: 'annotateSubscription = await startAnnotateWorker(',
    stop: 'annotateSubscription?.close()',
    manifest: 'deploy/k8s/pipeline-worker-annotate.yaml',
  },
  {
    id: 'JOB-SEQ-005-sweep',
    what: 'PR 제목 미표기 잔여 스윕',
    process: 'pipeline-worker',
    role: 'annotate',
    start: 'annotateSweeper = startAnnotateSweeper(',
    stop: 'annotateSweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-annotate.yaml',
  },
] as const;

describe('선언한 기능이 운영에서 실제로 기동한다 (CR-034)', () => {
  /*
   * **호출 형태로 단언한다.** 이름만 찾으면 `import` 줄이 남아 있는 한 호출을
   * 지워도 통과한다 — 처음 이 시험을 그렇게 썼다가 "start 삭제" 변이가 살아남는
   * 것을 보고 고쳤다.
   */
  it.each(CAPABILITIES)('$id $what — entrypoint가 시작한다', ({ start, process: proc }) => {
    const source = proc === 'search-api' ? `${API_INDEX}${API_RUNTIME}` : WORKER_INDEX;
    expect(source).toContain(start);
  });

  it.each(CAPABILITIES.filter((entry) => entry.stop !== null))(
    '$id $what — 종료에서 정리한다',
    ({ stop }) => {
      // 기동만 하고 shutdown에서 잊으면 롤링 배포가 진행 중인 작업을 끊는다.
      expect(WORKER_INDEX).toContain(stop as string);
    },
  );

  it.each(CAPABILITIES.filter((entry) => entry.role !== null))(
    '$id $what — 그 역할이 워커에 실재한다',
    ({ role }) => {
      expect(WORKER_INDEX).toContain(`roles.includes('${role as string}')`);
    },
  );

  it.each(CAPABILITIES)('$id $what — 배포 manifest가 있다', ({ manifest }) => {
    expect(existsSync(new URL(manifest, new URL('..', import.meta.url)))).toBe(true);
  });

  it.each(CAPABILITIES.filter((entry) => entry.role !== null))(
    '$id $what — manifest가 그 역할을 켠다',
    ({ role, manifest }) => {
      expect(read(manifest)).toContain(`value: ${role as string}`);
    },
  );

  /*
   * **배포 프로파일이 둘이면 도달성도 둘이다** (CR-059 / ADR-021, DEV-498).
   *
   * 위 검사들은 `deploy/k8s/`만 본다. 인프라 3.0장이 "두 프로파일은 같은 배포 단위
   * 집합을 세운다"고 정했으므로, Profile A의 산출물이 같은 역할을 켜지 않으면
   * **그 기능은 첫 사내 반입에서 배포되지 않는다** — `CR-034`가 찾은 결함이
   * 프로파일 축에서 그대로 재현되는 자리다.
   */
  it.each(CAPABILITIES.filter((entry) => entry.role !== null))(
    '$id $what — Profile A(단일 호스트)도 그 역할을 켠다',
    ({ role }) => {
      const compose = read('deploy/single-host/compose.yml');
      const roles = [...compose.matchAll(/PIPELINE_WORKER_ROLES: *([a-z,]+)/g)]
        .flatMap((match) => (match[1] ?? '').split(','));
      expect(roles, `Profile A가 '${role as string}' 역할을 세우지 않는다`).toContain(role);
    },
  );

  /*
   * 미배포 예외였던 둘을 Profile A가 실제로 세운다 (DEV-304 · DEV-305).
   *
   * `backfill`은 첫 반입 후 기존 PR 히스토리를 채우는 유일한 경로이고,
   * `release`는 포함 관계 조회(W-005)의 데이터를 만든다. **둘이 없으면
   * 반입된 시스템이 사실상 비어 있다.**
   */
  it('Profile A가 backfill과 release를 세운다 (DEV-304 · DEV-305)', () => {
    const compose = read('deploy/single-host/compose.yml');
    const roles = [...compose.matchAll(/PIPELINE_WORKER_ROLES: *([a-z,]+)/g)]
      .flatMap((match) => (match[1] ?? '').split(','));
    expect(roles).toContain('backfill');
    expect(roles).toContain('release');
  });

  /*
   * **`latest`는 릴리스 신원이 아니다** (DEV-491). Profile A의 애플리케이션
   * 이미지는 버전을 가리켜야 하며, 그래야 반입된 형상이 어느 외부 커밋에서
   * 왔는지 답할 수 있다.
   */
  it('Profile A가 애플리케이션 이미지에 `latest`를 쓰지 않는다 (DEV-491)', () => {
    const compose = read('deploy/single-host/compose.yml');
    const appImages = [...compose.matchAll(/image: *(prs\/[a-z-]+:[^\s]+)/g)].map((m) => m[1] ?? '');
    expect(appImages.length).toBeGreaterThan(0);
    for (const image of appImages) {
      expect(image, `${image}가 버전을 가리키지 않는다`).toMatch(/:\$\{PRS_VERSION/);
    }
  });

  /*
   * **백킹 서비스를 호스트에 노출하지 않는다** (인프라 6장 Profile A 규칙).
   * 오케스트레이터의 네트워크 정책이 없으므로 노출을 줄이는 것이 통제 수단이다.
   */
  it('Profile A가 백킹 서비스 포트를 호스트에 발행하지 않는다', () => {
    const compose = read('deploy/single-host/compose.yml');
    for (const service of ['postgres', 'elasticsearch', 'redis']) {
      const start = compose.indexOf(`\n  ${service}:\n`);
      expect(start, `${service} 서비스가 없다`).toBeGreaterThan(0);
      const next = compose.indexOf('\n  ', compose.indexOf('\n', start + 4));
      const block = compose.slice(start, next > start ? compose.indexOf('\n\n', start) : undefined);
      expect(block, `${service}가 호스트 포트를 발행한다`).not.toContain('ports:');
    }
  });

  /*
   * **compose 정의 파일 자체에 시크릿 리터럴이 없다** (DEV-499).
   * `docker compose config` 출력은 정의상 `.env` 값을 치환하므로 그것으로 판정하지
   * 않는다 — 그렇게 하면 통과할 수 없는 검사가 된다.
   */
  it('Profile A의 compose 정의에 시크릿 리터럴이 없다 (DEV-499)', () => {
    const compose = read('deploy/single-host/compose.yml');
    const assignments = [...compose.matchAll(/^\s*([A-Z_]*(?:SECRET|PASSWORD|TOKEN|KEY))[A-Z_]*: *(.+)$/gm)];
    expect(assignments.length).toBeGreaterThan(0);
    for (const match of assignments) {
      expect(match[2] ?? '', `${match[1] ?? ''}가 환경 참조가 아니다`).toMatch(/\$\{/);
    }
  });

  /*
   * **`search-api`의 헬스체크가 백킹 서비스를 실제로 확인한다** (DEV-495).
   * 인프라 3장 표가 그렇게 적어 두었는데 오랫동안 무조건 `ok`를 답했다.
   */
  /*
   * WP-074 / DEV-580. `API-SEQ-007`은 라우트 파일과 시험이 다 있어도 **등록 한 줄이
   * 빠지면 배포에서 사라진다** — `API-ADM-007`이 그 상태였다(CR-034, DEV-177).
   * 회귀가 그 호출 형태를 직접 건다.
   */
  it('API-SEQ-007이 시퀀스 라우트에 등록되고 기능 플래그가 운영 배선을 지난다 (WP-074)', () => {
    const routes = read('apps/search-api/src/sequence/routes.ts');
    expect(routes).toContain('app.get(MERGE_NUMBER_RESOLVE_PATH');
    expect(routes).toContain('resolveMergeNumber(');
    // 서버가 config의 플래그를 실제로 넘긴다 — 넘기지 않으면 언제나 404다.
    const server = read('apps/search-api/src/server.ts');
    expect(server).toContain('mergeNumberEnabled: config.mergeNumberEnabled === true');
  });

  /**
   * 플래그가 **가는 곳과 가지 않는 곳** (WP-074 / DEV-589·DEV-606).
   *
   * **M 코드가 도는 역할 전부**에 가야 한다. 하나라도 빠지면 그 역할만 꺼진 배포가
   * 되고, 그 상태는 오류도 로그도 없이 조용히 나타난다.
   *
   * - `search-api` — 응답에 M 키를 만든다. 빠지면 번호가 생겨도 실리지 않는다.
   * - `worker-sequence` — 채번한다. 빠지면 번호 자체가 생기지 않는다.
   * - `worker-batch` — **재색인이 여기서 돈다.** 빠지면 재색인 뒤 M 복구 의도를
   *   만들지 않아 새 색인의 M이 영영 빈다 (`DEV-597`이 고친 것이 되돌아온다).
   *
   * **`web`에는 가지 않는다.** 화면은 응답에 M 키가 있는지로만 판단하므로 그 값을
   * 읽지 않는다. 거기 두면 켜고 끄는 자리가 하나 더 늘고, 런북의 진단이 운영자를
   * 없는 자리로 보낸다.
   *
   * **서비스 이름으로 센다.** 개수만 세면 어느 역할에 갔는지 알 수 없고, 한 곳을
   * 빼고 다른 곳에 둘을 둬도 통과한다.
   */
  /**
   * `batch` 역할은 **플래그 하나만** 읽는다 (`DEV-607`).
   *
   * `resolveMergeNumberConfig()`는 `MNUMBER_BATCH_SIZE`·`MNUMBER_POLL_MS` 같은 채번
   * 전용 값까지 검증하고 범위를 벗어나면 던진다. `batch`가 그것을 부르면 **채번과
   * 무관한 역할이 채번 설정 때문에 기동하지 못한다** — 정리·보존·재색인이 함께 죽는다.
   *
   * 그 검증은 그 값을 실제로 쓰는 `sequence` 역할의 몫이다. 두 곳이 같은 이름을
   * 같은 규칙(`'true'`만 켜짐)으로 읽는 것은 아래에서 함께 본다.
   */
  it('**`batch`가 채번 설정 전체를 검증하지 않는다** (DEV-607)', () => {
    const index = read('apps/pipeline-worker/src/index.ts');
    const reindexDeps = /const reindexDeps: ReindexDeps = \{[\s\S]*?\n {2}\};/.exec(index)?.[0] ?? '';
    expect(reindexDeps).not.toBe('');

    /*
     * **주석이 아니라 실제 코드를 본다.** 주석에 그 함수 이름을 적는 것은 왜 부르지
     * 않는지 설명하는 일이라 막을 이유가 없다.
     */
    const code = reindexDeps
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');
    // 채번 전용 값을 검증하는 쪽을 부르지 않는다 — 그 오타가 batch를 멈추면 안 된다.
    expect(code).not.toContain('resolveMergeNumberConfig(');
    expect(code).toContain('resolveMergeNumberEnabled(');
  });

  /**
   * 켜짐의 정의가 **역할마다 같은가** (`DEV-608`).
   *
   * ## 왜 철자가 아니라 행동을 보는가
   *
   * 앞선 판에서는 두 소스에 특정 문자열이 있는지로 이것을 걸었다. 그것은 셋을
   * 놓친다. 부분 문자열의 **존재**만 보므로 다른 규칙을 한 줄 앞에 넣어도 통과하고,
   * 포매터가 따옴표를 바꾸면 동작이 같은데도 죽으며, **이미 갈라진 상태를 애초에
   * 보지 못한다.**
   *
   * 실제로 갈라져 있었다. 독립 검토가 세 구현을 같은 입력으로 불러 일곱 중 셋에서
   * 답이 다른 것을 보였다 — 빈 문자열에 한쪽은 `false`이고 한쪽은 던졌으며, `yes`에
   * 두 곳은 던지는데 `batch`만 조용히 꺼졌다. **조용히 꺼지는 것**이 `DEV-606`에서
   * 고친 실패 모양 그대로다.
   *
   * 그래서 **함수를 실제로 불러 표를 건다.** 리팩터링에 깨지지 않고, 한쪽 규칙만
   * 바뀌면 반드시 잡힌다.
   */
  it('**M 켜짐의 정의가 두 앱에서 같다** — 입력 표로 건다 (DEV-608)', async () => {
    const worker = await import('../apps/pipeline-worker/src/mnumber-config.js');
    const api = await import('../apps/search-api/src/config.js');

    const accepted: readonly (readonly [Record<string, string>, boolean])[] = [
      [{}, false],
      [{ MNUMBER_ENABLED: 'true' }, true],
      [{ MNUMBER_ENABLED: 'false' }, false],
      // `??`는 빈 문자열을 잡지 않는다. 그것이 꺼짐인지 오류인지가 갈렸던 자리다.
      [{ MNUMBER_ENABLED: '' }, false],
      [{ MNUMBER_ENABLED: ' true ' }, true],
      [{ MNUMBER_ENABLED: ' false ' }, false],
    ];

    for (const [env, expected] of accepted) {
      const label = JSON.stringify(env);
      expect(worker.resolveMergeNumberEnabled(env), `worker ${label}`).toBe(expected);
      expect(api.resolveMergeNumberEnabled(env), `search-api ${label}`).toBe(expected);
      // 채번 설정도 같은 답을 낸다 — 정의를 다시 쓰지 않기 때문이다.
      expect(worker.resolveMergeNumberConfig(env).enabled, `config ${label}`).toBe(expected);
    }

    // 오타를 켜짐으로도 꺼짐으로도 읽지 않는다. **세 곳이 함께 거부한다.**
    for (const bad of ['yes', 'TRUE', 'True', '1', 'on', 'no']) {
      const env = { MNUMBER_ENABLED: bad };
      expect(() => worker.resolveMergeNumberEnabled(env), `worker ${bad}`).toThrow();
      expect(() => api.resolveMergeNumberEnabled(env), `search-api ${bad}`).toThrow();
      expect(() => worker.resolveMergeNumberConfig(env), `config ${bad}`).toThrow();
    }
  });

  it('M 번호 플래그가 M 코드가 도는 세 역할에 가고 **web에는 가지 않는다** (DEV-589·DEV-606)', () => {
    const compose = read('deploy/single-host/compose.yml');

    /** 서비스 블록마다 그 이름이 있는가. compose의 두 칸 들여쓰기가 블록 경계다. */
    const carriers = new Set<string>();
    let current = '';
    for (const line of compose.split('\n')) {
      const header = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
      if (header?.[1] !== undefined) current = header[1];
      if (line.includes('MNUMBER_ENABLED') && current !== '') carriers.add(current);
    }

    expect([...carriers].sort()).toEqual(['search-api', 'worker-batch', 'worker-sequence']);
    expect(carriers.has('web')).toBe(false);

    // K8s도 같다 — 배포 방식이 달라도 켜고 끄는 자리는 같아야 한다.
    expect(read('deploy/k8s/pipeline-worker-sequence.yaml')).toContain('MNUMBER_ENABLED');
    expect(read('deploy/k8s/pipeline-worker-batch.yaml')).toContain('MNUMBER_ENABLED');

    expect(read('deploy/single-host/.env.example')).toContain('MNUMBER_ENABLED=false');
  });

  it('Profile A가 sequence 역할에 미러 볼륨과 mirror 모드를 함께 준다 (WP-074 / DEV-576)', () => {
    const compose = read('deploy/single-host/compose.yml');
    const block = /worker-sequence:[\s\S]*?\n\n/.exec(compose)?.[0] ?? '';
    expect(block).toContain('SEQUENCE_GRAPH_MODE: ${SEQUENCE_GRAPH_MODE:-mirror}');
    expect(block).toContain('mirror-data:/var/lib/prs/mirrors');
    // Profile B는 볼륨이 없으므로 API 모드를 **명시**한다 (ADR-023 C6).
    expect(read('deploy/k8s/pipeline-worker-sequence.yaml')).toContain('value: api');
  });

  it('push 수신이 채번 의도를 원본과 같은 트랜잭션에 남긴다 (WP-074 / AC-11)', () => {
    const store = read('apps/ingest-gateway/src/store.ts');
    expect(store).toContain('sequenceWorkRepo.enqueueRefreshWork(');
    // 같은 `withTransaction` 안이어야 한다 — 밖이면 반쪽 커밋이 생긴다.
    expect(store).toContain('if (inserted) await recordRefreshIntent(client, event)');
  });

  it('채번이 freshness 진입을 거친다 — 버스·수동·durable 세 경로가 같은 문을 쓴다 (DEV-576)', () => {
    const sequence = read('apps/pipeline-worker/src/sequence.ts');
    expect(sequence).toContain('export async function prepareAndAssignSequence(');
    expect(sequence).toContain('await prepareAndAssignSequence(deps, repositoryId, baseBranch, event.correlation_id)');
    expect(read('apps/pipeline-worker/src/sequence-assign-runner.ts')).toContain('prepareAndAssignSequence(');
    expect(read('apps/pipeline-worker/src/sequence-work-runner.ts')).toContain('prepareAndAssignSequence(');
  });

  it('모든 미러 fetch 호출자가 같은 락을 지난다 (WP-074 / ADR-023 C1)', () => {
    // sequence·mirror 스윕·release 셋이 같은 디렉터리에 동시에 fetch하지 않는다.
    expect(read('apps/pipeline-worker/src/sequence-freshness.ts')).toContain('withMirrorLock(');
    expect(read('apps/pipeline-worker/src/mirror-runner.ts')).toContain('withMirrorLock(');
    expect(WORKER_INDEX).toContain('withMirrorLock(pool, repositoryId, () => relSync.sync(ref, repositoryId)');
  });

  it('search-api 운영 배선이 헬스체크에 백킹 서비스 확인을 넘긴다 (DEV-495)', () => {
    expect(API_RUNTIME).toContain('checkBackingServices:');
    expect(API_RUNTIME).toContain("await parts.pool.query('SELECT 1')");
    expect(API_RUNTIME).toContain('await parts.es.ping()');
  });
});

describe('사내 반입 절차가 실행 도구와 같은 말을 한다 (WP-071 / CR-062)', () => {
  /*
   * **런북은 번들 안에 들어가 사내 운영자가 위에서 아래로 그대로 실행한다.**
   * 그래서 문서의 순서와 실행 도구의 검사가 어긋나면 그것은 오타가 아니라
   * 설치 실패다 — `DEV-524`가 정확히 그 모양이었고(`load`가 `.env`보다 앞),
   * `DEV-513`이 업그레이드 절에서 같은 결함을 닫은 직후였다.
   *
   * 여기서는 스크립트와 런북을 **문자열로** 대조한다. 실제 아카이브 생성과
   * `load`의 fail-fast는 실행으로 검증하며(원장 6.64장), 이 시험은 그 계약이
   * 조용히 되돌아가는 것을 막는 자리다.
   */
  const BUILD = read('deploy/single-host/build-bundle.sh');
  const PRSCTL = read('deploy/single-host/prsctl');
  const RUNBOOK = read('deploy/single-host/RUNBOOK.md');

  /** "`a`가 `b`보다 먼저 온다" — 둘 다 있는지 먼저 본다 (DEV-474). */
  const expectOrder = (text: string, first: string, second: string): void => {
    expect(text, first).toContain(first);
    expect(text, second).toContain(second);
    expect(text.indexOf(first), `${first} < ${second}`).toBeLessThan(text.indexOf(second));
  };

  /*
   * **사내로 가져갈 파일은 하나다** (DEV-523). 번들 디렉터리 옆에 운반 아카이브를
   * 만들되, checksum 생성과 시크릿 검사가 **끝난 뒤**여야 검사를 통과한 내용만
   * 담는다. `-C "$OUT_ROOT"`로 형제 위치에 두므로 아카이브가 자기 자신을 담지 않는다.
   */
  it('build-bundle.sh가 운반 아카이브를 checksum·시크릿 검사 뒤에 만든다 (DEV-523)', () => {
    expect(BUILD).toContain('ARCHIVE="${BUNDLE}.tar.gz"');
    expectOrder(BUILD, 'sha256sum > checksums/SHA256SUMS', 'tar -czf "$ARCHIVE"');
    expectOrder(BUILD, '번들에 시크릿으로 보이는 파일이 있다', 'tar -czf "$ARCHIVE"');
    expect(BUILD).toContain('tar -czf "$ARCHIVE" -C "$OUT_ROOT" "$(basename "$BUNDLE")"');
    expect(BUILD).toContain('tar -tzf "$ARCHIVE"');
  });

  /*
   * **`load`는 이미지 저장소를 바꾸기 전에 `.env`를 요구한다** (DEV-524).
   * 검사가 `docker load` 뒤에 있으면 fail-fast가 아니다.
   */
  it('prsctl load가 docker load보다 먼저 .env를 요구한다 (DEV-524)', () => {
    const start = PRSCTL.indexOf('cmd_load() {');
    const end = PRSCTL.indexOf('cmd_install() {');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expectOrder(PRSCTL.slice(start, end), 'require_env', 'docker load -i');
  });

  /*
   * **런북의 최초 설치 순서가 실행 도구의 검사와 같다** (DEV-524).
   * extract → verify → .env → load → install → smoke → lineage.
   */
  it('런북의 최초 설치가 .env 작성을 load보다 앞에 둔다 (DEV-524)', () => {
    const start = RUNBOOK.indexOf('### 2.B');
    const end = RUNBOOK.indexOf('### 2.C');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const install = RUNBOOK.slice(start, end);
    expectOrder(install, 'tar -xzf pr-search-<version>-offline.tar.gz', './prsctl verify');
    expectOrder(install, './prsctl verify', 'cp .env.example .env');
    expectOrder(install, 'cp .env.example .env', './prsctl load');
    expectOrder(install, './prsctl load', './prsctl install');
    expectOrder(install, './prsctl install', './prsctl smoke');
    expectOrder(install, './prsctl smoke', './prsctl lineage');
  });

  /*
   * **이미지 tar는 `docker load`의 대상이지 `tar`로 푸는 것이 아니다** (DEV-523).
   * `.tar`를 보고 `tar -xf`를 치도록 읽히는 문장이 런북에 있으면 안 된다.
   */
  it('런북이 이미지 tar를 직접 푸는 대상으로 적지 않는다 (DEV-523)', () => {
    expect(RUNBOOK).not.toMatch(/tar\s+-?x\w*\s+\S*(?:images\/|pr-search-app\.tar|backing-services\.tar)/);
    expect(RUNBOOK).toContain('`docker load`');
    expect(RUNBOOK).toContain('직접 풀지 않는다');
    expect(RUNBOOK).toContain('git fetch <파일> HEAD:vendor/upstream');
  });

  /*
   * **번들에 들어가는 텍스트는 LF다** (DEV-526). 빌더의 checkout이 `core.autocrlf=true`면
   * `.gitattributes`가 고정하지 않은 `.env.example`이 CRLF로 복사되고, 사내에서 `cp`한
   * `.env`의 모든 값 끝에 `\r`이 붙어 `require_env`가 `3600` 같은 멀쩡한 값을 거부한다.
   * 실제 검증 실행에서 그렇게 실패했다 — 속성으로 고정하고 빌드가 한 번 더 정규화한다.
   */
  it('번들의 배포 정의 텍스트가 LF로 고정된다 (DEV-526)', () => {
    const attributes = read('.gitattributes');
    expect(attributes).toContain('deploy/single-host/.env.example text eol=lf');
    expect(attributes).toContain('deploy/single-host/RUNBOOK.md text eol=lf');
    expect(BUILD).toContain("sed -i 's/\\r$//'");
  });
});

describe('사내 반입 운반이 GitHub Release와 같은 말을 한다 (WP-072 / CR-063)', () => {
  /*
   * **운반 경계는 "물리적 이동"이라는 문장 하나였다** (DEV-528). 결정자가 사내 어느
   * 위치에서든 github.com에 닿는다고 확인하면서 운반은 GitHub Release 자산이 됐다.
   * 발행은 아카이브를 다시 읽은 뒤여야 하고, 태그는 manifest의 커밋을 가리켜야 하며,
   * 발행한 자산은 다시 읽어 대조해야 한다. 사내 쪽은 받기 → digest 대조 → 풀기 순서다.
   *
   * 실제 발행·다운로드·대조는 실행으로 검증하며(원장 6.66장), 이 시험은 그 계약이
   * 조용히 되돌아가는 것을 막는 자리다.
   */
  const BUILD = read('deploy/single-host/build-bundle.sh');
  const RUNBOOK = read('deploy/single-host/RUNBOOK.md');
  const ENV_EXAMPLE = read('deploy/single-host/.env.example');

  const expectOrder = (text: string, first: string, second: string): void => {
    expect(text, first).toContain(first);
    expect(text, second).toContain(second);
    expect(text.indexOf(first), `${first} < ${second}`).toBeLessThan(text.indexOf(second));
  };

  /*
   * **읽지 못하는 아카이브를 발행하지 않는다.** 발행은 `tar -tzf` 재독 뒤이고, 태그는
   * manifest가 적는 바로 그 커밋을 가리킨다 — 다른 커밋이면 릴리스의 계보 증명이 거짓이다.
   */
  it('build-bundle.sh가 아카이브를 다시 읽은 뒤에만 발행하고 태그가 manifest의 커밋을 가리킨다 (DEV-528)', () => {
    expectOrder(BUILD, 'tar -tzf "$ARCHIVE"', 'gh release create');
    expect(BUILD).toContain('--target "$UPSTREAM_COMMIT"');
  });

  /*
   * **되돌릴 수 없는 일 앞에 검사를 둔다** (DEV-544가 DEV-519의 대조를 발행 앞으로 옮겼다).
   * 대조가 발행 뒤에 있으면, immutable releases를 켠 저장소에서 어긋났을 때 되돌리기가
   * 버전 이름을 영구히 태운다 — 잠긴 릴리스를 지우면 같은 이름을 다시 쓸 수 없다.
   * 초안 상태에서도 GitHub가 name·size·digest·state를 주므로 발행 전에 잴 수 있다(실측).
   */
  it('build-bundle.sh가 발행 전에 자산을 대조하고 발행 뒤에는 되돌리지 않는다 (DEV-519 / DEV-544)', () => {
    // 초안 → 자산 → **대조** → 발행 → 확인
    expect(BUILD).toContain('--draft');
    expectOrder(BUILD, 'gh release create', 'step "초안 자산 대조 (발행 전)"');
    expectOrder(BUILD, 'step "초안 자산 대조 (발행 전)"', '-F draft=false');
    expectOrder(BUILD, '-F draft=false', 'step "발행 확인"');
    expect(BUILD).toContain('.digest');
    expect(BUILD).toContain('초안 자산 digest가 다르다');
    expect(BUILD).toContain('undo_release; die "초안 자산 digest가 다르다');
    // 업로드가 끝난 자산인지도 본다 — 초안 상태에서 GitHub가 주는 값이다
    expect(BUILD).toContain('초안 자산이 업로드 완료가 아니다');
    // **조회 실패를 불일치로 세지 않는다** (DEV-042가 npm 쪽에서 가르친 것)
    expect(BUILD).toContain('초안 자산을 조회하지 못했다');
    // 발행 요청이 실패해도 서버에 적용됐으면 되돌리지 않는다 (DEV-535의 연장)
    expect(BUILD).toContain('서버에는 적용됐다');
    // **불변식**: 발행 확인 구간에는 되돌리기가 없다. 개별 문구가 아니라
    // "발행 뒤에는 되돌리지 않는다"를 고정한다.
    const afterPublishCheck = BUILD.slice(BUILD.indexOf('step "발행 확인"'));
    expect(afterPublishCheck).not.toContain('undo_release');
    expect(afterPublishCheck).toContain('되돌리지 않는다');
  });

  /*
   * **런북이 코드가 하는 만큼 말한다** (DEV-044의 교훈). 발행 뒤에 스크립트가 되돌리지
   * 않고 사람에게 넘기는 자리가 넷 있다. 그 상태에서 무엇을 확인해 어떻게 판단하는지가
   * 런북에 없으면, 잠긴 저장소에서 담당자의 잘못된 판단 하나가 버전 이름을 태운다.
   * 메시지를 고치면 이 시험이 먼저 깨진다 — 런북이 조용히 어긋나지 않게 한다.
   */
  it('런북이 발행 뒤 사람 판단이 필요한 상태를 스크립트와 같은 말로 안내한다 (DEV-544)', () => {
    const handoffs = [
      '발행 요청은 실패했으나 서버에는 적용됐다',
      '발행 뒤 확인 조회가 실패했다',
      '발행했는데 여전히 초안이다',
      '초안을 발행하지 못했고 실제 상태도 확인하지 못했다',
    ];
    for (const message of handoffs) {
      // 스크립트가 실제로 내는 말이어야 하고,
      expect(BUILD).toContain(message);
      // 런북이 그 말을 그대로 받아 안내해야 한다.
      expect(RUNBOOK).toContain(message);
    }
    // 판단의 근거가 되는 확인 절차와, 지우면 이름을 회수하지 못한다는 사실을 함께 적는다.
    expect(RUNBOOK).toContain('공개된 릴리스를 확인한다');
    expect(RUNBOOK).toContain('같은 이름을 회수하지 못한다');
  });

  /*
   * **남의 태그와 자기 태그는 처방이 반대다** (DEV-546 / PR #148 머지 후 리뷰 P1).
   * `undo_note()`는 다른 주체가 만든 태그에 대해 "지우지 않았다 — 새 버전으로 다시 실행"이라
   * 말하고, 이 실행이 만든 태그에 대해서는 "지운 뒤 다시 실행"이라 말한다. 런북이 둘을 한 행에
   * 합치면 운영자가 남의 태그를 지우게 되고, `DEV-541`이 코드에서 막은 것을 사람 손으로 하게 된다.
   */
  it('런북이 남의 태그와 자기 태그의 처방을 가른다 (DEV-546 / DEV-541)', () => {
    const start = RUNBOOK.indexOf('### 발행이 중간에 멈췄다면');
    const end = RUNBOOK.indexOf('### 경계 —');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const halt = RUNBOOK.slice(start, end);

    expect(halt).toContain('이 실행이 만든 것이 아니므로 지우지 않았다');
    expect(halt).toContain('그 태그를 지우지 않는다');
    expect(halt).toContain('새 버전으로');
    expect(halt).toContain('같은 버전으로');

    // **기대값 없는 삭제를 지시하지 않는다** (DEV-547). `TAG_LEFT`는 "그대로 남았다"와
    // "옮겨졌다"를 함께 담으므로, 기대값 없이 지우라고 하면 남의 태그를 지우게 된다.
    // 이 시험의 앞 판(PR #149)은 정반대로 그 명령이 **있어야** 한다고 요구했다 — 틀린 계약을
    // 굳히고 있었다.
    expect(halt).not.toMatch(/git push origin\s+:refs\/tags\//);
    expect(halt).not.toContain('git push --force-with-lease=');
    expect(halt).toContain('커밋 일치는 소유를 증명하지 않는다');
    expect(halt).toContain('대상을 먼저 본다');

    // **두 상황이 각각의 행에 있어야 한다.** 합치면 처방이 섞인다.
    const foreignRow = halt.split(/\r?\n/).find((l) => l.includes('이 실행이 만든 것이 아니므로'));
    expect(foreignRow).toBeDefined();
    expect(foreignRow).toContain('지우지 않는다');
    expect(foreignRow).not.toContain('같은 버전으로');
  });

  /*
   * **한 함수 안에서 두 메시지가 어긋나지 않는다** (DEV-547). `undo_note()`의 `TAG_LEFT`
   * 분기는 "그대로 남았다"와 "옮겨졌다"를 함께 다루므로, 기대값 없는 삭제를 지시하면
   * DEV-541이 코드에서 막은 남의 태그 삭제를 사람 손으로 하게 만든다. 같은 함수의 경고는
   * 이미 "확인한 뒤 판단한다"고 말하고 있었다.
   */
  it('undo_note가 기대값 없는 태그 삭제를 지시하지 않는다 (DEV-547)', () => {
    const start = BUILD.indexOf('undo_note() {');
    expect(start).toBeGreaterThan(-1);
    const note = BUILD.slice(start, BUILD.indexOf('\n  }', start));

    expect(note).not.toMatch(/git push origin\s+:refs\/tags\//);
    expect(note).not.toContain('git push');
    expect(note).toContain('소유를 증명하지 않는다');
    expect(note).toContain('태그를 보존하고');
    expect(note).toContain('새 버전으로');
  });

  /*
   * **`target_commitish`는 태그의 현재 대상이 아니다** (DEV-546). GitHub 문서가 "태그가 이미
   * 존재하면 사용되지 않는다"고 정하고, 이 스크립트는 태그를 먼저 원자적으로 만든 뒤 발행한다
   * (DEV-541). 그 필드로 계보를 판정하면, 태그가 옮겨진 릴리스를 온전하다고 선언해 **버전과
   * 소스의 계보가 거짓인 번들**을 사내로 내보낼 수 있다.
   */
  it('런북의 회복 절차가 태그를 역참조해 manifest와 대조한다 (DEV-546)', () => {
    const start = RUNBOOK.indexOf('#### 공개된 릴리스를 확인한다');
    expect(start).toBeGreaterThan(-1);
    const recover = RUNBOOK.slice(start, RUNBOOK.indexOf('### 경계 —'));

    expect(recover).toContain('refs/tags/<version>^{}');
    expect(recover).toContain('release-manifest.json');
    expect(recover).toContain('target_commitish');
    expect(recover).toContain('태그가 이미 존재하면 사용되지 않는다');
    // 온전 판정에 계보가 들어가야 한다
    expect(recover).toContain('manifest 커밋과 같으면');
  });

  /*
   * **릴리스는 불변이고 검사는 빌드 앞이다** (DEV-524가 가르친 것 — 검사의 위치).
   * 같은 버전의 릴리스가 있으면 몇 분짜리 이미지 빌드를 시작하기 전에 멈춘다.
   */
  it('build-bundle.sh가 같은 버전의 릴리스가 있으면 이미지를 빌드하기 전에 멈춘다', () => {
    expectOrder(BUILD, 'gh release view "$VERSION"', 'docker build --target');
  });

  /*
   * **사내 쪽은 받기 → digest 대조 → 풀기다.** 대조가 풀기 뒤에 있으면 손상된 파일을
   * 이미 풀어 놓은 뒤에 알게 된다. 2.B의 단계 번호는 그대로다 — 2.C·8장이 그 번호를 가리킨다.
   */
  it('런북 2.B 1단계가 받기 → digest 대조 → 풀기 순서이고 단계 번호는 그대로다', () => {
    const start = RUNBOOK.indexOf('### 2.B');
    const end = RUNBOOK.indexOf('### 2.C');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const install = RUNBOOK.slice(start, end);
    expectOrder(install, 'gh release download <version>', "--jq '.assets[].digest'");
    expectOrder(install, "--jq '.assets[].digest'", 'sha256sum pr-search-<version>-offline.tar.gz');
    expectOrder(install, 'sha256sum pr-search-<version>-offline.tar.gz', 'tar -xzf pr-search-<version>-offline.tar.gz');
    expect(install).toContain('# 3) 구성 작성');
    expect(install).toContain('# 5) 설치');
  });

  /*
   * **읽기 토큰이 `.env`에 들어갈 자리가 없다** (NFR-005). 서비스는 그 토큰을 읽지 않고,
   * 런북은 토큰을 실행 순간의 환경 변수로만 준다.
   */
  it('읽기 토큰이 .env에 들어갈 자리가 없고 런북이 소재를 적는다 (NFR-005)', () => {
    expect(ENV_EXAMPLE).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/);
    expect(RUNBOOK).toContain('GH_TOKEN=<읽기 토큰> gh release download');
    expect(RUNBOOK).toContain('Contents: Read-only');
    expect(RUNBOOK).toContain('`.env`·번들·저장소·호스트의 시크릿 파일');
  });

  /*
   * **릴리스는 저절로 불변이 아니다** (DEV-530, PR #119 머지 후 리뷰). 쓰기 권한자가 발행 뒤에도
   * 자산·태그를 바꿀 수 있으므로, 같은 릴리스의 현재 digest와만 대조하는 것은 검증이 아니다.
   * 정본은 담당자가 별도 채널로 전달한 SHA-256이며, 스크립트 출력과 런북 2.A·2.B가 그것을 말한다.
   */
  it('자산 SHA-256이 릴리스와 별도 채널로 전달되고 사내가 그것과 대조한다 (DEV-530)', () => {
    expect(BUILD).toContain('별도 채널로 전달할 것 셋');
    expect(BUILD).toContain('immutable-releases');
    expect(RUNBOOK).toContain('**사내 운영자에게 전달할 것은 셋이다**');
    const start = RUNBOOK.indexOf('### 2.B');
    const end = RUNBOOK.indexOf('### 2.C');
    expect(RUNBOOK.slice(start, end)).toContain('담당자가 별도 채널로 전달한 SHA-256');
  });

  /*
   * **초안 잔재를 남기지 않는다** (DEV-531, PR #120 머지 후 리뷰). 초안을 올린 뒤 id 조회가
   * 실패하면 되돌려야 한다 — 남기면 같은 버전의 재실행이 전제 검사에서 막힌다.
   * **curl 경로는 자산 id를 실제로 뽑아야 한다** (DEV-532). 한 줄 JSON에 id가 넷이라 grep은 답이 아니다.
   */
  it('초안 id 조회 실패가 초안을 되돌리고, curl 경로가 assets[]에서 id를 뽑는다 (DEV-531 · DEV-532)', () => {
    expect(BUILD).toContain('lookup_draft_id()');
    expect(BUILD).toContain('[ -n "$RELEASE_ID" ] || RELEASE_ID="$(lookup_draft_id)"');
    expect(BUILD).toMatch(/for attempt in 1 2 3; do[\s\S]*?undo_release\n\s+die "만든 초안의 id를 얻지 못했다 — \$\(undo_note\)"/);
    // 되돌리기의 결과를 사실대로 말한다 — 지우지 못했으면 "되돌렸다"고 보고하지 않는다 (DEV-533)
    expect(BUILD).toContain('UNDONE=1');
    expect(BUILD).toContain('릴리스를 되돌리지 못했다');
    expect(BUILD).not.toMatch(/die "[^"]*초안을 되돌렸다/);
    // 발행이 만든 태그의 삭제 결과도 보고에 들어간다 — 릴리스만 지우고 "되돌렸다"고 하지 않는다 (DEV-534)
    expect(BUILD).not.toContain('PUBLISHED');
    /*
     * **소유는 원자적 생성의 성공으로만 얻는다** (DEV-541이 DEV-537을 넓힌다). 같은 버전을
     * 같은 커밋으로 두 실행이 겹치면 "이 실행 전에 없었고 지금 내 커밋을 가리킨다"가 남의
     * 태그에도 참이 되므로, 커밋 일치를 소유 근거로 쓰지 않는다. 실제 동시성 시나리오는
     * `release-tag-ownership.test.ts`가 스크립트를 돌려 확인한다.
     */
    expect(BUILD).toMatch(/TAG_CREATED_BY_THIS_RUN=0/);
    expect(BUILD).toMatch(/gh api "repos\/\$\{REPO_SLUG\}\/git\/refs"[^\n]*ref=refs\/tags\/\$\{VERSION\}[\s\S]*?TAG_CREATED_BY_THIS_RUN=1/);
    expect(BUILD).toMatch(/undo_release\(\) \{[\s\S]*?\[ "\$TAG_CREATED_BY_THIS_RUN" -eq 1 \][\s\S]*?git push --force-with-lease="refs\/tags\/\$\{VERSION\}:\$\{UPSTREAM_COMMIT\}" origin ":refs\/tags\/\$\{VERSION\}"/);
    // 소유하지 않은 태그는 확인만 하고 남긴다 — 커밋이 같아도 지우지 않는다
    expect(BUILD).toMatch(/undo_release\(\) \{[\s\S]*?git ls-remote --tags origin "refs\/tags\/\$\{VERSION\}"[\s\S]*?TAG_FOREIGN=/);
    expect(BUILD).toContain('이 실행이 만든 것이 아니다 — 지우지 않는다');
    expect(BUILD).toContain('릴리스는 지웠으나 태그');
    // 기대값 없는 삭제로 되돌아가지 않는다
    expect(BUILD).not.toMatch(/git push origin ":refs\/tags\/\$\{VERSION\}"/);
    expect(BUILD).not.toMatch(/git push[^\n]*refs\/tags\/\$\{VERSION\}[^\n]*\|\| true/);
    expect(RUNBOOK).toContain('json.load(sys.stdin)["assets"]');
    expect(RUNBOOK).not.toMatch(/\|\s*grep -E '"\(id\|name\|digest\)"'/);
  });
});

describe('수동 실행이 실제로 러너에 닿는다 (WP-040 / CR-055)', () => {
  const RECONCILE = read('apps/pipeline-worker/src/reconcile.ts');
  const ASSIGN = read('apps/pipeline-worker/src/sequence-assign-runner.ts');
  const OPS_JOBS = read('apps/search-api/src/ops/jobs.ts');

  /*
   * **잡 유형을 여는 것과 러너가 있는 것은 다르다** (FR-ADMIN-002 AC-6).
   * `DEV-178`·`DEV-180`이 그 함정을 두 번 밟았다 — 생성만 열려 있으면 아무도
   * 집지 않는 행이 남고, 그 행이 활성 잡 제약에 걸려 이후의 복구까지 막는다.
   */
  it.each([
    ['reconcile', RECONCILE],
    ['sequence_assign', ASSIGN],
  ])('%s 잡을 집는 러너가 있다', (type, source) => {
    expect(OPS_JOBS).toContain(`'${type}'`);
    expect(source).toContain('claimNextJob');
  });

  /*
   * **조정 스캔은 두 방아쇠가 한 루프다** (FR-ING-011 AC-7, PR #88 리뷰 P2).
   * 단일 복제본 배치는 프로세스 수를 제한할 뿐 한 프로세스 안의 독립적인 비동기
   * 루프 둘을 직렬화하지 못한다. `runReconcileSweep`를 부르는 자리가 하나여야
   * 겹칠 수 있는 구조가 없다.
   */
  it('runReconcileSweep를 부르는 자리가 루프 안에 둘뿐이다 — 수동과 주기', () => {
    const calls = RECONCILE.match(/await runReconcileSweep\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(RECONCILE).toContain('claimNextJob(deps.pool, RECONCILE_JOB_TYPE, 1)');
  });

  it('별도의 조정 스캔 러너 파일을 만들지 않았다', () => {
    // 두 번째 루프가 생기면 그 파일 이름이 먼저 나타난다.
    expect(existsSync(new URL('apps/pipeline-worker/src/reconcile-runner.ts', new URL('..', import.meta.url)))).toBe(
      false,
    );
  });

  /*
   * **종료 상태는 조건부 전이여야 한다** (DEV-196·DEV-436). 무방비 `finishJob`은
   * 운영자의 취소를 완료로 덮는다 — 백필만 이 규율을 채택하지 않아 세 세션을
   * 떠돌았다.
   */
  it.each([
    'apps/pipeline-worker/src/backfill.ts',
    'apps/pipeline-worker/src/link.ts',
    'apps/pipeline-worker/src/reindex.ts',
    'apps/pipeline-worker/src/sequence-repair-runner.ts',
    'apps/pipeline-worker/src/sequence-assign-runner.ts',
    'apps/pipeline-worker/src/reconcile.ts',
  ])('%s — 무방비 finishJob을 쓰지 않는다', (path) => {
    expect(read(path)).not.toMatch(/jobRepo\.finishJob\(/);
  });

  /*
   * **한 함수 안에서 두 갈래가 갈리지 않는다** (DEV-437). `resolveJobTarget`의
   * `sequence_assign` 갈래는 슬러그 형식을 검사하는데 일반 갈래가 그것을
   * 빠뜨려, 슬래시 없는 값이 저장소 조회로 내려가 404가 되었다 — 운영자는
   * 자기 오타를 "그 저장소가 없다"로 읽는다. **형식이 틀린 것과 등록되지 않은
   * 것은 다른 오류다.**
   */
  it('resolveJobTarget의 두 갈래가 모두 슬러그 형식을 검사한다 (DEV-437)', () => {
    const checks = OPS_JOBS.match(/if \(owner === '' \|\| name === ''\)/g) ?? [];
    expect(checks).toHaveLength(2);
  });

  /*
   * **`reconcile`은 대상을 받지 않는다.** 받아서 무시하면 운영자는 자기가 지정한
   * 저장소만 스캔됐다고 믿는다 — 전량 스캔이 돌았는데도 그렇다.
   */
  /*
   * **중단은 상태 보존이 아니라 실행 정지다** (PR #89 리뷰 P1). 조건부 종료
   * 전이만으로는 잡 행이 `cancelled`로 남을 뿐, 전량 스윕이 계속 돌며 GHE를
   * 부른다 — 화면은 "취소됨"을 보이는데 비싼 스캔이 진행 중이다.
   */
  it('runReconcileSweep가 취소 신호를 받고 루프가 그것을 본다', () => {
    expect(RECONCILE).toMatch(/cancelled\?: \(\) => Promise<boolean>/);
    expect(RECONCILE).toContain('if (cancelled !== undefined && (await cancelled()))');
    // 수동 잡이 실제로 그 신호를 넘긴다.
    expect(RECONCILE).toContain('jobRepo.isJobRunning(deps.pool, job.job_id)');
  });

  /*
   * **`allowed_actions`는 안내이자 판정 그 자체다** (PR #89 리뷰 P2). 응답에서만
   * 빼고 변이 경로가 일반 전이표로 받으면 직접 호출이 그것을 지나간다.
   */
  it('applyJobAction이 잡 유형의 좁힌 목록을 강제한다', () => {
    expect(OPS_JOBS).toContain('allowedActionsForJob(before.type, before.state)');
    expect(OPS_JOBS).toContain("kind: 'unsupported_action'");
  });

  /*
   * **409는 실행 중 잡 식별자를 함께 준다** (FR-ADMIN-002 AC-4, QA-A003-03).
   *
   * 리터럴 전문을 걸지 않는다 (DEV-438이 같은 자리에서 배운 것). 재는 성질은
   * **"식별자 없는 충돌이 존재할 수 없다"**이며, 그것은 타입에 `null`이 없다는
   * 사실로 표현된다 (DEV-444). `| null`을 걸어 두면 이 성질이 강해졌을 때
   * 시험이 그것을 결함으로 신고한다.
   */
  it('JOB_CONFLICT가 잡 식별자를 싣는다', () => {
    expect(OPS_JOBS).toMatch(/kind: 'conflict'; readonly jobId: number/);
    expect(OPS_JOBS).not.toMatch(/jobId: number \| null/);
    expect(read('apps/search-api/src/ops/routes.ts')).toContain('job_id: outcome.jobId');
  });

  /*
   * **취소 신호가 저장소 안까지 닿는다** (PR #91 리뷰 P1, DEV-443). 스윕이
   * 신호를 받아 두고 저장소 조정에 넘기지 않으면 활성 저장소가 하나일 때
   * 확인 지점이 사라진다.
   */
  it('스윕이 취소 신호를 저장소 조정에 넘긴다', () => {
    expect(RECONCILE).toContain('await reconcileRepository(deps, repository, cancelled)');
    expect(RECONCILE).toContain('if (await shouldStop()) break scan;');
  });

  it('reconcile이 대상을 받으면 거절한다', () => {
    expect(OPS_JOBS).toContain("body['target'] !== undefined || body['repository'] !== undefined");
    expect(OPS_JOBS).toContain('RECONCILE_TARGET');
  });
});
describe('주기 스윕을 가진 역할은 replica 1이다', () => {
  // 리더 선출이 없다 — 여러 파드가 같은 주기에 같은 대상을 중복 처리한다.
  it.each([
    'deploy/k8s/pipeline-worker-sequence.yaml',
    'deploy/k8s/pipeline-worker-reconcile.yaml',
    // WP-075: 잔여 스윕이 리더 선출 없이 돈다. 파드가 둘이면 같은 PR에 요청이 두 번 나간다.
    'deploy/k8s/pipeline-worker-annotate.yaml',
  ])(
    '%s',
    (manifest) => {
      expect(read(manifest)).toMatch(/replicas:\s*1\b/);
    },
  );
});

describe('참조 간선 파생의 도달성 (WP-029 / CR-039)', () => {
  const LINK = read('apps/pipeline-worker/src/link.ts');
  const COMMIT_ENRICH = read('apps/pipeline-worker/src/commit-enrich.ts');

  it('**커밋 보강이 ready 신호를 실제로 발행한다** (DEV-215)', () => {
    /*
     * 이것이 없으면 직접 푸시 커밋의 참조가 영원히 간선이 되지 않는다 —
     * `EVT-ING-003`은 `project`가 만든 문서에만 나오기 때문이다. 상수 이름이
     * 아니라 **발행 호출**을 본다.
     */
    expect(COMMIT_ENRICH).toContain('await deps.bus.publish(TOPICS.projected,');
    expect(COMMIT_ENRICH).toContain('event_name: EVENT_NAMES.commitMetadataReady');
  });

  it('**색인 뒤·완결 표식 앞에 발행한다** (PR #44 리뷰 P1)', () => {
    /*
     * 순서가 셋 다 의미를 갖는다.
     *
     * - 색인보다 **뒤**: 먼저 내면 관계 워커가 아직 메시지가 없는 커밋을 읽어
     *   참조 0건으로 확정한다
     * - 완결 표식보다 **앞**: 뒤에 두면 발행 실패가 영구 유실이 된다 — 스냅숏도
     *   있고 투영도 찍혀 두 스윕이 모두 건너뛰고, 핸들러는 ack한다. 직접 푸시
     *   커밋의 유일한 방아쇠가 사라진다
     */
    // WP-035가 이 쓰기를 재색인 울타리로 감쌌다 — 앵커는 그 진입점이다.
    const indexed = COMMIT_ENRICH.indexOf('upsertCommitMetadata(');
    const publish = COMMIT_ENRICH.indexOf('event_name: EVENT_NAMES.commitMetadataReady');
    const marked = COMMIT_ENRICH.indexOf('markCommitProjected');
    expect(indexed).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(indexed);
    expect(marked).toBeGreaterThan(publish);
  });

  it('**커밋 보강이 자기 이벤트를 되받아 처리하지 않는다** (DEV-216)', () => {
    // 되먹임의 유일한 방어선이다. 이 줄이 없으면 보강 → 발행 → 보강 무한 루프다.
    expect(COMMIT_ENRICH).toContain(
      "if (name === EVENT_NAMES.commitMetadataReady) return { kind: 'ack' };",
    );
  });

  it('link 워커가 방아쇠 **둘**을 모두 처리한다', () => {
    expect(LINK).toContain('name === EVENT_NAMES.ingestionProjected');
    expect(LINK).toContain('name === EVENT_NAMES.commitMetadataReady');
  });

  it('link 워커가 **기본 그룹**을 쓴다 — 이름을 바꾸면 읽던 자리를 잃는다', () => {
    expect(LINK).toContain('consumerGroup(TOPICS.projected)');
    expect(LINK).not.toContain("consumerGroup(TOPICS.projected, 'link')");
  });

  it('**파생의 정본이 PostgreSQL이다** (ADR-004, DEV-221)', () => {
    // 정본에서 본문을 읽는 호출이 실재해야 한다. ES 문서를 파생 근거로 읽지 않는다.
    expect(LINK).toContain('prSnapshotRepo.listSnapshotsAfter(');
    expect(LINK).toContain('commitSnapshotRepo.findCommitSnapshot(');
  });

  it('**운영자가 JOB-REL-006을 시작할 수 있다** (PR #44 리뷰 P1)', () => {
    /*
     * 러너만 있고 큐에 넣을 경로가 없으면 그 잡은 영원히 돌지 않는다.
     * API-ADM-002가 유일한 시작 경로이고, 그것은 PostgreSQL 정본에서
     * `prs-links`를 복구하는 유일한 길이다 (ADR-004).
     */
    const jobs = read('apps/search-api/src/ops/jobs.ts');
    const routes = read('apps/search-api/src/ops/routes.ts');
    /*
     * WP-035가 목록을 **둘로 갈랐다** (DEV-301). `OPERATOR_JOB_TYPES`는 "집는
     * 러너가 있다"이고, `CREATABLE_GENERIC_JOB_TYPES`는 "API-ADM-002로 만들 수
     * 있다"이다. `reindex`는 앞에만 있다 — 생성은 API-ADM-004가 소유한다.
     *
     * **목록의 리터럴 전문을 단언하지 않는다** (CR-055). 목록이 자라는 것은
     * 정상이고(`reconcile`·`sequence_assign`이 그렇게 들어왔다), 전문을 걸면
     * 유형을 더할 때마다 이 시험이 **성질과 무관하게** 깨져 시험의 뜻이 흐려진다.
     * 걸어야 하는 것은 `link_rebuild`가 두 목록에 다 있고 `reindex`는 앞에만
     * 있다는 것이다.
     */
    expect(jobs).toMatch(/OPERATOR_JOB_TYPES = \[[^\]]*'link_rebuild'/);
    expect(jobs).toMatch(/OPERATOR_JOB_TYPES = \[[^\]]*'reindex'/);
    expect(jobs).toMatch(/CREATABLE_GENERIC_JOB_TYPES = \[[^\]]*'link_rebuild'/);
    expect(routes).toContain("if (!isCreatableGenericJobType(body['type'])) {");
    // 러너와 API가 **같은 `target` 형식**을 쓴다 — 다르면 러너가 자기 행을 못 읽는다.
    expect(LINK).toContain('repositoryRepo.findRepositoryBySlug(');
  });

  it('**해결된 접두 간선도 다시 판정한다** (PR #44 리뷰 P1)', () => {
    // `resolved`로 걸러 내면 한 번 잘못 붙은 간선을 다시 볼 방법이 없다.
    expect(LINK).toContain("include: target.kind === 'commit' ? 'any' : 'unresolved'");
  });

  it('**재파생이 같은 파생 핸들러를 쓴다** — 두 번째 알고리즘을 만들지 않는다', () => {
    const rebuild = LINK.slice(LINK.indexOf('export async function runReferenceRebuild'));
    expect(rebuild).toContain('handleSourceReady(');
  });

  it('**재시도 예산을 핸들러가 집행한다** (DEV-228)', () => {
    expect(LINK).toContain('delivery_count >= MAX_RETRIES');
    expect(LINK).toContain("kind: 'dead_letter'");
  });

  it('**완전한 파생에 성공했을 때만 stale을 지운다** (DEV-220)', () => {
    // 실패 갈래가 제거보다 **앞에서** 돌아 나가야 한다.
    const guard = LINK.indexOf('stale 제거를 하지 않는다');
    const remove = LINK.indexOf('deleteStaleReferenceLinks(');
    expect(guard).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(guard);
  });
});

describe('되돌림·체리픽·스택 파생의 도달성 (WP-030 / CR-041)', () => {
  const LINK = read('apps/pipeline-worker/src/link.ts');
  const RELATIONS = read('apps/pipeline-worker/src/relations.ts');

  it('**운영 진입점이 관계 파생을 실제로 부른다** — 함수가 존재하는 것으로는 부족하다', () => {
    /*
     * WP-028이 남긴 교훈이다: 함수도 있고 라우트도 있고 시험도 초록인데 운영이
     * 그것을 부르지 않을 수 있다. 이름 언급이 아니라 **호출 형태**로 건다.
     */
    /*
     * WP-035가 이 호출을 재색인 울타리 콜백 안으로 옮겼다 (DEV-296). **여전히
     * 호출 형태로 건다** — 이름 언급으로는 "운영이 부른다"가 증명되지 않는다.
     */
    expect(LINK).toContain('handleRelationsReady(deps, repository, source, targets)');
    expect(LINK).toContain('withReindexWrite(deps.pool, (targets) =>');
  });

  it('**재파생이 저절로 네 계열을 덮는다** (DEV-234) — 두 번째 틀을 만들지 않았다', () => {
    /*
     * `runReferenceRebuild`가 `handleSourceReady`를 부르고 그 안에 관계 파생이
     * 있으므로, JOB-REL-006은 별도 배선 없이 네 계열을 전부 다시 만든다.
     * 둘 중 하나라도 끊기면 "PostgreSQL만으로 복구된다"가 참조 축에서만 참이 된다.
     */
    const rebuild = LINK.slice(LINK.indexOf('export async function runReferenceRebuild'));
    expect(rebuild).toContain('handleSourceReady(');
    const ready = LINK.slice(LINK.indexOf('export async function handleSourceReady'));
    expect(ready).toContain('handleRelationsReady(');
  });

  it('**후보 변화 재평가가 파생과 같은 진입점에 묶여 있다** (DEV-242)', () => {
    /*
     * 둘을 따로 두면 호출부가 하나를 잊고, 그러면 관계가 수렴하지 않는다 —
     * 그 사실은 한참 뒤에야 드러난다.
     */
    const entry = RELATIONS.slice(RELATIONS.indexOf('export async function handleRelationsReady'));
    expect(entry).toContain('await deriveRelations(');
    expect(entry).toContain('await reevaluateAffectedRelations(');
  });

  it('**파생 정본이 PostgreSQL이다** (ADR-004) — ES를 파생 근거로 읽지 않는다', () => {
    expect(RELATIONS).toContain('commitSnapshotRepo.findCommitSnapshot(');
    expect(RELATIONS).toContain('prSnapshotRepo.findPullRequestSnapshot(');
    expect(RELATIONS).toContain('prSnapshotRepo.findOpenPullRequestsByHeadBranch(');
  });

  it('**스택 역방향 재평가가 실재한다** (DEV-232) — 하위 PR에는 이벤트가 오지 않는다', () => {
    expect(RELATIONS).toContain('prSnapshotRepo.findPullRequestsByBaseBranch(');
  });

  it('**patch-id 역방향 재평가가 실재한다** (DEV-242)', () => {
    const reeval = RELATIONS.slice(RELATIONS.indexOf('export async function reevaluateAffectedRelations'));
    expect(reeval).toContain('commitSnapshotRepo.findCommitsByPatchId(');
    expect(reeval).toContain('commitSnapshotRepo.findCommitsRevertingSha(');
  });

  it('**재평가가 다시 재평가를 부르지 않는다** — 저장소 전체로 번지지 않는다', () => {
    const reeval = RELATIONS.slice(RELATIONS.indexOf('export async function reevaluateAffectedRelations'));
    expect(reeval).toContain('await deriveRelations(deps, repository, target, writeTargets)');
    expect(reeval).not.toContain('await handleRelationsReady(deps, repository, target');
  });

  it('**스택은 지우지 않고 detached로 바꾼다** (FR-REL-006 AC-3, DEV-238)', () => {
    // `deleteStaleDerivedLinks`의 유형 인자에 `stacks_on`이 있으면 안 된다.
    expect(RELATIONS).toContain("linkType: 'reverts'");
    expect(RELATIONS).toContain("linkType: 'cherry_picks'");
    expect(RELATIONS).not.toContain("linkType: 'stacks_on'");
    expect(RELATIONS).toContain('await setLinkDetached(');
  });

  it('**요약을 active 간선 집합에서 재계산한다** (DEV-241)', () => {
    const refresh = RELATIONS.slice(RELATIONS.indexOf('export async function refreshRelationSummary'));
    expect(refresh).toContain('await summarizeRelations(deps.es');
    expect(refresh).toContain('relations,');
  });

  it('**`reference_count`를 건드리지 않는다** (DEV-222) — WP-029 소유다', () => {
    const refresh = RELATIONS.slice(RELATIONS.indexOf('export async function refreshRelationSummary'));
    expect(refresh).not.toContain('referenceCount');
  });

  it('**완전한 파생에 성공했을 때만 조정한다** (DEV-233)', () => {
    const guard = RELATIONS.indexOf('조정을 하지 않는다');
    const remove = RELATIONS.indexOf('deleteStaleDerivedLinks(');
    expect(guard).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(guard);
  });

  it('**순환 지표가 실재하고 실제로 증가한다** (FR-REL-006 AC-5, DEV-247)', () => {
    expect(RELATIONS).toContain('deps.metrics.linkStackCycleTotal.inc(');
    const metrics = read('apps/pipeline-worker/src/metrics.ts');
    expect(metrics).toContain("new Counter('link_stack_cycle_total'");
  });

  it('**새 역할·새 소비자 그룹·새 manifest를 만들지 않았다**', () => {
    const index = read('apps/pipeline-worker/src/index.ts');
    // link 역할 하나가 네 계열을 전부 돌린다.
    expect(index).toContain("if (roles.includes('link'))");
    expect(index).not.toContain("roles.includes('relations')");
    expect(RELATIONS).not.toContain('consumerGroup(');
    expect(existsSync(new URL('deploy/k8s/pipeline-worker-relations.yaml', new URL('..', import.meta.url)))).toBe(false);
  });

  it('**양 끝점의 요약을 갱신한다** (PR #46 리뷰 P1) — `is_reverted`는 대상의 필드다', () => {
    const derive = RELATIONS.slice(RELATIONS.indexOf('export async function deriveRelations'));
    // 조정 **전에** 기존 간선을 읽어야 사라진 대상의 요약도 되돌릴 수 있다.
    expect(derive).toContain('const before = await findLinksFrom(deps.es');
    expect(derive).toContain('for (const endpoint of endpoints.values())');
  });

  it('**요약 질의 전에 색인을 새로 고친다** (PR #46 리뷰 P2) — 운영은 refresh가 꺼져 있다', () => {
    const derive = RELATIONS.slice(RELATIONS.indexOf('export async function deriveRelations'));
    const refresh = derive.indexOf('await deps.es.indices.refresh({ index: LINKS_ALIAS })');
    const summarize = derive.indexOf('await refreshRelationSummary(');
    expect(refresh).toBeGreaterThan(-1);
    expect(summarize).toBeGreaterThan(refresh);
  });

  it('**부분 실패를 조용히 ack하지 않는다** (PR #46 리뷰 P1) — WP-030에는 pending 표식이 없다', () => {
    expect(RELATIONS).toContain('throw new Error(`관계 간선 쓰기 실패');
    expect(RELATIONS).toContain('throw new Error(`스택 해제 표시 실패');
  });

  it('**`links_pending`을 관계 파생이 덮지 않는다** (DEV-246, PR #46 리뷰 P1)', () => {
    const refresh = RELATIONS.slice(RELATIONS.indexOf('export async function refreshRelationSummary'));
    expect(refresh).not.toContain('linksPending');
    // 스크립트도 값이 없으면 건드리지 않아야 한다.
    const links = read('packages/es/src/links.ts');
    expect(links).toContain("'if (params.links_pending != null && ctx._source.links_pending != params.links_pending) {',");
  });

  it('**체리픽 방향 술어가 질의 안에 있다** (PR #46 리뷰 P2)', () => {
    const plan = RELATIONS.slice(RELATIONS.indexOf('async function planCherryPicks'));
    expect(plan).toContain("{ relation: 'earlier', committedAt: self.committed_at, commitSha: self.commit_sha }");
    // 앱에서 방향을 거르면 나중 커밋이 상한을 채울 때 이전 후보를 통째로 잃는다.
    expect(plan).not.toContain('.filter((row) => isLater(self, row))');
  });

  it('**retarget된 옛 child를 간선에서 찾는다** (PR #46 리뷰 P2)', () => {
    const reeval = RELATIONS.slice(RELATIONS.indexOf('export async function reevaluateAffectedRelations'));
    expect(reeval).toContain('await findLinksTo(deps.es');
  });

  it('**범위 요약이 되돌림 수를 같은 왕복에서 센다** (DEV-239) — N+1이 아니다', () => {
    const range = read('apps/search-api/src/sequence/range.ts');
    expect(range).toContain("reverted: { filter: { term: { 'link_summary.is_reverted': true } } }");
    expect(range).toContain('reverted_pull_request_count: aggs.reverted?.doc_count ?? 0');
    // 간선 인덱스를 여기서 읽지 않는다.
    expect(range).not.toContain('prs-links');
  });
});

describe('관계 조회의 도달성과 계약 (WP-031 / CR-042)', () => {
  const SERVER = read('apps/search-api/src/server.ts');
  const RELATION_ROUTES = read('apps/search-api/src/relations/routes.ts');
  const RELATION_SERVICE = read('apps/search-api/src/relations/service.ts');
  const CO_CHANGES = read('apps/search-api/src/relations/co-changes.ts');
  const RELATIONS_READ = read('packages/es/src/relations-read.ts');
  const ARCHITECTURE = read('packages/es/src/architecture.test.ts');
  const RESULT_TABLE = read('apps/web/components/ResultTable.tsx');
  const PR_DETAIL = read('apps/web/components/PrDetailView.tsx');
  const COMMIT_DETAIL = read('apps/web/components/CommitDetailView.tsx');
  const RELATION_SECTION = read('apps/web/components/RelationSection.tsx');

  /**
   * 주석을 걷어 낸 코드만 본다.
   *
   * "이 필드를 쓰지 않는다"를 파일 전문에 걸면 **그 사실을 설명한 주석에 걸린다**
   * — 검사기가 자기 검색어를 세는 것과 같은 함정이다 (원장 §7의 문서 검증기
   * 기술 부채, risks 21). 금지를 거는 검사는 범위를 코드로 좁힌다.
   */
  const codeOf = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');


  it('**운영 서버가 관계 라우트를 실제로 등록한다** (DEV-248)', () => {
    // 호출 형태로 건다 — 이름만 찾으면 import 줄이 남아 있는 한 통과한다.
    expect(SERVER).toContain('registerRelationRoutes(app, {');
  });

  it('관계 라우트가 검색과 **같은 조건** 뒤에 있다 — 세션 없이 열지 않는다', () => {
    const at = SERVER.indexOf('registerRelationRoutes(app, {');
    const guard = SERVER.indexOf('if (deps.search !== undefined) {');
    expect(guard).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(guard);
  });

  it('**역방향 조회가 라우팅을 쓰지 않는다** (DEV-250)', () => {
    /*
     * 간선은 source 저장소에 산다. 대상 저장소로 라우팅하면 저장소를 건너뛰는
     * 참조를 어떤 값으로도 찾을 수 없다. 경계는 강제 필터가 만든다.
     */
    const body = RELATIONS_READ.split('export async function searchRelationLinks')[1] ?? '';
    expect(body).not.toMatch(/^\s*routing:/m);
    expect(body).toContain('applyMandatoryScopeFilter(');
  });

  it('**부분 결과를 정상 응답으로 내지 않는다** (PR #47 리뷰 P1)', () => {
    /*
     * 이 질의는 라우팅을 쓰지 않아 샤드 전부를 돈다 — 한 샤드만 흔들려도
     * 부분 결과가 된다. 짧아진 목록이 `truncated: false`와 함께 나가면
     * 화면이 "관계가 이것뿐"이라고 말한다. 다른 조회 경로는 전부 이 검사를
     * 지난다.
     */
    expect(codeOf(RELATIONS_READ)).toContain('assertNoShardFailures(response)');
    const body = RELATIONS_READ.split('export async function searchRelationLinks')[1] ?? '';
    // 검사가 hits를 쓰기 **전에** 있어야 한다.
    expect(body.indexOf('assertNoShardFailures(response)')).toBeLessThan(
      body.indexOf('const hits = response.hits.hits'),
    );
  });

  it('**응답에 상한이 있다** — 워커의 전량 스크롤을 쓰지 않는다 (DEV-252)', () => {

    expect(RELATIONS_READ).toContain('limit + 1');
    expect(RELATIONS_READ).toContain('truncated');
    // 워커용 helper를 사용자 경로로 가져오지 않는다.
    expect(RELATION_SERVICE).not.toContain('findLinksTo');
    expect(RELATION_SERVICE).not.toContain('findLinksFrom');
    expect(RELATION_SERVICE).not.toContain('scrollLinks');
  });

  it('**오프셋 파라미터를 만들지 않는다** (ADR-010)', () => {
    expect(RELATION_ROUTES).not.toContain("'offset'");
    expect(RELATION_ROUTES).not.toContain("'page'");
  });

  it('**대상 내용을 강제 필터로 따로 읽는다** (THR-034, DEV-253)', () => {
    const loader = RELATION_SERVICE.split('async function loadTargets')[1] ?? '';
    expect(loader).toContain('applyMandatoryScopeFilter(');
    // `mget`·`get`으로 지름길을 내지 않는다 — ID를 알아도 필터를 지나야 한다.
    expect(RELATION_SERVICE).not.toMatch(/\bes\s*\.\s*(?:get|mget)\s*\(/);
  });

  it('대상 조회가 **종류별 한 번**이다 — 항목마다 부르지 않는다', () => {
    const calls = (RELATION_SERVICE.match(/loadTargets\(/g) ?? []).length;
    // 정의 1 + PR 1 + 커밋 1 = 3. 반복문 안에 있으면 이 수로는 안 잡히므로 함께 본다.
    expect(calls).toBeLessThanOrEqual(3);
    expect(RELATION_SERVICE).toContain('Promise.all([');
  });

  it('**ADR-008 가드레일이 `mget`과 `es.get`도 검사한다** (DEV-265)', () => {
    expect(ARCHITECTURE).toContain('mget');
    expect(ARCHITECTURE).toMatch(/es\|elasticsearch\)\\s\*\\\.\\s\*get/);
  });

  it('**관계 조회 계층이 `links.ts`의 면제를 물려받지 않는다** (DEV-265)', () => {
    // 허용 목록은 파일 단위다. 사용자 대면 조회가 그 파일에 있으면 검사가 침묵한다.
    expect(RELATIONS_READ).toContain("from './search.js'");
    const allowlist = ARCHITECTURE.split('UNSCOPED_ALLOWLIST')[1] ?? '';
    expect(allowlist.split('const UNSCOPED_FILES')[0]).not.toContain('relations-read.ts');
  });

  it('**동시 변경이 앱단에서 후보를 먼저 자르지 않는다** (DEV-255)', () => {
    // 점수와 상한이 같은 질의 안에 있어야 진짜 상위 20이 나온다.
    expect(CO_CHANGES).toContain('script_score');
    expect(CO_CHANGES).toContain('CO_CHANGE_LIMIT');
    expect(CO_CHANGES).toContain("sort: [{ _score: { order: 'desc' } }, { pr_number: { order: 'asc' } }]");
  });

  it('**200개 판정을 `changed_files_count`로 한다** — `files_truncated`는 다른 계약이다', () => {
    expect(CO_CHANGES).toContain('changed_files_count');
    // 3000 상한의 표식으로 200을 추론하지 않는다. 코드에서 그 필드를 읽지 않는다.
    expect(codeOf(CO_CHANGES)).not.toContain('files_truncated');
  });

  it('**미머지를 `created_at`으로 대체하지 않는다** (DEV-254)', () => {
    expect(CO_CHANGES).toContain("unavailable('not_merged')");
    const code = codeOf(CO_CHANGES);
    expect(code).not.toContain('created_at');
    expect(code).not.toContain('updated_at');
    // 창의 기준점은 언제나 `merged_at`이다.
    expect(code).toContain('shiftDays(anchor.merged_at');
  });


  it('겹치는 경로가 사전순 상한 10이다 (DEV-256)', () => {
    expect(CO_CHANGES).toContain('CO_CHANGE_OVERLAP_LIMIT');
    expect(CO_CHANGES).toContain('.sort()');
  });

  it('**목록 화면이 `link_summary`를 버리지 않는다** (DEV-264)', () => {
    expect(RESULT_TABLE).toContain('link_summary');
    expect(RESULT_TABLE).toContain('<RelationBadgeGroup summary={row.link_summary ?? null} />');
  });

  it('**상세 화면이 골격이 아니라 실제 섹션을 그린다**', () => {
    expect(PR_DETAIL).toContain('<RelationSection');
    expect(PR_DETAIL).toContain('<CoChangeSection');
    expect(COMMIT_DETAIL).toContain('<RelationSection');
    // 관계 자리에 더 이상 "준비 중" 골격을 두지 않는다.
    expect(PR_DETAIL).not.toContain('PendingSection');
    expect(COMMIT_DETAIL).not.toContain('PendingSection');
  });

  it('**진입 시 조회하지 않는다** — 펼칠 때만 부른다 (QA-W002-17, QA-W003-10)', () => {
    // `useEffect`로 마운트 시 부르면 진입 요청이 늘어난다. 조회는 토글 뒤에 있다.
    expect(RELATION_SECTION).toContain('if (next) loadAll();');
    const effects = RELATION_SECTION.split('useEffect(')[1]?.split('}, [')[0] ?? '';
    expect(effects).not.toContain('loadAll');
  });

  it('**커밋 화면이 스택·동시 변경을 묻지 않는다** (QA-W003-11)', () => {
    expect(RELATION_SECTION).toContain("const COMMIT_TYPES: readonly RelationLinkType[] = ['references', 'reverts', 'cherry_picks']");
    expect(COMMIT_DETAIL).not.toContain('CoChangeSection');
  });

  it('**`links_pending`이 참조 그룹에만 걸린다** (DEV-258)', () => {
    expect(RELATION_SECTION).toContain("linkType === 'references' && linksPending === true");
  });

  it('**`stacks_on`을 커밋 앵커로 물으면 서버가 거절한다** — 빈 배열로 답하지 않는다', () => {
    expect(RELATION_SERVICE).toContain('export function supportsAnchorKind');
    expect(RELATION_ROUTES).toContain('if (!supportsAnchorKind(linkType, anchor.kind))');
  });

  it('**앵커가 범위 밖이면 404다** — 403으로 존재를 밝히지 않는다', () => {
    expect(RELATION_ROUTES).toContain("notFound(reply, correlationId, '대상을 찾을 수 없습니다')");
    expect(RELATION_ROUTES).not.toContain('403');
  });

  it('커밋 상세가 `links_pending`을 응답에 싣는다 (DEV-263)', () => {
    const detail = read('apps/search-api/src/resolve/detail.ts');
    expect(detail).toContain("put(out, 'links_pending', commit.links_pending)");
  });
});

describe('경로가 실재하는지', () => {

  it('운영 조립이 정합성 점검 의존을 넘긴다', () => {
    expect(API_RUNTIME).toContain('buildIntegrityDeps');
    expect(API_RUNTIME).toMatch(/integrity\s*===\s*undefined\s*\?\s*\{\}\s*:\s*\{\s*integrity\s*\}/);
  });

  it('head 복구가 죽은 잡이 아니라 버스로 간다 (DEV-180)', () => {
    const reconcile = read('apps/pipeline-worker/src/reconcile.ts');
    // 발행을 **실제로 부르는지** 본다 — 상수 이름만 남아 있는 것으로는 부족하다.
    expect(reconcile).toContain('await deps.bus.publish(');
    expect(reconcile).toContain('TOPICS.sequence');
    expect(reconcile).toContain("'sequence.requested'");
    // 집는 러너가 없는 잡 유형을 다시 만들지 않는다.
    expect(reconcile).not.toContain("enqueueJob(deps.pool, 'sequence_assign'");
  });

  /*
   * **두 투영 경로가 모두 정본을 남긴다** (CR-034, DEV-184 / ADR-004).
   *
   * 한쪽만 남기면 그쪽만 재구성 가능한 반쪽 불변식이 된다 — 백필이 빠져 있던
   * 것이 정확히 그 상태였고, 정합성 감시가 정상 문서를 잉여로 보고했다.
   */
  it.each([
    ['apps/pipeline-worker/src/project.ts', '실시간 투영'],
    ['apps/pipeline-worker/src/backfill.ts', '백필·조정 투영'],
  ])('%s(%s)가 PostgreSQL 정본을 남긴다', (path) => {
    expect(read(path)).toContain('await recordProjectionSnapshot(');
  });

  it('정합성 감시의 정본은 raw_event가 아니라 스냅숏이다 (DEV-184)', () => {
    const consistency = read('apps/pipeline-worker/src/consistency.ts');
    expect(consistency).toContain('prSnapshotRepo.listSnapshots');
    // 백필 문서를 설명하지 못하는 옛 정본으로 되돌아가지 않는다.
    expect(consistency).not.toContain('FROM raw_event');
  });

  /*
   * **팀 접근 범위가 운영에서 실제로 채워지고 소급된다** (WP-068 / CR-035).
   *
   * 값을 만드는 자리가 없어 `team:` 질의가 한 건도 맞히지 못하던 것이 DEV-114였다.
   * 배선이 빠지면 같은 상태로 조용히 되돌아간다.
   */
  it('저장소 등록이 팀을 채운다 (DEV-185)', () => {
    expect(API_INDEX).toContain('listTeams:');
    expect(read('apps/search-api/src/ops/repositories.ts')).toContain('await syncRepositoryTeams(');
  });

  it('팀 변경이 색인에 소급 적용된다 (DEV-187)', () => {
    expect(WORKER_INDEX).toContain('refreshRepositoryTeams:');
    expect(WORKER_INDEX).toContain('applyRepositoryTeams(');
  });

  it('투영이 접근 범위에 팀을 싣는다 (DEV-114)', () => {
    expect(read('apps/pipeline-worker/src/documents.ts')).toContain('allowed_team_ids: [...repository.allowed_team_ids]');
  });

  it('**소급 적용이 네 색인 전부를 덮는다** — 둘만 덮으면 관계·릴리스가 옛 권한을 남긴다', () => {
    const registry = read('packages/es/src/registry.ts');
    expect(registry).toContain('TEAM_SCOPED_ALIASES: readonly EntityAlias[] = ENTITY_ALIASES');
    expect(registry).toContain('for (const alias of TEAM_SCOPED_ALIASES)');
  });

  it('**팀 소급이 GHE를 다시 읽는다** — 정본의 옛 값을 되쓰지 않는다 (CR-036, DEV-188)', () => {
    expect(WORKER_INDEX).toContain('refreshTeamScope(');
    expect(WORKER_INDEX).toContain('listRepositoryTeams(');
    // 회수 사건에서 정본의 옛 배열을 그대로 색인에 쓰던 경로로 되돌아가지 않는다.
    expect(WORKER_INDEX).not.toContain('repository.allowed_team_ids,');
  });

  it('두 경로가 **같은 동기화 구현**을 쓴다 (CR-036, DEV-188)', () => {
    expect(read('apps/search-api/src/ops/repositories.ts')).toContain('syncRepositoryTeamScope(');
    expect(WORKER_INDEX).toContain('syncRepositoryTeamScope(');
  });

  it('조정 스캔이 기존 저장소의 팀을 메운다 (CR-036, DEV-190)', () => {
    expect(WORKER_INDEX).toContain('syncTeams:');
    expect(read('apps/pipeline-worker/src/reconcile.ts')).toContain('await deps.syncTeams(repository)');
  });

  it('root 경로가 실재한다 — 시험이 잘못된 디렉터리를 보고 있지 않다', () => {
    expect(existsSync(new URL('package.json', new URL('..', import.meta.url)))).toBe(true);
    expect(root.length).toBeGreaterThan(0);
  });

  /*
   * 예약과 실행이 **같은 역할에서 함께** 서는지 본다 (CR-037, DEV-194).
   *
   * 예약만 하고 집는 러너가 없으면 잡 행이 영구 `queued`로 남고 `job_active_uk`가
   * 이후 요청을 전부 막는다 — DEV-178·DEV-180이 정확히 그 모양의 결함이었다.
   */
  it('JOB-ING-010 — 예약과 러너가 같은 역할에 함께 있다', () => {
    expect(WORKER_INDEX).toContain('enqueueSnapshotBootstrap: () => enqueueSnapshotBootstrap(pool)');
    expect(WORKER_INDEX).toContain('snapshotBootstrapRunner = startSnapshotBootstrapRunner(');
  });

  /*
   * JOB-MIR-002는 `prs:projected`를 **전용 소비자 그룹**으로 읽어야 한다
   * (CR-038, DEV-205). 기본 그룹으로 구독하면 관계 파생(WP-029)과 이벤트를 나눠
   * 갖고 둘 다 절반씩 놓친다 — 어느 쪽도 실패로 보이지 않는 조용한 결함이다.
   */
  it('JOB-MIR-002 — 전용 소비자 그룹으로 구독한다', () => {
    const source = read('apps/pipeline-worker/src/commit-enrich.ts');
    expect(source).toContain('consumerGroup(TOPICS.projected, COMMIT_ENRICH_CONSUMER)');
  });

  it('JOB-MIR-002 — 미러 볼륨이 배포에 붙어 있다', () => {
    // 미러가 이 잡의 정답지다. 볼륨이 없으면 전부 API 폴백으로 떨어진다.
    const manifest = read('deploy/k8s/pipeline-worker-mirror.yaml');
    expect(manifest).toContain('persistentVolumeClaim');
    expect(manifest).toContain('MIRROR_ROOT');
  });

  /*
   * **manifest가 있는 것과 배포되는 것은 다르다** (CR-038 / PR #42 리뷰).
   *
   * `pipeline-worker-mirror.yaml`은 파일도 있고 위의 도달성 시험도 통과했지만,
   * `deploy/k8s/README.md`의 적용 순서에 없어 **절차를 따르는 운영자가 끝내 만들지
   * 않았다.** 도달성 사슬의 마지막 고리는 "누군가 실제로 apply 하는가"다.
   */
  it('모든 배포 manifest가 적용 순서에 들어 있다', () => {
    /*
     * **적용 순서 블록만 본다.** README 전문을 보면 산문에 파일 이름을 한 번
     * 언급한 것만으로 통과한다 — 실제로 `kubectl apply` 목록에 있는지를 물어야
     * 이 시험이 의미가 있다 (이 시험의 첫 형태가 그 이유로 변이에 살아남았다).
     */
    const readme = read('deploy/k8s/README.md');
    const applyBlock = /## 적용 순서[\s\S]*?```sh([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    expect(applyBlock).not.toBe('');
    const dir = new URL('deploy/k8s/', new URL('..', import.meta.url));
    const manifests = readdirSync(dir)
      .filter((name) => name.endsWith('.yaml'))
      // 시크릿 예시는 그대로 apply 하지 않는다 — 사내 시크릿 관리가 만든다.
      // 접미로 거른다: WP-075가 표기 전용 자격을 **별도 시크릿**으로 나누면서
      // `annotate-secret.example.yaml`이 생겼고, 이름 하나만 비교하면 그것이
      // 적용 목록에 있어야 한다고 요구하게 된다.
      .filter((name) => !name.endsWith('secret.example.yaml'));

    expect(manifests.length).toBeGreaterThan(0);
    for (const name of manifests) {
      expect(applyBlock, `${name}이 적용 순서에 없다`).toContain(name);
    }
  });

  /*
   * **방향이 반대인 검사** (CR-045, DEV-293).
   *
   * 위 시험은 "존재하는 manifest가 적용 순서에 있는가"를 묻는다. 그래서 **없는
   * 파일은 물음의 대상이 아니었고**, `batch` 역할은 코드에 갈래가 있고 인프라
   * 3장이 배포 단위로 승인했는데도 manifest 없이 남아 있었다 — 그 결과 이미
   * 구현된 JOB-ING-007(아웃박스 재적재)이 배포되지 않았다 (DEV-292).
   *
   * 이 시험은 **코드를 정본으로 삼는다**: `index.ts`가 `roles.includes('X')`로
   * 갈래를 만들었다면 그 역할을 세우는 manifest가 있어야 한다. 코드가 그 역할을
   * 위해 무언가를 기동하는데 아무 배포도 그 역할을 켜지 않는다면, 그 기능은
   * **선언만 되고 실행되지 않는다.**
   *
   * 예외는 **짧고 사유와 DEV 번호가 붙어야 한다** (`architecture.test.ts`의
   * `UNSCOPED_ALLOWLIST`가 같은 형식이다). 비워 두거나 검사를 지우면 다음
   * 미배포 역할이 조용히 들어온다.
   */
  const UNDEPLOYED_ROLE_ALLOWLIST: readonly { readonly role: string; readonly dev: string; readonly why: string }[] = [
    {
      role: 'backfill',
      dev: 'DEV-304',
      why:
        'JOB-ING-004 백필 러너. `enrich` 안의 중첩 갈래인데 `pipeline-worker-enrich.yaml`이 ' +
        '`PIPELINE_WORKER_ROLES=enrich`만 세워 러너가 뜨지 않는다. 잡을 만들면 아무도 집지 않고 ' +
        '`job_active_uk`가 이후 요청을 막는다 — DEV-178과 같은 모양이다. WP-019 소관',
    },
    {
      role: 'release',
      dev: 'DEV-305',
      why:
        'JOB-REL-007 릴리스 수집. manifest 자체가 없다. 이 역할은 **미러 볼륨을 요구하므로**(DEV-143) ' +
        'PVC 배치가 함께 정해져야 해 복사만으로 만들 수 없다. WP-024 소관',
    },
  ];

  /** manifest가 실제로 켜는 역할 집합. 파일 존재가 아니라 `PIPELINE_WORKER_ROLES` **값**을 본다. */
  const deployedRoles = (): Set<string> => {
    const dir = new URL('deploy/k8s/', new URL('..', import.meta.url));
    const deployed = new Set<string>();
    for (const name of readdirSync(dir).filter((one) => one.endsWith('.yaml'))) {
      const manifest = readFileSync(new URL(name, dir), 'utf8');
      // 개행을 넘지 않는다 — `\s`를 넣으면 다음 YAML 키까지 삼킨다.
      const value = /PIPELINE_WORKER_ROLES[\s\S]{0,80}?value:[ \t]*([a-z][a-z,-]*)/.exec(manifest)?.[1] ?? '';
      for (const role of value.split(',')) {
        const trimmed = role.trim();
        if (trimmed !== '') deployed.add(trimmed);
      }
    }
    return deployed;
  };

  it('코드가 갈래를 만든 역할은 그것을 세우는 manifest를 갖는다', () => {
    const declared = [...WORKER_INDEX.matchAll(/roles\.includes\('([a-z-]+)'\)/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);

    const deployed = deployedRoles();
    const exempt = new Set(UNDEPLOYED_ROLE_ALLOWLIST.map((one) => one.role));
    for (const role of new Set(declared)) {
      if (exempt.has(role)) continue;
      expect(deployed, `역할 '${role}'을 세우는 manifest가 없다 — 그 갈래는 배포에서 실행되지 않는다`).toContain(role);
    }
  });

  /*
   * **두 정본을 모두 읽는다** (CR-046, DEV-310).
   *
   * 위 시험은 `index.ts`의 갈래를 정본으로 삼는다 — 그것은 "구현했는데 배포되지
   * 않았다"(`batch`가 그랬다)를 잡는다. 그러나 **구현 자체가 없는 경우**는 못 잡는다:
   * 인프라 3장이 배포 단위를 승인했는데 워커 갈래도 manifest도 없으면 `declared`에
   * 아예 나타나지 않으므로 이 검사를 그냥 통과한다.
   *
   * WP-035 계약이 "**인프라 3장의 배포 단위 표를 정본으로 삼아** 승인된 단위에
   * manifest가 있는가를 묻는다"고 적었는데 구현은 코드만 정본으로 삼았다 —
   * **하위 문서와 구현이 어긋난 자리이며 DEV-291과 같은 계열이다.** 두 방향을 모두 건다.
   */
  it('인프라 3장이 승인한 배포 단위는 manifest를 갖는다', () => {
    const infra = read('docs/30_technical_architecture/pr_search_infrastructure_operations.md');
    const approved = [...infra.matchAll(/`pipeline-worker:([a-z-]+)`\s*\|/g)].map((match) => match[1]);
    expect(approved.length, '배포 단위 표에서 pipeline-worker 단위를 하나도 찾지 못했다').toBeGreaterThan(0);

    /*
     * **이 방향에는 예외를 적용하지 않는다** (CR-047, DEV-312).
     *
     * 예외 목록을 여기에도 걸면, 예외 역할이 승인 표에 오르는 순간 **이 검사가
     * 통째로 침묵한다** — 그리고 그것이 이 시험이 잡으려던 "승인했는데 만들지
     * 않았다" 그 자체다. 표에 오른 것은 **예외 없이** manifest를 가져야 한다.
     * 아직 만들지 않았다면 표에 올리지 않는 것이 맞고, 그 규율은 아래 시험이 건다.
     */
    for (const role of new Set(approved)) {
      expect(
        deployedRoles(),
        `인프라 3장이 승인한 배포 단위 'pipeline-worker:${role}'의 manifest가 없다`,
      ).toContain(role);
    }
  });

  it('미배포 예외 역할은 배포 단위 표에 오르지 않는다', () => {
    /*
     * 인프라 3장이 적어 둔 규율("배포되지 않는 단위를 이 표에 먼저 적지 않는다")을
     * 시험이 강제한다 (CR-047, DEV-312). 예외 역할이 표에 오르면 **표가 사실과
     * 어긋난 상태**이며, 위 검사의 예외를 없앤 것만으로는 그것을 막지 못한다 —
     * 막는 것은 이 시험이다. 예외를 지우고 manifest를 만드는 것이 정상 경로다.
     */
    const infra = read('docs/30_technical_architecture/pr_search_infrastructure_operations.md');
    const approved = new Set([...infra.matchAll(/`pipeline-worker:([a-z-]+)`\s*\|/g)].map((match) => match[1]));
    for (const one of UNDEPLOYED_ROLE_ALLOWLIST) {
      expect(
        approved,
        `'${one.role}'은 배포되지 않는데 배포 단위 표에 올라 있다 (${one.dev}) — 표를 고치거나 manifest를 만들어라`,
      ).not.toContain(one.role);
    }
  });

  it('배포 단위 표와 코드 갈래가 서로를 덮는다', () => {
    /*
     * 표에만 있고 코드에 없는 역할은 **아직 만들지 않은 것**이고, 코드에만 있고 표에
     * 없는 역할은 **표가 낡은 것**이다. 둘 다 조용히 두면 어느 쪽이 사실인지 아무도
     * 모른다 (DEV-307).
     */
    const infra = read('docs/30_technical_architecture/pr_search_infrastructure_operations.md');
    const approved = new Set([...infra.matchAll(/`pipeline-worker:([a-z-]+)`\s*\|/g)].map((match) => match[1]));
    const declared = new Set(
      [...WORKER_INDEX.matchAll(/roles\.includes\('([a-z-]+)'\)/g)].map((match) => match[1]),
    );
    const exempt = new Set(UNDEPLOYED_ROLE_ALLOWLIST.map((one) => one.role));

    for (const role of approved) {
      expect(declared, `표가 승인한 '${role}'을 코드가 갈래로 만들지 않는다`).toContain(role);
    }
    for (const role of declared) {
      if (exempt.has(role)) continue;
      expect(approved, `코드가 갈래를 만든 '${role}'이 배포 단위 표에 없다`).toContain(role);
    }
  });

  it('**배포 단위 표에 같은 단위가 두 번 오르지 않는다** (PR #53 리뷰 P2)', () => {
    /*
     * 위 검사들은 파싱한 역할을 `Set`으로 다루므로 **중복 행을 보지 못한다.**
     * 표가 용량 산정의 근거인데 같은 단위가 두 줄이면 그 수가 애매해지고,
     * 행을 세는 도구는 배포 단위를 하나 더 있는 것으로 읽는다.
     *
     * 실제로 이 CR이 편집을 두 번 적용해 `authz` 행이 두 줄이 됐고, 다른 검사는
     * 전부 통과했다 — `Set`이 그것을 삼켰다.
     */
    const INFRA = read('docs/30_technical_architecture/pr_search_infrastructure_operations.md');
    const rows = [...INFRA.matchAll(/^\|\s*`(pipeline-worker:[a-z-]+)`\s*\|/gm)].map((one) => one[1]);
    const seen = new Set<string>();
    const duplicated = rows.filter((one) => {
      if (seen.has(one as string)) return true;
      seen.add(one as string);
      return false;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(duplicated, `배포 단위 표에 중복 행이 있다: ${duplicated.join(', ')}`).toEqual([]);
  });

  it('**배포된 역할을 표 아래 산문이 미배포라고 적지 않는다** (PR #53 리뷰 P2)', () => {
    /*
     * 표와 그 아래 설명이 서로 다른 말을 하면 운영자는 배타적인 두 지시를 받는다.
     * 표에 오른 역할이 "아직 배포되지 않으며"라는 문장에 남아 있으면 안 된다.
     */
    const INFRA = read('docs/30_technical_architecture/pr_search_infrastructure_operations.md');
    const approved = new Set(
      [...INFRA.matchAll(/^\|\s*`pipeline-worker:([a-z-]+)`\s*\|/gm)].map((one) => one[1] as string),
    );
    const note = /아직 배포되지 않으며([\s\S]{0,200})/.exec(INFRA)?.[0] ?? '';
    expect(note, '미배포 안내 문단을 찾지 못했다').not.toBe('');
    for (const role of approved) {
      const mentioned = new RegExp('`' + role + '`\\(JOB-[A-Z]+-\\d{3}\\)[^.]{0,80}아직 배포되지 않으며').test(INFRA);
      expect(mentioned, `배포 단위 표에 있는 '${role}'을 산문이 미배포로 적는다`).toBe(false);
    }
  });

  it('미배포 역할 예외는 목록에 사유와 DEV가 함께 있다', () => {
    // 예외를 늘리는 것은 **경계를 넓히는 일**이다. 비워 두면 검사가 무의미해진다.
    for (const one of UNDEPLOYED_ROLE_ALLOWLIST) {
      expect(one.dev, `${one.role} 예외에 DEV 번호가 없다`).toMatch(/^DEV-\d{3}$/);
      expect(one.why.length, `${one.role} 예외에 사유가 없다`).toBeGreaterThan(40);
    }
    // 이미 배포된 역할이 예외 목록에 남아 있으면 목록이 낡은 것이다.
    expect(UNDEPLOYED_ROLE_ALLOWLIST.map((one) => one.role)).not.toContain('batch');
    // CR-048이 `authz`를 배포했다 (DEV-306). 예외에 남아 있으면 목록이 낡은 것이다.
    expect(UNDEPLOYED_ROLE_ALLOWLIST.map((one) => one.role)).not.toContain('authz');
  });
});

describe('무중단 재색인의 도달성과 계약 (WP-035 / CR-045~047)', () => {
  const REINDEX = read('apps/pipeline-worker/src/reindex.ts');
  /*
   * **금지를 거는 검사는 주석을 걷어 낸 코드만 본다** (risks 43).
   *
   * 이 파일의 머리 주석이 "`client.reindex({ source, dest })`를 쓰지 않는다"고
   * 적고 있어서, 파일 전문에 걸면 그 설명 자체에 걸린다 — 문서 검증기가 자기
   * 검색어를 세는 것과 같은 함정이다.
   */
  const REINDEX_CODE = REINDEX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const OPS_REINDEX = read('apps/search-api/src/ops/reindex.ts');
  const OPS_ROUTES = read('apps/search-api/src/ops/routes.ts');
  const FENCE = read('packages/db/src/reindex-fence.ts');
  const VERSIONED = read('packages/es/src/versioned-index.ts');
  const CLI = read('apps/pipeline-worker/src/reindex-cli.ts');
  const ROOT_MANIFEST = read('package.json');

  it('**러너가 새 큐 틀을 만들지 않는다** — `claimNextJob`을 쓴다', () => {
    expect(REINDEX).toContain("jobRepo.claimNextJob(deps.pool, REINDEX_TYPE, REINDEX_MAX_CONCURRENT)");
    expect(REINDEX).toContain('export const REINDEX_MAX_CONCURRENT = 1;');
  });

  it('**전환은 `updateAliases` 한 번이다** (FR-ING-008 AC-3)', () => {
    /*
     * `remove` → `add` 두 호출로 나누면 그 사이에 별칭이 사라지고, 그 창의
     * 모든 읽기·쓰기가 `index_not_found_exception`으로 실패한다. 무중단이
     * 이 WP의 목적이므로 그 창은 실패가 아니라 계약 위반이다.
     */
    expect(VERSIONED).toContain('client.indices.updateAliases({');
    const switchBody = VERSIONED.slice(VERSIONED.indexOf('export async function switchAlias'));
    const body = switchBody.slice(0, switchBody.indexOf('\n}'));
    expect(body).toContain('remove:');
    expect(body).toContain('add:');
    expect((body.match(/updateAliases\(/g) ?? []).length).toBe(1);
  });

  it('**옛 인덱스를 재구축 원본으로 쓰지 않는다** (ADR-004)', () => {
    // `client.reindex({ source, dest })`가 있으면 정본만으로의 재구축이 아니다.
    expect(REINDEX_CODE).not.toContain('.reindex({');
    expect(REINDEX).toContain('prSnapshotRepo.listSnapshotsAfter(');
    expect(REINDEX).toContain('commitSnapshotRepo.listCommitSnapshotsAfter(');
    expect(REINDEX).toContain('releaseRepo.listReleases(');
  });

  it('**두 번째 문서 빌더를 만들지 않는다** — 운영 빌더를 재사용한다', () => {
    expect(REINDEX).toContain('commitMetadataFields(fact)');
    expect(REINDEX).toContain('commitCreateFields(repository, fact,');
    expect(REINDEX).toContain('rows.map(toDocInput(repository))');
    // 간선은 JOB-REL-006의 경로를 포트로 받는다.
    expect(REINDEX).toContain('deps.links.rebuildRepository(repository)');
  });

  it('**활성화가 정본 스캔보다 먼저다** (DEV-296)', () => {
    const activation = REINDEX.indexOf("phase: 'dual_write'");
    const scan = REINDEX.indexOf('const tally = await rebuildAlias(');
    expect(activation).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(activation);
  });

  it('**활성화와 전환이 배타 울타리 안에서 돈다** (DEV-308)', () => {
    expect(REINDEX).toContain('await withReindexExclusive(deps.pool,');
    // 전환 직전에 잡 상태를 **다시** 본다 — 기다리는 동안 취소가 들어왔을 수 있다.
    const cutover = REINDEX.slice(REINDEX.indexOf("phase: 'cutover'"));
    expect(cutover).toContain('const latest = await reindexRepo.findReindexJob(client, jobId)');
    expect(cutover).toContain("latest.state !== 'running'");
    expect(cutover).toContain('switchAlias(');
  });

  it('**울타리가 shadow 실패 기록까지 덮는다** (CR-046, DEV-308)', () => {
    /*
     * 기록이 울타리 밖으로 밀리면 전환이 "실패 없음"을 보고 지나간다.
     * `recordShadowFailure` 호출도, 그것을 정본에 남기는 것도 같은 구간이다.
     */
    const write = FENCE.slice(FENCE.indexOf('export async function withReindexWrite'));
    const body = write.slice(0, write.indexOf('export async function withReindexExclusive'));
    const run = body.indexOf('const result = await run(targets)');
    const record = body.indexOf('recordShadowFailures(client, active.job_id, failures)');
    const release = body.indexOf('releaseAdvisorySharedLock(client, key)');
    expect(run).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(run);
    expect(release).toBeGreaterThan(record);
  });

  it('**논리 쓰기는 공유, 활성화·전환은 배타다**', () => {
    // 공유가 아니면 모든 색인 쓰기가 한 줄로 직렬화된다.
    expect(FENCE).toContain('acquireAdvisorySharedLock(client, key, FENCE_LOCK_TIMEOUT_MS)');
    expect(FENCE).toContain('acquireAdvisorySessionLock(client, key, lockTimeoutMs)');
  });

  it('**대상 버전은 아직 쓰이지 않은 다음 번호다** (CR-046, DEV-309)', () => {
    expect(VERSIONED).toContain('export async function nextUnusedVersion');
    const next = VERSIONED.slice(VERSIONED.indexOf('export async function nextUnusedVersion'));
    expect(next).toContain('const versions = await listIndexVersions(client, alias)');
    expect(next).toContain('return highest + 1');
  });

  it('**shadow 항목 실패가 전환을 막는다** — HTTP 200이 완료가 아니다 (DEV-297)', () => {
    const upsert = read('packages/es/src/upsert.ts');
    expect(upsert).toContain('reportShadowFailure(targets, {');
    // 검증이 `failures`를 본다.
    expect(REINDEX).toContain("reasons.push(`알려진 실패 ${String(job.progress.failures)}건`)");
  });

  it('**커버리지는 재구축이 쓴 문서 수로 판정한다** (PR #52 리뷰 P1)', () => {
    /*
     * 처리한 *source* 수로 판정하면 간선이 영원히 전환하지 못한다 — source
     * 하나가 0개에서 여러 개의 문서를 내므로 관계가 없는 저장소에서 `0 < N`이
     * 된다. 그리고 셀 수 없는 축은 `null`로 두어 **판정 자체를 하지 않는다.**
     */
    expect(REINDEX).toContain('tally.documentIds.add(');
    expect(REINDEX).toContain("const expected = alias === 'prs-links' ? null : tally.documentIds.size;");
    expect(REINDEX).toContain('if (expectedDocuments !== null && targetCount.count < expectedDocuments)');
    expect(REINDEX_CODE).not.toContain('verifyBeforeCutover(deps, jobId, tally.scanned)');
  });

  it('**PR 원본 커밋도 정본에서 다시 만든다** (PR #52 리뷰 P1)', () => {
    /*
     * `commit_snapshot`은 first-parent 체인만 덮는다(`listCommitsMissingSnapshot`).
     * 그것만 읽으면 PR 원본 커밋 문서가 통째로 빠진 인덱스로 전환하게 된다.
     */
    expect(REINDEX).toContain('await rebuildProjectedCommits(deps, repository, tally, indexedAt);');
    // 문서는 투영과 **같은 함수**가 만든다 — 두 번째 빌더를 만들지 않는다.
    expect(REINDEX).toContain('buildProjectedCommitDocument({');
    expect(read('apps/pipeline-worker/src/documents.ts')).toContain(
      'export function buildProjectedCommitDocument(',
    );
  });

  it('**레지스트리 소유 필드를 현재 값으로 덮는다** (PR #52 리뷰 P1)', () => {
    // 스냅숏은 투영 시점의 사본이다. 그대로 쓰면 전환이 회수된 팀을 되살린다.
    expect(REINDEX).toContain('const scope = registryOwnedFields(repository);');
    expect(REINDEX).toContain('...row.document,');
    expect(REINDEX).toContain('...scope,');
    // 버전의 정본은 본문이 아니라 **열**이다 (CI가 잡았다).
    expect(REINDEX).toContain('document_version: Number(row.document_version),');
    const documents = read('apps/pipeline-worker/src/documents.ts');
    expect(documents).toContain('export function registryOwnedFields(');
    // 구현이 하나다 — `commit-enrich`가 자기 사본을 갖지 않는다.
    expect(read('apps/pipeline-worker/src/commit-enrich.ts')).toContain(
      'const scopeFields = registryOwnedFields;',
    );
  });

  it('**큐에 보이는 순간 잡이 완전하다** (PR #52 리뷰 P2)', () => {
    const repo = read('packages/db/src/repositories/reindex.ts');
    expect(repo).toContain('enqueueJob(db, REINDEX_JOB_TYPE, alias, requestedBy, { ...progress })');
    expect(read('packages/db/src/repositories/job.ts')).toContain(
      "VALUES ($1, $2, 'queued', $3, $4::jsonb)",
    );
  });

  it('**롤백 중인 보관 대상을 처리했다고 적지 않는다** (PR #52 리뷰 P2)', () => {
    expect(VERSIONED).toContain("export type RetiredIndexOutcome = 'deleted' | 'serving' | 'absent';");
    const sweep = REINDEX.slice(REINDEX.indexOf('export async function runRetentionSweep'));
    const serving = sweep.indexOf("if (outcome === 'serving')");
    const mark = sweep.indexOf('await reindexRepo.markRetired(deps.pool, one.jobId, now);');
    expect(serving).toBeGreaterThan(-1);
    expect(mark, '`serving` 갈래가 표시보다 뒤에 있다').toBeGreaterThan(serving);
    expect(sweep.slice(serving, mark)).toContain('continue;');
  });

  it('**전환은 됐는데 기록되지 않은 잡을 스스로 고친다** (PR #52 리뷰 P2)', () => {
    expect(REINDEX).toContain('export async function reconcileSwitchedJobs(');
    // 별칭이 실제로 그 인덱스를 가리킬 때만 채운다.
    expect(REINDEX).toContain(
      'if ((await resolveServingIndex(deps.es, one.alias)) !== one.targetIndex) continue;',
    );
    // 보관 스윕이 매 주기 그것을 부른다.
    expect(REINDEX).toContain('await reconcileSwitchedJobs(deps);');
    // 전환 뒤 기록은 다시 시도하고, 끝내 실패하면 그 사실을 오류에 싣는다.
    expect(REINDEX).toContain('alias_switched_but_unrecorded');
  });

  it('**전환 전 검증이 건수 하나로 판정하지 않는다** (DEV-297)', () => {
    const verify = REINDEX.slice(REINDEX.indexOf('export async function verifyBeforeCutover'));
    for (const fact of ['잡 상태가', '알려진 실패', '정본 스캔이 끝나지 않았다', '커버리지 부족', '대표 질의 실패']) {
      expect(verify, `검증이 '${fact}'를 보지 않는다`).toContain(fact);
    }
  });

  it('**종료가 CAS다** — 늦은 취소를 덮지 않는다 (DEV-298)', () => {
    expect(REINDEX).toContain("jobRepo.finishJobIfRunning(deps.pool, jobId, 'completed')");
    expect(REINDEX).not.toContain("jobRepo.finishJob(deps.pool, jobId, 'completed')");
  });

  it('**보관 정리가 현재 별칭 대상을 지우지 않는다** (FR-ING-008 AC-4)', () => {
    const remove = VERSIONED.slice(VERSIONED.indexOf('export async function deleteRetiredIndex'));
    const check = remove.indexOf('const serving = await client.indices.getAlias({ name: alias })');
    const del = remove.indexOf('await client.indices.delete({ index })');
    expect(check).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(check);
    expect(remove).toContain("if (Object.keys(serving).includes(index)) return 'serving'");
  });

  it('**보관 정본이 잡 `progress`다** — 새 표를 만들지 않았다 (DEV-299)', () => {
    const repo = read('packages/db/src/repositories/reindex.ts');
    expect(repo).toContain("progress ->> 'switched_at' IS NOT NULL");
    expect(repo).toContain('job.progress.source_index');
    expect(repo).toContain("progress ->> 'retired_at' IS NULL");
    // 마이그레이션을 만들지 않았다 — 014가 마지막이다.
    expect(existsSync(new URL('packages/db/migrations/015_reindex.up.sql', new URL('..', import.meta.url)))).toBe(false);
  });

  it('**API가 `alias`만 받는다** (DEV-294)', () => {
    expect(OPS_ROUTES).toContain("startReindex(reindex, body['alias'], principalId(principal))");
    expect(OPS_REINDEX).toContain('구체 인덱스는 받지 않는다');
    // 별칭 판정은 포트가 한다 — 라우트가 다른 대상 키를 읽지 않는다.
    expect(OPS_REINDEX).toContain("case 'invalid_alias':");
    expect(OPS_ROUTES).not.toContain("body['target_index']");
  });

  it('**API-ADM-002의 일반 생성이 `reindex`를 받지 않는다** (DEV-301·302)', () => {
    const jobs = read('apps/search-api/src/ops/jobs.ts');
    /*
     * **없다는 것을 단언한다.** 리터럴 전문을 걸면 목록이 자랄 때마다 깨지고,
     * 그때 사람은 성질을 다시 보지 않고 문자열만 갱신한다 — 그 갱신이 언젠가
     * `reindex`를 함께 들여보낸다 (CR-055).
     */
    const creatable = /CREATABLE_GENERIC_JOB_TYPES = \[([^\]]*)\]/.exec(jobs)?.[1] ?? '';
    expect(creatable).not.toContain("'reindex'");
    expect(creatable).toContain("'backfill'");
    expect(OPS_ROUTES).toContain("if (!isCreatableGenericJobType(body['type'])) {");
  });

  it('**CLI가 API와 같은 enqueue seam을 부른다** (DEV-302)', () => {
    expect(CLI).toContain('reindexRepo.enqueueReindex(pool, reindexIndexPort(es), alias, REQUESTED_BY)');
    expect(OPS_REINDEX).toContain('reindexRepo.enqueueReindex(deps.pool, deps.index, alias, requestedBy)');
    // CLI가 직접 재색인하지 않는다.
    expect(CLI).not.toContain('.reindex(');
    expect(CLI).not.toContain('switchAlias(');
    expect(ROOT_MANIFEST).toContain('"es:reindex"');
  });

  it('**러너가 있는 유형만 운영자 표면에 오른다** (DEV-301)', () => {
    const jobs = read('apps/search-api/src/ops/jobs.ts');
    expect(jobs).toContain("'reindex'");
    // 러너가 같은 커밋에 있다 — 먼저 등재하면 DEV-178이 된다.
    expect(REINDEX).toContain('export function startReindexRunner(');
  });
});

describe('저장된 검색의 도달성과 계약 (WP-033 / CR-049)', () => {
  const SERVER = read('apps/search-api/src/server.ts');
  const SAVED_ROUTES = read('apps/search-api/src/saved-search/routes.ts');
  const SAVED_SERVICE = read('apps/search-api/src/saved-search/service.ts');
  const SAVED_CURSOR = read('apps/search-api/src/saved-search/cursor.ts');
  const SAVED_REPO = read('packages/db/src/repositories/saved-search.ts');

  const codeOf = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('**운영 조립이 의존을 넘긴다** — 여기 한 줄이 빠지면 배포에 이 기능이 없다 (DEV-177 계열)', () => {
    // 호출 형태로 건다. 키 이름만 찾으면 타입 선언에도 걸린다.
    expect(API_RUNTIME).toContain('savedSearch: {');
    expect(API_RUNTIME).toContain('cursorSigner: createCursorSigner(parts.config.searchCursorKey)');
  });

  it('**운영 서버가 저장된 검색 라우트를 실제로 등록한다**', () => {
    /*
     * **이 검사가 덮지 못하는 면**: 호출이 *존재한다*를 볼 뿐 그 갈래가
     * *도달 가능한가*는 보지 않는다. `if (... && false)`로 무력화하면 여기서는
     * 통과한다 — 변이로 확인했다. 그 면은 통합 시험이 덮는다:
     * `integration/saved-search/*`가 실제 `buildServer`로 라우트를 세우고
     * 응답을 받으므로, 갈래가 죽으면 55건이 함께 죽는다.
     *
     * 조건식의 형태를 여기서 핀으로 박지 않는다 — 그러면 정당한 리팩터가
     * 시험을 깨고, 그 시험은 사실이 아니라 모양을 지키게 된다.
     */
    expect(SERVER).toContain('registerSavedSearchRoutes(app, {');
  });

  it('라우트가 세션 뒤에 있다 — 신원 없이 열지 않는다', () => {
    const at = SERVER.indexOf('registerSavedSearchRoutes(app, {');
    const guard = SERVER.indexOf('if (deps.auth !== undefined) {');
    expect(guard).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(guard);
  });

  it('**의존이 없으면 그 사실을 로그로 말한다** — 조용히 없는 것이 DEV-177의 원인이었다', () => {
    expect(SERVER).toContain('저장된 검색 경로를 등록하지 않는다 (API-SRCH-005)');
  });

  it('**정적 경로가 파라미터 경로보다 먼저 등록된다**', () => {
    const share = SAVED_ROUTES.indexOf('app.get(SHARE_TARGETS_PATH');
    const item = SAVED_ROUTES.indexOf('app.get(SAVED_SEARCH_ITEM_PATH');
    expect(share).toBeGreaterThan(-1);
    expect(item).toBeGreaterThan(-1);
    expect(share).toBeLessThan(item);
  });

  it('**소유자를 요청 본문에서 받지 않는다** (AC-1)', () => {
    const code = codeOf(SAVED_ROUTES);
    expect(code).toContain('ownerUserId: userId');
    expect(code).not.toContain("body.owner_user_id");
    expect(code).not.toContain("body['owner_user_id']");
  });

  it('**100건 상한이 소유자 행을 잠근다** (DEV-336)', () => {
    const code = codeOf(SAVED_REPO);
    expect(code).toContain('FOR UPDATE');
    // 세기 전에 잠근다 — 순서가 뒤집히면 잠금이 아무것도 막지 못한다.
    expect(code.indexOf('FOR UPDATE')).toBeLessThan(code.indexOf('count(*)::text AS count'));
    // 상한은 트랜잭션 안에 있다.
    expect(code).toContain('return withTransaction(pool, async (client) => {');
  });

  it('**팀 구성원 판정이 쓰기와 원자적이다** (DEV-344)', () => {
    const code = codeOf(SAVED_REPO);
    expect(code).toContain('FOR SHARE');
    // 생성과 수정 **양쪽**이 같은 판정을 쓴다.
    const create = code.split('export async function createSavedSearch')[1]?.split('export async function')[0] ?? '';
    const update = code.split('export async function updateSavedSearch')[1]?.split('export async function')[0] ?? '';
    expect(create).toContain('holdsMembership(client,');
    expect(update).toContain('holdsMembership(client,');
  });

  it('**실행 갱신이 권한 조건을 다시 건다** — TOCTOU를 남기지 않는다', () => {
    const code = codeOf(SAVED_REPO);
    const body = code.split('export async function markSavedSearchRun')[1] ?? '';
    expect(body).toContain('UPDATE saved_search s');
    expect(body).toContain('visibleTo(');
  });

  it('**`/run`이 검색을 대신 수행하지 않는다** (AC-3, THR-012)', () => {
    const code = codeOf(SAVED_SERVICE);
    // 색인 클라이언트도 검색 서비스도 이 계층에 없다.
    expect(code).not.toContain("from '@prs/es'");
    expect(code).not.toContain('runSearch(');
    expect(code).not.toContain('applyMandatoryScopeFilter');
  });

  it('**저장자의 접근 범위를 어디에도 남기지 않는다** (AC-3)', () => {
    for (const source of [SAVED_REPO, SAVED_SERVICE, SAVED_ROUTES]) {
      const code = codeOf(source);
      expect(code).not.toContain('access_scope');
      expect(code).not.toContain('repositoryIds');
      expect(code).not.toContain('scopeVersion');
    }
  });

  it('**커서가 W-001의 것과 갈려 있다** (DEV-340)', () => {
    const code = codeOf(SAVED_CURSOR);
    // PIT도 search_after도 이 자원에 뜻이 없다.
    expect(code).not.toContain('search_after');
    expect(code).not.toContain('pit');
    // 봉인 방식만 공유한다.
    expect(code).toContain("from '../cursor/envelope.js'");
  });

  it('**커서 지문에 팀 구성원 자격이 들어간다** — 순회 도중 회수를 막는다', () => {
    const code = codeOf(SAVED_CURSOR);
    const body = code.split('export function computeSavedSearchFingerprint')[1] ?? '';
    expect(body).toContain('input.teamIds');
    expect(body).toContain('input.userId');
    // 정렬해야 같은 소속이 늘 같은 지문이다.
    expect(body).toContain('.sort(');
  });

  it('**커서 서명 키를 새로 만들지 않는다** — 검색·구간과 같은 값이다', () => {
    expect(codeOf(SAVED_CURSOR)).not.toContain('process.env');
    expect(API_RUNTIME).toContain('parts.config.searchCursorKey');
  });

  it('**목록이 오프셋을 받지 않는다** (ADR-010)', () => {
    const code = codeOf(SAVED_ROUTES);
    expect(code).not.toContain("query['offset']");
    expect(code).not.toContain("query['page']");
  });

  it('**타임스탬프를 밀리초로 자르지 않는다** — 키셋이 항목을 건너뛴다', () => {
    const code = codeOf(SAVED_REPO);
    // 마이크로초를 보존하는 형식으로 읽는다.
    expect(code).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.USZ'");
    // 키셋 파라미터도 같은 정밀도로 되돌린다.
    expect(code).toContain('::timestamptz');
  });

  it('**소유하지 않은 항목의 수정·삭제가 404다** — 403은 존재를 흘린다', () => {
    const code = codeOf(SAVED_ROUTES);
    expect(code).not.toContain("code: 'FORBIDDEN_ROLE'");
    const patch = code.split("app.patch(SAVED_SEARCH_ITEM_PATH")[1]?.split('app.delete')[0] ?? '';
    expect(patch).toContain("case 'not_found':");
    expect(patch).toContain('notFound(reply, correlationId)');
  });

  it('**질의 검증에 파서를 쓴다** — 서버가 자기 문법을 새로 만들지 않는다 (ADR-001)', () => {
    expect(codeOf(SAVED_SERVICE)).toContain("from '@prs/query'");
    expect(codeOf(SAVED_SERVICE)).toContain('parseQuery(query)');
    // 라우트가 판정을 복제하지 않는다.
    expect(codeOf(SAVED_ROUTES)).toContain('judgeQuery(');
  });

  it('**마이그레이션 015가 불변식과 목록 인덱스를 만든다**', () => {
    const up = read('packages/db/migrations/015_saved_search_contract.up.sql');
    const down = read('packages/db/migrations/015_saved_search_contract.down.sql');

    /*
     * **금지를 거는 검사는 주석을 걷어 낸 SQL만 봐야 한다** (risks 43).
     * 이 마이그레이션은 왜 `CONCURRENTLY`를 쓰지 않는지 주석으로 설명하고
     * 있고, 파일 전문에 걸면 **그 설명에 걸린다** — 검사기가 자기 검색어를
     * 세는 것과 같은 함정이다.
     */
    const sqlOf = (source: string): string => source.replace(/^\s*--.*$/gm, '');

    expect(up).toContain('saved_search_team_target_chk');
    expect(up).toContain('saved_search_owner_idx');
    expect(up).toContain('saved_search_team_idx');
    // 새 표를 만들지 않는다.
    expect(sqlOf(up)).not.toContain('CREATE TABLE');
    // 트랜잭션 안에서 도는 러너라 CONCURRENTLY를 쓸 수 없다.
    expect(sqlOf(up)).not.toContain('CONCURRENTLY');
    // down이 up이 만든 셋을 전부 되돌린다.
    for (const name of ['saved_search_team_target_chk', 'saved_search_owner_idx', 'saved_search_team_idx']) {
      expect(down).toContain(name);
    }
  });
});

describe('집계 API의 도달성과 계약 (WP-037 / CR-053)', () => {
  const SERVER = read('apps/search-api/src/server.ts');
  const ROUTES = read('apps/search-api/src/analytics/routes.ts');
  const PREPARE = read('apps/search-api/src/analytics/prepare.ts');
  const EXECUTE = read('apps/search-api/src/analytics/execute.ts');
  const AGGREGATIONS = read('apps/search-api/src/analytics/aggregations.ts');
  const TYPES = read('apps/search-api/src/analytics/types.ts');

  it('**운영 서버가 집계 라우트를 실제로 등록한다**', () => {
    /*
     * 호출 형태로 건다 — 이름만 찾으면 `import` 줄이 남아 있는 한 통과한다.
     * WP-028의 `API-ADM-007`이 정확히 그 상태로 원장에 `done`으로 적혀 있었다
     * (CR-034, DEV-177).
     */
    expect(SERVER).toContain('registerAnalyticsRoutes(app, {');
  });

  it('집계 라우트가 검색과 **같은 조건** 뒤에 있다 — 세션 없이 열지 않는다', () => {
    const at = SERVER.indexOf('registerAnalyticsRoutes(app, {');
    const guard = SERVER.indexOf('if (deps.search !== undefined) {');
    expect(guard).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(guard);
  });

  it('네 엔드포인트가 모두 선언되어 있다 (API-STAT-001~004)', () => {
    for (const path of ['/groups', '/time-series', '/percentiles', '/distributions']) {
      expect(ROUTES).toContain(`\`\${ANALYTICS_BASE}${path}\``);
    }
  });

  it('**집계 모집단이 PR 단독이다** (FR-STAT-001 AC-6, DEV-381)', () => {
    // 커밋을 넣으면 그룹 키 셋과 지표 둘이 조용히 0이나 `unknown`이 된다.
    expect(TYPES).toContain("ANALYTICS_TARGET: readonly EntityAlias[] = ['prs-pull-requests']");
    expect(TYPES).not.toContain('prs-commits');
  });

  it('**모든 집계가 강제 접근 범위 필터를 지난다** (ADR-008)', () => {
    // 목록에서 이미 걸렀다는 이유로 생략하지 않는다 — 건수도 정보다.
    expect(PREPARE).toContain('applyMandatoryScopeFilter(');
    // 실행 계층은 `ScopedQuery`만 받는다. 원시 클라이언트를 직접 부르지 않는다.
    expect(EXECUTE).toContain('scoped: ScopedQuery');
    expect(EXECUTE).not.toContain('client.search(');
  });

  it('**부분 샤드 실패를 정상 집계로 반환하지 않는다**', () => {
    // 일부 샤드가 답하지 못한 수를 200으로 내보내면 "적게 나온 수"가 사실이 된다.
    expect(EXECUTE).toContain('assertNoShardFailures(');
  });

  it('**조회 시점 `script`를 쓰지 않는다** (NFR-001, FR-STAT-005 AC-7)', () => {
    // 집계가 읽는 값은 전부 색인 시점 계산 필드다. `changed_lines`가 그래서 생겼다.
    expect(AGGREGATIONS).not.toContain('script:');
    expect(AGGREGATIONS).not.toContain('runtime_mappings');
  });

  it('**그룹 정렬이 결정적이다** (FR-STAT-001 AC-8, DEV-389)', () => {
    // 상한으로 자르는 계약이라 순서가 흔들리면 어느 그룹이 잘리는지도 흔들린다.
    expect(AGGREGATIONS).toContain("{ _count: 'desc' }, { _key: 'asc' }");
  });

  it('**`team` 그룹이 작성자 팀을 본다** (DEV-382)', () => {
    // `allowed_team_ids`는 저장소 접근 권한이다. 섞으면 권한을 성과로 읽는다.
    expect(TYPES).toContain("team: 'author_team_ids'");
    expect(TYPES).not.toContain("team: 'allowed_team_ids'");
    expect(TYPES).toContain("team: 'author_team',");
  });

  it('**`drill_down_query`가 모집단을 유지한다** (FR-STAT-001 AC-5, DEV-383)', () => {
    // 이 조건이 없으면 사용자가 누른 수보다 목록이 더 크게 나온다.
    expect(AGGREGATIONS).toContain("replaceEquality(base, 'kind', 'pull_request')");
  });

  it('**근거 질의가 기존 조건을 대체한다** — 더하기만 하면 OR가 남는다', () => {
    /*
     * `author:alice author:bob`에서 alice를 눌렀는데 OR가 남으면 목록이 버킷보다
     * 큰 수를 보인다 (PR #76 리뷰 P2). 버킷을 누르는 것은 **좁히는** 일이다.
     */
    expect(AGGREGATIONS).toContain('replaceEquality');
    expect(AGGREGATIONS).not.toContain('addEquality');
  });

  it('**근사 여부를 집계 없이 센 수로 정한다** (PR #76 리뷰 P1)', () => {
    /*
     * `track_total_hits`는 히트 계수만 제한하고 집계 순회는 제한하지 않는다 —
     * 근사할지 정하려던 요청이 전수 집계를 수행한다. 그리고 상한까지만 센 수를
     * 모집단 크기로 쓰면 표본 비율이 1에 가까워져 근사가 근사가 아니게 된다.
     */
    expect(EXECUTE).toContain('countDocuments(');
    expect(EXECUTE).toContain('track_total_hits: false');
  });

  it('**200에 붙어 온 `timed_out`도 부분 결과다** (PR #76 리뷰 P1)', () => {
    // 샤드 실패가 아니라 `assertNoShardFailures`가 잡지 못한다. `facets.ts`가
    // 같은 자리에서 이미 `timed_out`을 본다.
    expect(EXECUTE).toContain('timed_out');
  });

  it('**시계열이 요청 구간을 모집단에 넣는다** (PR #76 리뷰 P1)', () => {
    // `extended_bounds`는 빈 버킷을 더할 뿐 범위 밖 문서를 빼지 않는다.
    expect(ROUTES).toContain('merged:${from}..${to}');
  });

  it('**리드타임은 머지된 PR로 한정한다** (FR-STAT-003 AC-2, PR #76 리뷰 P1)', () => {
    // 좁히지 않으면 열린 PR이 제외 건수로 세어져 `no_review`로 잘못 분류된다.
    expect(ROUTES).toContain('is:merged');
  });

  it('**낡은 에폭에서 집계를 계산하지 않는다** (FR-STAT-006 AC-6, DEV-384)', () => {
    // 0건이나 빈 버킷으로 위장하지 않는다 — 재채번 뒤의 같은 서수는 다른 커밋이다.
    expect(PREPARE).toContain('resolveSequenceContext(');
    expect(ROUTES).toContain('epoch_stale: true');
  });

  it('시퀀스 판정을 `/search`와 **같은 함수로** 옮긴다', () => {
    // 각자 옮기면 같은 상황에 다른 상태 코드를 내는 날이 온다.
    expect(ROUTES).toContain("import { toSequenceFailure } from '../search/routes.js'");
  });

  it('**`kind:`가 PR을 남기지 않으면 400이다** — 조용한 0건이 아니다', () => {
    expect(ROUTES).toContain('analytics_population_empty');
  });
});


/**
 * 감사 기록의 도달성과 계약 (WP-039 / CR-054).
 *
 * **`grep`으로 액션 문자열이 있는지 세지 않는다** — 그것은 "코드에 이름이
 * 있다"이지 "사용자 경로가 감사된다"가 아니다. 실제 기록은 통합 시험이
 * 확인하고, 여기서는 **배선이 끊기면 죽는 자리**만 건다.
 */
describe('감사 기록의 도달성과 계약 (WP-039 / CR-054)', () => {
  const RECORDER = read('apps/search-api/src/audit/recorder.ts');
  const AUDIT_ROUTES = read('apps/search-api/src/audit/routes.ts');
  const OPS_ROUTES = read('apps/search-api/src/ops/routes.ts');
  const SEARCH_ROUTES = read('apps/search-api/src/search/routes.ts');
  const RESOLVE_ROUTES = read('apps/search-api/src/resolve/routes.ts');
  const SAVED_SEARCH_ROUTES = read('apps/search-api/src/saved-search/routes.ts');
  const REPOSITORY_OPS = read('apps/search-api/src/ops/repositories.ts');
  const RETENTION = read('apps/pipeline-worker/src/retention.ts');
  const NAV = read('apps/web/lib/nav.ts');
  const SERVER = read('apps/search-api/src/server.ts');

  it('**운영 서버가 감사 라우트를 실제로 등록한다**', () => {
    expect(SERVER).toContain('registerAuditRoutes(app, {');
  });

  it('감사 라우트가 세션 블록 안에 있다 — 토큰으로 열리지 않는다', () => {
    // 역할은 세션에만 있다. 토큰 주체에게 열면 감사 평면이 토큰 하나로 열린다.
    const sessionBlock = SERVER.slice(SERVER.indexOf('deps.auth !== undefined'));
    expect(sessionBlock).toContain('registerAuditRoutes');
  });

  it('**`security_officer` 전용이다** (FR-AUTH-004 AC-5)', () => {
    expect(AUDIT_ROUTES).toContain("requireRole(principal, 'security_officer')");
    // `operator`를 함께 받는 형태가 아니어야 한다.
    expect(AUDIT_ROUTES).not.toContain("requireAnyRole(principal, ['operator'");
  });

  it('**접근 범위 필터를 걸지 않는다** — 감사는 행위의 기록이다', () => {
    expect(AUDIT_ROUTES).not.toContain('applyMandatoryScopeFilter');
    expect(AUDIT_ROUTES).toContain('접근 범위 필터를 걸지 않는다');
  });

  it('**갱신·삭제 경로가 없다** (AC-3)', () => {
    expect(AUDIT_ROUTES).not.toMatch(/app\.(patch|delete|put)\(/);
  });

  it('공용 실패 격리 경계가 하나다 (AC-6, DEV-406)', () => {
    expect(RECORDER).toContain('export async function recordAuditBestEffort');
    expect(RECORDER).toContain('auditFailedTotal.inc({ action: entry.action })');
  });

  it('**호출부가 각자 `try`/`catch`를 두지 않는다**', () => {
    // 각자 구현하면 빠뜨린 자리가 리뷰에서 눈에 띄지 않는다.
    for (const [name, source] of [
      ['ops/routes', OPS_ROUTES],
      ['ops/repositories', REPOSITORY_OPS],
      ['search/routes', SEARCH_ROUTES],
      ['resolve/routes', RESOLVE_ROUTES],
      ['saved-search/routes', SAVED_SEARCH_ROUTES],
    ] as const) {
      expect(source, name).not.toContain('auditRepo.recordAudit(');
    }
  });

  it('지표 라벨이 `action` 하나다 — 고카디널리티 값을 담지 않는다', () => {
    expect(RECORDER).not.toContain('userId: entry.userId,\n      target');
    expect(RECORDER).toContain("auditFailedTotal.inc({ action: entry.action })");
  });

  it('**`audit.view`를 응답 확정 뒤에 기록한다** (AC-8)', () => {
    const bodyIndex = AUDIT_ROUTES.indexOf('const body = {');
    const auditIndex = AUDIT_ROUTES.indexOf("action: 'audit.view'");
    expect(bodyIndex).toBeGreaterThan(0);
    expect(auditIndex).toBeGreaterThan(bodyIndex);
  });

  it('신규 재채번 기록이 `sequence.reassign`이다 (DEV-405)', () => {
    expect(OPS_ROUTES).toContain("action: 'sequence.reassign'");
    expect(OPS_ROUTES).not.toContain("action: 'sequence_integrity.reassign'");
  });

  it('**legacy 값을 조회에서 막지 않는다** (AC-7)', () => {
    // `action` 필터를 정본 enum으로 좁히면 과거를 조사할 수 없다.
    expect(AUDIT_ROUTES).not.toContain('isActiveAuditAction');
  });

  it('잡 제어 넷이 모두 기록된다 (DEV-404)', () => {
    expect(OPS_ROUTES).toContain("action: 'job.run'");
    expect(OPS_ROUTES).toContain('action: `job.${action}`');
  });

  it('재색인이 `reindex.start` 하나만 남긴다 — 두 번 세지 않는다', () => {
    expect(OPS_ROUTES).toContain("action: 'reindex.start'");
  });

  it('DLQ 재처리가 기록된다', () => {
    expect(OPS_ROUTES).toContain("action: 'dead_letter.reprocess'");
  });

  it('검색·상세·저장된 검색이 기록된다', () => {
    expect(SEARCH_ROUTES).toContain("action: 'search.execute'");
    expect(RESOLVE_ROUTES).toContain("action: 'entity.view'");
    expect(SAVED_SEARCH_ROUTES).toContain("action: 'saved_search.create'");
    expect(SAVED_SEARCH_ROUTES).toContain("action: 'saved_search.update'");
    expect(SAVED_SEARCH_ROUTES).toContain("action: 'saved_search.delete'");
  });

  it('**`saved_search.run`을 만들지 않는다** — 실행은 `search.execute`가 남긴다', () => {
    expect(SAVED_SEARCH_ROUTES).not.toContain("action: 'saved_search.run'");
  });

  it('**검색의 `target`이 `null`이다** (AC-2, DEV-415)', () => {
    expect(SEARCH_ROUTES).toContain('target: null');
  });

  it('보존 잡이 드롭 전에 파티션을 만든다 (DEV-417)', () => {
    const partitions = read('packages/db/src/partitions.ts');
    const createIndex = partitions.indexOf('const created = await ensureAllPartitions(');
    const dropIndex = partitions.indexOf('DROP TABLE IF EXISTS ${bound.name}');
    expect(createIndex).toBeGreaterThan(0);
    expect(dropIndex).toBeGreaterThan(createIndex);
  });

  it('**파티션 경계를 이름이 아니라 카탈로그에서 읽는다** (§41)', () => {
    const partitions = read('packages/db/src/partitions.ts');
    expect(partitions).toContain('pg_get_expr(c.relpartbound, c.oid)');
  });

  it('보존이 `retention.purge`를 남긴다 (FR-ING-003 AC-5)', () => {
    expect(RETENTION).toContain("action: 'retention.purge'");
    expect(RETENTION).toContain('AUDIT_RETENTION_PRINCIPAL');
  });

  it('**관리 연결이 `prs_app`과 다르다** (AC-3, DEV-411)', () => {
    const pool = read('packages/db/src/pool.ts');
    expect(pool).toContain('SET ROLE ${ADMIN_DB_ROLE}');
    expect(read('packages/db/src/config.ts')).toContain('ADMIN_DATABASE_URL');
  });

  it('**애플리케이션 롤에 `DROP` 권한을 주지 않는다**', () => {
    const roles = read('packages/db/migrations/005_roles.up.sql');
    expect(roles).toContain('GRANT SELECT, INSERT ON audit_record TO prs_app');
    expect(roles).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*audit_record[^;]*prs_app/);
  });

  it('커서 인덱스 마이그레이션이 있다 (DEV-412)', () => {
    expect(read('packages/db/migrations/018_audit_cursor.up.sql')).toContain(
      'CREATE INDEX audit_cursor_idx ON audit_record (occurred_at DESC, audit_id DESC)',
    );
    expect(read('packages/db/migrations/018_audit_cursor.down.sql')).toContain(
      'DROP INDEX IF EXISTS audit_cursor_idx',
    );
  });

  it('**내비게이션이 항목마다 역할을 본다** (DEV-408)', () => {
    expect(NAV).toContain('allowedRoles');
    // 섹션 하나로 통째로 여는 형태가 남아 있으면 안 된다.
    expect(NAV).not.toContain("entry.section !== 'ops' || ops");
  });

  it('감사 항목이 `security_officer` 전용이다', () => {
    expect(NAV).toContain("allowedRoles: ['security_officer']");
  });

  /*
   * PR #84 리뷰가 찾은 셋 (DEV-421~423).
   */
  it('**관리 롤이 파티션을 만들고 지울 수 있다** (DEV-421)', () => {
    // `GRANT ALL ON TABLE`은 스키마 `CREATE`도 소유권도 주지 않는다 —
    // 둘 다 없으면 `JOB-AUD-001`이 자기 일의 어느 절반도 하지 못한다.
    const roleGrants = read('packages/db/migrations/019_retention_role.up.sql');
    expect(roleGrants).toContain('GRANT CREATE ON SCHEMA public TO prs_admin');
    expect(roleGrants).toContain('ALTER TABLE audit_record OWNER TO prs_admin');
    expect(roleGrants).toContain('ALTER TABLE raw_event OWNER TO prs_admin');
  });

  it('**실제 관리 롤로 도는 시험이 있다** — 소유자 풀은 제약을 만나지 않는다', () => {
    const roleTest = read('apps/pipeline-worker/integration/retention/retention-role.test.ts');
    expect(roleTest).toContain('createAdminPool(');
    expect(roleTest).toContain('GRANT prs_admin TO');
  });

  it('`dead_letter.reprocess`가 **전달 식별자**를 남긴다 (DEV-422)', () => {
    expect(OPS_ROUTES).toContain('target: result.delivery_ids.join');
    expect(read('apps/search-api/src/ops/dead-letters.ts')).toContain('readonly delivery_ids:');
  });

  it('`saved_search.update`가 **바뀐 뒤의 질의**를 남긴다 (DEV-423)', () => {
    expect(SAVED_SEARCH_ROUTES).toContain("outcome.kind === 'updated' ? finalQuery : null");
  });
});

/**
 * 안전 구간 표식 (WP-041 / API-SEQ-004, FR-SEQ-006).
 *
 * 이 라우트는 시퀀스 경로에 얹혀 있으므로 `registerSequenceRoutes`가 서면
 * 함께 선다 — **그 등록이 이미 이 파일의 다른 블록에 걸려 있다.** 여기서
 * 확인하는 것은 그 안에서 **검사 순서가 소스에 그대로 있는가**이다:
 * 순서 자체가 계약이고, 시험은 그 순서가 만드는 *결과*를 보지만 그 결과가
 * 우연히 같아 보이는 배치가 있을 수 있다.
 */
describe('안전 구간 표식 (WP-041)', () => {
  const SEQUENCE_ROUTES = read('apps/search-api/src/sequence/routes.ts');
  const MARKER_SERVICE = read('apps/search-api/src/sequence/safe-marker.ts');
  const MARKER_REPO = read('packages/db/src/repositories/safe-marker.ts');
  const codeOf = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * "`a`가 `b`보다 먼저 온다" — **둘 다 있는지 먼저 본다** (DEV-474).
   *
   * `indexOf`는 없는 문자열에 `-1`을 주므로, 존재 확인 없이 `toBeLessThan`만
   * 걸면 **그 코드를 통째로 지운 변이가 통과한다.** 실제로 에폭 대조를
   * 지우는 변이가 그렇게 살아남았다.
   */
  const expectOrder = (code: string, first: string, second: string): void => {
    expect(code, first).toContain(first);
    expect(code, second).toContain(second);
    expect(code.indexOf(first), `${first} < ${second}`).toBeLessThan(code.indexOf(second));
  };

  it('**두 경로가 실제로 등록된다**', () => {
    expect(SEQUENCE_ROUTES).toContain('app.get(SAFE_MARKERS_PATH');
    expect(SEQUENCE_ROUTES).toContain('app.put(SAFE_MARKERS_PATH');
  });

  it('**역할 검사가 공간 해석보다 먼저 온다** — 403이 저장소의 존재를 흘리지 않는다', () => {
    const code = codeOf(SEQUENCE_ROUTES);
    const put = code.slice(code.indexOf('app.put(SAFE_MARKERS_PATH'));
    expectOrder(put, "requireRole(principal, 'release_manager')", 'const entered = await enter(');
  });

  it('**GET은 역할을 요구하지 않는다** — 막히는 것은 쓰기뿐이다 (DEV-461)', () => {
    const code = codeOf(SEQUENCE_ROUTES);
    const get = code.slice(
      code.indexOf('app.get(SAFE_MARKERS_PATH'),
      code.indexOf('app.put(SAFE_MARKERS_PATH'),
    );
    expect(get).not.toContain('requireRole');
  });

  it('**에폭 검사가 서수 실재 검사보다 먼저다** — 낡은 세대에서 서수를 찾지 않는다', () => {
    expectOrder(codeOf(MARKER_SERVICE), 'input.seqEpoch !== space.seqEpoch', 'findPointBySeq');
  });

  it('**완전 일치 검사가 `expected` 대조보다 먼저다** (DEV-464)', () => {
    // 뒤집히면 정직한 재시도가 자기가 만든 상태 때문에 409를 받는다.
    expectOrder(
      codeOf(MARKER_REPO),
      "return { kind: 'unchanged'",
      'currentSeq !== input.expectedMarkerSeq',
    );
  });

  it('**`note`가 멱등 판정의 재료다** (DEV-465)', () => {
    expect(codeOf(MARKER_REPO)).toContain('current.note === input.note');
  });

  it('**대체가 공간 단위 락 뒤에 있다** — 유일 제약을 직렬화 수단으로 쓰지 않는다', () => {
    expect(codeOf(MARKER_REPO)).toContain('advisoryXactLock(client, safeMarkerLockKey(');
    expectOrder(codeOf(MARKER_REPO), 'advisoryXactLock', 'findCurrentMarker(client');
  });

  it('**채번 락을 함께 쓰지 않는다** — 사람이 누르는 요청이 파이프라인을 밀지 않는다', () => {
    expect(codeOf(MARKER_REPO)).not.toContain('sequenceLockKey');
  });

  it('**대체 트랜잭션이 에폭을 `FOR SHARE`로 다시 읽는다** (DEV-471)', () => {
    const code = codeOf(MARKER_REPO);
    /*
     * 잠그지 않고 읽으면 읽은 **직후에** 커밋한 재채번을 보지 못한다.
     * 통합 시험은 그 잠금이 `bumpEpoch`를 막는다는 **전제**를 재고, 여기서는
     * 리포지터리가 실제로 그 잠금을 쓰는지를 본다 — 둘 중 하나만 있으면
     * `FOR SHARE`를 뺀 변이가 살아남는다.
     */
    expect(code).toContain('FROM sequence_space');
    // 읽고 대조한 뒤에 쓴다. 순서가 뒤집히면 잠금이 아무것도 막지 못한다.
    expectOrder(code, 'FOR SHARE', 'INSERT INTO safe_marker');
    expectOrder(code, 'currentEpoch !== input.seqEpoch', 'INSERT INTO safe_marker');
  });

  it('**멱등 재시도에 감사를 남기지 않는다** — 재시도가 등록으로 보인다', () => {
    const code = codeOf(SEQUENCE_ROUTES);
    const unchanged = code.slice(code.indexOf("case 'unchanged':"), code.indexOf("case 'created':"));
    expect(unchanged).not.toContain('recordAudit');
  });

  it('`safe_marker.set`이 **활성 어휘에 있다** — WP-041이 그 기능을 세웠다', () => {
    const audit = read('packages/domain/src/audit.ts');
    const active = audit.slice(
      audit.indexOf('ACTIVE_AUDIT_ACTIONS = ['),
      audit.indexOf('NOT_ACTIVATED_AUDIT_ACTIONS'),
    );
    expect(active).toContain("'safe_marker.set'");
    // WP-044가 마지막 미활성 액션을 실제로 연결했다.
    expect(active).toContain("'export.create'");
    expect(audit).toContain('NOT_ACTIVATED_AUDIT_ACTIONS = []');
  });
});

describe('작성자 소속 팀의 도달성과 계약 (WP-069 / CR-058)', () => {
  const AUTHOR_TEAMS = read('apps/pipeline-worker/src/author-teams.ts');
  const DOCUMENTS = read('apps/pipeline-worker/src/documents.ts');
  const PROJECT = read('apps/pipeline-worker/src/project.ts');
  const BACKFILL = read('apps/pipeline-worker/src/backfill.ts');
  const REINDEX = read('apps/pipeline-worker/src/reindex.ts');
  const MEMBERSHIP_REPO = read('packages/db/src/repositories/team-membership.ts');
  const codeOf = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** "`a`가 `b`보다 먼저 온다" — 둘 다 있는지 먼저 본다 (DEV-474). */
  const expectOrder = (code: string, first: string, second: string): void => {
    expect(code, first).toContain(first);
    expect(code, second).toContain(second);
    expect(code.indexOf(first), `${first} < ${second}`).toBeLessThan(code.indexOf(second));
  };

  it('**조직 팀 스윕이 `authz` 역할에서 실제로 기동하고 종료한다**', () => {
    expect(WORKER_INDEX).toContain('orgTeamSweeper = startOrgTeamSweeper(');
    expect(WORKER_INDEX).toContain('await orgTeamSweeper?.stop()');
    // 기동이 `authz` 역할 블록 안에 있어야 그 배포에서 돈다.
    const authzBlock = WORKER_INDEX.slice(WORKER_INDEX.indexOf("roles.includes('authz')"));
    expect(authzBlock).toContain('startOrgTeamSweeper(');
  });

  it('**그 역할의 매니페스트가 실재한다** — 배포되지 않는 역할에 기능을 얹지 않는다 (DEV-304·305)', () => {
    expect(existsSync(new URL('deploy/k8s/pipeline-worker-authz.yaml', new URL('..', import.meta.url)))).toBe(true);
  });

  it('**투영이 작성자 팀을 판정한다** — 부르지 않으면 필드가 영영 비어 있다', () => {
    expect(PROJECT).toContain("from './author-teams.js'");
    expectOrder(codeOf(PROJECT), 'resolveAuthorTeam(', 'buildUpsertRequests({');
    expect(codeOf(PROJECT)).toContain('authorTeams,');
  });

  it('**투영은 GHE를 쓰지 않는다** — 접근 범위와 같은 모양으로 PostgreSQL만 읽는다', () => {
    expect(PROJECT).not.toContain('GitHubClient');
    expect(codeOf(PROJECT)).not.toContain('syncOrgTeamsIfStale');
  });

  it('**백필은 잡 시작에 조직 팀을 갱신한 뒤 투영한다** — 순서가 뒤집히면 옛 소속을 다시 박는다', () => {
    const code = codeOf(BACKFILL);
    expectOrder(code, 'syncOrgTeamsIfStale(', 'resolveAuthorTeam(');
    expectOrder(code, 'resolveAuthorTeam(', 'buildUpsertRequests({');
  });

  it('**재색인은 정본에서 다시 계산하고 GHE를 부르지 않는다** (ADR-004, DEV-485)', () => {
    expect(REINDEX).toContain('resolveAuthorTeams(');
    expect(REINDEX).not.toContain('syncOrgTeamsIfStale');
    expect(REINDEX).not.toContain('GitHubClient');
    // 스냅숏이 실어 온 옛 값을 **명시적으로** 지운다.
    expect(codeOf(REINDEX)).toContain("delete doc['author_team_ids']");
  });

  it('**모름은 필드를 지운다** — 부재로 판정하는 필드는 부재를 만들 수 있어야 한다 (DEV-484)', () => {
    const code = codeOf(DOCUMENTS);
    expect(code).toContain("authorTeams.kind === 'unknown' ? ['author_team_ids'] : []");
    expectOrder(code, 'const removed = [', 'remove: removed');
  });

  it('**작성자를 모르면 소속도 모름이다** — 호출부의 값보다 이 판정이 먼저다 (DEV-487)', () => {
    const code = codeOf(DOCUMENTS);
    expectOrder(code, "pr?.author == null", 'source.authorTeams');
  });

  it('**`allowed_team_ids`와 다른 필드에 쓴다** — 접근 권한을 성과로 읽지 않는다 (DEV-382)', () => {
    const code = codeOf(DOCUMENTS);
    expect(code).toContain("doc['author_team_ids'] =");
    expect(code).toContain('allowed_team_ids: [...repository.allowed_team_ids]');
  });

  it('**동기화가 조회한 팀을 레지스트리에 등재한다** — 하지 않으면 slug 해석이 빈다 (DEV-483)', () => {
    const code = codeOf(MEMBERSHIP_REPO);
    expectOrder(code, 'upsertTeam(pool', 'DELETE FROM team_membership');
    expectOrder(code, 'INSERT INTO team_membership', 'INSERT INTO org_team_sync');
  });

  it('**등재를 트랜잭션 밖에서 한다** — 23505 재시도가 중단된 트랜잭션 안에서는 성립하지 않는다', () => {
    /*
     * `upsertTeam`은 `(org_id, slug)` 충돌을 **한 번 다시 시도해** 넘긴다 — 그 사이
     * 상대가 커밋해 행이 존재한다는 전제다. 트랜잭션 안에서는 오류가 트랜잭션을
     * 중단시키므로 그 재시도가 25P02로 다시 실패하고, **회복 가능한 경합이 동기화
     * 전체의 실패가 된다.** 저장소 팀 동기화가 같은 표에 다른 잠금 아래에서 쓰므로
     * 그 경합은 실재한다 — 조직 잠금은 이쪽 경로끼리만 줄을 세운다.
     */
    const code = codeOf(MEMBERSHIP_REPO);
    expectOrder(code, 'upsertTeam(pool', 'withTransaction(pool');
    expect(code, '잠긴 클라이언트로 등재하면 재시도가 성립하지 않는다').not.toContain('upsertTeam(client');
  });

  it('**동기화 시각을 같은 트랜잭션에서 찍는다** — 실패한 조직이 신선해 보이면 모름이 빈 배열이 된다', () => {
    const code = codeOf(MEMBERSHIP_REPO);
    expect(code).toContain('withTransaction(pool');
    expectOrder(code, 'withTransaction(pool', 'INSERT INTO org_team_sync');
  });

  it('**낡음 판정이 조회 앞에 온다** — 낡았으면 표를 읽지 않고 모름이다 (DEV-486)', () => {
    const code = codeOf(AUTHOR_TEAMS);
    expectOrder(code, 'findOrgSyncedAt(deps.pool, orgId)', 'findAuthorTeamIds(deps.pool, orgId, named)');
    expect(code).toContain('AUTHOR_TEAMS_UNKNOWN');
  });

  it('**잠금을 얻은 뒤 신선도를 다시 본다** — 기다리는 동안 상대가 끝냈으면 두 번 훑지 않는다', () => {
    const code = codeOf(AUTHOR_TEAMS);
    expectOrder(code, 'acquireAdvisorySessionLock(client, orgTeamSyncLockKey', 'readOrgTeams(github, org.owner)');
    // 잠금 뒤에도 신선도 확인이 한 번 더 있다.
    const afterLock = code.slice(code.indexOf('acquireAdvisorySessionLock(client, orgTeamSyncLockKey'));
    expect(afterLock).toContain('findOrgSyncedAt');
  });

  it('**채번 락·저장소 범위 락과 다른 키를 쓴다** — 조직 동기화가 다른 일을 밀어내지 않는다', () => {
    const LOCKS = read('packages/db/src/advisory-lock.ts');
    expect(LOCKS).toContain('export function orgTeamSyncLockKey');
    expect(LOCKS).toContain('`org:teams:${String(orgId)}`');
  });

  it('**계약의 두 자리가 같은 사실을 말한다** — 하나만 갱신하면 읽는 쪽이 어느 것이 사실인지 모른다 (DEV-488)', () => {
    /*
     * `WP-069`가 `author_team_ids`를 채운 뒤, 계약 3장의 검색 키 표와 4장의
     * `API-STAT-001` 절이 **같은 필드를 서로 다르게 설명하고 있었다.** 한쪽만
     * 고친 것이 원인이며, 리뷰가 잡았다.
     *
     * 문자열 검사라 정교하지 않다. 그래도 **"둘 중 하나만 갱신했는데 아무 시험도
     * 안 죽는 상태"보다는 낫다** — 그 상태가 이 DEV의 원인이었다.
     */
    const CONTRACTS = read('docs/30_technical_architecture/pr_search_api_contracts.md');
    const lines = CONTRACTS.split('\n');

    const keyRow = lines.find((line) => line.startsWith('| `author_team` |'));
    expect(keyRow, '검색 키 표에 `author_team` 행이 없다').toBeDefined();
    expect(keyRow).toContain('WP-069');
    expect(keyRow).not.toContain('투영이 아직 채우지 않');

    const analytics = lines.find((line) => line.includes('`author_team_ids`는'));
    expect(analytics, '집계 절에 `author_team_ids` 설명이 없다').toBeDefined();
    expect(analytics).toContain('WP-069');
    expect(analytics).not.toContain('투영이 채우지 않는다');
  });

  it('**마이그레이션 021이 실재하고 되돌릴 수 있다**', () => {
    const dir = new URL('packages/db/migrations/', new URL('..', import.meta.url));
    const files = readdirSync(dir);
    expect(files).toContain('021_author_team.up.sql');
    expect(files).toContain('021_author_team.down.sql');
  });
});

/**
 * **첫 사내 반입(2026-09-07)이 드러낸 것** (`CR-066` / `DEV-548`~`DEV-553`).
 *
 * 이 절이 재는 것은 전부 **외부에서는 초록이었다.** 단위·통합·회귀가 다 통과했고
 * 스모크도 통과했다. 그런데 사내에 세우자 웹 화면이 전부 500이었고, 웹훅은 404
 * 다음에 시간 초과였고, 받기 시작하자 저장에서 거부됐다.
 *
 * 공통점이 하나 있다. **개발 트리와 배포 트리가 다른 것을 하는 자리**이거나,
 * **문서가 코드와 다른 값을 적은 자리**였다. 둘 다 실행하지 않으면 보이지 않으므로,
 * 여기서는 그 둘이 같은 말을 하는지를 소스에서 직접 잰다.
 */
describe('첫 사내 반입이 드러낸 계약 (CR-066)', () => {
  const RUNBOOK = read('deploy/single-host/RUNBOOK.md');
  const ENV_EXAMPLE = read('deploy/single-host/.env.example');
  const COMPOSE = read('deploy/single-host/compose.yml');
  const PRSCTL = read('deploy/single-host/prsctl');
  const DOCKERFILE = read('Dockerfile');
  const GATEWAY = read('apps/ingest-gateway/src/server.ts');
  const GH_CONFIG = read('packages/github/src/config.ts');

  /**
   * **런북이 적는 웹훅 주소는 코드가 여는 경로여야 한다** (`DEV-549`).
   *
   * 런북이 `/api/v1`을 빼고 적어 첫 반입의 웹훅이 전부 404였다. 문자열을 박아 두면
   * 코드가 옮겨갈 때 같은 일이 다시 나므로, **코드에서 읽어 문서와 대조한다.**
   */
  it('런북의 웹훅 주소가 `WEBHOOK_PATH`와 같다', () => {
    const declared = /export const WEBHOOK_PATH = '([^']+)'/.exec(GATEWAY)?.[1];
    expect(declared, '게이트웨이가 `WEBHOOK_PATH`를 선언하지 않는다').toBeDefined();
    expect(declared).toBe('/api/v1/webhooks/github');

    const registration = RUNBOOK.split('\n').filter((line) => line.includes('웹훅을 등록한다'));
    expect(registration.length, '런북에 웹훅 등록 단계가 없다').toBeGreaterThan(0);
    for (const line of registration) {
      expect(line, `런북의 웹훅 주소가 코드의 경로와 다르다: ${line}`).toContain(declared as string);
    }
    // 옛 주소가 어디에도 남아 있으면 안 된다 — 한 곳만 고치면 다른 곳이 사람을 오도한다.
    expect(RUNBOOK).not.toMatch(/[^1]\/webhooks\/github/);
  });

  /**
   * **웹훅이 오지 않는 것과 서명이 틀린 것은 다른 문제다** (`DEV-550`).
   *
   * 백필은 아웃바운드, 웹훅은 인바운드다. 그 방향 차이를 런북이 말하지 않으면
   * 운영자가 시간 초과를 서명·경로 문제로 오진한다.
   */
  it('런북이 웹훅 인바운드가 막힌 경우를 다룬다', () => {
    expect(RUNBOOK).toContain('GHE가 서버에 닿지 못할 때');
    // 방향이 반대라는 것이 이 절의 요지다.
    expect(RUNBOOK).toMatch(/백필 \| 서버 → GHE/);
    expect(RUNBOOK).toMatch(/웹훅 \| GHE → 서버/);
    // 경유를 택할 때 지켜야 할 셋이 모두 있어야 한다.
    expect(RUNBOOK).toContain('X-Hub-Signature-256');
    expect(RUNBOOK).toContain('기존 웹훅을 고쳐 쓰지 않는다');
    expect(RUNBOOK).toContain('이 저장소 밖에 산다');
  });

  /**
   * **anchor는 얕게 합쳐진다** (`DEV-552`).
   *
   * `x-worker-base`에만 CA를 걸면 자기 `volumes`를 가진 워커 셋에는 닿지 않는다.
   * compose에서 그 셋을 **직접 세어** 런북의 안내가 실제 구조와 맞는지 확인한다 —
   * 새 워커가 자기 볼륨을 갖는 순간 이 시험이 그것을 알린다.
   */
  it('anchor를 덮어쓰는 워커를 런북이 빠짐없이 적는다', () => {
    const overriding = [...COMPOSE.matchAll(/^ {2}(worker-[a-z]+):$/gm)]
      .map(([, name]) => name)
      .filter((name) => {
        const body = COMPOSE.slice(COMPOSE.indexOf(`\n  ${name}:\n`));
        const service = body.slice(0, body.indexOf('\n\n') + 1 || undefined);
        return /^ {4}volumes:$/m.test(service);
      });

    expect(overriding, 'anchor를 덮는 워커가 하나도 없다 — 구조가 바뀌었다').not.toHaveLength(0);

    // **절 제목에서 자른다** (CR-091). 같은 낱말이 5장 표에도 있어 첫 등장부터 자르면, 그 사이에 다른 `bash` 블록
    // (6장 「운영 역할 지정하기」)이 생기는 순간 엉뚱한 블록을 확인 명령으로 읽는다.
    const heading = RUNBOOK.indexOf('#### 2단계의 함정 — anchor는 얕게 합쳐진다');
    expect(heading, 'anchor 절 제목이 없다').toBeGreaterThan(-1);
    const section = RUNBOOK.slice(heading);
    // **표의 그 행에서 잰다.** 문서 어딘가에 이름이 있다는 것으로는 부족하다 —
    // 「개별로 더한다」고 지시하는 행에 빠져 있으면 운영자가 그 서비스를 건너뛴다.
    const row = section.split('\n').find((line) => line.includes('개별로 더한다'));
    expect(row, '개별 마운트를 지시하는 행이 없다').toBeDefined();
    // 확인 명령도 같은 목록을 돌아야 한다 — 한쪽만 고치면 점검이 그 서비스를 지나친다.
    // **코드 블록만 본다.** 뒤에 오는 산문에 같은 이름이 있어 구간을 넓게 잡으면
    // 목록에서 빠진 서비스를 놓친다 (변이로 확인했다).
    const fence = section.indexOf('```bash');
    expect(fence, '확인 명령 블록이 없다').toBeGreaterThan(-1);
    const check = section.slice(fence, section.indexOf('```', fence + 7));
    expect(check).toContain('NODE_EXTRA_CA_CERTS');
    for (const name of overriding) {
      expect(row, `${name}이 자기 volumes를 갖는데 런북의 지시 행에 없다`).toContain(name);
      expect(check, `${name}이 런북의 확인 명령에 없다`).toContain(name);
    }
  });

  /**
   * **배포 트리는 선택 의존성을 담지 않는다** (`DEV-551`).
   *
   * Turbopack이 외부화한 해시 이름을 실체화하지 않으면 모든 SSR이 500이다.
   * 개별 문구가 아니라 **불변식**을 고정한다 — 배포 단계가 실체화를 부른다.
   */
  it('web 배포 단계가 외부 모듈을 실체화한다', () => {
    const stage = DOCKERFILE.slice(DOCKERFILE.indexOf('FROM build AS deploy-web'));
    const body = stage.slice(0, stage.indexOf('\nFROM '));
    expect(body).toContain('materialize-turbopack-externals.mjs');
    // `pnpm deploy` 뒤여야 한다 — 앞이면 지워질 트리에 만든다.
    expect(body.indexOf('pnpm deploy')).toBeLessThan(body.indexOf('materialize-turbopack-externals.mjs'));

    const script = read('scripts/materialize-turbopack-externals.mjs');
    // **찾지 못하면 조용히 지나가지 않는다.** 그것이 이 결함의 재발 경로다.
    // 종료가 있는지가 아니라 **`names.size === 0` 갈래가 종료하는지**를 잰다 —
    // 파일 어딘가에 종료가 있다는 것으로는 이 계약이 지켜지는지 알 수 없다.
    const emptyBranch = script.slice(script.indexOf('if (names.size === 0)'));
    expect(emptyBranch.slice(0, emptyBranch.indexOf('\n}')), '이름을 찾지 못했을 때 종료하지 않는다').toContain(
      'process.exit(1)',
    );
    // **이름을 박아 두지 않는다** — 해시는 빌드마다 달라질 수 있다. 주석이 실제로
    // 본 이름을 근거로 적는 것은 옳으므로, 주석을 걷어 낸 코드만 본다 (DEV-427의 선례).
    const code = script
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/-[0-9a-f]{16}['"`]/);
  });

  it('WP-072: pipeline-worker 이미지가 미러와 커밋 그래프에 필요한 git을 포함한다 (DEV-572)', () => {
    const start = DOCKERFILE.indexOf('FROM base AS pipeline-worker');
    expect(start).toBeGreaterThan(-1);
    const stage = DOCKERFILE.slice(start, DOCKERFILE.indexOf('\nFROM ', start + 1));
    expect(stage).toContain('RUN apk add --no-cache git');
    expect(stage.indexOf('apk add --no-cache git')).toBeLessThan(stage.indexOf('COPY --from=deploy-pipeline-worker'));
  });

  /**
   * **`.env`의 `KEY=`는 미설정이 아니라 빈 문자열이다** (`DEV-548`).
   *
   * 환경에서 URL을 읽는 자리가 `??`만 쓰면 빈 값이 그대로 URL이 된다.
   */
  it('GHE 설정이 빈 문자열을 기본값으로 되돌린다', () => {
    const resolver = GH_CONFIG.slice(GH_CONFIG.indexOf('export function resolveGitHubConfig'));
    const body = resolver.slice(0, resolver.indexOf('\n}'));
    expect(body).toContain('withBlankFallback');
    // 옛 형태로 되돌아가면 잡는다.
    expect(body).not.toMatch(/env\['GHE_(BASE|API)_URL'\] \?\?/);
  });

  /**
   * **파티션이 소진되면 수신이 통째로 막힌다** (`DEV-553`).
   *
   * `.env.example`이 이 값을 "없으면 보존 잡만 안 선다"로만 안내하면, 채우지 않은
   * 배포가 웹훅을 하나도 저장하지 못한 채 뜬다 — 첫 반입에서 실제로 그랬다.
   */
  it('`ADMIN_DATABASE_URL`의 안내가 실제 대가를 말한다', () => {
    const section = ENV_EXAMPLE.slice(0, ENV_EXAMPLE.indexOf('\nADMIN_DATABASE_URL='));
    const note = section.slice(section.lastIndexOf('# `JOB-AUD-001`'));
    // 대가를 말하는 것이 이 시험의 계약이다 — "보존 잡만 안 선다"로는 부족하다.
    expect(note).toContain('store_failed');
    // **"손으로 만든다"는 더 이상 요구하지 않는다** (`DEV-556`이 강제 경로로 옮겼다).
    // 옛 문구를 계속 요구하면 이 시험이 틀린 계약을 굳힌다 — 갱신하되 느슨하게 만들지
    // 않는다. 대신 값이 강제된다는 사실을 잰다.
    expect(note).toContain('필수 값이다');
    // 8장이 그 증상에서 이 값으로 안내해야 한다.
    expect(RUNBOOK).toMatch(/store_failed[\s\S]{0,300}ADMIN_DATABASE_URL/);
  });

  /**
   * **7장은 하지 않은 것을 했다고 적지 않는다.**
   *
   * 반입이 성공했다고 표 전체를 통과로 바꾸면 그 표가 쓸모를 잃는다. 그날 실제로
   * 재지 못한 셋은 `NOT RUN`으로 남아야 한다.
   */
  it('7장이 실행한 것과 실행하지 못한 것을 가른다', () => {
    const table = RUNBOOK.slice(RUNBOOK.indexOf('| 사내 위치에서 github.com 도달'));
    const section = table.slice(0, table.indexOf('\n\n## '));
    expect(section).toContain('VERIFIED (internal)');
    for (const stillOpen of ['실제 사내 OIDC와 그룹 클레임', 'ACC-06']) {
      const row = section.split('\n').find((line) => line.includes(stillOpen));
      expect(row, `${stillOpen} 행이 없다`).toBeDefined();
      expect(row, `${stillOpen}을 실행하지 않았는데 통과로 적었다`).toContain('NOT RUN');
    }
  });

  /**
   * **다음 반입이 같은 진단을 반복하지 않게 한다.**
   *
   * 사내에서 만든 것 중 번들이 덮는 것과 덮지 않는 것을 5장이 갈라 적어야 한다.
   */
  it('5장이 첫 반입의 다운스트림 형상을 적는다', () => {
    const section = RUNBOOK.slice(RUNBOOK.indexOf('첫 반입(2026-09-07)이 만든 것'));
    expect(section.slice(0, section.indexOf('\n---'))).toContain('prs_retention');
    for (const item of ['`.env`', 'CA 마운트', '웹훅 경유 경로']) {
      expect(section, `${item} 행이 없다`).toContain(item);
    }
  });

  it('WP-072: 업그레이드는 load 뒤 CA 일곱 자리를 복원하고 upgrade한다 (DEV-571)', () => {
    expect(PRSCTL).toMatch(/load\)\s+cmd_verify; cmd_load/);
    const upgrade = RUNBOOK.slice(RUNBOOK.indexOf('### 업그레이드'), RUNBOOK.indexOf('\n---', RUNBOOK.indexOf('### 업그레이드')));
    expect(upgrade).toContain('load 완료 → compose.yml 수정 → upgrade');
    expect(upgrade.indexOf('./prsctl verify && ./prsctl load')).toBeLessThan(upgrade.indexOf('compose.yml을 새 번들이 덮어쓰므로'));
    expect(upgrade.indexOf('compose.yml을 새 번들이 덮어쓰므로')).toBeLessThan(upgrade.indexOf('./prsctl upgrade'));

    const ca = RUNBOOK.slice(RUNBOOK.indexOf('anchor는 얕게 합쳐진다'));
    expect(ca).toContain('CA를 거는 자리는 **일곱 곳**');
    expect(ca).toContain('`ingest-gateway`');
    expect(RUNBOOK).toContain('checksum 불일치로 거부된다 (`DEV-571`)');
  });
});

/**
 * **제품 스타일시트가 모션을 만들지 않는다** (`DEV-555` / `CR-068`).
 *
 * `CR-064`가 파생 토큰 문서 §9를 좁힐 때 근거로 든 것은 "`apps/web`에 CSS 파일이
 * 0건"이라는 당시의 사실이었다. `CR-067`이 `workbench.css`를 들이면서 그 근거가
 * 깨졌는데 문장은 남아 **한 문서가 스스로와 어긋났다** — `DEV-546`이 런북에서 겪은
 * 것과 같은 형태다.
 *
 * 그래서 여기서는 근거가 아니라 **불변식**을 잰다. 제품 CSS가 몇 개든, 그 안에
 * 전환·애니메이션 선언이 없어야 한다. 파일이 늘어나도 이 시험은 따라간다.
 */
describe('제품 스타일시트가 모션을 만들지 않는다 (DEV-555)', () => {
  /**
   * **`apps/web` 전체를 재귀로 훑는다.** 처음에는 `apps/web/app`의 직계 자식만 셌는데,
   * 그러면 라우트 지역 스타일시트(`app/search/results.css`)나 `components/` 아래의 것이
   * 검사를 통과하며 전환을 선언할 수 있다 — "파일이 늘어나도 따라간다"는 이 절의 주장이
   * 거짓이 되는 자리다 (`PR #152` 머지 후 리뷰).
   */
  const collectStyles = (dir: string): string[] => {
    const entries = readdirSync(new URL(`${dir}/`, new URL('..', import.meta.url)), {
      withFileTypes: true,
    });
    return entries.flatMap((entry) => {
      // 생성물과 의존성은 제품 소스가 아니다.
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
      if (entry.isDirectory()) return collectStyles(`${dir}/${entry.name}`);
      return entry.name.endsWith('.css') ? [`${dir}/${entry.name}`] : [];
    });
  };
  const productStyles = collectStyles('apps/web');

  it('제품 CSS에 전환·애니메이션 선언이 없다 — 모션은 Conductor가 소유한다', () => {
    for (const path of productStyles) {
      const name = path;
      const css = read(path)
        // 주석은 걷어 낸다. 규칙을 설명하는 문장이 그 규칙을 어겼다고 세지 않는다.
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, `${name}이 transition을 선언한다`).not.toMatch(/(^|[;{\s])transition(-[a-z]+)?\s*:/);
      expect(css, `${name}이 animation을 선언한다`).not.toMatch(/(^|[;{\s])animation(-[a-z]+)?\s*:/);
      expect(css, `${name}이 @keyframes를 정의한다`).not.toContain('@keyframes');
    }
  });

  it('§9가 사라진 근거를 다시 주장하지 않는다', () => {
    const tokens = read('docs/20_derived_ui_specs/pr_search_design_system_tokens.md');
    // 제품 CSS가 실재하는 동안 "0건"이라고 적으면 그것이 문서 결함이다.
    if (productStyles.length > 0) {
      expect(tokens, '§9가 아직 "CSS 파일이 0건"을 근거로 든다').not.toContain('CSS 파일이 0건');
    }
    // 규칙 자체는 남아 있어야 한다 — 근거를 고치면서 결론까지 지우지 않는다.
    expect(tokens).toContain('제품에서 별도 애니메이션을 추가하지 않는다');
  });
});

/**
 * **파티션을 만드는 주체가 강제 경로에 있다** (`DEV-556` / `CR-069`).
 *
 * `DEV-553`의 처방은 `.env.example`의 주석이었다. **주석은 강제하지 않는다** — 새로
 * 설치하면 그 값이 빈 채로 모든 관문을 통과하고, 파티션이 소진되는 순간 모든 웹훅이
 * 저장에서 거부된다. 게이트의 존재가 아니라 **위치**가 실패의 대가를 정한다는 것을
 * 이 저장소가 세 번째로 겪은 자리다(`DEV-524` → `DEV-544` → 여기).
 */
describe('파티션 수명 주체가 강제 경로에 있다 (DEV-556)', () => {
  const PRSCTL = read('deploy/single-host/prsctl');
  const RUNBOOK = read('deploy/single-host/RUNBOOK.md');
  const ENV_EXAMPLE = read('deploy/single-host/.env.example');

  it('`require_env`가 `ADMIN_DATABASE_URL`을 필수로 센다', () => {
    const fn = PRSCTL.slice(PRSCTL.indexOf('require_env() {'));
    const loop = fn.slice(fn.indexOf('for key in'), fn.indexOf('; do'));
    expect(loop, '필수 키 목록에 ADMIN_DATABASE_URL이 없다').toContain('ADMIN_DATABASE_URL');
  });

  it('롤 프로비저닝이 `install`·`upgrade`·`restore` 셋 모두에 있다', () => {
    // **접속 주체와 같은 자리여야 한다.** 하나라도 빠지면 그 경로로 복구한 설치에서
    // 잡이 서지 못하고, 그 사실은 파티션이 소진될 때까지 드러나지 않는다.
    const appCalls = PRSCTL.match(/^ {2}provision_app_role$/gm) ?? [];
    const retentionCalls = PRSCTL.match(/^ {2}provision_retention_role$/gm) ?? [];
    expect(appCalls.length, 'provision_app_role 호출이 셋이 아니다 — 구조가 바뀌었다').toBe(3);
    expect(retentionCalls.length).toBe(appCalls.length);
    // 마이그레이션 뒤여야 한다 — `prs_admin`은 마이그레이션이 만든다.
    for (const cmd of ['cmd_install()', 'cmd_upgrade()', 'cmd_restore()']) {
      const body = PRSCTL.slice(PRSCTL.indexOf(cmd));
      const scope = body.slice(0, body.indexOf('\n}\n'));
      expect(scope.indexOf('run --rm migrate'), `${cmd}에 마이그레이션이 없다`).toBeGreaterThan(-1);
      expect(
        scope.indexOf('provision_retention_role'),
        `${cmd}에서 롤 생성이 마이그레이션보다 앞이다`,
      ).toBeGreaterThan(scope.indexOf('run --rm migrate'));
    }
  });

  it('퍼센트 인코딩된 비밀번호를 거부한다 — 조용히 틀린 롤을 만들지 않는다', () => {
    const fn = PRSCTL.slice(PRSCTL.indexOf('provision_retention_role() {'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/case "\$pw" in \*%\*\)/);
    // `prs_admin` 직접 접속도 막는다 — NOLOGIN 그룹 롤이다.
    expect(body).toContain("'prs_admin'");
  });

  it('문서가 강제 경로와 같은 말을 한다', () => {
    // 런북의 필수 값 목록은 `require_env`를 옮겨 적은 것이다 — 한쪽만 고치면 어긋난다.
    const list = RUNBOOK.slice(RUNBOOK.indexOf('**`prsctl`이 요구하는 필수 값**'));
    const fenceStart = list.indexOf('```text');
    const block = list.slice(fenceStart, list.indexOf('```', fenceStart + '```text'.length));
    // **부분 문자열로 재지 않는다.** `ADMIN_DATABASE_URL_X`도 통과하던 자리다(변이로 확인).
    // 키 이름이 줄 첫머리에 그대로 있어야 한다 — `require_env`가 세는 것과 같은 이름이다.
    expect(
      block.split('\n').some((line) => /^ADMIN_DATABASE_URL(\s|$)/.test(line)),
      '런북의 필수 값 블록에 ADMIN_DATABASE_URL 행이 없다',
    ).toBe(true);
    // 옛 처방(손으로 만든다)이 남아 있으면 안 된다.
    expect(RUNBOOK).not.toContain('이 롤은 **마이그레이션이 만들지 않으므로**');
    expect(ENV_EXAMPLE).not.toContain('복구나 재구축 뒤에는 손으로 다시');
  });
});

/**
 * 초록이 거짓말하지 못하게 한다 (`CR-078` / `DEV-577`).
 *
 * ## 이 계층이 무엇을 잡고 무엇을 잡지 못하는가
 *
 * `0.1.0-pilot.3`은 **아래를 전부 통과하고** 사내에서 막혔다.
 *
 *   단위·통합·회귀 시험 통과 → `next build` 성공 → `docker build` 성공
 *   → 컨테이너 healthcheck 통과 → **사람이 여는 화면은 전부 500**
 *
 * 그 다섯 중 어느 것도 "실제 이미지가 실제 SSR 요청을 처리하는가"를 묻지
 * 않았다. 그 질문은 **컨테이너를 띄워야만** 물을 수 있으므로 산출물 게이트
 * (`deploy/single-host/smoke-images.sh`)가 릴리스 시점에 묻는다.
 *
 * 이 파일이 하는 일은 다르다: **그 게이트가 릴리스 경로에서 사라지지 않게
 * 하는 것**과, 게이트가 묻는 질문의 목록이 조용히 줄어들지 않게 하는 것이다.
 * 게이트를 지우면 여기서 죽고, 게이트의 질문 하나를 지워도 여기서 죽는다.
 *
 * **판정 자체는 여기서 재지 않는다.** 소스를 문자열로 읽는 검사는 「토큰은
 * 남기고 로직을 뒤집는」 변이를 놓친다 — 적대적 검토가 실제로 그렇게 통과시켰다.
 * 그래서 판정은 실행으로 잰다:
 *
 *   `apps/web/instrumentation.test.ts`      기동 검증이 실제로 종료를 요청하는가
 *   `apps/web/app/healthz/route.test.ts`    헬스체크가 실제로 5xx를 내는가
 *   `apps/web/lib/server/config.test.ts`    판정이 실제로 이유를 돌려주는가
 *   `packages/authz/src/config.test.ts`     계약과 배포 문서가 같은 말을 하는가
 *   `deploy/single-host/smoke-images.sh`    실제 이미지가 실제 요청을 처리하는가
 */
describe('초록이 거짓말하지 못한다 (CR-078)', () => {
  const INSTRUMENTATION = read('apps/web/instrumentation.ts');
  const HEALTHZ = read('apps/web/app/healthz/route.ts');
  const WEB_CONFIG = read('apps/web/lib/server/config.ts');
  const SMOKE = read('deploy/single-host/smoke-images.sh');
  const BUILD_BUNDLE = read('deploy/single-host/build-bundle.sh');
  const RUNBOOK_078 = read('deploy/single-host/RUNBOOK.md');

  /**
   * **적힌 의도를 실제로 이행한다.**
   *
   * `resolveSessionReaderConfig`의 주석도 `playwright.config.ts`의 주석도
   * 원장의 검증 표도 「운영에서 false면 **기동을 막는다**」고 적고 있었다.
   * 실제로는 요청마다 던졌을 뿐이라 컨테이너가 초록으로 섰다.
   */
  it('web이 기동 시점에 구성을 편다', () => {
    expect(INSTRUMENTATION, 'instrumentation이 register를 내보내지 않는다').toMatch(
      /export\s+(?:async\s+)?function\s+register\s*\(/,
    );
    /*
     * 판정은 한 곳에서 온다 — 기동과 헬스체크가 각자 판정하면 갈라진다.
     * **부르는지를 잰다**: 이름만 남기고 `null`을 대입하는 변이가 이름 검사를
     * 그대로 통과했다.
     */
    expect(INSTRUMENTATION, '기동 검증이 구성 판정을 부르지 않는다').toMatch(
      /=\s*webConfigFailure\s*\(/,
    );
    expect(WEB_CONFIG).toMatch(/export function webConfigFailure\s*\(/);
  });

  /**
   * **`throw`로는 막지 못한다.** 재 보았다: Next 16.3.1의 production 서버는
   * `NextServer.prepare()`에서 진짜 준비를 await하지 않고 `.catch`로 로그만
   * 남기므로, `register()`가 던져도 **프로세스가 살아서 모든 요청에 500을
   * 낸다** — 고치려던 바로 그 모양이다. 종료만이 이 계약을 이행한다.
   *
   * 그래서 "파일 어딘가에 종료가 있는가"가 아니라 **실패 갈래가 종료하는가**를
   * 잰다 (`DEV-427`·`DEV-551`이 세운 선례).
   */
  it('구성이 성립하지 않으면 프로세스를 종료한다 — 던지기만 하지 않는다', () => {
    const marker = 'if (failure === null) return;';
    expect(INSTRUMENTATION, '실패 갈래를 가르는 조기 반환이 없다').toContain(marker);
    const failureBranch = INSTRUMENTATION.slice(INSTRUMENTATION.indexOf(marker) + marker.length);
    expect(failureBranch, '구성이 성립하지 않는 갈래가 프로세스를 종료하지 않는다').toMatch(/\.exit\??\.?\(1\)/);
    // 이유를 남기지 않으면 운영자가 `docker logs`를 열어도 알 수 없다.
    expect(failureBranch).toContain('failure');
  });

  /**
   * **헬스체크가 구성을 본다.**
   *
   * 옛 핸들러는 아무것도 읽지 않고 늘 `ok`를 냈다. 그래서 Docker가 `healthy`를
   * 보고하는 동안 모든 화면이 500이었고, 운영자는 컨테이너가 정상이므로 원인을
   * 다른 곳에서 찾았다.
   */
  it('/healthz가 구성 판정을 읽고 실패를 5xx로 낸다', () => {
    const fn = HEALTHZ.slice(HEALTHZ.indexOf('export function GET('));
    /*
     * **부르는지를 잰다.** 이름이 파일 어딘가에 있는 것으로는 판정이 응답을
     * 좌우한다고 말할 수 없다 — `webConfigFailure`를 import한 채 `null`을
     * 대입하는 변이가 그 시험을 그대로 통과했다.
     */
    const call = /const\s+(\w+)\s*=\s*webConfigFailure\(/.exec(fn);
    expect(call, 'GET이 구성 판정을 부르지 않는다').not.toBeNull();
    const bound = (call as RegExpExecArray)[1] as string;

    // 5xx가 **그 결과에 걸려** 있어야 한다. 죽은 갈래에 있으면 초록이 다시 거짓말한다.
    const guard = fn.indexOf(`if (${bound} !== null)`);
    expect(guard, '판정 결과로 갈래를 가르지 않는다').toBeGreaterThan(-1);
    const branch = fn.slice(guard, fn.indexOf('\n  }', guard));
    expect(branch, '판정이 실패해도 5xx를 내지 않는다').toMatch(/status:\s*5\d\d/);

    // 값을 반사하면 호스트 포트에 노출된다 — 이유는 로그로만 간다 (NFR-005).
    expect(branch, '판정 문구를 응답 본문에 싣는다').not.toMatch(/reason:\s*\w/);
  });

  /**
   * **게이트가 릴리스 경로에 있다.**
   *
   * 순서가 계약이다: `docker save` **뒤**여야 tar을 건넌 이미지를 검사하고,
   * 운반 아카이브 **앞**이어야 통과하지 못한 이미지로 반입 파일을 만들지 않는다.
   */
  it('번들 빌드가 이미지 런타임 검사를 거친다', () => {
    const call = BUILD_BUNDLE.indexOf('smoke-images.sh');
    expect(call, 'build-bundle.sh가 이미지 런타임 검사를 부르지 않는다').toBeGreaterThan(-1);
    const save = BUILD_BUNDLE.indexOf('docker save');
    const archive = BUILD_BUNDLE.indexOf('tar -czf');
    expect(save, 'docker save가 없다').toBeGreaterThan(-1);
    expect(archive, '운반 아카이브 생성이 없다').toBeGreaterThan(-1);
    expect(save, '검사가 docker save보다 앞이다 — tar을 건넌 이미지를 보지 않는다').toBeLessThan(call);
    expect(call, '검사가 운반 아카이브 생성보다 뒤다 — 통과 못한 이미지로 반입 파일을 만든다').toBeLessThan(archive);
    // 실패가 빌드를 멈춰야 한다. 부르기만 하고 넘어가면 게이트가 아니다.
    const line = BUILD_BUNDLE.slice(call, BUILD_BUNDLE.indexOf('\n\n', call));
    expect(line, '검사 실패가 번들 생성을 멈추지 않는다').toContain('die');
    // 검사는 **tar을 인자로** 받아야 저장·적재 경계를 건넌다.
    expect(BUILD_BUNDLE.slice(call - 200, call + 200)).toContain('pr-search-app.tar');
  });

  /**
   * **게이트가 묻는 질문이 줄지 않는다.**
   *
   * 한 줄씩 지워도 게이트는 계속 초록이므로, 질문 목록 자체를 여기서 고정한다.
   */
  it('이미지 런타임 검사가 다섯 차원을 모두 본다', () => {
    // 1. `/healthz`만으로 판정하지 않는다 — 그것이 이 결함을 놓친 이유다.
    const ssr = /^SSR_PATHS='([^']+)'/m.exec(SMOKE)?.[1];
    expect(ssr, '대표 SSR 경로 목록이 없다').toBeDefined();
    const paths = (ssr as string).split(/\s+/).filter((one) => one !== '');
    expect(paths.length, '대표 SSR 화면이 너무 적다').toBeGreaterThanOrEqual(5);
    expect(paths, '헬스체크 경로만 본다').not.toEqual(['/healthz']);
    expect(paths).toContain('/');

    // 2. 해시 외부 모듈이 **런타임에 해석되는지** 본다 (DEV-551). 디렉터리
    //    존재가 아니라 해석이며, 이름은 `.next`의 추적 기록에서 읽는다.
    expect(SMOKE).toContain('nft.json');
    expect(SMOKE).toContain('require.resolve');
    // 이름을 박아 두지 않는다 — 해시는 빌드마다 달라질 수 있다.
    expect(SMOKE.replace(/^#.*$/gm, ''), '해시 이름이 박혀 있다').not.toMatch(/-[0-9a-f]{16}['"`]/);

    // 3. 잘못된 구성이 **죽는지** 본다. 멈추는 것은 통과가 아니다 (DEV-577).
    expect(SMOKE).toContain('SESSION_COOKIE_SECURE=false');
    // 같은 유형의 구성 하나 더 — 인증을 켰는데 자격 증명이 없는 경우 (DEV-579).
    expect(SMOKE, 'OIDC 불완전 구성의 거부를 재지 않는다').toContain('AUTH_ENABLED=true');
    expect(SMOKE, '거부 검사에 시간 제한이 없다 — 고치기 전 이미지는 죽지 않고 멈춘다').toMatch(/timeout .*docker run/);
    /*
     * **시간 초과 갈래가 실패시키는지 본다.** `124)`가 파일에 있다는 것만으로는
     * 부족하다 — 그 갈래를 통과로 바꾸면 죽지 않는(= 고치기 전) 이미지가 게이트를
     * 지나가는데 검사는 초록이었다(변이로 확인).
     */
    const timedOut = SMOKE.slice(SMOKE.indexOf('    124)'));
    expect(timedOut.slice(0, timedOut.indexOf(';;')), '시간 초과를 실패로 판정하지 않는다').toContain('die');

    // 4. worker의 git이 실제로 실행되는지 본다 (DEV-572).
    expect(SMOKE).toMatch(/--entrypoint git/);

    // 5. 손 조치가 필요한 상태로 반입되지 않는다.
    expect(SMOKE).toContain('package-lock.json');
  });

  /**
   * **게이트가 빌더의 환경에 기대지 않는다.**
   *
   * 백킹 서비스나 IdP가 있어야 도는 게이트는 빌더마다 답이 달라진다.
   * 그러면 게이트가 아니라 잡음이고, 잡음은 결국 꺼진다.
   */
  it('이미지 런타임 검사가 네트워크 없이 돈다', () => {
    const runs = [...SMOKE.matchAll(/docker run[^\n]*/g)].map(([one]) => one);
    expect(runs.length, 'docker run이 없다').toBeGreaterThan(0);
    for (const run of runs) {
      expect(run, `네트워크를 끊지 않는 실행이 있다: ${run}`).toContain('--network none');
    }
  });

  /**
   * **배포 정의가 인증 계약이 요구하는 키를 전부 넘긴다** (`DEV-579`).
   *
   * `resolveOidcConfig`가 요구하는 키를 **그 소스에서 읽어** compose가 `web`에
   * 넘기는 목록과 대조한다. 목록을 여기 옮겨 적지 않는 이유는 단순하다 —
   * 옮겨 적었다면 `OIDC_REDIRECT_URI`가 빠진 것을 못 잡았을 것이다. 실제로
   * 그 키는 계약에만 있고 `compose.yml`·`.env.example`·런북 어디에도 없어서,
   * 사내가 OIDC를 켜는 순간 모든 로그인이 500이 될 상태였다.
   */
  it('compose가 OIDC 계약이 요구하는 키를 web에 전부 넘긴다', () => {
    const contract = read('packages/authz/src/config.ts');
    const required = [...contract.matchAll(/required\(env, '([A-Z_]+)'\)/g)].map(([, key]) => key);
    expect(required.length, '계약이 요구하는 키를 읽지 못했다').toBeGreaterThan(0);
    expect(required, 'OIDC_REDIRECT_URI가 계약에서 사라졌다 — 이 시험의 전제가 바뀌었다').toContain(
      'OIDC_REDIRECT_URI',
    );

    const compose = read('deploy/single-host/compose.yml');
    const web = compose.slice(compose.indexOf('\n  web:\n'), compose.indexOf('\n  search-api:\n'));
    const example = read('deploy/single-host/.env.example');
    for (const key of required) {
      /*
       * **주석으로는 만족하지 않는다.** `KEY:` 부분 문자열만 보면 `# KEY: ...`
       * 주석 한 줄이 검사를 통과시킨다(변이로 확인). 실제 매핑 행이어야 한다 —
       * 줄 첫머리의 키와 `${KEY` 참조를 함께 본다.
       */
      const mapping = new RegExp(`^\\s+${key}:\\s*\\$\\{${key}`, 'm');
      expect(mapping.test(web), `compose가 web에 ${key}를 넘기지 않는다 — 인증을 켜면 로그인이 500이다`).toBe(true);
      expect(
        example.split('\n').some((line) => line.startsWith(`${key}=`)),
        `.env.example에 ${key} 행이 없다 — 운영자가 채워야 할 값을 모른다`,
      ).toBe(true);
    }
  });

  /**
   * **인증을 켰는데 자격 증명이 없으면 서지 않는다** (`DEV-579`).
   *
   * `DEV-577`과 같은 모양이다 — 컨테이너는 초록인데 사람의 경로가 막힌다.
   * 판정이 로그인 라우트가 실제로 부르는 함수를 부르는지 확인한다. 키 목록을
   * 옮겨 적으면 한쪽이 키를 더할 때 갈라진다.
   */
  it('구성 판정이 OIDC 계약을 로그인 라우트와 같은 함수로 잰다', () => {
    const login = read('apps/web/app/auth/login/route.ts');
    expect(login, '로그인 라우트가 resolveOidcConfig를 부르지 않는다').toMatch(/resolveOidcConfig\s*\(/);
    expect(WEB_CONFIG, '판정이 로그인 라우트와 다른 함수로 잰다').toMatch(/resolveOidcConfig\s*\(env\)/);
    // 키 이름을 판정 쪽에 옮겨 적으면 갈라진다.
    const judge = WEB_CONFIG.slice(WEB_CONFIG.indexOf('export function webConfigFailure'));
    expect(judge, '판정이 OIDC 키 이름을 직접 담는다 — 계약과 갈라진다').not.toMatch(/'OIDC_[A-Z_]+'/);
  });

  /**
   * **사내 스모크가 화면을 본다** (`DEV-577`).
   *
   * `prsctl smoke`는 「health가 아니라 실제 조회 왕복을 건다」는 규율로 세워졌는데
   * (`DEV-515`), `web`에 대해서는 `/healthz`만 봤다. 그래서 사내 업그레이드에서
   * 스모크가 통과하고도 사람이 여는 화면은 전부 500이었다 — 그 이미지와 그
   * 구성으로 실측했다: `/healthz` 200, `/` 500.
   *
   * **5xx만 거른다.** 인증을 켠 배포에서 진입 화면은 로그인으로 리다이렉트하는
   * 것이 정상이므로 200을 요구하면 정상 배포가 실패한다.
   */
  it('prsctl smoke가 web의 헬스체크만 보지 않는다', () => {
    const prsctl = read('deploy/single-host/prsctl');
    const smoke = prsctl.slice(prsctl.indexOf('cmd_smoke()'));
    const body = smoke.slice(0, smoke.indexOf('\n}\n'));

    // 진입 화면을 실제로 요청한다 — 헬스체크 경로가 아니다.
    expect(body, 'web의 진입 화면을 요청하지 않는다').toMatch(/127\.0\.0\.1:3000\/'/);
    // 5xx를 실패로 판정해야 한다.
    expect(body, '5xx를 실패로 판정하지 않는다').toMatch(/5\*\|''\)/);
    // 200을 요구하면 인증을 켠 배포가 리다이렉트 때문에 실패한다.
    const entry = body.slice(body.indexOf('사람이 여는 화면'));
    expect(entry.slice(0, entry.indexOf('엔티티 별칭')), '진입 화면에 200을 요구한다').not.toMatch(
      /entry" = 200|entry" != 200/,
    );
  });

  /**
   * **런북이 이번 증상을 안다.**
   *
   * 운영자가 실제로 본 화면은 "컨테이너는 전부 정상인데 웹만 500"이었다.
   * 그 문장으로 찾을 수 있어야 다음 반입에서 같은 시간을 쓰지 않는다.
   */
  it('런북이 이번 증상과 처방을 적는다', () => {
    const table = RUNBOOK_078.slice(RUNBOOK_078.indexOf('| 증상'));
    expect(table, '"정상인데 화면만 500" 증상 행이 없다').toMatch(/웹 화면만 \*\*500\*\*|\*\*웹 화면만 500\*\*/);
    expect(table, '기동 거부 증상 행이 없다').toContain('web 구성이 성립하지 않아 기동할 수 없다');
    // **손 조치를 처방으로 남기지 않는다.** 그것이 이번 반입에서 제안된 것이다.
    expect(table).toContain('`npm install`을 실행하지 않는다');
  });

  /**
   * **문서가 운영자를 거부당하는 값으로 보내지 않는다.**
   *
   * 실행 가능한 대조는 `packages/authz/src/config.test.ts`가 한다 — 문서에서
   * 읽은 값을 실제 계약 함수에 넣는다. 여기서는 옛 문구가 되살아나지 않는지만
   * 본다.
   */
  it('런북이 HTTP에서 insecure 쿠키를 권하지 않는다', () => {
    expect(RUNBOOK_078).not.toMatch(/SESSION_COOKIE_SECURE=false[^)]{0,40}(?:로 둔다|여야|권한다)/);
    // 대신 갈 곳을 말해야 한다.
    expect(RUNBOOK_078).toContain('TLS를 앞에 세우거나');
  });
});

/**
 * `compose.yml`의 서비스별 **최종** 환경 키 집합.
 *
 * 병합 앵커(`<<: *a` 와 `<<: [*a, *b]`)를 실제로 펼쳐 명시 키와 합집합한다.
 * 환경 키만 본다 — 앵커 정의의 소문자 키(`image`·`restart`)는 대문자 규칙으로
 * 자연히 걸러진다.
 */
const composeEnvByService = (source: string): Map<string, Set<string>> => {
  const lines = source.split('\n');
  const anchors = new Map<string, Set<string>>();
  const services = new Map<string, Set<string>>();

  let anchorKeys: Set<string> | undefined;
  let serviceKeys: Set<string> | undefined;
  let serviceMerges: string[] = [];
  let inServices = false;
  let inEnvironment = false;

  const pending: { keys: Set<string>; merges: string[] }[] = [];
  const closeService = (): void => {
    if (serviceKeys) pending.push({ keys: serviceKeys, merges: serviceMerges });
  };

  for (const line of lines) {
    const anchorStart = /^x-[a-z0-9-]+: &([a-z0-9-]+)\s*$/.exec(line);
    if (anchorStart) {
      anchorKeys = new Set<string>();
      anchors.set(anchorStart[1]!, anchorKeys);
      continue;
    }
    if (anchorKeys) {
      const key = /^ {2}([A-Z][A-Z0-9_]*):/.exec(line);
      if (key) {
        anchorKeys.add(key[1]!);
        continue;
      }
      // 주석과 빈 줄은 블록을 끝내지 않는다.
      if (/^\s*(#.*)?$/.test(line)) continue;
      // 들여쓰기 안의 다른 줄(중첩 매핑 등)은 환경 키가 아니므로 버린다.
      if (line.startsWith('  ')) continue;
      // 들여쓰기를 벗어나면 앵커 블록이 끝났다. **이 줄은 버리지 않는다** —
      // `services:`가 바로 그 자리에 오므로 아래 로직이 다시 본다.
      anchorKeys = undefined;
    }

    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;

    const serviceStart = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (serviceStart) {
      closeService();
      serviceKeys = new Set<string>();
      serviceMerges = [];
      services.set(serviceStart[1]!, serviceKeys);
      inEnvironment = false;
      continue;
    }
    if (!serviceKeys) continue;

    if (/^ {4}environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    // environment 와 같은 깊이의 다른 키가 나오면 블록이 끝난다.
    if (/^ {4}[a-z]/.test(line)) {
      inEnvironment = false;
      continue;
    }
    if (!inEnvironment) continue;

    const listMerge = /^ {6}<<: \[([^\]]+)\]\s*$/.exec(line);
    if (listMerge) {
      for (const ref of listMerge[1]!.split(',')) {
        const name = ref.trim().replace(/^\*/, '');
        if (name) serviceMerges.push(name);
      }
      continue;
    }
    const singleMerge = /^ {6}<<: \*([a-z0-9-]+)\s*$/.exec(line);
    if (singleMerge) {
      serviceMerges.push(singleMerge[1]!);
      continue;
    }
    const key = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (key) serviceKeys.add(key[1]!);
  }
  closeService();

  for (const entry of pending) {
    for (const anchor of entry.merges) {
      for (const key of anchors.get(anchor) ?? []) entry.keys.add(key);
    }
  }
  return services;
};

/**
 * 사설 CA가 `git`에도 닿는가 (CR-082 / DEV-561).
 *
 * ## 무엇이 있었나
 *
 * 사내가 `0.1.0-pilot.4`를 올리며 사설 CA를 걸었다. Node로 나가는 호출은 전부
 * 성립했고 컨테이너도 전부 `healthy`였는데 **미러 초기화만** 실패했다 —
 * `SSL certificate problem: unable to get local issuer certificate`.
 *
 * `NODE_EXTRA_CA_CERTS`는 **Node 런타임만** 읽는다. `JOB-MIR-001`과 미러 fetch는
 * `git`을 서브프로세스로 부르므로 그 변수를 보지 못하고 `GIT_SSL_CAINFO`를 따로
 * 받아야 한다. 런북 6장은 그 사실을 **이미 적고 있었으나** `compose.yml`이 그
 * 변수를 컨테이너에 넘기지 않았다 — 문서가 존재하지 않는 경로를 안내했다.
 *
 * ## 왜 문자열 검사가 아니라 집합 계산인가
 *
 * 앵커에 키를 넣는 것과 **그 키가 서비스에 닿는 것은 다른 명제다.** `DEV-552`가
 * 볼륨에서 그것을 가르쳤다 — anchor의 `volumes`는 자기 `volumes`를 가진 서비스
 * 셋에 닿지 않았다. 파일 어딘가에 `GIT_SSL_CAINFO`가 있는지 묻는 검사는 그 함정을
 * 통째로 놓친다. 그래서 서비스마다 **최종 환경 키 집합을 만들어** 묻는다.
 *
 * 대상 목록을 손으로 적지도 않는다. `MIRROR_ROOT`를 선언한 서비스가 곧 로컬
 * 미러를 다루는 서비스이고, 그것이 `git`을 부르는 서비스다. 새 역할이 미러를
 * 쓰기 시작하면 그 서비스가 자동으로 이 검사의 대상이 된다.
 */
describe('사설 CA가 git 서브프로세스에도 닿는다 (CR-082 / DEV-561)', () => {
  const COMPOSE_561 = read('deploy/single-host/compose.yml');
  const ENV_EXAMPLE_561 = read('deploy/single-host/.env.example');
  const RUNBOOK_561 = read('deploy/single-host/RUNBOOK.md');


  const ENV_BY_SERVICE = composeEnvByService(COMPOSE_561);

  /**
   * **파서가 먼저 검증 대상이다.** 이 판이 배운 것 중 하나다 — 대역이나 경로
   * 선택 때문에 아무것도 증명하지 못하는 시험이 넷 있었다. 파서가 조용히 빈
   * 집합을 만들면 아래 단언이 전부 무의미하게 통과한다.
   */
  it('파서가 compose의 서비스와 병합 결과를 실제로 읽는다', () => {
    expect(ENV_BY_SERVICE.size, '서비스를 하나도 읽지 못했다').toBeGreaterThan(5);
    for (const name of ['web', 'search-api', 'worker-mirror', 'worker-sequence']) {
      expect(ENV_BY_SERVICE.has(name), `${name} 서비스를 읽지 못했다`).toBe(true);
    }
    // 앵커가 실제로 펼쳐졌는가 — `NODE_ENV`는 `x-app-env`에만 있고 서비스에 다시
    // 적히지 않는다. 병합이 동작하지 않으면 이 단언이 죽는다.
    expect(ENV_BY_SERVICE.get('worker-mirror')).toContain('NODE_ENV');
    // 명시 키도 함께 모이는가 — `MIRROR_ROOT`는 앵커가 아니라 서비스에 직접 있다.
    expect(ENV_BY_SERVICE.get('worker-mirror')).toContain('MIRROR_ROOT');
    // 받지 않는 서비스를 받는다고 말하지 않는가 — `SESSION_COOKIE_SECURE`는
    // `web`에만 간다 (`DEV-577`의 비대칭).
    expect(ENV_BY_SERVICE.get('search-api')).not.toContain('SESSION_COOKIE_SECURE');
  });

  /**
   * **미러를 다루는 서비스는 전부 `git`의 CA 경로를 받는다.**
   *
   * 목록을 손으로 적지 않는다. `MIRROR_ROOT`가 그 신호다.
   */
  it('미러를 다루는 서비스가 전부 GIT_SSL_CAINFO를 받는다', () => {
    const mirrorServices = [...ENV_BY_SERVICE.entries()]
      .filter(([, keys]) => keys.has('MIRROR_ROOT'))
      .map(([name]) => name);

    expect(mirrorServices.length, 'MIRROR_ROOT를 선언한 서비스가 없다 — 파서나 배포 정의가 바뀌었다').toBeGreaterThanOrEqual(3);

    const missing = mirrorServices.filter((name) => !ENV_BY_SERVICE.get(name)?.has('GIT_SSL_CAINFO'));
    expect(missing, `git을 부르는 서비스가 CA 경로를 받지 못한다 (DEV-561): ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * **두 CA 변수는 같은 자리에 있다.**
   *
   * 하나만 받는 서비스가 있으면 그 서비스에서 Node와 git의 신뢰가 갈린다. 그것이
   * 이 결함의 모양이었다 — 한쪽만 있어서 한쪽만 붙었다.
   */
  it('NODE_EXTRA_CA_CERTS를 받는 서비스가 GIT_SSL_CAINFO도 받는다', () => {
    const asymmetric = [...ENV_BY_SERVICE.entries()]
      .filter(([, keys]) => keys.has('NODE_EXTRA_CA_CERTS') !== keys.has('GIT_SSL_CAINFO'))
      .map(([name]) => name);
    expect(asymmetric, `CA 변수 둘이 갈린 서비스가 있다: ${asymmetric.join(', ')}`).toEqual([]);
  });

  /**
   * **운영자가 채울 자리가 `.env.example`에 있어야 한다.**
   *
   * 주석만으로는 통과하지 않게 실제 대입 행을 요구한다 — `DEV-556`이 가르친 것이다.
   */
  it('.env.example이 GIT_SSL_CAINFO 항목을 준다', () => {
    expect(ENV_EXAMPLE_561, 'GIT_SSL_CAINFO 대입 행이 없다').toMatch(/^GIT_SSL_CAINFO=/m);
    expect(ENV_EXAMPLE_561, 'NODE_EXTRA_CA_CERTS 대입 행이 없다').toMatch(/^NODE_EXTRA_CA_CERTS=/m);
  });

  /**
   * **런북이 두 변수를 함께 안내한다.**
   *
   * 이 결함의 원인 절반은 문서였다. 런북은 `git`이 별도 변수를 받는다고 적고
   * 있었으나 그 변수를 **어디에 적는지**는 말하지 않았고, 배포 정의에는 자리조차
   * 없었다. 안내와 실행 경로가 갈리면 문서가 운영자를 없는 길로 보낸다.
   */
  it('런북이 git CA 경로의 설정 자리와 증상을 적는다', () => {
    expect(RUNBOOK_561, '런북이 GIT_SSL_CAINFO를 안내하지 않는다').toContain('GIT_SSL_CAINFO');
    expect(RUNBOOK_561, 'DEV-561 근거가 런북에 없다').toContain('DEV-561');
    const table = RUNBOOK_561.slice(RUNBOOK_561.indexOf('| 증상'));
    expect(table, '미러만 실패하는 증상 행이 없다').toContain('JOB-MIR-001');
  });
});

/**
 * **쓰기 자격이 조회 경로로 새지 않는다** (WP-075 / CR-084, FR-SEQ-009 AC-5, ADR-022 결정 1).
 *
 * 이 제품이 사람의 지시 없이 GHE를 고치는 최초의 경로가 열렸다. `THR-047`이 적는
 * 위험은 그 쓰기 토큰이 조회 경로로 새는 것이고, 완화 근거는 **두 App의 자격이
 * 서로 다른 자리에 있다**는 사실 하나다. 그 사실이 코드와 배포에서 실제로 참인지를
 * 여기서 잰다 — 문서에만 있으면 다음 사람이 `envFrom` 한 줄로 되돌린다.
 *
 * ## 양방향으로 건다
 *
 * 한 방향만 거는 게이트는 계약이 넓어질 때 반대로 거짓말한다 (`DEV-615`가 가르친
 * 것이다). 그래서 "표기 파드가 조회 키를 받지 않는다"와 "조회 파드가 표기 키를
 * 받지 않는다"를 **둘 다** 단언한다.
 */
describe('표기 쓰기 자격이 조회 경로로 새지 않는다 (WP-075 / CR-084)', () => {
  const ANNOTATE_SECRET_KEYS = ['GHE_ANNOTATE_APP_ID', 'GHE_ANNOTATE_PRIVATE_KEY', 'GHE_ANNOTATE_INSTALLATIONS'];
  const DATA_APP_SECRET_KEYS = ['GHE_APP_ID', 'GHE_APP_PRIVATE_KEY', 'GHE_INSTALLATIONS'];

  it('표기 패키지를 의존하는 앱은 pipeline-worker 하나다', () => {
    /*
     * **의존 그래프가 경계다.** 같은 패키지에 두면 `search-api`가 `@prs/github`을
     * 의존하는 것만으로 쓰기 코드가 그 그래프에 들어온다. 이름을 나눈 것이
     * 아니라 패키지를 나눈 이유가 이것이고, 그 사실을 여기서 고정한다.
     */
    const dependents = ['apps/search-api', 'apps/web', 'apps/ingest-gateway', 'apps/pipeline-worker'].filter(
      (dir) => read(`${dir}/package.json`).includes('@prs/github-annotate'),
    );
    expect(dependents).toEqual(['apps/pipeline-worker']);
  });

  it('조회 전송 계층에 쓰기 메서드가 없다', () => {
    // `GitHubTransport`는 GET 계열만 갖는다. PATCH가 여기 생기면 조회 토큰으로
    // 쓰기가 가능한 경로가 만들어진다.
    const transport = read('packages/github/src/transport.ts');
    expect(transport).not.toMatch(/method:\s*'(PATCH|POST|PUT|DELETE)'/);
    const client = read('packages/github/src/client.ts');
    expect(client).not.toContain('updateTitle');
  });

  it('표기 클라이언트가 조회 App의 변수를 읽지 않는다', () => {
    const config = read('packages/github-annotate/src/config.ts');
    for (const key of DATA_APP_SECRET_KEYS) {
      // 주석으로 언급하는 것까지 막지는 않는다 — `env[...]` 형태의 **읽기**만 본다.
      expect(config, `표기 설정이 ${key}를 읽는다`).not.toContain(`env['${key}']`);
    }
    for (const key of ANNOTATE_SECRET_KEYS) {
      expect(config).toContain(key);
    }
  });

  it('표기 워커만 쓰기 자격을 받는다 (Profile A)', () => {
    const envByService = composeEnvByService(read('deploy/single-host/compose.yml'));
    expect(envByService.has('worker-annotate'), 'worker-annotate 서비스가 없다').toBe(true);

    const withAnnotateKey = [...envByService.entries()]
      .filter(([, keys]) => keys.has('GHE_ANNOTATE_PRIVATE_KEY'))
      .map(([name]) => name);
    expect(withAnnotateKey).toEqual(['worker-annotate']);
  });

  it('표기 워커가 조회 App의 자격을 받지 않는다 (Profile A)', () => {
    const envByService = composeEnvByService(read('deploy/single-host/compose.yml'));
    const keys = envByService.get('worker-annotate');
    expect(keys, 'worker-annotate의 환경을 읽지 못했다').toBeDefined();
    for (const key of DATA_APP_SECRET_KEYS) {
      expect(keys, `worker-annotate가 조회 App의 ${key}를 받는다`).not.toContain(key);
    }
    // 호스트 주소는 자격이 아니므로 받아야 한다 — 없으면 어디에 쓸지 모른다.
    expect(keys).toContain('GHE_BASE_URL');
    expect(keys).toContain('MNUMBER_ANNOTATE_ENABLED');
  });

  it('Profile B도 자격을 나눈다', () => {
    const annotate = read('deploy/k8s/pipeline-worker-annotate.yaml');
    // 표기 파드는 전용 시크릿만 `envFrom`으로 받는다.
    expect(annotate).toContain('secretRef: { name: prs-annotate-secrets }');
    expect(annotate).not.toContain('secretRef: { name: prs-secrets }');
    // 공용 값은 키 하나만 골라 받는다.
    expect(annotate).toContain('secretKeyRef: { name: prs-secrets, key: DATABASE_URL }');

    // 반대 방향 — 표기 시크릿을 **소비하는** 다른 manifest는 없다. 시크릿을
    // 정의하는 파일 자신은 당연히 그 이름을 담으므로 대상이 아니다.
    const dir = new URL('deploy/k8s/', new URL('..', import.meta.url));
    const others = readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith('.yaml') &&
          name !== 'pipeline-worker-annotate.yaml' &&
          name !== 'annotate-secret.example.yaml',
      )
      .filter((name) => readFileSync(new URL(name, dir), 'utf8').includes('prs-annotate-secrets'));
    expect(others, `표기 시크릿을 참조하는 다른 manifest: ${others.join(', ')}`).toEqual([]);
  });

  it('**기본값이 꺼짐이다** — 이 변경을 받는 것만으로 제목이 바뀌지 않는다', () => {
    expect(read('deploy/single-host/.env.example')).toContain('MNUMBER_ANNOTATE_ENABLED=false');
    expect(read('deploy/k8s/configmap.yaml')).toContain("MNUMBER_ANNOTATE_ENABLED: 'false'");
    // compose가 값 없는 배포에서 꺼짐으로 접는지 — `:-false`가 그 자리다.
    expect(read('deploy/single-host/compose.yml')).toContain('MNUMBER_ANNOTATE_ENABLED: ${MNUMBER_ANNOTATE_ENABLED:-false}');
  });

  /**
   * **게이트의 기대를 계약 함수에 넣어 대조한다** (DEV-615가 가르친 것).
   *
   * 문자열로 "꺼짐이 기본"이라고 세는 검사는 그 문자열이 그대로 있고 **판정만
   * 반대로 바뀐** 상태를 못 본다. 그래서 실제 해석 함수를 불러 답의 표를 만든다.
   */
  it('전역 스위치의 해석이 배포 정의와 같은 말을 한다', () => {
    expect(resolveAnnotateEnabled({})).toBe(false);
    expect(resolveAnnotateEnabled({ MNUMBER_ANNOTATE_ENABLED: '' })).toBe(false);
    expect(resolveAnnotateEnabled({ MNUMBER_ANNOTATE_ENABLED: 'false' })).toBe(false);
    expect(resolveAnnotateEnabled({ MNUMBER_ANNOTATE_ENABLED: 'true' })).toBe(true);
    // 오타는 조용히 꺼지지 않는다.
    for (const bad of ['yes', 'True', '1', 'on']) {
      expect(() => resolveAnnotateEnabled({ MNUMBER_ANNOTATE_ENABLED: bad }), bad).toThrow();
    }
  });

  it('켜 놓고 자격이 없으면 쓰기 전에 멈춘다', () => {
    const enabledWithout = resolveAnnotateConfig({ MNUMBER_ANNOTATE_ENABLED: 'true', GHE_BASE_URL: 'https://ghe.example.com' });
    expect(annotateConfigFailure(enabledWithout)).toMatch(/GHE_ANNOTATE_APP_ID/);
    // 꺼져 있으면 자격이 없어도 정상이다 — 기존 배포가 깨지지 않는다.
    expect(annotateConfigFailure(resolveAnnotateConfig({}))).toBeNull();
    // 기동을 막는 자리가 실제로 그 판정을 부르는가.
    expect(read('apps/pipeline-worker/src/index.ts')).toContain('annotateConfigFailure(annotateConfig)');
  });

  it('표기가 `mnumber`와 다른 소비자 그룹을 쓴다', () => {
    /*
     * 같은 group이면 채번 힌트와 표기가 이벤트를 나눠 먹어 각자 절반만 본다
     * (DEV-205의 규율). 철자가 아니라 **카탈로그 값**으로 확인한다.
     */
    expect(LOGICAL_CONSUMERS[TOPICS.projected]).toContain('annotate');
    expect(consumerGroup(TOPICS.projected, 'annotate')).not.toBe(consumerGroup(TOPICS.projected, 'mnumber'));
  });

  it('감사 액션이 활성 어휘에 있고 미활성으로 남아 있지 않다', () => {
    expect(ACTIVE_AUDIT_ACTIONS as readonly string[]).toContain('pull_request.annotate');
    expect(NOT_ACTIVATED_AUDIT_ACTIONS as readonly string[]).not.toContain('pull_request.annotate');
    // SRS의 정본 표도 같은 말을 해야 한다.
    const srs = read('docs/10_requirements/srs_final.md');
    const row = srs.split('\n').find((line) => line.includes('`pull_request.annotate`') && line.startsWith('|'));
    expect(row, 'SRS 감사 표에 pull_request.annotate 행이 없다').toBeDefined();
    expect(row, 'SRS가 아직 미활성이라고 말한다').not.toContain('미활성');
  });
});

/**
 * 표기의 안전성 계약을 **구조로** 고정한다 (WP-075 안전성 보강).
 *
 * 여기 적힌 것들은 전부 「고쳐 놓으면 다음 수정에서 조용히 사라지는」 성질의 것이다.
 * 재시도 한 줄을 옮기면 오래된 제목이 다시 나가고, 게이트 호출을 빼면 간격이
 * 사라지며, 락을 빼도 시험 대부분은 여전히 초록이다. 그래서 시험 가능한 행동이
 * 아니라 **코드의 모양**을 단언한다.
 */
describe('표기 안전성 계약 (WP-075 안전성 보강)', () => {
  const worker = (): string => read('apps/pipeline-worker/src/annotate.ts');

  it('변경 요청은 시도 함수 안에서만 나간다 — 재시도가 판단을 건너뛸 수 없다', () => {
    /*
     * `updateTitle` 호출이 `attemptOnce` 밖에 있으면, 그 자리는 정본 재확인과
     * 제목 재조회를 지나지 않는 경로다. 호출이 **정확히 하나**여야 한다.
     */
    const source = worker();
    const calls = source.match(/client\.updateTitle\(/g) ?? [];
    expect(calls, '변경 요청 호출이 하나가 아니다').toHaveLength(1);

    const attemptStart = source.indexOf('async function attemptOnce(');
    const attemptEnd = source.indexOf('export async function annotateOne(');
    const callAt = source.indexOf('client.updateTitle(');
    expect(attemptStart).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(attemptStart);
    expect(callAt).toBeLessThan(attemptEnd);
  });

  it('변경 요청 앞에 정본 재확인과 제목 조회가 모두 있다', () => {
    const source = worker();
    const attempt = source.slice(
      source.indexOf('async function attemptOnce('),
      source.indexOf('export async function annotateOne('),
    );
    const readAt = attempt.indexOf('client.readTitle(');
    const fenceAt = attempt.lastIndexOf('isAnnotationCurrent(');
    const writeAt = attempt.indexOf('client.updateTitle(');
    expect(readAt).toBeGreaterThan(-1);
    // 제목 조회와 마지막 울타리가 **둘 다** 쓰기보다 앞이다.
    expect(readAt).toBeLessThan(writeAt);
    expect(fenceAt).toBeLessThan(writeAt);
  });

  it('쓰기 차례를 기다리는 호출이 변경 요청 앞에 있다', () => {
    const attempt = worker().slice(
      worker().indexOf('async function attemptOnce('),
      worker().indexOf('export async function annotateOne('),
    );
    const gateAt = attempt.indexOf('gate.waitForTurn(');
    const sentAt = attempt.indexOf('gate.markSent()');
    const writeAt = attempt.indexOf('client.updateTitle(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(writeAt);
    // 보낸 시각은 **보내기 전에** 기록한다 — 실패해도 간격이 지켜지게.
    expect(sentAt).toBeLessThan(writeAt);
  });

  it('회차가 실행자 락을 지난다 (DEV-629)', () => {
    const source = worker();
    expect(source).toContain('withAnnotateRunnerLock(');
    // 락이 준 커넥션이 시도 맥락으로 들어간다 — 그것이 소유권 확인의 자리다.
    expect(source).toMatch(/db:\s*client/);
  });

  it('해제 표시도 실행자 락 안에서 돈다', () => {
    /*
     * GHE를 부르지 않는 순수 DB 쓰기라 락 밖에 두기 쉽지만, 그러면 「실행자는
     * 하나다」가 회차에만 참인 말이 된다. 두 프로세스가 같은 행을 함께 표시하면
     * `disabled` 지표가 부푼다.
     */
    const source = worker();
    const call = source.indexOf('markDisabledRepositoryTargets(');
    expect(call).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, call - 300), call);
    expect(before, '해제 표시가 락 밖에서 돈다').toContain('withAnnotateRunnerLock(');
  });

  it('HTTP 왕복에 회차의 중단 신호가 걸린다', () => {
    const source = worker();
    expect(source).toContain('deps.client.readTitle(ref, { signal: context.deadline.signal })');
    expect(source).toContain('signal: context.deadline.signal');
    // 전송 계층도 그 신호를 실제로 fetch에 건다.
    expect(read('packages/github-annotate/src/client.ts')).toContain('AbortSignal.any([');
  });

  it('스윕 종료가 진행 중인 회차를 끊는다', () => {
    const source = worker();
    // 종료 컨트롤러가 회차로 전달되고, `stop`이 그것을 올린다.
    expect(source).toContain('stopping.abort()');
    expect(source).toContain('stopping.signal');
  });

  it('대상 질의가 `body_changed`를 다시 집지 않는다', () => {
    /*
     * 이 한 줄이 바뀌면 「확인된 불일치를 자동으로 덮지 않는다」가 무너진다.
     * 상태 목록을 질의에서 직접 읽어 고정한다.
     */
    const repo = read('packages/db/src/repositories/merge-sequence.ts');
    const clause = /annotate_state IN \(([^)]*)\)/.exec(repo);
    expect(clause, '대상 질의의 상태 목록을 찾지 못했다').not.toBeNull();
    const states = (clause?.[1] ?? '').replace(/[' ]/g, '').split(',');
    expect(states).toContain('failed');
    expect(states).toContain('disabled');
    expect(states).toContain('unknown');
    expect(states, '`body_changed`가 자동 재시도 대상이 되었다').not.toContain('body_changed');
  });

  it('마이그레이션의 상태 목록과 코드의 상태 유니온이 같다', () => {
    const migration = read('packages/db/migrations/027_annotate_outcome.up.sql');
    const repo = read('packages/db/src/repositories/merge-sequence.ts');
    const inDb = (/annotate_state IN\s*\n?\s*\(([^)]*)\)/.exec(migration)?.[1] ?? '')
      .replace(/[' \n]/g, '')
      .split(',')
      .filter((value) => value !== '');
    const union = /export type AnnotateState =([^;]*);/.exec(repo)?.[1] ?? '';
    expect(inDb.length, '마이그레이션에서 상태 목록을 읽지 못했다').toBeGreaterThan(0);
    for (const state of inDb) {
      // 데이터베이스가 받는 값은 **전부** 코드의 유니온에 있어야 한다.
      expect(union, `코드의 AnnotateState가 ${state}를 모른다`).toContain(`'${state}'`);
    }
    // 반대 방향도 본다 — 코드만 아는 상태는 쓰는 순간 제약 위반이다.
    for (const state of union.split('|').map((part) => part.replace(/['\s]/g, '')).filter((part) => part !== '')) {
      expect(inDb, `데이터베이스가 ${state} 상태를 받지 않는다`).toContain(state);
    }
  });

  it('읽기 성공만으로 차단을 풀지 않는다', () => {
    const source = worker();
    const clearAt = source.indexOf('clearAnnotationBlock(');
    expect(clearAt).toBeGreaterThan(-1);
    // 차단 해제는 「쓴 경우」 갈래 안에 있다. 조회 직후에 있으면 그 앞줄이 `readTitle`이다.
    const before = source.slice(Math.max(0, clearAt - 600), clearAt);
    expect(before, '차단 해제가 조회 직후에 있다').not.toContain('client.readTitle(');
    expect(before).toContain('outcome.wrote');
  });

  it('감사 결과 코드의 어휘가 계약과 코드에서 같다', () => {
    /*
     * 이 저장소의 관례는 **액션마다 자신의 `result_code` 어휘를 계약 문서가 소유하는
     * 것**이다 (`safe_marker.set`의 선례). 코드가 계약에 없는 값을 남기면 감사 로그를
     * 읽는 사람이 사유를 복원할 수 없고, 계약에만 있고 코드가 쓰지 않는 값은 있지도
     * 않은 상태를 문서가 약속하는 것이 된다. 양방향으로 묶는다.
     */
    const contract = read('docs/30_technical_architecture/pr_search_security_privacy_architecture.md');
    const worker = read('apps/pipeline-worker/src/annotate.ts');
    const declared = ['annotated', 'annotated_observed'];
    for (const code of declared) {
      expect(contract, `계약이 ${code}를 적지 않는다`).toContain(`\`${code}\``);
      expect(worker, `코드가 ${code}를 남기지 않는다`).toContain(`'${code}'`);
    }
    // 코드가 쓰는 값이 정확히 그 둘인지 — 세 번째가 조용히 생기지 않게 한다.
    const used = new Set(
      [...worker.matchAll(/recordAnnotateAudit\([^)]*?'([a-z_]+)'\s*\)/gs)].map((match) => match[1] as string),
    );
    expect([...used].sort()).toEqual([...declared].sort());
  });

  it('사전 점검은 읽기 전용이다', () => {
    const cli = read('apps/pipeline-worker/src/annotate-preview-cli.ts');
    expect(cli).toContain('BEGIN READ ONLY');
    // 쓰기 경로가 이 파일에 없다.
    expect(cli).not.toContain('updateTitle');
    expect(cli).not.toContain('markAnnotateState');
    expect(cli).not.toContain('clearAnnotationBlock');
  });
});

/**
 * REL-007 R0 — GitHub Operations Plane 도달성 (WP-077 / CR-086).
 *
 * `CAPABILITIES` 표에 넣지 않는다 — 그 표는 `deploy/k8s/*.yaml`을 요구하는데 이 판은 K8s를
 * 주력으로 만들지 않는다(결정자 지시). 대신 Profile A(compose)와 소스 배선을 직접 건다.
 * 문자열 검사라 정교하지 않지만, 「실행기 없이 API만 켜진 배포」·「argv 빌더 둘」·「shell을
 * 거치는 spawn」·「도구가 지운 제어 문자」는 리뷰에서 눈에 띄지 않는 종류라 회귀로 잡는다.
 */
describe('REL-007 R0: GitHub Operations Plane이 배포에서 실제로 돈다 (WP-077)', () => {
  /** 디렉터리 아래 `.ts`·`.tsx` 파일의 저장소 상대 경로. `node_modules`·`dist`는 우리 코드가 아니다. */
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    const visit = (current: string): void => {
      for (const entry of readdirSync(`${root}${current}`, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const relative = `${current}/${entry.name}`;
        if (entry.isDirectory()) visit(relative);
        else if (/\.tsx?$/.test(entry.name)) out.push(relative);
      }
    };
    if (existsSync(`${root}${dir}`)) visit(dir);
    return out.sort();
  };
  const GH_PLANE = ['packages/gh-cli/src', 'apps/gh-executor/src', 'apps/search-api/src/gh'];
  const product = GH_PLANE.flatMap(walk).filter((file) => !/\.test\.tsx?$/.test(file));

  it('gh 프로세스를 만드는 곳은 apps/gh-executor/src/spawn.ts 하나이며 shell을 거치지 않는다 (ADR-016, NFR-010)', () => {
    expect(product.length).toBeGreaterThan(20);
    const spawners = product.filter((file) => /from 'node:child_process'/.test(read(file)));
    /*
     * 둘이다. `spawn.ts`가 **사용자가 요청한 실행**을 띄우는 유일한 곳이고, `inventory.ts`는
     * manifest 추출과 기동 시 버전 대조를 위해 `gh <path> --help`·`gh --version`만 고정 argv로
     * 띄운다 — 사용자 입력이 그 argv에 닿는 길이 없다.
     */
    expect([...spawners].sort()).toEqual(['apps/gh-executor/src/spawn.ts', 'packages/gh-cli/src/inventory.ts']);
    const inventory = read('packages/gh-cli/src/inventory.ts');
    expect(inventory).toContain("[...path, '--help']");
    expect(inventory).toContain("['--version']");
    const spawn = read('apps/gh-executor/src/spawn.ts');
    expect(spawn).toContain('shell: false');
    // 주석이 아니라 import를 본다 — `exec`·`execFile`을 들여오지 않으면 부를 수 없다.
    const importedFrom = (source: string): string => /^import \{([^}]*)\} from 'node:child_process';/m.exec(source)?.[1] ?? '';
    expect(importedFrom(spawn)).toMatch(/\bspawn\b/);
    expect(importedFrom(spawn)).not.toMatch(/\bexec/);
    expect(importedFrom(inventory)).toMatch(/\bspawnSync\b/);
    expect(importedFrom(inventory)).not.toMatch(/\bexec/);
    /** 주석을 걷어 낸 코드. 「`shell: true`가 0건임을 건다」고 적은 주석까지 잡으면 규칙을 설명할 수 없다. */
    const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of product) {
      expect(code(read(file)), file).not.toContain('shell: true');
      expect(code(read(file)), file).not.toContain("'sh', '-c'");
    }
    // 러너만 spawn을 부른다 — API·다른 모듈이 gh를 직접 띄우는 길이 없다.
    const callers = product.filter((file) => file !== 'apps/gh-executor/src/spawn.ts' && read(file).includes('runGhProcess('));
    expect(callers).toEqual(['apps/gh-executor/src/runner.ts']);
  });

  it('argv 빌더는 하나이고, 미리보기·실행 수락·재검증이 전부 그것을 부른다 (ADR-017, FR-GH-002 AC-4)', () => {
    const definitions = [...walk('packages'), ...walk('apps')].filter((file) => /export function buildArgv\(/.test(read(file)));
    expect(definitions).toEqual(['packages/gh-cli/src/argv.ts']);
    expect(read('apps/search-api/src/gh/executions.ts')).toContain('buildArgv(');
    const runner = read('apps/gh-executor/src/runner.ts');
    expect(runner).toContain('buildArgv(');
    // 저장된 argv와 다시 만든 argv를 **대조**한다 — 변조된 행은 실행하지 않는다 (AC-8).
    expect(runner).toContain('argvEquals(');
    expect(runner).toContain("'argv_mismatch'");
  });

  it('Dockerfile과 smoke 검사의 gh 버전·해시 리터럴이 pin.ts와 같다 (FR-GH-011)', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain(`ARG GH_VERSION=${GH_PINNED_VERSION}`);
    expect(dockerfile).toContain(`ARG GH_ASSET_SHA256=${GH_PINNED_LINUX_AMD64.sha256}`);
    expect(dockerfile).toContain(`ARG GH_BINARY_SHA256=${GH_PINNED_LINUX_AMD64.binarySha256}`);
    expect(dockerfile).toContain('USER node');
    const smoke = read('deploy/single-host/smoke-images.sh');
    expect(smoke).toContain(`gh version ${GH_PINNED_VERSION} `);
    expect(smoke).toContain(GH_PINNED_LINUX_AMD64.binarySha256);
    // 번들 회귀의 docker 대역도 같은 답을 내야 한다 — 어긋나면 태그 소유권 시험이 무관한 이유로 죽는다.
    const fakeDocker = read('regression/fixtures/release-tag/fake-docker');
    expect(fakeDocker).toContain(`gh version ${GH_PINNED_VERSION} `);
    expect(fakeDocker).toContain(GH_PINNED_LINUX_AMD64.binarySha256);
  });

  it('argv·표시 경로의 비밀 가림이 GitHub 클라이언트의 가림과 같은 답을 낸다 (FR-GH-008 AC-7)', () => {
    const samples = [
      'ghu_abcdefghijklmnop0123456789ABCDEF',
      'token ghs_0123456789abcdefghijklmnopqrstuv in argv',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789',
      'plain owner/name --state open',
    ];
    for (const sample of samples) {
      expect(redactString(sample), sample).toBe(redactGitHub(sample));
    }
    expect(redactString(samples[0] as string)).toBe('<redacted>');
  });

  it('Profile A: 실행기는 선택 프로파일이고, 플래그·봉인 키는 search-api와 실행기만, 자격은 나뉜다 (CR-059 · FR-GH-008 AC-1)', () => {
    const compose = read('deploy/single-host/compose.yml');
    /** 서비스 블록마다 그 이름이 있는가 — MNUMBER 검사와 같은 방법이다. */
    const carriersOf = (needle: string): string[] => {
      const carriers = new Set<string>();
      let current = '';
      for (const line of compose.split('\n')) {
        const header = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
        if (header?.[1] !== undefined) current = header[1];
        if (line.includes(needle) && current !== '' && !line.trimStart().startsWith('#')) carriers.add(current);
      }
      return [...carriers].sort();
    };
    expect(carriersOf('GH_OPERATIONS_ENABLED:')).toEqual(['gh-executor', 'search-api']);
    expect(carriersOf('GH_IDENTITY_VAULT_KEY:')).toEqual(['gh-executor', 'search-api']);
    // Operations App의 client secret은 인가·갱신을 하는 search-api에만 간다.
    expect(carriersOf('GHE_OPS_CLIENT_SECRET:')).toEqual(['search-api']);
    // web은 플래그를 읽지 않는다 — 404를 「열리지 않았다」로 그린다 (DEV-589의 규율).
    expect(carriersOf('GH_OPERATIONS_ENABLED:')).not.toContain('web');

    const block = /\n {2}gh-executor:\n[\s\S]*?\n\n/.exec(compose)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).toContain("profiles: ['github-operations']");
    expect(block).toContain('read_only: true');
    // 수집용 Data App·표기 App의 키를 받지 않는다 — 실행은 사용자의 위임 토큰으로만 한다.
    expect(block).not.toContain('*ghe-env');
    expect(block).not.toContain('*annotate-env');
    expect(block).not.toContain('GHE_APP_');
    expect(block).not.toContain('GHE_ANNOTATE_');
    expect(block).not.toContain('ELASTICSEARCH');
  });

  it('search-api가 라우트를 등록하고 실행기가 스윕·구독을 세우며 종료에서 닫는다 (JOB-GH-001·007)', () => {
    expect(read('apps/search-api/src/server.ts')).toContain('registerGhRoutes(');
    expect(read('apps/search-api/src/runtime.ts')).toContain('buildGhDeps(');
    const index = read('apps/gh-executor/src/index.ts');
    expect(index).toContain('sweeper = startSweeper(');
    expect(index).toContain('await bus.subscribe(');
    expect(index).toContain('await sweeper?.stop()');
    expect(index).toContain('subscriptions.map((subscription) => subscription.close())');
    // 꺼진 실행기의 헬스체크는 백킹 서비스를 묻지 않는다 — 오프라인 런타임 검사가 그것에 기댄다.
    expect(index).toMatch(/\.\.\.\(config\.enabled\s*\?\s*\{\s*checkBackingServices/);
  });

  it('prsctl이 .env의 켜짐을 프로파일로 옮기고, 번들이 실행기 이미지를 담고 검사한다', () => {
    const prsctl = read('deploy/single-host/prsctl');
    expect(prsctl).toContain('--profile github-operations');
    expect(prsctl).toContain('"prs/gh-executor:${PRS_VERSION}"');
    expect(prsctl).toContain('compose exec -T gh-executor wget -qO- "http://127.0.0.1:3004/healthz"');
    const bundle = read('deploy/single-host/build-bundle.sh');
    expect(bundle).toMatch(/APP_TARGETS=\([^)]*\bgh-executor\b/);
    expect(bundle).toContain('[gh-executor]="prs/gh-executor"');
    const smoke = read('deploy/single-host/smoke-images.sh');
    expect(smoke).toContain('EXECUTOR_IMAGE="prs/gh-executor:${VERSION}"');
    expect(smoke).toContain('GH_OPERATIONS_ENABLED=false');
    expect(smoke).toContain('GH_OPERATIONS_ENABLED=true');
    expect(read('deploy/single-host/.env.example')).toContain('GH_OPERATIONS_ENABLED=false');
  });

  /**
   * `DEV-608`이 Node 축에 세운 방어(켜짐의 정의가 같은가)를 **셸·compose 경계**에도 건다 (`DEV-664`).
   *
   * prsctl은 search-api가 받을 값을 `docker compose config`의 렌더에서 읽어 프로파일을 켠다. 이 시험은
   * **실제 `docker compose`**로 `.env`의 키·값 변형(따옴표·주석·`export `·공백)을 렌더해, prsctl의 판정이
   * search-api의 `resolveOperationsEnabled`와 같은 입력에 같은 답(on/off/reject)을 내는지 본다. 처음 판은
   * 셸로 `.env`를 다시 파싱했고 값 쪽만 맞춘 뒤 키 쪽(`export KEY=…`, `KEY = true`)에서 다시 갈렸다 —
   * 독립 검토가 둘 다 실측했다. 렌더를 단일 근거로 삼으면 갈릴 자리가 없고, 이 시험은 그 배선(추출
   * sed·분류)이 유지되는지 건다. **docker가 없으면 실패다** — skip은 통과가 아니다.
   */
  it('prsctl의 켜짐 판정이 compose의 렌더와 search-api의 판정에 같은 답을 낸다 — 실제 docker compose로 키·값 변형을 건다 (DEV-664)', async () => {
    const { resolveOperationsEnabled } = await import('../apps/search-api/src/gh/config.js');
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    const prsctl = read('deploy/single-host/prsctl');
    const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\r?\\n\\}`, 'm').exec(prsctl)?.[0] ?? '';
    // CR-091: 렌더 추출이 `rendered_env_value` 하나로 모였다 — 토큰 충돌 사전 감지(DEV-696)가 같은 함수를 쓴다.
    const shell = ['GH_OPS_STATE=""', fn('rendered_env_value'), fn('gh_operations_value'), fn('gh_operations_state')].join('\n');
    expect(fn('gh_operations_value')).toContain('rendered_env_value search-api GH_OPERATIONS_ENABLED');
    expect(shell).toContain('docker compose');
    expect(shell).toContain('gh_operations_state()');
    const classifyApi = (value: string): 'on' | 'off' | 'reject' => {
      try {
        return resolveOperationsEnabled({ GH_OPERATIONS_ENABLED: value }) ? 'on' : 'off';
      } catch {
        return 'reject';
      }
    };
    // compose가 `:?`로 요구하는 변수를 전부 채운 `.env` — 값 자체는 이 시험의 관심사가 아니다.
    const compose = read('deploy/single-host/compose.yml');
    const required = [...new Set([...compose.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1] ?? ''))].filter((k) => k !== '');
    const base = required.map((key) => `${key}=x`).join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'prs-gh-ops-'));
    const composeFile = join(root, 'deploy/single-host/compose.yml');
    try {
      const lines = [
        'GH_OPERATIONS_ENABLED=true', 'GH_OPERATIONS_ENABLED= true ', 'GH_OPERATIONS_ENABLED="true"', "GH_OPERATIONS_ENABLED='true'",
        'GH_OPERATIONS_ENABLED=true # 켠다', 'GH_OPERATIONS_ENABLED="true" # 켠다', 'export GH_OPERATIONS_ENABLED=true',
        '  GH_OPERATIONS_ENABLED=true', 'GH_OPERATIONS_ENABLED = true', 'GH_OPERATIONS_ENABLED=false', 'GH_OPERATIONS_ENABLED="false"',
        'GH_OPERATIONS_ENABLED=', 'GH_OPERATIONS_ENABLED=TRUE', 'GH_OPERATIONS_ENABLED=yes', 'GH_OPERATIONS_ENABLED=true#x', '',
      ];
      for (const line of lines) {
        const envFile = join(dir, '.env');
        writeFileSync(envFile, `${base}\n${line}\n`);
        const env = { ...process.env, ENV_FILE: envFile, PROJECT: 'prs-parity-test', COMPOSE_FILE: composeFile };
        const rendered = execFileSync('bash', ['-c', `${shell}\ngh_operations_value`], { env, encoding: 'utf8' }).trim();
        const state = execFileSync('bash', ['-c', `${shell}\ngh_operations_state`], { env, encoding: 'utf8' }).trim();
        expect(state, `prsctl ${JSON.stringify(line)} (rendered=${JSON.stringify(rendered)})`).toBe(classifyApi(rendered));
        // compose는 따옴표·주석·export·공백을 벗겨 값만 넘긴다 — 실측 그대로다.
        if (line.includes('true') && !line.includes('TRUE') && !line.includes('true#x')) expect(rendered, line).toBe('true');
      }
      // 파일이 없으면 꺼짐이다 (require_env 전에도 불린다).
      const missing = { ...process.env, ENV_FILE: join(dir, 'missing.env'), PROJECT: 'prs-parity-test', COMPOSE_FILE: composeFile };
      expect(execFileSync('bash', ['-c', `${shell}\ngh_operations_state`], { env: missing, encoding: 'utf8' }).trim()).toBe('off');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('실행기의 시험 전용 훅(timeoutMsOverride·stdoutLimitOverride·beforeClaim)은 운영 배선에 넘기지 않는다', () => {
    const index = read('apps/gh-executor/src/index.ts');
    for (const hook of ['timeoutMsOverride', 'stdoutLimitOverride', 'beforeClaim']) {
      expect(index, hook).not.toContain(hook);
    }
  });

  /*
   * CR-088 — capability 분류·검증·드리프트·스냅숏·A-006 (WP-078). 아래 넷은 「분류를 늘렸다고 실행이 넓어지지
   * 않는다」·「검사가 실제 프로세스에 배선됐다」·「요청 경로에서 검사하지 않는다」·「운영 화면의 역할」을 건다.
   */
  it('CR-088: 실행 허용은 여전히 pr.list 하나다 — 코드 표와 커밋된 manifest가 같은 답을 낸다', () => {
    const capabilities = read('packages/gh-cli/src/capabilities.ts');
    // 정의 배열의 원소가 하나다. 넓히려면 CR이 먼저다 (지시: R0 범위 유지).
    expect(capabilities).toMatch(/EXECUTABLE_CAPABILITIES: readonly GhCapabilityDefinition\[\] = \[PR_LIST_CAPABILITY\];/);
    const manifest = JSON.parse(read('packages/gh-cli/manifest/gh-2.97.0.json')) as {
      manifestVersion: string;
      coverage: { executableCommands: number; leafCommands: number; unclassifiedLeafCommands: number };
      commands: { execution: string; id: string; group: boolean }[];
    };
    expect(manifest.manifestVersion).toBe('r0.3');
    expect(manifest.coverage.executableCommands).toBe(1);
    expect(manifest.commands.filter((command) => command.execution === 'allowed').map((command) => command.id)).toEqual(['pr.list']);
    expect(manifest.coverage.unclassifiedLeafCommands).toBe(0);
  });

  /*
   * CR-089 — 결과 계약·typed port·바인딩·그래프 (WP-079). 아래 넷은 「의미 계약이 생겼다고 실행이 넓어지지 않는다」·
   * 「바인딩 평가를 요청 경로에 두지 않았다(다단계 실행 0)」·「A-006이 실행 결과 원문의 통로가 아니다」·「회귀 시험이
   * CI에서 실제로 돈다」를 건다.
   */
  it('CR-089: 실행 경로(prepare·실행기 재검증)는 결과 계약·port·바인딩·그래프를 읽지 않는다 — 실행 허용은 코드 표뿐이다', () => {
    for (const file of ['apps/search-api/src/gh/executions.ts', 'apps/gh-executor/src/runner.ts']) {
      const source = read(file);
      expect(source, file).toMatch(/findCapability\(/);
      expect(source, file).not.toMatch(/classification\??\.result|outputPorts?\b|inputPorts|resultAdapter|evaluateBinding|judgePortCompatibility|computeCapabilityGraph|composability/);
    }
  });

  it('CR-089: 바인딩 평가(evaluateBinding)는 어느 앱의 제품 코드에도 없다 — 호환 판정을 실행 승인으로 쓰는 길이 없다', () => {
    // 앱 다섯 전부의 제품 코드 — ingest-gateway도 실행 경로와 무관하지만 「어느 앱에도 없다」의 분모에 넣는다 (독립 검토 B).
    const callers = ['apps/search-api/src', 'apps/gh-executor/src', 'apps/pipeline-worker/src', 'apps/ingest-gateway/src', 'apps/web/app', 'apps/web/lib', 'apps/web/components']
      .flatMap(walk)
      .filter((file) => !/\.test\.tsx?$/.test(file) && /evaluateBinding\(/.test(read(file)));
    expect(callers).toEqual([]);
  });

  it('CR-089: A-006 조회(registry.ts)는 실행 기록을 읽지 않는다 — 다른 사용자의 결과 원문이 이 경로로 나가지 않는다', () => {
    // 주석을 걷어 낸 코드만 본다 — 문서 주석이 「`gh_execution`을 읽지 않는다」고 말하는 것은 읽는 코드가 아니다.
    const registry = read('apps/search-api/src/gh/registry.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(registry).not.toMatch(/ghExecutionRepo|gh_execution\b|stdout_excerpt|findVisibleExecution/);
    expect(registry).toMatch(/result_contract:\s*command\.classification\?\.result/);
  });

  it('CR-089: 회귀 시험은 CI의 integration 잡에서 test:integration 뒤에 같은 서비스·환경으로 순차 실행된다', () => {
    const ci = read('.github/workflows/ci.yml');
    const verify = ci.slice(ci.indexOf('\n  verify:'), ci.indexOf('\n  integration:'));
    const integration = ci.slice(ci.indexOf('\n  integration:'));
    expect(integration).toMatch(/- name: test:integration\s+run: pnpm test:integration\s+(?:#[^\n]*\s+)*- name: test:regression\s+run: pnpm test:regression/);
    expect(integration).toContain('POSTGRES_TEST_DB: prs_test');
    expect(verify).not.toContain('test:regression');
    // 러너·트리거·잡 구조는 그대로다 (결정자 지시).
    expect(ci.match(/runs-on: ubuntu-latest/g)).toHaveLength(2);
    expect(ci).toMatch(/on:\s+push:\s+branches: \[main\]\s+pull_request:/);
  });

  it('CR-088: 레지스트리 검사(JOB-GH-003)는 실행기가 기동 시 기다리고 주기로 돌리며 종료에서 닫고, 러너가 stale을 읽는다', () => {
    const index = read('apps/gh-executor/src/index.ts');
    expect(index).toMatch(/registry\s*=\s*startRegistryChecker\(/);
    expect(index).toMatch(/await\s+registry\.runOnce\('startup'\)/);
    expect(index).toMatch(/await\s+registry\?\.stop\(\)/);
    /*
     * CR-090: 러너는 검사기의 상태(드리프트 `stale`과 마지막 통과 시각)를 통째로 받아 실행 판정의 레지스트리 입력으로 쓴다.
     * 옛 배선(`isStale`만 넘기고 재검증에서 한 줄로 거절)은 과거의 통과 하나로 무기한 실행하는 경로를 남겼다.
     */
    expect(index).toMatch(/registry:\s*\{\s*snapshot:\s*\(\)\s*=>\s*checker\.state\(\)\s*\}/);
    // 헬스 서버는 기동 검사보다 먼저 열린다 — 검사 동안 `/healthz`가 닫혀 있으면 안 된다.
    expect(index.indexOf('server.listen(')).toBeLessThan(index.indexOf("registry.runOnce('startup')"));
    const runner = read('apps/gh-executor/src/runner.ts');
    // 러너 의존에서 레지스트리는 필수다 — 없으면 검사를 건너뛰는 경로를 두지 않는다.
    expect(runner).toMatch(/readonly\s+registry:\s*\{\s*snapshot\(\)/);
    expect(runner).toMatch(/const\s+registry\s*=\s*deps\.registry\.snapshot\(\);/);
    expect(runner).toMatch(/executorRegistryVerdict\(\{\s*stale:\s*registry\.stale,\s*lastPassedAt:\s*registry\.lastPassedAt,/);
    expect(read('apps/gh-executor/src/server.ts')).toMatch(/readonly\s+registry\?:/);
    const check = read('apps/gh-executor/src/registry-check.ts');
    expect(check).toMatch(/checkedBy:\s*'gh-executor'/);
    // 주기 검사는 비동기 판을 쓴다 — 동기 판은 이벤트 루프를 20~30초 막는다 (독립 검토 나).
    expect(check).toContain('checkDriftAsync(');
    expect(check).not.toMatch(/\bcheckDrift\(/);
  });

  it('CR-088: 인벤토리 추출(gh --help 순회)은 search-api·web 요청 경로에 없다 — 검사는 실행기·CLI·시험만 한다', () => {
    const callers = [...walk('apps/search-api/src'), ...walk('apps/web/app'), ...walk('apps/web/lib'), ...walk('apps/web/components')].filter((file) =>
      /checkDrift\(|extractInventory\(/.test(read(file)),
    );
    expect(callers).toEqual([]);
    expect(read('apps/gh-executor/src/registry-check.ts')).toMatch(/checkDriftAsync\(\{\s*binaryPath:\s*deps\.config\.binaryPath,\s*manifest\s*\}\)/);
    expect(read('scripts/gh-capabilities.mjs')).toContain('checkDrift(');
  });

  it('CR-088: A-006 조회는 operator·security_officer만이며 web 라우트·내비·배포 설정이 함께 있다', () => {
    const routes = read('apps/search-api/src/gh/routes.ts');
    expect(routes).toMatch(/requireAnyRole\(principal,\s*\['operator',\s*'security_officer'\]\)/);
    expect(routes).toMatch(/GH_REGISTRY_PATH\s*=\s*'\/api\/v1\/gh\/registry'/);
    expect(routes).toMatch(/GH_REGISTRY_COMMAND_PATH\s*=\s*'\/api\/v1\/gh\/registry\/commands\/:id'/);
    expect(existsSync(`${root}apps/web/app/ops/gh-registry/page.tsx`)).toBe(true);
    expect(read('apps/web/lib/nav.ts')).toMatch(/id:\s*'ops-gh-registry'[\s\S]{0,200}allowedRoles:\s*\['operator',\s*'security_officer'\]/);
    expect(read('deploy/single-host/compose.yml')).toMatch(/GH_EXECUTOR_REGISTRY_CHECK_MS:\s*\$\{GH_EXECUTOR_REGISTRY_CHECK_MS:-86400000\}/);
    expect(read('deploy/single-host/.env.example')).toContain('GH_EXECUTOR_REGISTRY_CHECK_MS');
    // 미리보기·수락(prepare)과 실행기 재검증이 같은 두 조건(정의 allowed ∧ manifest allowed)을 본다 (독립 검토 가).
    expect(read('apps/search-api/src/gh/executions.ts')).toMatch(/capability\.execution\s*!==\s*'allowed'\s*\|\|\s*command\.execution\s*!==\s*'allowed'/);
  });

  /*
   * CR-090 — 운영 승인·차단이 실제 실행을 통제한다 (WP-080). 아래 셋은 「판정식이 한 곳이고 수락·claim이 그것을 부른다」·
   * 「정책 표를 애플리케이션이 직접 쓰지 않는다」·「운영 정책 경로의 역할과 web 배선」을 건다. 동작은 통합 시험
   * (`gh-policy`·`policy-flow`·`policy-routes`)이 보고, 여기는 그 동작이 배포 코드에 이어져 있는지를 본다.
   */
  it('CR-090: 요청 수락과 실행기 claim이 같은 판정 함수를 부르고, claim은 정책 공유 잠금을 쥔 한 트랜잭션에서 한다', () => {
    const executions = read('apps/search-api/src/gh/executions.ts');
    expect(read('apps/search-api/src/gh/policy.ts')).toMatch(/return\s+decideExecution\(\{/);
    expect(executions).toMatch(/const\s+gate\s*=\s*await\s+executionGate\(policyDepsOf\(deps,\s*host\),\s*capability\.id\);/);
    expect(executions).toMatch(/if\s*\(!prepared\.gate\.allowed\)\s*throw\s+gateRejection\(prepared\.gate\);/);
    expect(executions).toMatch(/policyRevision:\s*prepared\.gate\.revision/);
    const runner = read('apps/gh-executor/src/runner.ts');
    expect(runner).toMatch(/return\s+decideExecution\(\{/);
    expect(runner).toMatch(/acceptedRevision:\s*row\.policy_revision/);
    expect(runner).toMatch(/withTransaction\(deps\.pool,[\s\S]{0,200}lockPolicyShared\(client,[\s\S]{0,200}gateFor\(deps,\s*row,\s*client\)[\s\S]{0,300}claimExecution\(client,/);
    // 판정식은 `@prs/gh-cli` 한 곳이다 — API·실행기·화면이 식을 복제하지 않는다 (지시서 6장).
    const copies = ['apps/search-api/src', 'apps/gh-executor/src', 'apps/web/app', 'apps/web/lib', 'apps/web/components']
      .flatMap(walk)
      .filter((file) => !/\.test\.tsx?$/.test(file) && /function\s+(decideExecution|approvalMatchesManifest|evaluateApprovalEligibility)\b/.test(read(file)));
    expect(copies).toEqual([]);
  });

  it('CR-090: 정책 표는 애플리케이션 코드가 직접 쓰지 않는다 — 쓰기는 migration 030의 SECURITY DEFINER 함수 하나이고 prs_app은 읽기·실행만 한다', () => {
    // 주석을 걷어 낸 코드만 본다 — 「`UPDATE gh_operations_policy`를 적어도 DB가 거절한다」는 설명은 쓰는 코드가 아니다.
    const code = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const writers = ['apps/search-api/src', 'apps/gh-executor/src', 'apps/pipeline-worker/src', 'packages/db/src']
      .flatMap(walk)
      .filter((file) => !/\.test\.ts$/.test(file) && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+gh_operations_policy/i.test(code(file)));
    expect(writers).toEqual([]);
    const migration = read('packages/db/migrations/030_gh_operations_policy.up.sql');
    expect(migration).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION gh_operations_policy_apply\([^)]*\) TO prs_app;/);
    expect(migration).toMatch(/GRANT SELECT ON gh_operations_policy, gh_operations_policy_revision TO prs_app;/);
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*gh_operations_policy[^;]*TO\s+prs_app/);
    // 새 실행 기록은 수락 revision을 적는다 — claim 가드가 그 값을 현재 정책과 대조한다.
    expect(read('packages/db/src/repositories/gh-execution.ts')).toMatch(/correlation_id,\s*policy_revision\)/);
  });

  it('CR-090: 운영 정책 조회는 operator·security_officer, 변경은 operator만이며 web 라우트·내비·프록시 헤더가 함께 있다', () => {
    const routes = read('apps/search-api/src/gh/routes.ts');
    expect(routes).toMatch(/GH_POLICIES_PATH\s*=\s*'\/api\/v1\/gh\/policies'/);
    expect(routes).toMatch(/GH_POLICY_CHANGES_PATH\s*=\s*'\/api\/v1\/gh\/policies\/changes'/);
    expect(routes).toMatch(/app\.get\(GH_POLICIES_PATH,[\s\S]{0,200}registryAccess\(request,\s*reply,\s*correlationId\)/);
    // 변경 처리기 본문만 잘라 본다 — 역할 판정이 있고, 그것이 변경 함수 호출보다 앞선다.
    const start = routes.indexOf('app.post(GH_POLICY_CHANGES_PATH');
    const end = routes.indexOf('app.get(GH_CONTEXT_REPOSITORIES_PATH');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const changeHandler = routes.slice(start, end);
    expect(changeHandler).toMatch(/if\s*\(!hasRole\(principal\.roles,\s*'operator'\)\)/);
    expect(changeHandler.search(/hasRole\(principal\.roles,\s*'operator'\)/)).toBeLessThan(changeHandler.indexOf('changePolicy('));
    expect(existsSync(`${root}apps/web/app/ops/gh-policy/page.tsx`)).toBe(true);
    expect(read('apps/web/lib/nav.ts')).toMatch(/id:\s*'ops-gh-policy'[\s\S]{0,200}allowedRoles:\s*\['operator',\s*'security_officer'\]/);
    // 쓰기 요청의 중복 방지 키가 web 프록시를 지난다 — 빠지면 실제 배포에서 실행·정책 변경이 400이다 (DEV-690).
    expect(read('apps/web/lib/proxy.ts')).toMatch(/^\s*'idempotency-key',\r?$/m);
  });

  it('gh 계열 소스에 원시 제어 문자가 없다 — 도구가 지운 ESC가 시험을 거짓 실패시켰다', () => {
    const files = [...GH_PLANE, 'packages/gh-cli/testing', 'apps/gh-executor/integration', 'apps/search-api/integration/gh', 'apps/web/app/gh', 'apps/web/lib']
      .flatMap(walk)
      .concat(walk('apps/web/components').filter((file) => /\/(Gh[A-Za-z]+|SafeGhOutputViewer)\.tsx$/.test(file)));
    expect(files.length).toBeGreaterThan(40);
    // eslint-disable-next-line no-control-regex -- 제어 문자를 찾는 것이 이 검사의 목적이다
    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f]/;
    const offenders = files.filter((file) => control.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
