/**
 * 커밋 모양별 원본 저장소 (CR-139 / DEV-810 통합 시험).
 *
 * **대조군과 유발 후보를 함께 둔다.** 결함의 조건은 "diff에 추가와 삭제가 함께 있어
 * 이름 변경 감지가 blob 내용을 요구하는 커밋"이다. 수정만·추가만·정확한 이름 변경
 * (내용 동일)·추가만 있는 병합은 그 조건에 걸리지 않아야 하고, 이름 변경+수정·
 * 삭제+무관한 추가·둘째 부모 기준으로 추가와 삭제가 섞이는 병합은 걸려야 한다.
 * 한쪽만 있으면 가설이 틀려도 시험이 통과한다.
 *
 * 메타데이터 모양(루트·부모 셋·여러 줄·빈 메시지·한글·작성자≠커미터·시간대 오프셋)은
 * 필드 단위 대조를 위해 함께 둔다.
 *
 * **HEAD에 `.mailmap`이 있는 변형**을 따로 만든다 — bare 저장소에서 `mailmap.blob`의
 * 기본값이 `HEAD:.mailmap`이라 `git log`가 시작하면서 그 blob을 읽으려 한다 (DEV-811).
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTempDir, run } from './fixtures.js';

/** 시각을 커밋마다 따로 준다. 같은 시각이면 git이 정렬을 흔들 수 있다. */
function at(minute: number): string {
  return `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`;
}

const FIXTURE_ENV: NodeJS.ProcessEnv = {
  // 개발자의 전역 설정(core.autocrlf 등)이 픽스처의 SHA를 흔들지 않게 한다.
  HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1',
};

export const PROMISOR_CASES = [
  'root',
  'modifyOnly',
  'addOnly',
  'exactRename',
  'renameEdit',
  'deleteAdd',
  'mergeAddDelete',
  'mergeClean',
  'octopus',
  'multiline',
  'emptyMessage',
  'korean',
  'authorNeCommitter',
] as const;

export type PromisorCase = (typeof PROMISOR_CASES)[number];

/** 이름 변경 감지 때문에 `git show`가 blob을 요구하는 커밋 (DEV-810의 유발 조건). */
export const RENAME_CANDIDATE_CASES: readonly PromisorCase[] = ['renameEdit', 'deleteAdd', 'mergeAddDelete'];

export interface PromisorOrigin {
  /** 작업 트리가 있는 원본 저장소. 서빙은 `${dir}/.git`이다. */
  readonly dir: string;
  readonly gitDir: string;
  readonly shas: Readonly<Record<PromisorCase, string>>;
  /** 주석 태그 객체의 SHA (커밋이 아니다). */
  readonly annotatedTagObject: string;
}

export const MULTILINE_MESSAGE = 'subject line\n\nbody line 1\nbody line 2 | with pipe\n\n    indented block\ntrailing';
export const KOREAN_MESSAGE = '한글 커밋 메시지 — ✓ café 🚀\n\n본문 둘째 줄';

export const AUTHOR_NE_COMMITTER = {
  author: 'Ünïcødé 작성자',
  authorEmail: 'author@example.invalid',
  authoredAt: '2026-01-02T09:00:00+09:00',
  committer: 'Committer Lee',
  committerEmail: 'committer@example.invalid',
  committedAt: '2026-01-02T01:30:00-05:30',
} as const;

function lines(prefix: string, count: number): string {
  return `${Array.from({ length: count }, (_, index) => `${prefix} line ${String(index + 1)}`).join('\n')}\n`;
}

