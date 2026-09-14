/**
 * 결과 계약 분류 (FR-GH-001 AC-11·AC-12, SRS 9.8, ADR-020, CR-089).
 *
 * **순수 함수이고 결정적이다.** 인벤토리 command와 분류 표의 행에서만 판정한다 — 검증기가 같은 함수로 다시 만들어
 * 저장값과 대조한다.
 *
 * ## 결과 종류의 뜻
 *
 * | 종류 | 뜻 |
 * | --- | --- |
 * | `resource` | 결과가 자원 하나를 **이 제품이 정의한 문법**(JSON 식별 필드 · gh 파서가 있는 URL)으로 식별한다 |
 * | `resource_list` | 같은 종류의 자원 목록을 그렇게 식별한다 |
 * | `json` | 구조화 JSON이지만 자원 하나·목록이 아니다 — 자원 종류가 없거나 목록 여럿을 담은 객체다 |
 * | `url` | 링크 한 줄 — comment·릴리스·run처럼 참조 문법의 근거가 없는 URL |
 * | `text` · `stream` · `artifact` · `exit_status` | 사람이 읽는 텍스트 · 끝나지 않는 출력 · 파일 · 종료 코드만 |
 *
 * 주 종류는 구조화 모드(`--json`·`--format json`)가 있으면 그 모드의 결과이고, 없으면 **비TTY 실행기에서 관측되는**
 * 기본 출력이다. TTY에서만 찍히는 확인 문구는 결과가 아니다(`RESULT_KIND_EVIDENCE`).
 *
 * ## composability 도출 — 순서가 규칙이다
 *
 * 1. 민감도 `secret` → `secret_non_bindable`
 * 2. 지원 `policy_blocked` → `policy_blocked`
 * 3. 출력 port가 있다 → `partially_bindable`. gh 결과에는 출력 모드·필드 선택·URL 대조 조건이 늘 있어 이 판은
 *    `fully_bindable`을 쓰지 않는다
 * 4. 종류 `artifact` → `artifact_result`
 * 5. 종류 `text`·`stream`, 또는 구조를 정할 수 없는 JSON(`api`) → `opaque_result`
 * 6. 나머지(`exit_status`·`url`·자원 종류가 없는 `json`) → `terminal_result`
 *
 * `unsupported_by_host`는 쓰지 않는다 — 대상 GHES에서 확인한 command가 없다 (DEV-674).
 */

import type {
  GhComposability,
  GhInventoryCommand,
  GhOutputFormat,
  GhOutputModeContract,
  GhPort,
  GhResourceKind,
  GhResultAdapter,
  GhResultContract,
  GhResultKind,
  GhResultSensitivity,
} from '../types.js';
import type { CommandRow } from './commands.js';
import { GH_SOURCE, inputPortOf, inputPortsNoteOf, jsonSchemaName, outputPortsOf, subjectSlotsOf, urlSchemaName } from './ports.js';

export const RESULT_KINDS: readonly GhResultKind[] = ['json', 'resource', 'resource_list', 'url', 'artifact', 'text', 'stream', 'exit_status'];
export const RESULT_SENSITIVITIES: readonly GhResultSensitivity[] = ['public', 'internal', 'sensitive', 'secret'];
export const RESULT_ADAPTERS: readonly GhResultAdapter[] = ['native_json', 'gh_api_structured', 'resource_url', 'artifact', 'opaque_text', 'stream', 'exit_status', 'secret_non_bindable'];
export const COMPOSABILITY_VALUES: readonly GhComposability[] = ['fully_bindable', 'partially_bindable', 'terminal_result', 'artifact_result', 'opaque_result', 'secret_non_bindable', 'policy_blocked', 'unsupported_by_host'];
export const BINDABLE_COMPOSABILITY: ReadonlySet<GhComposability> = new Set(['fully_bindable', 'partially_bindable']);

