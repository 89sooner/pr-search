/**
 * 발행 되돌리기가 남의 태그를 지우지 않는다 (DEV-541 / PR #125 머지 후 리뷰 P1).
 *
 * 같은 버전을 같은 커밋으로 두 실행이 겹치면, "이 실행 전에는 없었고 지금 내 커밋을
 * 가리킨다"는 조건이 **남의 태그에도 참**이 된다. OID 일치는 대상을 증명하지 소유를
 * 증명하지 않는다. 그래서 소유는 **원자적 생성의 성공**으로만 얻고, 삭제에는 기대값을
 * 걸어 그 사이 태그가 옮겨졌으면 지우지 않는다.
 *
 * 이 시험은 `build-bundle.sh`를 실제로 실행한다. `git`은 진짜이고 원격은 로컬 bare
 * 저장소이며, `gh`와 `docker`만 대역이다. 대역 `gh`의 `POST /git/refs`는 원격의 실제
 * 상태를 보고 이미 있으면 422를 내 GitHub의 원자성을 그대로 흉내낸다.
 *
 * Refs: DEV-541 WP-072 CR-063
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES = join(REPO_ROOT, 'regression/fixtures/release-tag');
const VERSION = '9.9.9-ownership-test';

let root: string;

/** 스크립트가 요구하는 최소 저장소. 실제 저장소를 복제하지 않는다 — 이 시험의 관심사는 태그다. */
const makeWorkspace = (): { work: string; remote: string; commit: string; other: string } => {
  const dir = mkdtempSync(join(root, 'ws-'));
  const remote = join(dir, 'remote.git');
  const work = join(dir, 'work');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  execFileSync('git', ['init', '-q', '--bare', remote]);
  mkdirSync(work, { recursive: true });
  git(work, 'init', '-q');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'test');
  // 번들 내용이 빌더의 개행 설정에 따라 달라지지 않게 한다 (DEV-526과 같은 이유).
  git(work, 'config', 'core.autocrlf', 'false');

  mkdirSync(join(work, 'packages/db/migrations'), { recursive: true });
  mkdirSync(join(work, 'packages/es/src/mappings'), { recursive: true });
  mkdirSync(join(work, 'deploy/single-host'), { recursive: true });
  writeFileSync(join(work, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(work, 'packages/db/migrations/001_init.up.sql'), 'SELECT 1;\n');
  // `set -o pipefail` 아래에서 매핑 해시의 `cat`이 실패하면 스크립트가 거기서 멈춘다.
  writeFileSync(join(work, 'packages/es/src/mappings/commits.ts'), 'export const m = {};\n');
  writeFileSync(join(work, 'packages/es/src/indices.ts'), 'export const i = [];\n');
  writeFileSync(join(work, 'packages/es/src/settings.ts'), 'export const s = {};\n');
  writeFileSync(join(work, '.nvmrc'), '22\n');
  writeFileSync(join(work, 'package.json'), '{"packageManager":"pnpm@9.0.0"}\n');
  writeFileSync(join(work, 'deploy/single-host/compose.yml'), 'services: {}\n');
  writeFileSync(join(work, 'deploy/single-host/RUNBOOK.md'), '# runbook\n');
  copyFileSync(join(REPO_ROOT, 'deploy/single-host/build-bundle.sh'), join(work, 'deploy/single-host/build-bundle.sh'));
  chmodSync(join(work, 'deploy/single-host/build-bundle.sh'), 0o755);

  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  const commit = git(work, 'rev-parse', 'HEAD');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

  // 비교용 두 번째 커밋. 원격이 그 객체를 알아야 태그를 그리로 옮길 수 있다.
  const other = git(work, 'commit-tree', `${commit}^{tree}`, '-p', commit, '-m', 'other');
  git(work, 'push', '-q', 'origin', `${other}:refs/heads/other`);
  return { work, remote, commit, other };
};

const run = (ws: ReturnType<typeof makeWorkspace>, env: Record<string, string>) => {
  const binDir = mkdtempSync(join(root, 'bin-'));
  for (const [name, source] of [['gh', 'fake-gh'], ['docker', 'fake-docker']]) {
    copyFileSync(join(FIXTURES, source), join(binDir, name));
    chmodSync(join(binDir, name), 0o755);
  }
  try {
    const stdout = execFileSync('bash', ['deploy/single-host/build-bundle.sh', VERSION, '--release'], {
      cwd: ws.work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        FAKE_REMOTE: ws.remote,
        FAKE_COMMIT: ws.commit,
        FAKE_OTHER_COMMIT: ws.other,
        FAKE_VERSION: VERSION,
        ...env,
      },
    });
    return { ok: true, output: stdout };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
};