export async function createPromisorOrigin(): Promise<PromisorOrigin> {
  const dir = await makeTempDir('prs-promisor-origin-');
  let minute = 0;
  /** 모든 git 호출이 같은 환경을 쓴다. checkout과 commit이 다른 개행 설정을 보면 커밋 모양이 흔들린다. */
  const g = (args: readonly string[], overrides: NodeJS.ProcessEnv = {}): Promise<string> =>
    run(dir, args, { ...FIXTURE_ENV, ...overrides });
  const next = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
    minute += 1;
    return { GIT_AUTHOR_DATE: at(minute), GIT_COMMITTER_DATE: at(minute), ...overrides };
  };
  const put = (name: string, body: string): Promise<void> => writeFile(join(dir, name), body, 'utf8');
  const head = async (): Promise<string> => (await g(['rev-parse', 'HEAD'])).trim();
  const commit = async (message: string, overrides: NodeJS.ProcessEnv = {}, extra: readonly string[] = []): Promise<string> => {
    const commitEnv = next(overrides);
    await g(['add', '-A'], commitEnv);
    await g(['commit', '-q', '--allow-empty', ...extra, '-m', message], commitEnv);
    return head();
  };
  const merge = async (message: string, ...branches: string[]): Promise<string> => {
    await g(['merge', '-q', '--no-ff', '-m', message, ...branches], next());
    return head();
  };

  await g(['init', '-q', '-b', 'main']);
  await g(['config', 'core.autocrlf', 'false']);
  // 부분 클론 필터와 임의 객체 want를 켠다. 켜지 않으면 필터가 조용히 무시된다.
  await g(['config', 'uploadpack.allowFilter', 'true']);
  await g(['config', 'uploadpack.allowAnySHA1InWant', 'true']);

  await put('a.txt', lines('alpha', 40));
  await put('b.txt', lines('bravo', 40));
  await put('keep.txt', lines('keep', 40));
  const root = await commit('root commit');

  await put('a.txt', lines('alpha', 41));
  const modifyOnly = await commit('control: modify only');

  await put('new.txt', lines('new', 10));
  const addOnly = await commit('control: add only');

  // feature는 여기서 갈라진다 — 병합 때 둘째 부모 기준 diff에 추가와 삭제가 섞인다.
  await g(['branch', 'feature']);

  await g(['mv', 'keep.txt', 'kept.txt']);
  const exactRename = await commit('control: exact rename (content unchanged)');

  await g(['mv', 'b.txt', 'b2.txt']);
  await put('b2.txt', lines('bravo', 40).replace('bravo line 7', 'bravo line 7 edited'));
  const renameEdit = await commit('trigger: rename with edit');

  await g(['rm', '-q', 'a.txt']);
  await put('z.txt', lines('zulu', 25));
  const deleteAdd = await commit('trigger: delete one file and add an unrelated one');

  await g(['checkout', '-q', 'feature']);
  await put('feat.txt', lines('feat', 10));
  await commit('feature work');
  await g(['checkout', '-q', 'main']);
  const mergeAddDelete = await merge('Merge pull request #7 from acme/feature', 'feature');

  await g(['checkout', '-q', '-b', 'feature2']);
  await put('f2.txt', lines('f2', 10));
  await commit('feature2 work');
  await g(['checkout', '-q', 'main']);
  await put('m2.txt', lines('m2', 10));
  await commit('main work before the clean merge');
  const mergeClean = await merge('control: merge with additions only', 'feature2');

  await g(['checkout', '-q', '-b', 'o1']);
  await put('o1.txt', lines('o1', 5));
  await commit('octopus leg 1');
  await g(['checkout', '-q', 'main']);
  await g(['checkout', '-q', '-b', 'o2']);
  await put('o2.txt', lines('o2', 5));
  await commit('octopus leg 2');
  await g(['checkout', '-q', 'main']);
  const octopus = await merge('octopus merge', 'o1', 'o2');

  await put('multi.txt', 'x\n');
  const multiline = await commit(MULTILINE_MESSAGE);

  const emptyMessage = await commit('', {}, ['--allow-empty-message']);

  await put('korean.txt', '한글\n');
  const korean = await commit(KOREAN_MESSAGE);

  await put('people.txt', 'people\n');
  const authorNeCommitter = await commit('author differs from committer', {
    GIT_AUTHOR_NAME: AUTHOR_NE_COMMITTER.author,
    GIT_AUTHOR_EMAIL: AUTHOR_NE_COMMITTER.authorEmail,
    GIT_AUTHOR_DATE: AUTHOR_NE_COMMITTER.authoredAt,
    GIT_COMMITTER_NAME: AUTHOR_NE_COMMITTER.committer,
    GIT_COMMITTER_EMAIL: AUTHOR_NE_COMMITTER.committerEmail,
    GIT_COMMITTER_DATE: AUTHOR_NE_COMMITTER.committedAt,
  });

  await g(['tag', '-a', 'v1', '-m', 'annotated tag', modifyOnly], next());
  const annotatedTagObject = (await g(['rev-parse', 'v1'])).trim();

  return {
    dir,
    gitDir: join(dir, '.git'),
    shas: {
      root,
      modifyOnly,
      addOnly,
      exactRename,
      renameEdit,
      deleteAdd,
      mergeAddDelete,
      mergeClean,
      octopus,
      multiline,
      emptyMessage,
      korean,
      authorNeCommitter,
    },
    annotatedTagObject,
  };
}

/** HEAD에 `.mailmap`을 더한 사본을 만든다. 히스토리는 원본과 같고 커밋이 하나 더 있다. */
export async function createMailmapOrigin(source: PromisorOrigin): Promise<{ readonly dir: string; readonly gitDir: string }> {
  const dir = await makeTempDir('prs-promisor-mailmap-');
  await run(dir, ['clone', '-q', '--no-local', source.dir, '.'], FIXTURE_ENV);
  await run(dir, ['config', 'core.autocrlf', 'false'], FIXTURE_ENV);
  await run(dir, ['config', 'uploadpack.allowFilter', 'true'], FIXTURE_ENV);
  await run(dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true'], FIXTURE_ENV);
  await writeFile(join(dir, '.mailmap'), 'Mapped Name <mapped@example.invalid> fixture <fixture@example.com>\n', 'utf8');
  const commitEnv = { ...FIXTURE_ENV, GIT_AUTHOR_DATE: at(59), GIT_COMMITTER_DATE: at(59) };
  await run(dir, ['add', '.mailmap'], commitEnv);
  await run(dir, ['commit', '-q', '-m', 'add .mailmap at HEAD'], commitEnv);
  return { dir, gitDir: join(dir, '.git') };
}

/** 원본(모든 blob 보유)에서 옛 명령으로 읽은 값 — "의미가 바뀌지 않았다"의 정답지다. */
export const METADATA_FORMAT = '--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%B';