/** 주 종류의 관측 근거 — 비TTY stdout의 모양이 이름에서 기대하는 것과 다른 command (고정 gh 소스). */
export const RESULT_KIND_EVIDENCE: Readonly<Record<string, string>> = {
  'pr close': 'pkg/cmd/pr/close/close.go:111 확인 문구는 IO.ErrOut — stdout은 비어 있다',
  'pr merge': 'pkg/cmd/pr/merge/merge.go:492·500 메시지는 IO.ErrOut',
  'pr ready': 'pkg/cmd/pr/ready/ready.go:99·111 메시지는 IO.ErrOut',
  'pr reopen': 'pkg/cmd/pr/reopen/reopen.go:102 메시지는 IO.ErrOut',
  'pr review': 'pkg/cmd/pr/review/review.go:249 `Got:`은 대화형 확인 흐름에서만 stdout에 찍는다',
  'issue close': 'pkg/cmd/issue/close/close.go:169 메시지는 IO.ErrOut',
  'issue reopen': 'pkg/cmd/issue/reopen/reopen.go:113 메시지는 IO.ErrOut',
  'label create': 'pkg/cmd/label/create.go:120-124 확인 문구는 TTY에서만 stdout',
  'label edit': 'pkg/cmd/label/edit.go:97-101 확인 문구는 TTY에서만 stdout',
  'repo edit': 'pkg/cmd/repo/edit/edit.go:355 확인 문구는 TTY에서만 stdout',
  'repo rename': 'pkg/cmd/repo/rename/rename.go:152·167 확인 문구는 TTY에서만 stdout',
  'codespace edit': 'pkg/cmd/codespace/edit.go — stdout에 쓰는 자리가 없다',
  'codespace create': 'pkg/cmd/codespace/create.go:344 codespace 이름 한 줄',
  'codespace jupyter': 'pkg/cmd/codespace/jupyter.go:97 로컬 JupyterLab URL',
  'issue develop': 'pkg/cmd/issue/develop/develop.go:253 `<host>/<owner>/<repo>/tree/<branch>` 한 줄',
  'issue edit': 'pkg/cmd/issue/edit/edit.go:436-440 고친 issue URL을 줄마다 하나',
  'agent-task create': 'pkg/cmd/agent-task/create/create.go:183·191 세션 URL 또는 「job … queued」 문구',
  'repo autolink create': 'pkg/cmd/repo/autolink/create/create.go:111-115 생성 문구',
  'skill publish': 'pkg/cmd/skills/publish/publish.go:631-633 게시 문구',
  'pr comment': 'pkg/cmd/pr/shared/commentable.go:196·255 comment URL',
  'issue comment': 'pkg/cmd/pr/shared/commentable.go:196·255 comment URL',
  'discussion comment': 'pkg/cmd/discussion/comment/comment.go:211·240·264 comment URL',
  'release create': 'pkg/cmd/release/create/create.go:566 릴리스 URL',
  'release edit': 'pkg/cmd/release/edit/edit.go:131 릴리스 URL',
  'workflow run': 'pkg/cmd/workflow/run/run.go:390-393 비TTY는 run URL 한 줄(API가 줄 때)',
  'auth status': '`--json` exporter가 있다(JSON FIELDS `hosts`)',
  'repo read-file': 'pkg/cmd/repo/read-file/read_file.go exporter',
  'attestation verify': 'pkg/cmd/attestation/verify/verify.go exporter (--format json)',
  'release verify': 'pkg/cmd/release/verify/verify.go exporter (--format json)',
  'release verify-asset': 'pkg/cmd/release/verify-asset/verify_asset.go exporter (--format json)',
};

/** 구조를 정할 수 없는 JSON — 엔드포인트·표현식이 모양을 정한다. */
export const OPAQUE_JSON: Readonly<Record<string, string>> = {
  api: '엔드포인트와 메서드마다 응답 모양이 다르다 — 스키마를 정할 수 없다 (`gh api --help` 「prints the response」)',
};

const PROJECT_NOTE = 'project는 소유자와 번호로 식별되는데 GhResourceRef에 소유자 자리가 없다 (SRS 9.8 3항) — 참조를 만들지 않는다';
const PROJECT_PART_NOTE = 'project의 필드·항목이다 — 자원 종류에 없고, 속한 project도 소유자 자리가 없어 식별할 수 없다';

/**
 * 출력 port가 없는 이유 — 결과가 구조화(json)·링크(url)인데 port가 없는 command는 여기 행이 있어야 한다(시험이 건다).
 * 기본 이유(종류별)로 충분한 command는 적지 않는다.
 */
