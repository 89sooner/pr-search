/**
 * @prs/gh-cli — GitHub Operations Plane의 capability 모델·argv 조립·출력 경계 (ADR-013).
 *
 * **이 진입점은 브라우저에서도 돈다.** Node 전용 코드(바이너리 호출·manifest 파일·
 * 봉인)는 `@prs/gh-cli/node`에 있다. 폼 검증과 서버 검증이 같은 함수를 읽어야
 * 하므로(FR-GH-003 AC-8) 순수한 부분을 따로 둔다.
 *
 * `gh`를 실행하는 코드는 여기 없다. 그것은 `apps/gh-executor`만 한다 (ADR-016).
 */

export const PACKAGE_NAME = '@prs/gh-cli' as const;

export {
  GH_PINNED_LINUX_AMD64,
  GH_PINNED_RELEASE_DATE,
  GH_PINNED_VERSION,
  GH_RELEASE_DOWNLOAD_BASE,
  ghPinnedAssetUrl,
  parseGhVersionOutput,
} from './pin.js';
export type { GhPinnedAsset } from './pin.js';

export type {
  GhBoolOption,
  GhCapabilityDefinition,
  GhCapabilityManifest,
  GhConstraint,
  GhConstraintViolation,
  GhEnumOption,
  GhExecutionContext,
  GhExecutionState,
  GhExecutionStatus,
  GhIntOption,
  GhInteractionMode,
  GhInventory,
  GhInventoryCommand,
  GhInventoryFlag,
  GhInvocation,
  GhJsonFieldsOption,
  GhManifestCommand,
  GhManifestCoverage,
  GhNormalizedInvocation,
  GhOption,
  GhPrListResult,
  GhPrListRow,
  GhResultContract,
  GhRiskLevel,
  GhSafeText,
  GhSupportStatus,
} from './types.js';
export { GH_TERMINAL_STATES, isTerminalExecutionState } from './types.js';

export { parseFlagLine, parseHelp, splitHelpSections } from './help-parse.js';
export type { ParsedCommandListing, ParsedHelp, ParsedHelpSection } from './help-parse.js';

export { evaluateInvocation, evaluateRelations, parseRepositorySlug } from './constraints.js';
export type { EvaluationResult, RepositorySlug } from './constraints.js';

export { REDACTED, argvEquals, buildArgv, redactArgv, redactString } from './argv.js';

export { SafeOutputStream, looksBinary, sanitizeOutput, sanitizeText, stripEscapes } from './safe-output.js';
export type { SafeOutputOptions } from './safe-output.js';

export {
  PR_LIST_DEFAULT_JSON_FIELDS,
  PR_LIST_JSON_FIELDS,
  parsePrListOutput,
  prListPortValue,
  safeHttpUrl,
} from './result.js';
export type { ParsePrListOutcome, PrListJsonField, PrListResultContext } from './result.js';

export {
  GH_EXECUTION_ENV_KEYS,
  GH_EXECUTION_PATH,
  GH_SECRET_ENV_KEYS,
  buildExecutionEnv,
  describeExecutionEnv,
} from './env.js';
export type { ExecutionEnvInput, GhExecutionEnvKey } from './env.js';

export {
  EXECUTABLE_CAPABILITIES,
  IMPLEMENTED_RESULT_SCHEMAS,
  PR_LIST_CAPABILITY,
  PR_LIST_CAPABILITY_ID,
  R0_READ_TIMEOUT_MS,
  capabilityIdOf,
  findCapability,
} from './capabilities.js';

export {
  MANIFEST_VERSION,
  buildManifest,
  canonicalJson,
  coverageOf,
  manifestHash,
  summarizeCommand,
  verifyManifestHash,
} from './manifest.js';
export type { ManifestBuildInput } from './manifest.js';
export { sha256Hex } from './sha256.js';

