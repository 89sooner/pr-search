/**
 * capability manifest·invocation·결과의 타입 (FR-GH-001·002·003, ADR-015·017·020).
 *
 * **브라우저와 Node가 함께 읽는다.** 이 파일에는 런타임 코드가 없다.
 */

/** 위험도 (FR-GH-009 AC-1). */
export type GhRiskLevel = 'R0' | 'R1' | 'R2' | 'R3';

/**
 * FR-GH-001 AC-2의 분류 상태.
 *
 * `unknown`은 **미분류**다. 계약이 금지하는 것은 릴리스 게이트를 `unknown`이 남은
 * 채로 통과하는 것이지, 진행 중인 manifest가 미분류를 **정직하게 세는 것**이
 * 아니다. 숨기면 게이트가 셀 수 없다 (NFR-009 「목록에서 사라지는 것은 분류가
 * 아니다」).
 */
export type GhSupportStatus =
  | 'supported'
  | 'unsupported_by_host'
  | 'preview'
  | 'policy_blocked'
  | 'terminal_only'
  | 'admin_only'
  | 'requires_extension'
  | 'requires_local_workspace'
  | 'unknown';

/**
 * **실행 허용 차원** — FR-GH-001의 분류와 다른 축이다.
 *
 * 인벤토리에 있다는 것과 이 제품이 실행을 여는 것은 다르다. 첫 수직 판은
 * `pr list` 하나만 연다. 나머지는 `not_implemented`이며 **그 사유를 호스트
 * 미지원이나 정책 차단으로 위장하지 않는다.** 실행 요청은 `allowed`만 지나간다.
 */
export type GhExecutionStatus = 'allowed' | 'not_implemented' | 'policy_blocked';

/** interaction 모드 (FR-GH-001 AC-8, ADR-019). */
export type GhInteractionMode =
  | 'web_native'
  | 'web_equivalent'
  | 'sandbox_terminal'
  | 'terminal_only'
  | 'policy_blocked'
  | 'unsupported_by_host'
  | 'unknown';

/** `gh <path> --help`에서 뽑은 flag 하나 (FR-GH-001 AC-1·AC-7). */
export interface GhInventoryFlag {
  /** `--state` 처럼 `--`를 뺀 긴 이름. */
  readonly name: string;
  /** `-s` 처럼 `-`를 뺀 짧은 별칭. 없으면 `null`. */
  readonly short: string | null;
  /** help가 적은 값 자리표시자(`string`·`int`·`strings`·`[HOST/]OWNER/REPO`…). bool은 `null`. */
  readonly valueType: string | null;
  readonly description: string;
  /** `(default "open")`에서 뽑은 원문. 없으면 `null`. */
  readonly defaultValue: string | null;
  /** cobra의 `strings`·`stringArray`·`stringSlice` 계열은 반복 가능하다. */
  readonly repeatable: boolean;
  /** INHERITED FLAGS 절에서 왔는가. */
  readonly inherited: boolean;
}

export interface GhInventoryCommand {
  /** `['pr', 'list']`. 루트는 `[]`다. */
  readonly path: readonly string[];
  /** `gh pr ls` → `['pr ls']` 처럼 help의 ALIASES 절 원문(`gh ` 접두 제거). */
  readonly aliases: readonly string[];
  /** 부모 목록이 적은 한 줄 설명. */
  readonly summary: string;
  /** USAGE 절의 첫 줄. */
  readonly usage: string;
  /** 하위 command가 있으면 그룹이다. */
  readonly group: boolean;
  /** 부모 목록에서 이 command가 속한 절 이름 (`CORE COMMANDS` 등). */
  readonly section: string;
  readonly flags: readonly GhInventoryFlag[];
  /** `--json`이 받는 필드 목록. 없으면 빈 배열. */
  readonly jsonFields: readonly string[];
  /**
   * 별칭 전용 노드 (`gh co` → `pr checkout`). 실제 command path가 따로 있다.
   * 일반 command는 `null`.
   */
  readonly aliasOf: readonly string[] | null;
  /**
   * `--help`가 답했는가.
   *
   * `gh extension exec --help`는 인증 없이는 종료 코드 4(인증 필요)를 낸다 — 2.97.0
   * 실측. 그 command는 flag를 뽑을 수 없으므로 **그 사실을 적고** 넘어간다. 숨기면
   * 인벤토리가 실제 트리보다 작아진다.
   */
  readonly helpStatus: 'ok' | 'auth_required';
}