export const OUTPUT_PORT_NOTES: Readonly<Record<string, string>> = {
  'agent-task list': 'Copilot 에이전트 세션 목록이다 — GhResourceRef.kind에 세션이 없다',
  'agent-task view': 'Copilot 에이전트 세션이다 — GhResourceRef.kind에 세션이 없다',
  'cache list': 'Actions 캐시(id·key)다 — 자원 종류에 없다',
  'label list': 'label이다 — 자원 종류에 없다',
  'pr checks': 'check 항목의 JSON 필드(name·state·startedAt·completedAt·link·bucket·event·workflow·description)에 check run·workflow run 식별자가 없다(pkg/cmd/pr/checks/checks.go:22-32) — link URL을 식별자로 재해석하지 않는다. GhResourceRef.kind에 check run도 없다',
  'repo autolink list': 'autolink 설정이다 — 자원 종류에 없다',
  'repo autolink view': 'autolink 설정이다 — 자원 종류에 없다',
  'repo deploy-key list': 'deploy key다 — 자원 종류에 없다',
  'repo read-dir': '디렉터리 항목(이름·경로)이다 — 자원 종류에 없다',
  'repo read-file': '파일 내용과 메타데이터다 — 자원 종류에 없다',
  'search code': '코드 검색 결과(경로·일치 조각)다 — 파일은 자원 종류에 없다',
  'secret list': 'Actions secret의 이름이다 — 자원 종류에 없고 값은 나오지 않는다',
  'skill list': 'skill이다 — 자원 종류에 없다',
  'skill search': 'skill이다 — 자원 종류에 없다',
  'variable get': 'Actions variable의 이름과 값이다 — 자원 종류에 없고 값이 sensitive다',
  'variable list': 'Actions variable의 이름과 값이다 — 자원 종류에 없고 값이 sensitive다',
  'attestation verify': '증명 검증 결과다 — 자원 종류에 없다',
  'release verify': '릴리스 증명 검증 결과다 — 자원 종류에 없다',
  'release verify-asset': '릴리스 자산 증명 검증 결과다 — 자원 종류에 없다',
  'project close': PROJECT_NOTE,
  'project copy': PROJECT_NOTE,
  'project create': PROJECT_NOTE,
  'project delete': PROJECT_NOTE,
  'project edit': PROJECT_NOTE,
  'project list': PROJECT_NOTE,
  'project mark-template': PROJECT_NOTE,
  'project view': PROJECT_NOTE,
  'project field-create': PROJECT_PART_NOTE,
  'project field-delete': PROJECT_PART_NOTE,
  'project field-list': PROJECT_PART_NOTE,
  'project item-add': PROJECT_PART_NOTE,
  'project item-archive': PROJECT_PART_NOTE,
  'project item-create': PROJECT_PART_NOTE,
  'project item-delete': PROJECT_PART_NOTE,
  'project item-edit': PROJECT_PART_NOTE,
  'project item-list': PROJECT_PART_NOTE,
  browse: '`--no-browser`일 때 찍는 URL(pkg/cmd/browse/browse.go:220)은 인자에 따라 저장소·issue·PR·파일·커밋을 가리킨다 — 한 종류의 참조로 읽을 수 없다',
  'gist create': 'gist URL(pkg/cmd/gist/create/create.go:187)을 읽는 gh 파서(GistIDFromURL, gist/shared/shared.go:84-99)는 경로 조각의 위치로 id를 고른다 — 대상 GHES의 gist 경로 형식을 고정 버전 소스로 확인하지 못해 문법 근거로 삼지 않는다',
  'pr comment': 'comment URL(pkg/cmd/pr/shared/commentable.go:196·255)이다 — comment는 자원 종류에 없다',
  'issue comment': 'comment URL(pkg/cmd/pr/shared/commentable.go:196·255)이다 — comment는 자원 종류에 없다',
  'discussion comment': 'comment URL(`#discussioncomment-…`)이다 — comment는 자원 종류에 없다',
  'release create': '릴리스 URL이다 — gh에 릴리스 URL을 인자로 읽는 파서가 없어 태그가 URL 경로에 담기는 규칙을 근거로 삼을 수 없다',
  'release edit': '릴리스 URL이다 — gh에 릴리스 URL을 인자로 읽는 파서가 없어 태그가 URL 경로에 담기는 규칙을 근거로 삼을 수 없다',
  'workflow run': 'workflow run URL이다 — gh에 run URL을 인자로 읽는 파서가 없다(run 명령은 `<run-id>`만 받는다)',
  'codespace jupyter': '로컬 JupyterLab URL이다 — 원격 자원이 아니다',
  'codespace create': 'codespace 이름 한 줄이다 — 구조화 출력이 아니라 텍스트라 참조로 읽지 않는다',
};

/** 결과가 자원을 가리키지만 참조를 만들 근거가 없어 port가 없는 command의 자원 종류. */
export const PORTLESS_RESOURCE: Readonly<Record<string, GhResourceKind>> = {
  'project close': 'project',
  'project copy': 'project',
  'project create': 'project',
  'project delete': 'project',
  'project edit': 'project',
  'project list': 'project',
  'project mark-template': 'project',
  'project view': 'project',
  'release create': 'release',
  'release edit': 'release',
  'workflow run': 'workflow_run',
  'codespace create': 'codespace',
  'gist create': 'gist',
};