const remoteTag = (ws: { remote: string }): string => {
  try {
    return execFileSync('git', ['--git-dir', ws.remote, 'rev-parse', '--verify', '-q', `refs/tags/${VERSION}`], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'prs-tag-own-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('발행 되돌리기의 태그 소유권 (DEV-541)', () => {
  it('C1·C3: 태그가 없을 때 이 실행이 만들고, 되돌리기가 그 태그를 지운다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_ASSET_MISMATCH: '1' });
    expect(result.ok).toBe(false); // 자산 대조가 어긋나 되돌리기가 돈다
    expect(result.output).toContain('릴리스와 태그를 되돌렸다');
    expect(remoteTag(ws)).toBe(''); // 자기가 만든 태그는 지운다
  });

  it('C2·C4: 같은 버전·같은 커밋을 다른 실행이 먼저 만들면 소유하지 않고, 되돌리기가 지우지 않는다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_RACE_AT_DRAFT: '1', FAKE_ASSET_MISMATCH: '1' });
    expect(result.ok).toBe(false);
    // 커밋이 같아도 소유가 아니다 — 이것이 이 P1의 핵심이다.
    expect(result.output).toContain('다른 실행이 먼저 만들었다');
    expect(result.output).toContain('이 실행이 만든 것이 아니다 — 지우지 않는다');
    // 되돌리기 보고도 사실대로 말한다 — "되돌렸다"고 단정하지 않는다 (DEV-533).
    expect(result.output).toContain('이 실행이 만든 것이 아니므로 지우지 않았다');
    expect(result.output).not.toContain('릴리스와 태그를 되돌렸다');
    expect(remoteTag(ws)).toBe(ws.commit); // 남의 태그가 그대로 남는다
  });

  it('C5: 만든 뒤 태그가 옮겨지면 되돌리기가 지우지 않고 그 사실을 말한다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_RETARGET_AFTER_REF: '1', FAKE_ASSET_MISMATCH: '1' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('옮겨졌거나 삭제가 거부됐다');
    expect(result.output).not.toContain('릴리스와 태그를 되돌렸다');
    expect(remoteTag(ws)).toBe(ws.other); // 옮겨진 상태 그대로 보존된다
  });

  it('C6: 다른 커밋을 가리키는 태그가 이미 있으면 이미지를 빌드하기 전에 멈추고 건드리지 않는다', () => {
    const ws = makeWorkspace();
    execFileSync('git', ['--git-dir', ws.remote, 'update-ref', `refs/tags/${VERSION}`, ws.other]);
    const result = run(ws, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('다른 커밋');
    expect(result.output).not.toContain('이미지 빌드');
    expect(remoteTag(ws)).toBe(ws.other);
  });

  it('DEV-559: 삭제 실패 뒤 A→B→A로 돌아와도 복구 안내는 태그를 보존한다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_RETARGET_AFTER_REF: '1', FAKE_ASSET_MISMATCH: '1' });
    expect(result.ok).toBe(false);
    expect(remoteTag(ws)).toBe(ws.other);
    execFileSync('git', ['--git-dir', ws.remote, 'update-ref', `refs/tags/${VERSION}`, ws.commit]);
    // 같은 OID의 lease는 다른 주체가 되돌린 태그도 삭제한다.
    execFileSync('git', ['push', `--force-with-lease=refs/tags/${VERSION}:${ws.commit}`,
      'origin', `:refs/tags/${VERSION}`], { cwd: ws.work, stdio: 'pipe' });
    expect(remoteTag(ws)).toBe('');
    // 따라서 실패 뒤 안내에는 삭제 명령을 제공하지 않는다.
    expect(result.output).not.toContain('git push --force-with-lease=');
    expect(result.output).toContain('소유를 증명하지 않는다');
    expect(result.output).toContain('새 버전으로');
  });
});

/**
 * 되돌릴 수 없는 일 앞에 검사를 둔다 (DEV-544 / PR #145 머지 후 리뷰 P1).
 *
 * `immutable releases`를 켠 저장소에서는 발행된 릴리스를 지우면 태그는 지울 수 있으나
 * **같은 태그 이름을 다시 쓸 수 없다**(GitHub 문서). 그래서 자산 대조가 발행 **뒤**에
 * 있으면, 일시적인 조회 실패 하나로 그 버전이 영구히 타 버린다 — 파일은 멀쩡히 올라갔는데도.
 *
 * 고친 것은 둘이다. 대조를 발행 앞으로 옮겼고, 발행 뒤에는 되돌리지 않는다.
 *
 * Refs: DEV-544 DEV-530 WP-072
 */