export interface GhInventory {
  readonly ghVersion: string;
  readonly commands: readonly GhInventoryCommand[];
  /** HELP TOPICS 절의 이름들. command가 아니라 문서다 — 세되 실행 대상이 아니다. */
  readonly helpTopics: readonly string[];
}

/* ---------------------------------------------------------------- 옵션·제약 */

export interface GhEnumOption {
  readonly kind: 'enum';
  readonly flag: string;
  readonly values: readonly string[];
  readonly defaultValue: string;
  readonly label: string;
}

export interface GhIntOption {
  readonly kind: 'int';
  readonly flag: string;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly label: string;
}

/**
 * `--json` 필드 집합. 허용 목록 밖 필드는 거절한다 — 출력 계약(`GhResultContract`)이
 * 그 필드만 안다.
 */
export interface GhJsonFieldsOption {
  readonly kind: 'json_fields';
  readonly flag: string;
  readonly allowed: readonly string[];
  readonly defaultValue: readonly string[];
  readonly minItems: number;
  readonly maxItems: number;
  readonly label: string;
}

export interface GhBoolOption {
  readonly kind: 'bool';
  readonly flag: string;
  readonly defaultValue: boolean;
  readonly label: string;
}

export type GhOption = GhEnumOption | GhIntOption | GhJsonFieldsOption | GhBoolOption;

/**
 * 의미 제약 모델 (FR-GH-003 AC-7, ADR-017, ENT-GH-007).
 *
 * flag 이름은 `--`를 포함한 원문이다. 열거값·범위·반복·최소/최대는 옵션 자체에
 * 있고, 여기는 **옵션 사이**의 관계와 컨텍스트 요구다.
 */
export type GhConstraint =
  | { readonly kind: 'requires'; readonly flag: string; readonly requires: readonly string[] }
  | { readonly kind: 'conflicts'; readonly flags: readonly string[] }
  | { readonly kind: 'one_of'; readonly flags: readonly string[] }
  | { readonly kind: 'exactly_one'; readonly flags: readonly string[] }
  | { readonly kind: 'at_least_one'; readonly flags: readonly string[] }
  | { readonly kind: 'implies'; readonly flag: string; readonly whenValue?: string; readonly implies: string }
  | { readonly kind: 'required_if'; readonly flag: string; readonly when: { readonly flag: string; readonly value: string } }
  | { readonly kind: 'input_source_exclusive'; readonly sources: readonly string[] }
  | { readonly kind: 'context_required'; readonly context: 'repository' | 'host' };

/** 결과 계약 (FR-GH-001 AC-11, ADR-020, ENT-GH-009). */
export interface GhResultContract {
  readonly kind: 'json' | 'resource' | 'resource_list' | 'url' | 'artifact' | 'text' | 'stream' | 'exit_status';
  /** 구조화 결과의 스키마 이름. `pr_list_v1` 처럼 이 패키지가 아는 값이어야 한다. */
  readonly schema: string;
  readonly resourceType: string | null;
  readonly bindable: boolean;
  readonly sensitivity: 'public' | 'internal' | 'sensitive' | 'secret';
  readonly adapter:
    | 'native_json'
    | 'gh_api_structured'
    | 'resource_url'
    | 'artifact'
    | 'opaque_text'
    | 'stream'
    | 'exit_status'
    | 'secret_non_bindable';
  readonly composability:
    | 'fully_bindable'
    | 'partially_bindable'
    | 'terminal_result'
    | 'artifact_result'
    | 'opaque_result'
    | 'secret_non_bindable'
    | 'policy_blocked'
    | 'unsupported_by_host';
}

