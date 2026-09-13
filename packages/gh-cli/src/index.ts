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
  safeHttpUrl,
} from './result.js';
export type { ParsePrListOutcome, PrListJsonField } from './result.js';

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
  manifestHash,
  summarizeCommand,
  verifyManifestHash,
} from './manifest.js';
export type { ManifestBuildInput } from './manifest.js';
export { sha256Hex } from './sha256.js';
