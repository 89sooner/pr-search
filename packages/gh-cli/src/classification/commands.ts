/**
 * leaf command 196개의 의미 분류 표 (FR-GH-001 AC-2·AC-8·AC-9·AC-11, ADR-019, NFR-009, WP-045 / CR-088).
 *
 * **사람이 적은 표다.** 인벤토리(자동 추출)는 command가 무엇을 받는지는 말하지만 그것이
 * 읽기인지 쓰기인지, 브라우저·터미널·작업 트리를 요구하는지, 결과가 비밀인지는 말하지
 * 않는다. 그 판정은 고정 gh 2.97.0의 `--help` 원문(`testing/fixtures`·세션 실측)을 읽고
 * 여기 적었다. 행마다 `note`가 판정의 근거 문장이다 — 근거가 이름뿐인 행은 그 사실을 적는다.
 *
 * ## 이 표가 하지 않는 것
 *
 * - **실행을 열지 않는다.** 실행 허용은 `capabilities.ts`의 `EXECUTABLE_CAPABILITIES`만 정한다.
 *   여기 `supported`로 적힌 195개는 여전히 `not_implemented`다. 검증기가 그 사실을 건다.
 * - **호스트 지원을 단정하지 않는다.** 사내 GHES에서 확인한 것이 없으므로 `unsupported_by_host`는
 *   0건이고, 모든 행의 `hostSupport`는 `unverified`다 (FR-GH-011 AC-4·AC-5는 다음 판).
 * - **미지원을 정책 차단으로 위장하지 않는다.** `policy_blocked`는 이 제품이 **열지 않기로 정한**
 *   것(자격 관리·셸 확장·실행기 설정)에만 쓴다.
 *
 * ## 위험도 사다리 (FR-GH-009 AC-1)
 *
 * R0 읽기 · R1 되돌릴 수 있는 쓰기(코멘트·편집·닫기·재실행) · R2 되돌리기 어려운 쓰기(삭제·
 * 병합·설정·접근 부여·비용 발생) · R3 자격·비밀·정책·조직 범위(토큰·secret 값·저장소 삭제·
 * 임의 코드 실행). **이름만 보고 정하지 않았다** — `variable list`는 「list」지만 값을 그대로
 * 찍으므로 결과가 sensitive이고, `gh api`는 `-X` 하나로 삭제가 되므로 arbitrary다.
 */

import type {
  GhAuthRequirement,
  GhContextRequirement,
  GhInteractionMode,
  GhResultContract,
  GhRiskLevel,
  GhSideEffect,
  GhSupportStatus,
} from '../types.js';

export interface CommandRow {
  readonly support: Exclude<GhSupportStatus, 'unknown'>;
  readonly interaction: Exclude<GhInteractionMode, 'unknown'>;
  readonly risk: GhRiskLevel;
  readonly sideEffect: Exclude<GhSideEffect, 'unknown'>;
  readonly auth: Exclude<GhAuthRequirement, 'unknown'>;
  readonly result: GhResultContract['kind'];
  readonly sensitivity: GhResultContract['sensitivity'];
  readonly stdin?: 'optional' | 'required';
  readonly contexts: readonly GhContextRequirement[];
  /** 판정의 근거 — help 원문 인용 또는 규칙. 비워 두지 않는다. */
  readonly note: string;
}

type Kind = GhResultContract['kind'];
type Sens = GhResultContract['sensitivity'];

const REPO: readonly GhContextRequirement[] = ['repository'];
const HOST: readonly GhContextRequirement[] = ['host'];
const NONE: readonly GhContextRequirement[] = ['none'];
const ORG: readonly GhContextRequirement[] = ['organization'];
const GIST: readonly GhContextRequirement[] = ['gist'];
const CODESPACE: readonly GhContextRequirement[] = ['codespace'];
const PROJECT: readonly GhContextRequirement[] = ['project'];

/** GHE를 읽는 일반 command. */
function read(result: Kind, sensitivity: Sens, contexts: readonly GhContextRequirement[], note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'supported', interaction: 'web_native', risk: 'R0', sideEffect: 'read', auth: 'token', result, sensitivity, contexts, note, ...extra };
}

/** 되돌릴 수 있는 쓰기 (R1). */
function write(result: Kind, contexts: readonly GhContextRequirement[], note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'supported', interaction: 'web_native', risk: 'R1', sideEffect: 'write', auth: 'token', result, sensitivity: 'internal', contexts, note, ...extra };
}

/** 되돌리기 어려운 쓰기·삭제 (R2 기본). */
function destructive(result: Kind, contexts: readonly GhContextRequirement[], note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'supported', interaction: 'web_native', risk: 'R2', sideEffect: 'destructive', auth: 'token', result, sensitivity: 'internal', contexts, note, ...extra };
}