/**
 * 실행을 여는 capability 하나의 정의 — 의미 오버라이드(ADR-015)다.
 *
 * `path`는 인벤토리의 command와 1:1로 맞아야 한다. 맞지 않으면 manifest 생성이
 * 실패한다 — 인벤토리에 없는 command를 실행 가능으로 적을 수 없다.
 */
export interface GhCapabilityDefinition {
  readonly id: string;
  readonly path: readonly string[];
  readonly title: string;
  readonly risk: GhRiskLevel;
  readonly support: GhSupportStatus;
  readonly execution: GhExecutionStatus;
  readonly interaction: GhInteractionMode;
  /** 공식 문서가 요구하는 App 권한. 화면이 「필요 권한」으로 보여 준다 (FR-GH-009 AC-7). */
  readonly requiredPermissions: readonly string[];
  readonly options: readonly GhOption[];
  readonly constraints: readonly GhConstraint[];
  readonly result: GhResultContract;
  /** 실행 시간 상한(ms). 명령군마다 다르다 (NFR-011). */
  readonly timeoutMs: number;
}

/* ------------------------------------------------------- 분류 (WP-045, NFR-009) */

/**
 * FR-GH-001 AC-3 — positional·flag의 분류 상태. `unknown`은 미분류이며 게이트를 실패시킨다.
 * 규칙이 하나도 맞지 않은 자리만 `unknown`이다 — 모르는 것을 generic으로 뭉개지 않는다.
 */
export type GhControlClass =
  | 'mapped_to_typed_control'
  | 'mapped_to_generic_control'
  | 'mapped_to_web_equivalent'
  | 'terminal_only'
  | 'policy_blocked'
  | 'unsupported_by_host'
  | 'requires_admin_approval'
  | 'unknown';

export type GhFlagValueKind =
  | 'bool'
  | 'enum'
  | 'int'
  | 'float'
  | 'string'
  | 'strings'
  | 'file'
  | 'expression'
  | 'fields'
  | 'date'
  | 'duration'
  | 'selector'
  | 'key_value'
  | 'unknown';

/**
 * 분류 하나의 근거. `rule`은 문서화된 규칙 이름(`rules.ts`), `override`는 사람이 적은 표
 * (`commands.ts`), `help`는 고정 바이너리의 `--help` 원문이다. `evidence`는 판정이 본 원문이다.
 */
export interface GhClassificationBasis {
  readonly source: 'help' | 'rule' | 'override';
  readonly rule: string | null;
  readonly evidence: string;
}

/**
 * 부작용. `local`은 GHE가 아니라 실행 호스트(설정·작업 트리·편집기)를 바꾸는 것이고,
 * `arbitrary`는 입력에 따라 무엇이든 될 수 있음이 **확인된** 것(`gh api`·extension 실행)이다 —
 * 모르는 것(`unknown`)과 다르다.
 */
export type GhSideEffect = 'read' | 'write' | 'destructive' | 'local' | 'arbitrary' | 'unknown';
export type GhAuthRequirement = 'none' | 'token' | 'unknown';
/** 대상 GHES에서 실제로 확인했는가. 이 판은 전부 `unverified`다 — 사내 확인은 NOT RUN. */
export type GhHostSupport = 'verified' | 'unverified';
export type GhOutputFormat = 'text' | 'json' | 'jq' | 'template' | 'web' | 'stream' | 'file';
export type GhContextRequirement =
  | 'repository'
  | 'host'
  | 'branch'
  | 'workspace'
  | 'codespace'
  | 'organization'
  | 'gist'
  | 'project'
  | 'none';

/** 입출력 모드 (FR-GH-001 AC-9). */
export interface GhIoProfile {
  readonly stdin: 'none' | 'optional' | 'required';
  readonly fileInputFlags: readonly string[];
  readonly fileOutputFlags: readonly string[];
  readonly outputFormats: readonly GhOutputFormat[];
  readonly contexts: readonly GhContextRequirement[];
  readonly paginated: boolean;
}

