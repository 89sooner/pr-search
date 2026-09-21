# tools — 계약 검증 도구 입력

## `openapi-3.1-schema-2022-10-07.json`

OpenAPI 3.1 문서의 공식 JSON Schema를 **바꾸지 않고** 그대로 둔 사본입니다.

| 항목 | 값 |
|---|---|
| 출처 | <https://spec.openapis.org/oas/3.1/schema/2022-10-07> |
| 받은 날 | 2026-09-21 |
| SHA-256 | `da01ba28852cac0de53893797cb8d1942bc3b05084f526dcc216717dec314ed0` |
| 저작권·라이선스 | OpenAPI Initiative, Apache License 2.0 |

pr-search의 계약 시험(`apps/search-api/src/integrations/pipe/contract.test.ts`)이 이 파일로 `pipe-integration-v1.openapi.yaml`을 검증합니다. 두 가지를 알아 두십시오.

1. **`$dynamicRef`를 정적 `$ref`로 바꿔 씁니다.** 이 스키마는 Schema Object 자리를 `"$dynamicRef": "#meta"`로 가리키고 `$defs/schema`에 `"$dynamicAnchor": "meta"`를 둡니다. Ajv 8은 `$dynamicAnchor`가 스키마 리소스의 루트에 있을 때만 이것을 올바르게 해석해서, 그대로 쓰면 올바른 문서도 거절합니다. 이 판은 방언을 확장하지 않으므로 `"$dynamicRef": "#meta"`를 `"$ref": "#/$defs/schema"`로 바꾸는 것은 뜻을 바꾸지 않습니다. 바꾸기는 시험 코드가 메모리에서 하며 이 파일은 원본 그대로입니다.
2. **`format`은 주석으로 다룹니다.** JSON Schema 2020-12에서 `format`의 기본은 검사가 아니라 주석입니다. 서버 URL 템플릿(`https://{host}:{port}`)은 `uri-reference` 형식 검사를 통과하지 못하지만 OpenAPI가 허용하는 표기입니다.

PIPE 저장소도 같은 방식으로 이 파일을 써서 OpenAPI를 검증할 수 있습니다.