/** 실행 호스트만 바꾸는 로컬 command — 터미널·작업 트리·편집기가 필요하다. */
function terminal(support: Exclude<GhSupportStatus, 'unknown'>, risk: GhRiskLevel, note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support, interaction: 'terminal_only', risk, sideEffect: 'local', auth: 'token', result: 'exit_status', sensitivity: 'internal', contexts: ['workspace'], note, ...extra };
}

/** 이 제품이 열지 않기로 정한 command — 자격·셸·실행기 설정. */
function blocked(risk: GhRiskLevel, sideEffect: Exclude<GhSideEffect, 'unknown'>, result: Kind, sensitivity: Sens, note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'policy_blocked', interaction: 'policy_blocked', risk, sideEffect, auth: 'none', result, sensitivity, contexts: NONE, note, ...extra };
}

/** extension plane (ADR-019) — 관리자 허용 목록 없이는 열지 않는다. */
function extension(interaction: Exclude<GhInteractionMode, 'unknown'>, risk: GhRiskLevel, sideEffect: Exclude<GhSideEffect, 'unknown'>, result: Kind, note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'requires_extension', interaction, risk, sideEffect, auth: 'token', result, sensitivity: 'internal', contexts: NONE, note, ...extra };
}

/** gh가 preview로 표시한 command. 분류는 하되 미리보기라는 사실을 support에 남긴다. */
function preview(risk: GhRiskLevel, sideEffect: Exclude<GhSideEffect, 'unknown'>, result: Kind, contexts: readonly GhContextRequirement[], note: string, extra: Partial<CommandRow> = {}): CommandRow {
  return { support: 'preview', interaction: 'web_native', risk, sideEffect, auth: 'token', result, sensitivity: 'internal', contexts, note, ...extra };
}

const PREVIEW_NOTE = 'help 요약이 「(preview)」다 — gh가 바뀔 수 있다고 적은 command';
const NAME_ONLY = '판정 근거는 help 요약과 동사뿐이다';

/**
 * path(공백 결합) → 행. leaf 196개 전부 있어야 한다 — `commands.test.ts`가 인벤토리와 1:1을 건다.
 */