export interface GhFlagClassification {
  readonly name: string;
  readonly inherited: boolean;
  readonly control: GhControlClass;
  readonly valueKind: GhFlagValueKind;
  readonly enumValues: readonly string[] | null;
  /** 값이 비밀 그 자체다(`secret set --body`). argv 미리보기·로그·이력에 실으면 안 된다. */
  readonly secretInput: boolean;
  readonly basis: GhClassificationBasis;
}

export interface GhPositionalClassification {
  readonly placeholder: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly control: GhControlClass;
  readonly binding: 'value' | 'file' | 'stdin' | 'passthrough' | null;
  readonly basis: GhClassificationBasis;
}

/** leaf command 하나의 분류 전부. 그룹과 별칭 전용 노드에는 없다. */
export interface GhCommandClassification {
  readonly support: GhSupportStatus;
  readonly interaction: GhInteractionMode;
  readonly risk: GhRiskLevel | null;
  readonly sideEffect: GhSideEffect;
  readonly auth: GhAuthRequirement;
  readonly io: GhIoProfile;
  readonly resultKind: GhResultContract['kind'] | 'unknown';
  readonly sensitivity: GhResultContract['sensitivity'] | 'unknown';
  readonly hostSupport: GhHostSupport;
  readonly positionals: readonly GhPositionalClassification[];
  readonly flags: readonly GhFlagClassification[];
  readonly basis: GhClassificationBasis;
  /** 옵션에 따라 부작용·민감도가 달라지는 자리 등, 사람이 읽을 주의. */
  readonly notes: readonly string[];
}

/** manifest에 실리는 command 하나 — 인벤토리 + 실행 차원 + 분류. */
export interface GhManifestCommand extends GhInventoryCommand {
  readonly id: string;
  readonly support: GhSupportStatus;
  readonly execution: GhExecutionStatus;
  /** `not_implemented`·`policy_blocked`의 사람이 읽을 사유. `allowed`는 `null`. */
  readonly executionReason: string | null;
  readonly risk: GhRiskLevel | null;
  /** leaf만 있다. 그룹·별칭 전용 노드는 `null`. */
  readonly classification: GhCommandClassification | null;
}

export type GhCoverageGate = 'GATE-GH-01' | 'GATE-GH-01b' | 'GATE-GH-01d' | 'informational';

/** NFR-009 차원 하나의 커버리지. `unclassifiedSample`은 앞 50개까지다. */
export interface GhCoverageDimension {
  readonly id: string;
  readonly label: string;
  readonly gate: GhCoverageGate;
  readonly total: number;
  readonly classified: number;
  readonly unclassified: number;
  readonly unclassifiedSample: readonly string[];
  /** 분모를 어떻게 셌는지, 무엇이 「분류」인지. 숫자만 두면 나중에 같은 뜻으로 읽히지 않는다. */
  readonly note: string;
}

export interface GhManifestCoverage {
  /** 그룹을 뺀 실행 가능 leaf 수. */
  readonly leafCommands: number;
  readonly groupCommands: number;
  readonly aliasOnlyCommands: number;
  readonly helpTopics: number;
  readonly commandFlags: number;
  readonly inheritedFlagOccurrences: number;
  readonly jsonFieldCommands: number;
  readonly jsonFields: number;
  /** FR-GH-001 분류 차원에서 `unknown`이 아닌 leaf 수. */
  readonly classifiedLeafCommands: number;
  readonly unclassifiedLeafCommands: number;
  /** 실행 차원에서 `allowed`인 leaf 수. */
  readonly executableCommands: number;
  /** NFR-009 차원별 커버리지 (CR-088). 검증기가 독립적으로 다시 세어 대조한다. */
  readonly dimensions: readonly GhCoverageDimension[];
}

