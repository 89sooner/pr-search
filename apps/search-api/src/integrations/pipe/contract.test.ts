/**
 * PIPE 연동 계약 (CR-112 / API-INT-001~014) — handoff 산출물이 코드 정본과 같은가.
 *
 * `handoff/pipe-search-integration/v1/`의 OpenAPI·operation map·예시·manifest는 PIPE 담당 세션이 이 저장소를
 * 보지 않고 구현하는 근거다. 코드가 바뀌었는데 그 파일들이 그대로면 인수인계가 거짓이 된다 — 그 상태를
 * 여기서 막는다. 정본은 코드다: 경로 목록은 `INTEGRATION_OPERATIONS`, 연동 오류는 `PSI_ERRORS`, 상한은 각
 * 모듈의 상수. 실제 응답 본문과 스키마의 대조는 통합 시험(`integration/integrations/pipe/openapi.test.ts`)이 맡는다.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { MAX_PREFIX_CANDIDATES } from '@prs/es';
import { MAX_SOURCE_COMMITS } from '../../resolve/detail.js';
import { DEFAULT_RESOLVE_LIMIT } from '../../resolve/service.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../repositories/overview.js';
import { SEARCH_TIMEOUT_MS } from '../../search/routes.js';
import { DEFAULT_SIZE, MAX_SIZE, TRACK_TOTAL_HITS } from '../../search/service.js';
import { SOURCE_MAX_BYTES, SOURCE_MAX_ENTRIES, SOURCE_MAX_LINES } from '../../source/service.js';
import { CLOCK_SKEW_SECONDS, MAX_ASSERTION_LENGTH, MAX_ASSERTION_TTL_SECONDS } from './assertion.js';
import { PROTOCOL_VERSION, PSI_ERRORS, PSI_ERROR_CODES } from './errors.js';
import { EXPIRED_DIAGNOSTIC_WINDOW_SECONDS, GRANT_TOKEN_PREFIX, GRANT_TTL_SECONDS } from './grant-store.js';
import {
  BASE_CAPABILITIES,
  INTEGRATION_OPERATIONS,
  INTEGRATION_PREFIX,
  MERGE_NUMBER_CAPABILITY,
  type IntegrationOperation,
} from './operations.js';
import { INTEGRATION_BODY_LIMIT, INTEGRATION_REQUEST_TIMEOUT_MS } from './server.js';

// ------------------------------------------------------------------ 파일 읽기

const HANDOFF = new URL('../../../../../handoff/pipe-search-integration/v1/', import.meta.url);
const handoffPath = (name: string): string => fileURLToPath(new URL(name, HANDOFF));
/** 작업 트리는 CRLF일 수 있다(core.autocrlf). 커밋된 내용과 같은 LF로 읽는다. */
const readText = (name: string): string => readFileSync(handoffPath(name), 'utf8').replace(/\r\n/g, '\n');

// js-yaml은 타입 선언이 없다. 이 시험이 쓰는 함수 하나만 좁혀 받는다.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(input: string): unknown };

interface OpenApiParameter {
  readonly name?: string;
  readonly in?: string;
  readonly required?: boolean;
  readonly $ref?: string;
}
interface OpenApiResponse {
  readonly $ref?: string;
  readonly content?: Record<string, { readonly schema?: { readonly $ref?: string } }>;
}
interface OpenApiOperation {
  readonly operationId: string;
  readonly 'x-operation-id': string;
  readonly 'x-api-id': string;
  readonly 'x-auth': string;
  readonly 'x-original': { readonly api_id: string; readonly method: string; readonly path: string } | null;
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly parameters?: readonly OpenApiParameter[];
  readonly responses: Record<string, OpenApiResponse>;
}
interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly version: string };
  readonly security: readonly Record<string, readonly string[]>[];
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly components: {
    readonly parameters: Record<string, OpenApiParameter>;
    readonly responses: Record<string, OpenApiResponse>;
    readonly schemas: Record<string, Record<string, unknown>>;
  };
}
interface MappedOperation {
  readonly id: string;
  readonly api_id: string;
  readonly openapi_operation_id: string;
  readonly method: string;
  readonly path: string;
  readonly auth: string;
  readonly query_keys: readonly string[];
  readonly original: { readonly api_id: string; readonly method: string; readonly path: string } | null;
  readonly limits: Record<string, number>;
  readonly integration_error_codes: readonly string[];
  readonly original_error_schema: string | null;
}
interface OperationMap {
  readonly protocol_version: string;
  readonly prefix: string;
  readonly common: { readonly limits: Record<string, number> };
  readonly operations: readonly MappedOperation[];
}
interface Example {
  readonly operation: string;
  readonly captured: boolean;
  readonly request: { readonly method: string; readonly path: string };
  readonly response: { readonly status: number; readonly headers: Record<string, string>; readonly body: unknown };
}

