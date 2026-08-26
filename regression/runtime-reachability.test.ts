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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
    const indexed = COMMIT_ENRICH.indexOf('await upsertCommitMetadata(');
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
    expect(jobs).toContain("export const OPERATOR_JOB_TYPES = ['backfill', 'link_rebuild'] as const;");
    expect(routes).toContain("if (!isOperatorJobType(body['type'])) {");
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
    const remove = LINK.indexOf('deleteStaleReferenceLinks(deps.es');
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
    expect(LINK).toContain('await handleRelationsReady(deps, repository, source)');
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
    expect(reeval).toContain('await deriveRelations(deps, repository, target)');
    expect(reeval).not.toContain('await handleRelationsReady(deps, repository, target)');
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
    const remove = RELATIONS.indexOf('await deleteStaleDerivedLinks(deps.es');
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

  it('**범위 요약이 되돌림 수를 같은 왕복에서 센다** (DEV-239) — N+1이 아니다', () => {
    const range = read('apps/search-api/src/sequence/range.ts');
    expect(range).toContain("reverted: { filter: { term: { 'link_summary.is_reverted': true } } }");
    expect(range).toContain('reverted_pull_request_count: aggs.reverted?.doc_count ?? 0');
    // 간선 인덱스를 여기서 읽지 않는다.
    expect(range).not.toContain('prs-links');
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
      .filter((name) => name !== 'secret.example.yaml');

    expect(manifests.length).toBeGreaterThan(0);
    for (const name of manifests) {
      expect(applyBlock, `${name}이 적용 순서에 없다`).toContain(name);
    }
  });
});