export interface GhCapabilityManifest {
  readonly manifestVersion: string;
  readonly ghVersion: string;
  readonly generatedAt: string;
  /** `manifestVersion`·`ghVersion`·`commands`·`capabilities`의 정규 JSON SHA-256. */
  readonly hash: string;
  readonly commands: readonly GhManifestCommand[];
  readonly capabilities: readonly GhCapabilityDefinition[];
  readonly helpTopics: readonly string[];
  readonly coverage: GhManifestCoverage;
}

/* ------------------------------------------------------------- invocation */

/**
 * 사용자 의도의 구조화 표현 (FR-GH-002 AC-7, ENT-GH-008).
 *
 * **문자열 명령은 어느 단계에서도 진실이 아니다.** 저장소는 `owner/name` 슬러그이며
 * 호스트는 사용자 입력이 아니라 서버 설정이다. positional·stdin·파일 바인딩은
 * 이 판이 여는 capability에 없으므로 비어 있어야 한다 — 값이 오면 거절한다.
 */
export interface GhInvocation {
  readonly capability_id: string;
  readonly context: {
    readonly repository: string;
  };
  readonly flags: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly output: {
    readonly json_fields: readonly string[];
  };
}

/** 검증을 통과해 값이 채워진 invocation. argv 빌더는 이것만 받는다. */
export interface GhNormalizedInvocation {
  readonly capabilityId: string;
  readonly repository: { readonly owner: string; readonly name: string };
  /** 옵션 정의 순서대로 정렬된 값. `bool`이 `false`이면 빠진다. */
  readonly options: readonly { readonly flag: string; readonly value: string | number | boolean | readonly string[] }[];
  readonly jsonFields: readonly string[];
}

/** 실행 직전에 서버가 확정하는 컨텍스트 (C-062). 비밀은 없다. */
export interface GhExecutionContext {
  /** `ghe.example.com` 또는 `127.0.0.1:48443` — `GHE_BASE_URL`의 host 부분. */
  readonly host: string;
  readonly repository: { readonly owner: string; readonly name: string };
}

export interface GhConstraintViolation {
  readonly code:
    | 'unknown_flag'
    | 'positional_not_allowed'
    | 'enum_value'
    | 'int_format'
    | 'int_range'
    | 'bool_format'
    | 'json_field_not_allowed'
    | 'json_fields_min'
    | 'json_fields_max'
    | 'json_fields_duplicate'
    | 'repository_format'
    | 'requires'
    | 'conflicts'
    | 'one_of'
    | 'exactly_one'
    | 'at_least_one'
    | 'implies'
    | 'required_if'
    | 'input_source_exclusive'
    | 'context_required';
  readonly flag: string | null;
  readonly message: string;
}

/* ----------------------------------------------------------------- 결과 */

export interface GhSafeText {
  readonly text: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly bytesTotal: number;
  readonly bytesKept: number;
}

/** `pr list --json`의 한 행. 허용 필드만 있고 값은 무해화 경계를 지났다. */
export interface GhPrListRow {
  readonly number: number;
  readonly title: string | null;
  readonly state: string | null;
  readonly url: string | null;
  readonly author: string | null;
  readonly headRefName: string | null;
  readonly baseRefName: string | null;
  readonly isDraft: boolean | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface GhPrListResult {
  readonly schema: 'pr_list_v1';
  readonly rows: readonly GhPrListRow[];
  readonly fields: readonly string[];
  /** 요청한 상한(`--limit`)에 닿아 더 있을 수 있는가. gh는 초과분을 잘라 내고 알리지 않는다. */
  readonly possiblyMore: boolean;
}

/** 실행 상태 (FR-GH-006 AC-1). */
export type GhExecutionState =
  | 'queued'
  | 'preflighting'
  | 'awaiting_confirmation'
  | 'awaiting_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'policy_blocked';

export const GH_TERMINAL_STATES: readonly GhExecutionState[] = [
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'policy_blocked',
];

export function isTerminalExecutionState(state: string): boolean {
  return (GH_TERMINAL_STATES as readonly string[]).includes(state);
}