export const COMMAND_ROWS: Readonly<Record<string, CommandRow>> = {
  /* ---- agent-task (preview) */
  'agent-task create': preview('R1', 'write', 'resource', REPO, `${PREVIEW_NOTE}. 「Create an agent task」 — 에이전트 세션을 만든다`),
  'agent-task list': preview('R0', 'read', 'json', REPO, `${PREVIEW_NOTE}. 「List agent tasks」`),
  'agent-task view': preview('R0', 'read', 'json', REPO, `${PREVIEW_NOTE}. 「View an agent task session」`),

  /* ---- alias — 실행기의 gh 설정은 실행마다 비어 있고, 확장은 셸 명령이 될 수 있다 */
  'alias delete': blocked('R1', 'local', 'exit_status', 'internal', 'gh 설정 파일을 고친다. 실행기의 설정 디렉터리는 실행마다 새로 만들어 남지 않으므로 뜻이 없다'),
  'alias import': blocked('R3', 'local', 'exit_status', 'internal', 'help: 「Import aliases from a YAML file」 — 파일의 확장이 `!`로 시작하면 셸 명령이다 (`alias set` help)'),
  'alias list': blocked('R0', 'local', 'text', 'internal', '실행기의 설정에는 별칭이 없다 — 항상 빈 목록이다'),
  'alias set': blocked('R3', 'local', 'exit_status', 'internal', 'help: 「If the expansion starts with `!` or if `--shell` was given, the expansion is a shell command」 — 셸 실행 경로다'),

  /* ---- api — 임의 엔드포인트·임의 메서드 */
  api: {
    support: 'supported',
    interaction: 'web_equivalent',
    risk: 'R2',
    sideEffect: 'arbitrary',
    auth: 'token',
    result: 'json',
    sensitivity: 'sensitive',
    stdin: 'optional',
    contexts: HOST,
    note: 'help: 「Makes an authenticated HTTP request to the GitHub API and prints the response」. `-X`로 메서드를 고르므로 부작용은 입력이 정한다(arbitrary). 웹 등가는 스키마 인지 폼(W-020, WP-056·064)이다',
  },

  /* ---- attestation */
  'attestation download': read('artifact', 'internal', REPO, 'help: 「Download an artifact\'s attestations for offline use」 — 번들 파일을 쓴다(파일 출력)'),
  'attestation trusted-root': read('text', 'public', HOST, 'help: 「Output trusted_root.jsonl contents」 — 공개 신뢰 루트를 stdout에 낸다', { auth: 'none' }),
  'attestation verify': read('text', 'internal', REPO, 'help: 「Verify an artifact\'s integrity using attestations」 — 아티팩트 파일 또는 OCI 참조를 입력으로 받는다'),

  /* ---- auth — 자격은 이 제품이 위임 토큰으로 관리한다. gh의 자격 저장소를 쓰지 않는다 */
  'auth login': blocked('R3', 'local', 'exit_status', 'secret', '대화형 로그인·브라우저·토큰 입력. 실행기는 위임 토큰을 환경으로 받으며 gh 자격 저장소를 쓰지 않는다 (FR-GH-008)'),
  'auth logout': blocked('R3', 'local', 'exit_status', 'internal', 'gh 자격 저장소를 지운다 — 실행기에는 그 저장소가 없다'),
  'auth refresh': blocked('R3', 'local', 'exit_status', 'secret', '토큰 범위를 다시 인가한다 — 위임 토큰의 갱신은 search-api가 한다 (JOB-GH-004)'),
  'auth setup-git': blocked('R2', 'local', 'exit_status', 'internal', 'git 자격 도우미를 설정한다 — 실행기에는 git 작업 트리가 없다'),
  'auth status': blocked('R0', 'read', 'text', 'sensitive', 'help: 「Display active account and authentication state」 — `--show-token`이면 토큰을 찍는다'),
  'auth switch': blocked('R3', 'local', 'exit_status', 'internal', '계정 전환 — 실행기의 계정은 위임 신원 하나뿐이다'),
  'auth token': blocked('R3', 'read', 'text', 'secret', 'help: 「This command outputs the authentication token for an account」 — 결과가 비밀 그 자체다'),

  /* ---- browse */
  browse: read('url', 'internal', REPO, 'help: 「Transition from the terminal to the web browser」 — 실행기에는 브라우저가 없다. 웹 등가는 `--no-browser`가 찍는 URL을 링크로 주는 것이다', { interaction: 'web_equivalent' }),

  /* ---- cache */
  'cache delete': destructive('exit_status', REPO, 'help: 「Delete GitHub Actions caches」 — `--all`이면 전부'),
  'cache list': read('json', 'internal', REPO, 'help: 「List GitHub Actions caches」'),

  /* ---- codespace */
  'codespace code': terminal('terminal_only', 'R1', 'help: 「Open a codespace in Visual Studio Code」 — 로컬 편집기를 연다'),
  'codespace cp': terminal('terminal_only', 'R1', 'help: 「Copy files between local and remote file systems」 — 로컬 파일 시스템이 필요하다'),
  'codespace create': { support: 'supported', interaction: 'web_native', risk: 'R2', sideEffect: 'write', auth: 'token', result: 'resource', sensitivity: 'internal', contexts: REPO, note: 'help: 「Create a codespace」 — 과금되는 컴퓨트를 만든다. 되돌리려면 삭제해야 한다' },
  'codespace delete': destructive('exit_status', CODESPACE, 'help: 「Delete codespaces」 — `--all`·`--days`로 여럿을 지운다'),
  'codespace edit': write('resource', CODESPACE, 'help: 「Edit a codespace」 — 표시 이름·머신 변경'),
  'codespace jupyter': terminal('terminal_only', 'R1', 'help: 「Open a codespace in JupyterLab」 — 로컬 브라우저·포트 포워딩'),
  'codespace list': read('json', 'internal', NONE, 'help: 「List codespaces」'),
  'codespace logs': terminal('terminal_only', 'R0', 'help: 「Access codespace logs」 — SSH로 codespace에 붙어 스트림을 받는다', { sideEffect: 'read', result: 'stream' }),
  'codespace ports forward': terminal('terminal_only', 'R1', 'help: 「Forward ports」 — 로컬 포트를 연다'),
  'codespace ports visibility': write('exit_status', CODESPACE, 'help: 「Change the visibility of the forwarded port」 — `public`이면 인터넷에 노출된다', { risk: 'R2' }),
  'codespace rebuild': write('exit_status', CODESPACE, 'help: 「Rebuild a codespace」 — `--full`이면 캐시 없이 다시 만든다'),
  'codespace ssh': terminal('terminal_only', 'R2', 'help: 「SSH into a codespace」 — 원격 셸이며 `[<command>]`로 임의 명령을 넘긴다', { sideEffect: 'arbitrary' }),
  'codespace stop': write('exit_status', CODESPACE, 'help: 「Stop a running codespace」'),
  'codespace view': read('json', 'internal', CODESPACE, 'help: 「View details about a codespace」'),

  /* ---- completion · config · licenses — 실행 호스트의 gh 자체에 대한 것 */
  completion: terminal('terminal_only', 'R0', 'help: 「Generate shell completion scripts」 — 셸 설정용 스크립트. GHE와 무관하다', { sideEffect: 'read', result: 'text', sensitivity: 'public', auth: 'none', contexts: NONE }),
  'config clear-cache': blocked('R0', 'local', 'exit_status', 'internal', 'gh의 로컬 캐시를 지운다 — 실행기의 설정 디렉터리는 실행마다 새것이다'),
  'config get': blocked('R0', 'read', 'text', 'internal', 'gh 설정값을 읽는다 — 실행기 설정은 환경 변수로 봉인되어 있다 (NFR-010)'),
  'config list': blocked('R0', 'read', 'text', 'internal', 'gh 설정 목록 — 실행기 설정은 환경 변수로 봉인되어 있다 (NFR-010)'),
  'config set': blocked('R1', 'local', 'exit_status', 'internal', 'help: 「Update configuration with a value for the given key」 — 실행기 설정을 사용자가 바꾸게 두지 않는다'),
  copilot: extension('terminal_only', 'R3', 'arbitrary', 'stream', 'help: 「If the Copilot CLI is not installed, it will be downloaded to …」 — 외부 CLI를 내려받아 실행하는 대화형 에이전트다', { auth: 'token' }),
  licenses: read('text', 'public', NONE, 'help: 「View third-party license information」 — gh 자체의 라이선스 문서', { auth: 'none' }),

  /* ---- discussion (preview) */
  'discussion comment': preview('R1', 'write', 'resource', REPO, `${PREVIEW_NOTE}. 「Add, edit, or delete a comment」 — \`--delete-last\`는 삭제다`),
  'discussion create': preview('R1', 'write', 'resource', REPO, `${PREVIEW_NOTE}. 「Create a new discussion」`),
  'discussion edit': preview('R1', 'write', 'resource', REPO, `${PREVIEW_NOTE}. 「Edit a discussion」`),
  'discussion list': preview('R0', 'read', 'json', REPO, `${PREVIEW_NOTE}. 「List discussions in a repository」`),
  'discussion view': preview('R0', 'read', 'json', REPO, `${PREVIEW_NOTE}. 「View a discussion」`),

  /* ---- extension (ADR-019 — 별도 plane, 허용 목록 없이 열지 않는다) */
  'extension browse': extension('terminal_only', 'R1', 'local', 'exit_status', 'help: 「Enter a UI for browsing, adding, and removing extensions」 — 터미널 UI'),
  'extension create': extension('terminal_only', 'R1', 'local', 'exit_status', 'help: 「Create a new extension」 — 로컬 디렉터리에 뼈대를 만든다'),
  'extension exec': extension('sandbox_terminal', 'R3', 'arbitrary', 'stream', 'help가 인증을 요구해(종료 4) flag를 뽑지 못했다(DEV-653). 설치된 확장을 실행한다 — 무엇이든 될 수 있다'),
  'extension install': extension('web_native', 'R2', 'local', 'exit_status', 'help: 「Install a gh extension from a repository」 — 코드를 내려받아 설치한다. pin·허용 목록이 먼저다 (ADR-019)'),
  'extension list': extension('web_native', 'R0', 'read', 'text', 'help: 「List installed extension commands」 — 실행기에는 설치된 확장이 없어 항상 빈 목록이다'),
  'extension remove': extension('web_native', 'R1', 'local', 'exit_status', 'help: 「Remove an installed extension」'),
  'extension search': extension('web_native', 'R0', 'read', 'json', 'help: 「Search extensions to the GitHub CLI」 — GitHub 저장소 검색이며 읽기다'),
  'extension upgrade': extension('web_native', 'R2', 'local', 'exit_status', 'help: 「Upgrade installed extensions」 — 코드를 바꾼다'),

  /* ---- gist */
  'gist clone': terminal('requires_local_workspace', 'R0', 'help: 「Clone a gist locally」 — 작업 트리가 필요하다', { sideEffect: 'read', contexts: GIST }),
  'gist create': write('url', GIST, 'help: 「Create a new gist」 — `--public`이면 공개 콘텐츠가 된다. 파일 또는 stdin 입력', { stdin: 'optional', risk: 'R2' }),
  'gist delete': destructive('exit_status', GIST, 'help: 「Delete a gist」'),
  'gist edit': write('exit_status', GIST, 'help: 「Edit one of your gists」 — flag 없이는 편집기를 열므로 `--add`·`--filename`·`--desc`로만 연다'),
  'gist list': read('text', 'internal', NONE, 'help: 「List your gists」 — 비밀 gist도 목록에 있다'),
  'gist rename': write('exit_status', GIST, 'help: 「Rename a file in a gist」'),
  'gist view': read('text', 'sensitive', GIST, 'help: 「View the given gist or select from recent gists」 — 비밀 gist의 내용을 그대로 찍는다'),

  /* ---- gpg-key · ssh-key — 계정 자격 자산 */
  'gpg-key add': write('exit_status', NONE, 'help: 「Add a GPG key to your GitHub account」 — 키 파일 또는 stdin', { risk: 'R2', stdin: 'optional' }),
  'gpg-key delete': destructive('exit_status', NONE, 'help: 「Delete a GPG key from your GitHub account」'),
  'gpg-key list': read('text', 'internal', NONE, 'help: 「Lists GPG keys in your GitHub account」 — 공개 키 목록'),
  'ssh-key add': write('exit_status', NONE, 'help: 「Add an SSH key to your GitHub account」 — 접근 수단을 더한다. 키 파일 또는 stdin', { risk: 'R2', stdin: 'optional' }),
  'ssh-key delete': destructive('exit_status', NONE, 'help: 「Delete an SSH key from your GitHub account」'),
  'ssh-key list': read('text', 'internal', NONE, 'help: 「Lists SSH keys in your GitHub account」 — 공개 키 목록'),

  /* ---- issue */
  'issue close': write('resource', REPO, 'help: 「Close issue」 — reopen으로 되돌린다'),
  'issue comment': write('resource', REPO, 'help: 「Add a comment to an issue」 — `--edit-last`·`--delete-last`는 마지막 코멘트를 고치거나 지운다', { stdin: 'optional' }),
  'issue create': write('resource', REPO, 'help: 「Create a new issue」 — 본문은 flag 또는 파일', { stdin: 'optional' }),
  'issue delete': destructive('exit_status', REPO, 'help: 「Delete issue」 — 되돌릴 수 없다'),
  'issue develop': write('resource', REPO, 'help: 「Manage linked branches for an issue」 — 브랜치를 만든다. `--checkout`은 작업 트리가 필요하다'),
  'issue edit': write('resource', REPO, 'help: 「Edit issues」 — 여러 이슈를 한 번에 바꾼다'),
  'issue list': read('json', 'internal', REPO, 'help: 「List issues in a repository」'),
  'issue lock': write('exit_status', REPO, 'help: 「Lock issue conversation」'),
  'issue pin': write('exit_status', REPO, 'help: 「Pin an issue」'),
  'issue reopen': write('resource', REPO, 'help: 「Reopen issue」'),
  'issue status': read('json', 'internal', REPO, 'help: 「Show status of relevant issues」'),
  'issue transfer': destructive('resource', REPO, 'help: 「Transfer issue to another repository」 — 번호가 바뀌고 원래 저장소에서 사라진다'),
  'issue unlock': write('exit_status', REPO, 'help: 「Unlock issue conversation」'),
  'issue unpin': write('exit_status', REPO, 'help: 「Unpin an issue」'),
  'issue view': read('json', 'internal', REPO, 'help: 「View an issue」'),

  /* ---- label */
  'label clone': write('exit_status', REPO, 'help: 「Clones labels from one repository to another」 — `--force`면 덮어쓴다'),
  'label create': write('resource', REPO, 'help: 「Create a new label」'),
  'label delete': destructive('exit_status', REPO, 'help: 「Delete a label from a repository」'),
  'label edit': write('resource', REPO, 'help: 「Edit a label」'),
  'label list': read('json', 'internal', REPO, 'help: 「List labels in a repository」'),

  /* ---- org */
  'org list': read('text', 'internal', NONE, 'help: 「List organizations for the authenticated user」'),

  /* ---- pr */
  'pr checkout': terminal('requires_local_workspace', 'R1', 'help: 「Check out a pull request in git」 — 작업 트리가 필요하다', { contexts: REPO }),
  'pr checks': read('json', 'internal', REPO, 'help: 「Show CI status for a single pull request」 — `--watch`면 끝날 때까지 스트림'),
  'pr close': write('resource', REPO, 'help: 「Close a pull request」 — `--delete-branch`는 브랜치 삭제를 더한다'),
  'pr comment': write('resource', REPO, 'help: 「Add a comment to a pull request」', { stdin: 'optional' }),
  'pr create': write('resource', REPO, 'help: 「Create a pull request」 — 본문은 flag 또는 파일. `--web`은 브라우저', { stdin: 'optional' }),
  'pr diff': read('text', 'internal', REPO, 'help: 「View changes in a pull request」 — 패치 원문'),
  'pr edit': write('resource', REPO, 'help: 「Edit a pull request」'),
  'pr list': read('json', 'internal', REPO, 'help: 「List pull requests in a repository」 — R0 첫 수직이 여는 유일한 command (CR-086)'),
  'pr lock': write('exit_status', REPO, 'help: 「Lock pull request conversation」'),
  'pr merge': destructive('resource', REPO, 'help: 「Merge a pull request」 — 병합은 되돌리기 어렵고 `--admin`은 보호 규칙을 넘는다'),
  'pr ready': write('resource', REPO, 'help: 「Mark a pull request as ready for review」 — `--undo`로 되돌린다'),
  'pr reopen': write('resource', REPO, 'help: 「Reopen a pull request」'),
  'pr revert': write('resource', REPO, 'help: 「Revert a pull request」 — 되돌리기 PR을 새로 만든다'),
  'pr review': write('resource', REPO, 'help: 「Add a review to a pull request」 — `--approve`는 병합 조건에 영향', { stdin: 'optional' }),
  'pr status': read('json', 'internal', REPO, 'help: 「Show status of relevant pull requests」'),
  'pr unlock': write('exit_status', REPO, 'help: 「Unlock pull request conversation」'),
  'pr update-branch': write('exit_status', REPO, 'help: 「Update a pull request branch」 — base를 머지·리베이스해 커밋을 만든다'),
  'pr view': read('json', 'internal', REPO, 'help: 「View a pull request」'),

  /* ---- preview */
  'preview prompter': terminal('terminal_only', 'R0', 'help: 「Execute a test program to preview the prompter」 — 대화형 프롬프트 시험 도구', { sideEffect: 'read', auth: 'none', contexts: NONE, sensitivity: 'public' }),

  /* ---- project */
  'project close': write('resource', PROJECT, 'help: 「Close a project」 — `--undo`로 되돌린다'),
  'project copy': write('resource', PROJECT, 'help: 「Copy a project」'),
  'project create': write('resource', ORG, 'help: 「Create a project」'),
  'project delete': destructive('exit_status', PROJECT, 'help: 「Delete a project」'),
  'project edit': write('resource', PROJECT, 'help: 「Edit a project」'),
  'project field-create': write('resource', PROJECT, 'help: 「Create a field in a project」'),
  'project field-delete': destructive('exit_status', PROJECT, 'help: 「Delete a field in a project」 — 필드의 값이 함께 사라진다'),
  'project field-list': read('json', 'internal', PROJECT, 'help: 「List the fields in a project」 — `--format json`'),
  'project item-add': write('resource', PROJECT, 'help: 「Add a pull request or an issue to a project」'),
  'project item-archive': write('resource', PROJECT, 'help: 「Archive an item in a project」 — `--undo`로 되돌린다'),
  'project item-create': write('resource', PROJECT, 'help: 「Create a draft issue item in a project」'),
  'project item-delete': destructive('exit_status', PROJECT, 'help: 「Delete an item from a project by ID」'),
  'project item-edit': write('resource', PROJECT, 'help: 「Edit an item in a project」 — `--clear`는 값을 지운다'),
  'project item-list': read('json', 'internal', PROJECT, 'help: 「List the items in a project」 — `--format json`'),
  'project link': write('exit_status', PROJECT, 'help: 「Link a project to a repository or a team」'),
  'project list': read('json', 'internal', ORG, 'help: 「List the projects for an owner」 — `--format json`'),
  'project mark-template': write('exit_status', PROJECT, 'help: 「Mark a project as a template」 — `--undo`로 되돌린다'),
  'project unlink': write('exit_status', PROJECT, 'help: 「Unlink a project from a repository or a team」'),
  'project view': read('json', 'internal', PROJECT, 'help: 「View a project」 — `--format json`'),

  /* ---- release */
  'release create': write('resource', REPO, 'help: 「Create a new release」 — 태그를 만들 수 있고 자산 파일을 올린다', { stdin: 'optional' }),
  'release delete': destructive('exit_status', REPO, 'help: 「Delete a release」 — `--cleanup-tag`는 태그까지 지운다'),
  'release delete-asset': destructive('exit_status', REPO, 'help: 「Delete an asset from a release」'),
  'release download': read('artifact', 'internal', REPO, 'help: 「Download release assets」 — 파일을 쓴다(파일 출력)'),
  'release edit': write('resource', REPO, 'help: 「Edit a release」', { stdin: 'optional' }),
  'release list': read('json', 'internal', REPO, 'help: 「List releases in a repository」'),
  'release upload': write('exit_status', REPO, 'help: 「Upload assets to a release」 — 파일 입력. `--clobber`면 덮어쓴다'),
  'release verify': read('text', 'internal', REPO, 'help: 「Verify the attestation for a release」'),
  'release verify-asset': read('text', 'internal', REPO, 'help: 「Verify that a given asset originated from a release」 — 로컬 파일을 입력으로 받는다'),
  'release view': read('json', 'internal', REPO, 'help: 「View information about a release」'),

  /* ---- repo */
  'repo archive': destructive('exit_status', REPO, 'help: 「Archive a repository」 — 읽기 전용이 된다. unarchive로 되돌린다'),
  'repo autolink create': write('resource', REPO, 'help: 「Create a new autolink reference」'),
  'repo autolink delete': destructive('exit_status', REPO, 'help: 「Delete an autolink reference」'),
  'repo autolink list': read('json', 'internal', REPO, 'help: 「List autolink references for a GitHub repository」'),
  'repo autolink view': read('json', 'internal', REPO, 'help: 「View an autolink reference」'),
  'repo clone': terminal('requires_local_workspace', 'R0', 'help: 「Clone a repository locally」 — 작업 트리가 필요하다', { sideEffect: 'read', contexts: REPO }),
  'repo create': write('resource', ORG, 'help: 「Create a new repository」 — `--push`·`--source`는 로컬 작업 트리를 쓴다(그 모드는 terminal)', { risk: 'R2' }),
  'repo delete': { support: 'supported', interaction: 'web_native', risk: 'R3', sideEffect: 'destructive', auth: 'token', result: 'exit_status', sensitivity: 'internal', contexts: REPO, note: 'help: 「Delete a repository」 — 되돌릴 수 없고 `delete_repo` 범위가 필요하다' },
  'repo deploy-key add': write('exit_status', REPO, 'help: 「Add a deploy key to a GitHub repository」 — 접근 수단을 더한다. 키 파일 입력', { risk: 'R2' }),
  'repo deploy-key delete': destructive('exit_status', REPO, 'help: 「Delete a deploy key from a GitHub repository」'),
  'repo deploy-key list': read('json', 'internal', REPO, 'help: 「List deploy keys in a GitHub repository」 — 공개 키 목록'),
  'repo edit': write('resource', REPO, 'help: 「Edit repository settings」 — 가시성·병합 정책·기능 토글', { risk: 'R2' }),
  'repo fork': write('resource', REPO, 'help: 「Create a fork of a repository」 — `--clone`은 작업 트리가 필요하다'),
  'repo gitignore list': read('text', 'public', NONE, 'help: 「List available repository gitignore templates」', { auth: 'none' }),
  'repo gitignore view': read('text', 'public', NONE, 'help: 「View an available repository gitignore template」', { auth: 'none' }),
  'repo license list': read('text', 'public', NONE, 'help: 「List common repository licenses」', { auth: 'none' }),
  'repo license view': read('text', 'public', NONE, 'help: 「View a specific repository license」', { auth: 'none' }),
  'repo list': read('json', 'internal', ORG, 'help: 「List repositories owned by user or organization」'),
  'repo read-dir': preview('R0', 'read', 'json', REPO, `${PREVIEW_NOTE}. 「List a directory in a repository」`),
  'repo read-file': preview('R0', 'read', 'text', REPO, `${PREVIEW_NOTE}. 「Read the contents of a file … without cloning it」 — 기본으로 이스케이프 시퀀스가 있는 파일 출력을 거부한다`),
  'repo rename': destructive('resource', REPO, 'help: 「Rename a repository」 — 옛 이름의 링크가 리다이렉트에 기댄다'),
  'repo set-default': terminal('requires_local_workspace', 'R0', 'help: 「Configure default repository for this directory」 — 로컬 git 설정을 바꾼다', { contexts: REPO }),
  'repo sync': write('exit_status', REPO, 'help: 「Sync a repository」 — 인자가 없으면 로컬 저장소를, 있으면 원격 포크를 동기화한다. 웹은 원격 모드만이다'),
  'repo unarchive': write('exit_status', REPO, 'help: 「Unarchive a repository」'),
  'repo view': read('json', 'internal', REPO, 'help: 「View a repository」'),

  /* ---- ruleset */
  'ruleset check': read('text', 'internal', REPO, 'help: 「View rules that would apply to a given branch」'),
  'ruleset list': read('text', 'internal', REPO, 'help: 「List rulesets for a repository or organization」'),
  'ruleset view': read('text', 'internal', REPO, 'help: 「View information about a ruleset」'),

  /* ---- run */
  'run cancel': write('exit_status', REPO, 'help: 「Cancel a workflow run」'),
  'run delete': destructive('exit_status', REPO, 'help: 「Delete a workflow run」 — 로그·아티팩트가 함께 사라진다'),
  'run download': read('artifact', 'internal', REPO, 'help: 「Download artifacts generated by a workflow run」 — 파일을 쓴다(파일 출력)'),
  'run list': read('json', 'internal', REPO, 'help: 「List recent workflow runs」'),
  'run rerun': write('exit_status', REPO, 'help: 「Rerun a run」 — 새 시도를 만든다'),
  'run view': read('json', 'internal', REPO, 'help: 「View a summary of a workflow run」 — `--log`는 로그 전문'),
  'run watch': read('stream', 'internal', REPO, 'help: 「Watch a run until it completes」 — 끝날 때까지 스트림'),

  /* ---- search */
  'search code': read('json', 'internal', HOST, 'help: 「Search within code」'),
  'search commits': read('json', 'internal', HOST, 'help: 「Search for commits」'),
  'search issues': read('json', 'internal', HOST, 'help: 「Search for issues」'),
  'search prs': read('json', 'internal', HOST, 'help: 「Search for pull requests」'),
  'search repos': read('json', 'internal', HOST, 'help: 「Search for repositories」'),

  /* ---- secret · variable — Actions 자격 */
  'secret delete': destructive('exit_status', REPO, 'help: 「Delete secrets」 — 저장소·환경·조직·사용자 수준'),
  'secret list': read('json', 'internal', REPO, 'help: 「List secrets」 — 이름만 나오고 값은 나오지 않는다'),
  'secret set': { support: 'supported', interaction: 'web_native', risk: 'R3', sideEffect: 'write', auth: 'token', result: 'exit_status', sensitivity: 'secret', stdin: 'optional', contexts: REPO, note: 'help: 「Create or update secrets」 — 비밀 값을 입력으로 받는다(`--body`·stdin·`--env-file`). 값은 어디에도 남기면 안 된다' },
  'variable delete': destructive('exit_status', REPO, 'help: 「Delete variables」'),
  'variable get': read('json', 'sensitive', REPO, 'help: 「Get variables」 — 값을 그대로 찍는다'),
  'variable list': read('json', 'sensitive', REPO, 'help: 「List variables」 — 이름과 **값**이 함께 나온다'),
  'variable set': write('exit_status', REPO, 'help: 「Create or update variables」 — Actions에 노출되는 값', { risk: 'R2', stdin: 'optional' }),

  /* ---- skill (preview) */
  'skill install': preview('R2', 'local', 'exit_status', NONE, `${PREVIEW_NOTE}. 「Install agent skills from a GitHub repository」 — 로컬에 코드를 내려받아 둔다`, { interaction: 'terminal_only' }),
  'skill list': preview('R0', 'read', 'json', NONE, `${PREVIEW_NOTE}. 「List installed skills」 — 실행기에는 설치된 skill이 없다`),
  'skill preview': preview('R0', 'read', 'text', NONE, `${PREVIEW_NOTE}. 「Preview a skill from a GitHub repository」`),
  'skill publish': preview('R2', 'write', 'resource', REPO, `${PREVIEW_NOTE}. 「Validate and publish skills to a GitHub repository」 — 로컬 디렉터리를 올린다`, { interaction: 'terminal_only' }),
  'skill search': preview('R0', 'read', 'json', HOST, `${PREVIEW_NOTE}. 「Search for skills across GitHub」`),
  'skill update': preview('R1', 'local', 'exit_status', NONE, `${PREVIEW_NOTE}. 「Update installed skills」`, { interaction: 'terminal_only' }),

  /* ---- status */
  status: read('text', 'internal', NONE, 'help: 「Print information about relevant issues, pull requests, and notifications across repositories」'),

  /* ---- workflow */
  'workflow disable': write('exit_status', REPO, 'help: 「Disable a workflow」 — 이후 트리거가 실행되지 않는다', { risk: 'R2' }),
  'workflow enable': write('exit_status', REPO, 'help: 「Enable a workflow」'),
  'workflow list': read('json', 'internal', REPO, 'help: 「List workflows」'),
  'workflow run': write('resource', REPO, 'help: 「Run a workflow by creating a workflow_dispatch event」 — 입력은 `-f`·`-F`·`--json` stdin', { stdin: 'optional' }),
  'workflow view': read('text', 'internal', REPO, 'help: 「View the summary of a workflow」 — `--yaml`은 정의 원문'),
};

export const COMMAND_ROW_COUNT = Object.keys(COMMAND_ROWS).length;

/** 이 표가 쓰지 않는 값을 적어 둔다 — 검증기가 「의도적 0건」과 「빠짐」을 구분한다. */
export const NEVER_ASSIGNED_SUPPORT: readonly GhSupportStatus[] = ['unsupported_by_host', 'admin_only'];
export { NAME_ONLY };