describe('발행 전 대조와 발행 후 불가역 (DEV-544)', () => {
  /** 대역 `gh`가 PATCH(발행)를 받으면 남기는 자국. 이것이 없으면 발행에 닿지 않은 것이다. */
  const publishedMarker = (ws: { remote: string }): boolean =>
    existsSync(join(ws.remote, '..', 'fake-gh.state.published'));

  const archiveOf = (ws: { work: string }): string =>
    join(ws.work, 'deploy/single-host/bundle', `pr-search-${VERSION}-offline.tar.gz`);

  it('C7: 자산이 어긋나면 발행에 닿기 전에 멈춘다 — 되돌리기가 성립하는 자리다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_ASSET_MISMATCH: '1', FAKE_IMMUTABLE: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('초안 자산');
    expect(result.output).toContain('발행하지 않았다');
    // **발행에 닿지 않았다는 것이 이 시험의 전부다.** 닿았다면 잠긴 저장소에서 버전이 탄다.
    expect(publishedMarker(ws)).toBe(false);
    expect(result.output).toContain('릴리스와 태그를 되돌렸다');
    expect(remoteTag(ws)).toBe('');
  });

  it('C8: 조회 실패를 불일치로 세지 않고, 그때도 발행하지 않는다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_ASSET_QUERY_FAIL: '1', FAKE_IMMUTABLE: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('조회하지 못했다');
    // "이름이 다르다"로 오분류하지 않는다 — 그 둘은 다른 사실이다 (DEV-042의 교훈).
    expect(result.output).not.toContain('이름이 다르다');
    expect(publishedMarker(ws)).toBe(false);
    expect(remoteTag(ws)).toBe('');
  });

  it('C9: 발행 요청이 실패해도 서버에 적용됐으면 되돌리지 않는다', () => {
    const ws = makeWorkspace();
    const result = run(ws, {
      FAKE_ARCHIVE: archiveOf(ws),
      FAKE_PUBLISH_PATCH_FAIL: '1',
      FAKE_DRAFT_AFTER_PATCH: 'false', // 서버에는 적용됐다
      FAKE_IMMUTABLE: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('서버에는 적용됐다');
    expect(result.output).toContain('되돌리지 않는다');
    // 잠긴 저장소라는 사실을 그 자리에서 말한다 — 사람이 판단할 근거다.
    expect(result.output).toContain('다시 쓸 수 없다');
    // 되돌리기가 돌지 않았으므로 태그가 남는다.
    expect(remoteTag(ws)).toBe(ws.commit);
  });

  it('C9b: 발행 요청이 실패하고 서버도 초안 그대로면 되돌린다', () => {
    const ws = makeWorkspace();
    const result = run(ws, {
      FAKE_ARCHIVE: archiveOf(ws),
      FAKE_PUBLISH_PATCH_FAIL: '1',
      FAKE_DRAFT_AFTER_PATCH: 'true', // 적용되지 않았다
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('서버도 초안 그대로다');
    expect(result.output).toContain('릴리스와 태그를 되돌렸다');
    expect(remoteTag(ws)).toBe('');
  });

  it('C10: 발행 뒤 확인 조회가 실패해도 되돌리지 않는다', () => {
    const ws = makeWorkspace();
    const result = run(ws, {
      FAKE_ARCHIVE: archiveOf(ws),
      FAKE_PUBLISH_CHECK_FAIL: '1',
      FAKE_IMMUTABLE: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('확인 조회가 실패했다');
    expect(result.output).toContain('되돌리지 않는다');
    expect(publishedMarker(ws)).toBe(true); // 발행은 됐다
    expect(remoteTag(ws)).toBe(ws.commit); // 태그를 지우지 않는다
  });

  it('C11: 자산이 맞으면 발행까지 간다 — 대조를 앞으로 옮겨도 성공 경로가 성립한다', () => {
    const ws = makeWorkspace();
    const result = run(ws, { FAKE_ARCHIVE: archiveOf(ws), FAKE_IMMUTABLE: 'true' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('번들 완료');
    expect(result.output).toContain('immutable releases : 켜짐');
    expect(publishedMarker(ws)).toBe(true);
    expect(remoteTag(ws)).toBe(ws.commit);
  });
});