const SECRET_NOTE = '결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)';
const BLOCKED_NOTE = '제품이 열지 않기로 정한 command다 — 결과를 연결 source로 두지 않는다';

const DEFAULT_PORTLESS: Partial<Record<GhResultKind, string>> = {
  exit_status: 'stdout에 결과가 없다 — 비TTY 실행기에서는 종료 코드만 의미가 있다',
  text: '사람이 읽는 텍스트다 — 자원을 식별하는 구조가 없다',
  stream: '끝이 정해지지 않은 스트림이다 — 자원을 식별하는 구조가 없다',
  artifact: 'artifact 결과는 경로가 아니라 아티팩트 ID로만 흐른다 — 파일 바인딩(FR-GH-005, FR-GH-007 AC-9)이 열리기 전에는 port가 아니다',
};

export function composabilityOf(input: {
  readonly sensitivity: GhResultSensitivity;
  readonly blocked: boolean;
  readonly outputPorts: readonly GhPort[];
  readonly kind: GhResultKind;
  readonly opaque: boolean;
}): GhComposability {
  if (input.sensitivity === 'secret') return 'secret_non_bindable';
  if (input.blocked) return 'policy_blocked';
  if (input.outputPorts.length > 0) return 'partially_bindable';
  if (input.kind === 'artifact') return 'artifact_result';
  if (input.kind === 'text' || input.kind === 'stream' || input.opaque) return 'opaque_result';
  return 'terminal_result';
}

interface ModeContext {
  readonly key: string;
  readonly kind: GhResultKind;
  readonly sensitivity: GhResultSensitivity;
  readonly outputPorts: readonly GhPort[];
  readonly portlessNote: string | null;
  readonly opaqueNote: string | null;
}

function modeContract(mode: GhOutputFormat, context: ModeContext): GhOutputModeContract {
  const contract = ((): GhOutputModeContract => {
    switch (mode) {
      case 'json': {
        const ports = context.outputPorts.filter((port) => port.source?.adapter === 'native_json');
        const source = ports[0]?.source;
        const schema = context.opaqueNote !== null ? null : source?.adapter === 'native_json' ? source.schema : jsonSchemaName(context.key);
        const kind: GhResultKind = context.kind === 'resource' || context.kind === 'resource_list' ? context.kind : 'json';
        return { mode, kind, adapter: 'native_json', schema, unstructuredReason: context.opaqueNote, bindable: ports.length > 0, reason: ports.length > 0 ? null : context.portlessNote };
      }
      case 'text': {
        const urlPort = context.outputPorts.find((port) => port.source?.adapter === 'resource_url');
        if (urlPort?.source?.adapter === 'resource_url') {
          return { mode, kind: context.kind, adapter: 'resource_url', schema: urlSchemaName(urlPort.source.grammar), unstructuredReason: null, bindable: true, reason: null };
        }
        if (context.kind === 'exit_status') {
          return { mode, kind: 'exit_status', adapter: 'exit_status', schema: null, unstructuredReason: 'stdout에 결과가 없다 — 비TTY에서 확인 문구는 stderr로만 나가거나 TTY에서만 찍힌다', bindable: false, reason: '종료 코드만 의미가 있다' };
        }
        if (context.kind === 'url') {
          return { mode, kind: 'url', adapter: 'opaque_text', schema: null, unstructuredReason: context.portlessNote, bindable: false, reason: context.portlessNote };
        }
        if (context.kind === 'text') {
          return { mode, kind: 'text', adapter: 'opaque_text', schema: null, unstructuredReason: '사람이 읽는 텍스트다 — 구조를 신뢰할 수 없다', bindable: false, reason: context.portlessNote };
        }
        return { mode, kind: 'text', adapter: 'opaque_text', schema: null, unstructuredReason: '기본 출력은 사람이 읽는 표·요약이다 — 구조는 --json(--format json) 모드에만 있다', bindable: false, reason: '기본 출력에는 식별 필드의 구조가 없다' };
      }
      case 'jq':
        return { mode, kind: 'text', adapter: 'opaque_text', schema: null, unstructuredReason: 'jq 표현식의 결과는 표현식이 정한다 — 모양을 보장하지 않는다 (pkg/cmdutil/json_flags.go:233-242)', bindable: false, reason: '임의 표현식의 출력은 typed 바인딩의 source가 될 수 없다 (ADR-020)' };
      case 'template':
        return { mode, kind: 'text', adapter: 'opaque_text', schema: null, unstructuredReason: 'Go 템플릿 출력은 텍스트다 (pkg/cmdutil/json_flags.go:243-250)', bindable: false, reason: '임의 템플릿의 출력은 typed 바인딩의 source가 될 수 없다 (ADR-020)' };
      case 'web':
        /*
         * 모든 `--web` command에 같은 문장이 붙으므로 한 command의 소스를 근거로 들지 않는다. 실측(v2.97.0): 안내
         * 「Opening … in your browser.」는 stderr나 `IsStdoutTTY()` 안의 stdout으로 나가고, 조건 없이 비TTY stdout에
         * 쓰는 곳은 `gist create`(pkg/cmd/gist/create/create.go:181-183) 하나다 — 어느 쪽이든 구조화된 결과는 없다.
         */
        return {
          mode,
          kind: 'exit_status',
          adapter: 'exit_status',
          schema: null,
          unstructuredReason: '브라우저를 여는 모드다 — 구조화된 결과가 없고(안내 문구는 stderr나 TTY 전용 stdout으로 나가며, gist create는 비TTY stdout에 안내 한 줄을 쓴다) 실행기에는 브라우저가 없다 (ADR-019)',
          bindable: false,
          reason: '구조화된 결과가 없다',
        };
      case 'file':
        return { mode, kind: 'artifact', adapter: 'artifact', schema: null, unstructuredReason: '파일로 쓰는 결과다', bindable: false, reason: DEFAULT_PORTLESS.artifact ?? '' };
      case 'stream':
        return { mode, kind: 'stream', adapter: 'stream', schema: null, unstructuredReason: '끝이 정해지지 않은 스트림이다', bindable: false, reason: '스트림은 typed 바인딩의 source가 될 수 없다' };
    }
  })();
  if (context.sensitivity !== 'secret') return contract;
  return { ...contract, adapter: 'secret_non_bindable', schema: null, unstructuredReason: SECRET_NOTE, bindable: false, reason: SECRET_NOTE };
}