export type {
  GhAuthRequirement,
  GhClassificationBasis,
  GhCommandClassification,
  GhContextRequirement,
  GhControlClass,
  GhCoverageDimension,
  GhCoverageGate,
  GhFlagClassification,
  GhFlagValueKind,
  GhHostSupport,
  GhIoProfile,
  GhOutputFormat,
  GhPositionalClassification,
  GhSideEffect,
} from './types.js';
export { classifyCommand } from './classification/classify.js';
export { COMMAND_ROWS, COMMAND_ROW_COUNT, NEVER_ASSIGNED_SUPPORT } from './classification/commands.js';
export type { CommandRow } from './classification/commands.js';
export { RULES_VERSION, classifyFlag, classifyPositional, enumValuesOf, parseUsagePositionals } from './classification/rules.js';
export type { FlagClassificationOutcome, PositionalClassificationOutcome, UsagePositional } from './classification/rules.js';
export { computeDimensions } from './classification/dimensions.js';
export {
  REPORT_VERSION,
  VALIDATOR_VERSION,
  inventoryCommandOf,
  inventoryHash,
  inventoryOfManifest,
  reportHash,
  validateManifest,
} from './validate.js';
export type { GhContractSummary, GhFindingSeverity, GhRegistryFinding, GhRegistryGate, GhRegistryReport, ValidateOptions } from './validate.js';

/* ------------------------------------------ 결과 계약·typed port·바인딩·그래프 (CR-089) */

export type {
  GhComposability,
  GhImplementedResultAdapter,
  GhJsonIdentity,
  GhOutputModeContract,
  GhPort,
  GhPortCondition,
  GhPortConditionCode,
  GhPortSlot,
  GhPortSource,
  GhPrListReferences,
  GhResourceKind,
  GhResourceRef,
  GhResultAdapter,
  GhResultKind,
  GhResultSensitivity,
  GhUrlGrammar,
} from './types.js';
export { JSON_POINTER_MAX_LENGTH, JSON_POINTER_MAX_TOKENS, evaluateJsonPointer, parseJsonPointer } from './json-pointer.js';
export type { JsonPointerError, JsonPointerEvaluation, JsonPointerParse } from './json-pointer.js';
export { IDENTIFIABLE_KINDS, REPOSITORY_SCOPED_KINDS, RESOURCE_KINDS, refFromOutputUrl, refTypeName, slugOf, validateResourceRef } from './resource-ref.js';
export type { GhRefContext, GhRefProblem, GhRefValidation, GhUrlRefOutcome, GhUrlRefProblem } from './resource-ref.js';
export { BINDING_EXECUTION_BLOCKED, evaluateBinding, judgePortCompatibility } from './binding.js';
export type {
  GhBinding,
  GhBindingOutcome,
  GhBindingRejection,
  GhBindingTargetContext,
  GhCompatibilityVerdict,
  GhIncompatibility,
  GhIncompatibilityCode,
  GhPortCompatibility,
  GhPortEndpoint,
  GhPortValue,
} from './binding.js';
export { computeCapabilityGraph } from './graph.js';
export type { GhCapabilityGraph, GhGraphBlockedPair, GhGraphEdge, GhGraphSummary } from './graph.js';
export {
  BINDABLE_COMPOSABILITY,
  COMPOSABILITY_VALUES,
  OPAQUE_JSON,
  OUTPUT_PORT_NOTES,
  PORTLESS_RESOURCE,
  RESULT_ADAPTERS,
  RESULT_KINDS,
  RESULT_KIND_EVIDENCE,
  RESULT_SENSITIVITIES,
  classifyResult,
  composabilityOf,
} from './classification/results.js';
export { JSON_OUTPUT_PORTS, PR_LIST_RESULT_SCHEMA, URL_OUTPUT_PORTS, jsonSchemaName, subjectSlotsOf, urlSchemaName } from './classification/ports.js';
export type { SubjectSlot } from './classification/ports.js';
export { contractProblems } from './classification/contract-checks.js';
export type { ContractDimension, ContractProblem } from './classification/contract-checks.js';
export { NONZERO_DENOMINATOR_DIMENSIONS } from './classification/dimensions.js';