const OPENAPI_FILE = 'pipe-integration-v1.openapi.yaml';
const openapi = yaml.load(readText(OPENAPI_FILE)) as OpenApiDocument;
const operationMap = JSON.parse(readText('operation-map.json')) as OperationMap;
const exampleFiles = readdirSync(handoffPath('examples/')).filter((name) => name.endsWith('.json')).sort();

// ------------------------------------------------------------------ 도움

/** `:repository` → `{repository}`. OpenAPI와 operation map은 중괄호 표기를 쓴다. */
function templated(path: string): string {
  return path.replace(/:([a-z_]+)/g, '{$1}');
}

/** 코드의 원본 대응을 문서 표기(`api_id`, 중괄호 경로)로 옮긴다. */
function originalOf(operation: IntegrationOperation): { api_id: string; method: string; path: string } | null {
  const original = operation.original;
  return original === null ? null : { api_id: original.apiId, method: original.method, path: templated(original.path) };
}

function openapiPath(operation: IntegrationOperation): string {
  return `${INTEGRATION_PREFIX}${templated(operation.path)}`;
}

function openapiOperation(operation: IntegrationOperation): OpenApiOperation {
  const found = openapi.paths[openapiPath(operation)]?.[operation.method.toLowerCase()];
  if (found === undefined) throw new Error(`OpenAPI에 ${operation.method} ${openapiPath(operation)}가 없다`);
  return found;
}