/**
 * leaf command 하나의 결과 계약.
 *
 * @param outputFormats 분류가 정한 출력 모드(`io.outputFormats`). 모드마다 계약이 하나다.
 */
export function classifyResult(command: GhInventoryCommand, row: CommandRow, outputFormats: readonly GhOutputFormat[]): GhResultContract {
  const key = command.path.join(' ');
  const kind = row.result;
  const sensitivity = row.sensitivity;
  const blocked = row.support === 'policy_blocked';
  const secret = sensitivity === 'secret';
  const opaqueNote = OPAQUE_JSON[key] ?? null;

  const declared = outputPortsOf(command, sensitivity);
  const outputPorts = secret || blocked || opaqueNote !== null ? [] : declared;
  const inputPorts = subjectSlotsOf(command).map((subject) => inputPortOf(command, subject));

  const portlessNote = secret ? SECRET_NOTE : blocked ? BLOCKED_NOTE : (opaqueNote ?? OUTPUT_PORT_NOTES[key] ?? DEFAULT_PORTLESS[kind] ?? null);
  const composability = composabilityOf({ sensitivity, blocked, outputPorts, kind, opaque: opaqueNote !== null });

  const portType = outputPorts[0]?.type ?? null;
  const portless = PORTLESS_RESOURCE[key] ?? null;
  const resourceKind: GhResourceKind | null = portType ?? portless ?? (kind === 'artifact' ? 'artifact' : null);
  const resourceBasis =
    portType !== null
      ? (outputPorts[0]?.basis.evidence ?? '')
      : portless !== null
        ? `${GH_SOURCE} ${portlessNote ?? ''}`
        : (portlessNote ?? '');

  const kindEvidence = RESULT_KIND_EVIDENCE[key];
  const evidence = [GH_SOURCE, kindEvidence === undefined ? null : `주 종류: ${kindEvidence}`, outputPorts[0]?.basis.evidence.replace(`${GH_SOURCE} `, '') ?? portlessNote]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return {
    kind,
    sensitivity,
    composability,
    bindable: BINDABLE_COMPOSABILITY.has(composability),
    resourceKind,
    resourceBasis,
    outputs: outputFormats.map((mode) => modeContract(mode, { key, kind, sensitivity, outputPorts, portlessNote, opaqueNote })),
    inputPorts,
    outputPorts,
    inputPortsNote: inputPorts.length > 0 ? null : inputPortsNoteOf(command),
    outputPortsNote: outputPorts.length > 0 ? null : portlessNote,
    basis: { source: 'override', rule: 'result-contract', evidence },
  };
}
