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
   * **발행한 것을 다시 읽어 본다** (DEV-519의 규율). 이름·크기·digest 셋을 로컬과
   * 대조하고, 어긋나면 되돌리고 실패한다. 검사가 없으면 "올렸다"가 "같은 것을 올렸다"로 읽힌다.
   */
  it('build-bundle.sh가 발행한 자산을 다시 읽어 이름·크기·digest를 대조한다 (DEV-519)', () => {
    expectOrder(BUILD, 'gh release create', 'releases/tags/${VERSION}');
    // 초안 → 자산 → 발행. immutable releases가 켜진 저장소에서는 발행 뒤 자산을 붙일 수 없다 (DEV-530)
    expect(BUILD).toContain('--draft');
    expectOrder(BUILD, 'gh release create', '-F draft=false');
    expectOrder(BUILD, '-F draft=false', 'releases/tags/${VERSION}');
    expect(BUILD).toContain('.digest');
    expect(BUILD).toContain('발행된 자산 digest가 다르다');
    expect(BUILD).toContain('undo_release; die "발행된 자산 digest가 다르다');
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
      .filter((name) => name !== 'secret.example.yaml');

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
    expect(audit).toContain("NOT_ACTIVATED_AUDIT_ACTIONS = ['export.create']");
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