function resolveRef<T>(ref: string): T {
  const parts = ref.replace(/^#\//, '').split('/');
  let current: unknown = openapi;
  for (const part of parts) current = (current as Record<string, unknown> | undefined)?.[part];
  if (current === undefined) throw new Error(`풀리지 않는 $ref: ${ref}`);
  return current as T;
}

function parameters(operation: OpenApiOperation): OpenApiParameter[] {
  return (operation.parameters ?? []).map((parameter) =>
    parameter.$ref === undefined ? parameter : resolveRef<OpenApiParameter>(parameter.$ref),
  );
}

/** 응답 정의의 본문 스키마 이름. 상태가 따로 없으면 `default`다. */
function responseSchemaName(operation: OpenApiOperation, status: number): string {
  const entry = operation.responses[String(status)] ?? operation.responses['default'];
  if (entry === undefined) throw new Error(`${operation.operationId}에 ${String(status)}·default 응답이 없다`);
  const response = entry.$ref === undefined ? entry : resolveRef<OpenApiResponse>(entry.$ref);
  const ref = response.content?.['application/json']?.schema?.$ref;
  if (ref === undefined) throw new Error(`${operation.operationId} ${String(status)} 응답의 스키마가 $ref가 아니다`);
  return ref.replace('#/components/schemas/', '');
}

function schemaValidator(): (name: string) => ValidateFunction {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats.default(ajv);
  // OpenAPI 확장 키워드와 스키마 묶음의 바깥 키. 검증 뜻은 없다.
  ajv.addKeyword('x-psi-errors');
  ajv.addKeyword('components');
  ajv.addSchema({ $id: 'psi', components: { schemas: openapi.components.schemas } });
  const cache = new Map<string, ValidateFunction>();
  return (name) => {
    let validate = cache.get(name);
    if (validate === undefined) {
      validate = ajv.compile({ $ref: `psi#/components/schemas/${name}` });
      cache.set(name, validate);
    }
    return validate;
  };
}

const validatorFor = schemaValidator();

// ------------------------------------------------------------------ OpenAPI 문서 자체

describe('OpenAPI 문서', () => {
  /*
   * 공식 OAS 3.1 스키마(handoff tools/, 원본 그대로)로 검증한다. Ajv 8은 `$dynamicAnchor`가 스키마 리소스의
   * 루트에 있을 때만 `$dynamicRef`를 바르게 푼다 — 이 판은 방언을 확장하지 않으므로 `#meta`를 정적 `$ref`로
   * 바꿔도 뜻이 같다. `format`은 2020-12의 기본대로 주석으로 둔다(서버 URL 템플릿 `{host}` 때문이다).
   */
  const metaSchema = JSON.parse(readText('tools/openapi-3.1-schema-2022-10-07.json')) as Record<string, unknown>;
  const staticMeta = JSON.parse(
    JSON.stringify(metaSchema).replace(/"\$dynamicRef":"#meta"/g, '"$ref":"#/$defs/schema"'),
  ) as { $defs: { schema: Record<string, unknown> } };
  delete staticMeta.$defs.schema['$dynamicAnchor'];
  const meta = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validateDocument = meta.compile(staticMeta);

  it('OpenAPI 3.1 공식 스키마에 맞는다', () => {
    const ok = validateDocument(openapi);
    expect(validateDocument.errors ?? [], JSON.stringify(validateDocument.errors?.slice(0, 5))).toEqual([]);
    expect(ok).toBe(true);
    expect(openapi.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it('검증기가 실제로 거절한다 — 설명 없는 응답, 위치 없는 파라미터', () => {
    const broken = JSON.parse(JSON.stringify(openapi)) as OpenApiDocument;
    const exchange = broken.paths[`${INTEGRATION_PREFIX}/auth/exchange`]?.['post'];
    delete (exchange?.responses['200'] as Record<string, unknown>)['description'];
    expect(validateDocument(broken)).toBe(false);
    const broken2 = JSON.parse(JSON.stringify(openapi)) as OpenApiDocument;
    delete (broken2.components.parameters['Repository'] as Record<string, unknown>)['in'];
    expect(validateDocument(broken2)).toBe(false);
  });

  it('모든 $ref가 풀리고 모든 스키마가 strict로 컴파일된다', () => {
    const refs = new Set<string>();
    (function walk(node: unknown): void {
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.add(value);
        else walk(value);
      }
    })(openapi);
    for (const ref of refs) expect(() => resolveRef(ref), ref).not.toThrow();
    for (const name of Object.keys(openapi.components.schemas)) expect(() => validatorFor(name), name).not.toThrow();
  });

  it('프로토콜 판·능력·operation 이름·토큰 형식이 코드와 같다', () => {
    const schemas = openapi.components.schemas;
    expect(openapi.info.version).toBe(PROTOCOL_VERSION);
    expect(schemas['ProtocolVersion']?.['const']).toBe(PROTOCOL_VERSION);
    expect(schemas['Capability']?.['enum']).toEqual([...BASE_CAPABILITIES, MERGE_NUMBER_CAPABILITY]);
    expect(schemas['ReadOperationId']?.['enum']).toEqual(
      INTEGRATION_OPERATIONS.filter((operation) => operation.id.startsWith('read.')).map((operation) => operation.id),
    );
    const exchange = schemas['ExchangeResponse']?.['properties'] as Record<string, Record<string, unknown>>;
    expect(exchange['access_token']?.['pattern']).toBe(`^${GRANT_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);
    expect(exchange['expires_in']?.['maximum']).toBe(GRANT_TTL_SECONDS);
    const assertion = (schemas['AssertionRequest']?.['properties'] as Record<string, Record<string, unknown>>)['assertion'];
    expect(assertion?.['maxLength']).toBe(MAX_ASSERTION_LENGTH);
  });
});

// ------------------------------------------------------------------ 경로 ↔ 코드

describe('OpenAPI 경로가 INTEGRATION_OPERATIONS와 같다', () => {
  it('경로·method의 집합이 정확히 같다 — 한쪽에만 있는 경로가 없다', () => {
    const inDocument = Object.entries(openapi.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const inCode = INTEGRATION_OPERATIONS.map((operation) => `${operation.method} ${openapiPath(operation)}`);
    expect([...inDocument].sort()).toEqual([...inCode].sort());
  });

  it.each(INTEGRATION_OPERATIONS.map((operation) => [operation.id, operation] as const))(
    '%s — 식별자·인증·원본·파라미터가 같다',
    (_id, operation) => {
      const documented = openapiOperation(operation);
      expect(documented['x-operation-id']).toBe(operation.id);
      expect(documented['x-api-id']).toBe(operation.apiId);
      expect(documented['x-auth']).toBe(operation.auth);
      expect(documented['x-original']).toEqual(
        originalOf(operation),
      );

      const all = parameters(documented);
      expect(all.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name)).toEqual([
        ...operation.queryKeys,
      ]);
      const pathParams = [...operation.path.matchAll(/:([a-z_]+)/g)].map((match) => match[1]);
      expect(all.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name)).toEqual(pathParams);
      for (const parameter of all.filter((candidate) => candidate.in === 'path')) expect(parameter.required).toBe(true);
      expect(all.filter((parameter) => parameter.in === 'header').map((parameter) => parameter.name)).toEqual([
        'X-Correlation-Id',
      ]);

      // 인증: assertion 경로는 mTLS만, grant 경로는 mTLS + grant다.
      const security = documented.security ?? openapi.security;
      expect(security).toEqual(
        operation.auth === 'mtls+assertion' ? [{ mutualTLS: [] }] : [{ mutualTLS: [], grant: [] }],
      );
    },
  );
});

// ------------------------------------------------------------------ 연동 오류

describe('연동 오류 코드가 PSI_ERRORS와 같다', () => {
  it('코드 목록(순서 포함)과 코드별 상태·재시도 가능·문구가 같다', () => {
    const codeSchema = openapi.components.schemas['PsiErrorCode'];
    expect(codeSchema?.['enum']).toEqual([...PSI_ERROR_CODES]);
    expect(codeSchema?.['x-psi-errors']).toEqual(PSI_ERRORS);
  });
});

// ------------------------------------------------------------------ operation map

describe('operation-map.json이 코드와 같다', () => {
  it('판·접두·공통 상한', () => {
    expect(operationMap.protocol_version).toBe(PROTOCOL_VERSION);
    expect(operationMap.prefix).toBe(INTEGRATION_PREFIX);
    expect(operationMap.common.limits).toEqual({
      request_timeout_ms: INTEGRATION_REQUEST_TIMEOUT_MS,
      body_bytes_max: INTEGRATION_BODY_LIMIT,
    });
  });

  it('operation이 같은 순서로 하나씩 대응한다', () => {
    expect(operationMap.operations.map((operation) => operation.id)).toEqual(
      INTEGRATION_OPERATIONS.map((operation) => operation.id),
    );
  });

  /** map의 상한 이름 → 코드 상수. 여기 없는 상한은 원본 route의 리터럴이다(`page_max` 등). */
  const LIMIT_CONSTANTS: Record<string, number> = {
    assertion_chars_max: MAX_ASSERTION_LENGTH,
    assertion_lifetime_seconds_max: MAX_ASSERTION_TTL_SECONDS,
    clock_skew_seconds: CLOCK_SKEW_SECONDS,
    grant_ttl_seconds_max: GRANT_TTL_SECONDS,
    expired_diagnostic_window_seconds: EXPIRED_DIAGNOSTIC_WINDOW_SECONDS,
    size_default: DEFAULT_SIZE,
    size_max: MAX_SIZE,
    es_timeout_ms: SEARCH_TIMEOUT_MS,
    track_total_hits: TRACK_TOTAL_HITS,
    source_commits_max: MAX_SOURCE_COMMITS,
    entries_max: SOURCE_MAX_ENTRIES,
    file_bytes_max: SOURCE_MAX_BYTES,
    file_lines_max: SOURCE_MAX_LINES,
  };
  const OPERATION_LIMITS: Record<string, Record<string, number>> = {
    'read.repositories': { limit_default: DEFAULT_PAGE_SIZE, limit_max: MAX_PAGE_SIZE },
    'read.resolve': { limit_default: DEFAULT_RESOLVE_LIMIT, limit_max: MAX_PREFIX_CANDIDATES },
  };

  it.each(INTEGRATION_OPERATIONS.map((operation) => [operation.id, operation] as const))(
    '%s — 경로·method·인증·query·원본·상한·오류 스키마',
    (id, operation) => {
      const mapped = operationMap.operations.find((candidate) => candidate.id === id);
      expect(mapped).toBeDefined();
      if (mapped === undefined) return;
      expect(mapped.api_id).toBe(operation.apiId);
      expect(mapped.method).toBe(operation.method);
      expect(mapped.path).toBe(openapiPath(operation));
      expect(mapped.auth).toBe(operation.auth);
      expect(mapped.query_keys).toEqual([...operation.queryKeys]);
      expect(mapped.original).toEqual(
        originalOf(operation),
      );

      const documented = openapiOperation(operation);
      expect(mapped.openapi_operation_id).toBe(documented.operationId);

      for (const code of mapped.integration_error_codes) expect(PSI_ERROR_CODES as readonly string[]).toContain(code);
      expect(new Set(mapped.integration_error_codes).size).toBe(mapped.integration_error_codes.length);

      // 조회는 default 응답이 `oneOf [PsiErrorResponse, <원본 오류 스키마>]`다. map의 이름과 같아야 한다.
      const errorSchema = responseSchemaName(documented, 599);
      if (mapped.original_error_schema === null) {
        expect(errorSchema).toBe('PsiErrorResponse');
      } else {
        const union = openapi.components.schemas[errorSchema]?.['oneOf'] as readonly { $ref: string }[] | undefined;
        expect(union?.map((entry) => entry.$ref)).toEqual([
          '#/components/schemas/PsiErrorResponse',
          `#/components/schemas/${mapped.original_error_schema}`,
        ]);
      }

      for (const [key, value] of Object.entries(mapped.limits)) {
        const expected = OPERATION_LIMITS[id]?.[key] ?? LIMIT_CONSTANTS[key];
        if (expected !== undefined) expect([key, value]).toEqual([key, expected]);
      }
    },
  );
});

// ------------------------------------------------------------------ 예시

describe('examples/*.json이 OpenAPI 응답 스키마에 맞는다', () => {
  it('예시가 있다', () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(exampleFiles)('%s', (file) => {
    const example = JSON.parse(readText(`examples/${file}`)) as Example;
    const operation = INTEGRATION_OPERATIONS.find((candidate) => candidate.id === example.operation);
    expect(operation, `${file}의 operation`).toBeDefined();
    if (operation === undefined) return;

    // 요청: 경로가 그 operation의 것이다.
    expect(example.request.method).toBe(operation.method);
    const pattern = new RegExp(`^${openapiPath(operation).replace(/\{[a-z_]+\}/g, '[^/?]+')}(\\?.*)?$`);
    expect(example.request.path).toMatch(pattern);

    // 응답: 상태에 맞는 스키마로 본문을 검증한다.
    const schemaName = responseSchemaName(openapiOperation(operation), example.response.status);
    const validate = validatorFor(schemaName);
    const ok = validate(example.response.body);
    expect(validate.errors ?? [], `${file} → ${schemaName}: ${JSON.stringify(validate.errors?.slice(0, 3))}`).toEqual([]);
    expect(ok).toBe(true);

    // 머리글: 모든 응답이 no-store이고, 본문에 상관 ID가 있으면 머리글과 같다.
    expect(example.response.headers['cache-control']).toBe('private, no-store');
    const body = example.response.body as { correlation_id?: string };
    if (body.correlation_id !== undefined) expect(example.response.headers['x-correlation-id']).toBe(body.correlation_id);
  });
});

// ------------------------------------------------------------------ manifest

interface Manifest {
  readonly protocol_version: string;
  readonly checksum_algorithm: string;
  readonly contract_checksum: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('manifest.json의 checksum이 파일과 같다', () => {
  const manifest = JSON.parse(readText('manifest.json')) as Manifest;

  it('계약 checksum은 OpenAPI와 operation map을 이어 붙인 LF 바이트의 SHA-256이다', () => {
    expect(manifest.protocol_version).toBe(PROTOCOL_VERSION);
    expect(manifest.contract_checksum).toBe(sha256(readText(OPENAPI_FILE) + readText('operation-map.json')));
  });

  it('나열된 파일마다 LF 정규화 SHA-256이 같고, manifest 밖 파일이 없다', () => {
    for (const entry of manifest.files) expect([entry.path, sha256(readText(entry.path))]).toEqual([entry.path, entry.sha256]);
    const listed = new Set(manifest.files.map((entry) => entry.path));
    const onDisk = (function list(dir: string): string[] {
      return readdirSync(handoffPath(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? list(`${dir}${entry.name}/`) : [`${dir}${entry.name}`],
      );
    })('').filter((path) => path !== 'manifest.json');
    expect(onDisk.filter((path) => !listed.has(path))).toEqual([]);
  });
});
