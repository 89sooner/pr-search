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

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
    id: 'JOB-ING-008',
    what: 'PG↔ES 정합성 감시',
    process: 'pipeline-worker',
    role: 'project',
    start: 'consistencySweeper = startConsistencySweeper(',
    stop: 'consistencySweeper?.stop()',
    manifest: 'deploy/k8s/pipeline-worker-project.yaml',
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
});

describe('주기 스윕을 가진 역할은 replica 1이다', () => {
  // 리더 선출이 없다 — 여러 파드가 같은 주기에 같은 대상을 중복 처리한다.
  it.each(['deploy/k8s/pipeline-worker-sequence.yaml', 'deploy/k8s/pipeline-worker-reconcile.yaml'])(
    '%s',
    (manifest) => {
      expect(read(manifest)).toMatch(/replicas:\s*1\b/);
    },
  );
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
});
