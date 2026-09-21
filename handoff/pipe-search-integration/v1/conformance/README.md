# conformance — PIPE 서명기 대조용 벡터

> **FIXTURE ONLY.** `keys/`에는 시험 전용 키 쌍의 **공개키만** 있습니다. 이 저장소는 공개 저장소라 비밀키 파일은 커밋하지 않았습니다. 이 키는 어떤 배포 환경(dev·stage·prod)에서도 쓰지 않습니다. pr-search는 `NODE_ENV=production`에서 이 공개키(SPKI SHA-256 `a09ce41e6e4304fb8117b867340cee2b15001b6247984e64951cce1f0639dfb1`)가 정책에 있으면 **기동을 거부합니다.** 운영 키는 PIPE가 따로 만들고 공개키만 pr-search에 넘깁니다.

## 무엇을 대조하는가

PSI-1.0 assertion은 RS256(RSASSA-PKCS1-v1_5 + SHA-256)으로 서명합니다. 구현마다 갈리는 자리는 서명 알고리즘이 아니라 **헤더·payload의 직렬화와 claim 규칙**이므로, PIPE 서명기는 다음 순서로 pr-search와 맞는지 확인합니다.

1. `vectors.json`의 `header`와 `payload`를 **적힌 키 순서 그대로** JSON으로 직렬화합니다 (공백 없음, Python이면 `json.dumps(obj, separators=(",", ":"), ensure_ascii=False)`처럼 키 순서를 보존).
2. 서명 입력 = `base64url(header) + "." + base64url(payload)` (패딩 없음). 이 값이 `token`의 앞 두 조각(`.`으로 나눈 첫째·둘째)과 **바이트 단위로 같아야** 합니다.
3. `token`의 서명을 `keys/TEST-ONLY-pipe-conformance-signing.public.pem`(RS256)으로 검증합니다. 서명이 없는 V22(`alg: none`)를 뺀 21개 벡터에서 통과해야 합니다 — 거절 벡터도 서명은 올바르고, claim·헤더 규칙 때문에 거절됩니다.
4. 각 벡터의 `expect`는 pr-search가 그 토큰에 내는 결과입니다: `accept`이거나, `401 ASSERTION_INVALID`와 내부 사유 코드(`reason`)입니다. **사유 코드는 응답 본문에 나오지 않습니다** (pr-search 이벤트 기록에만 남습니다). PIPE는 코드까지만 대조합니다.

PIPE가 자기 키로 서명한 결과까지 확인하려면, 자기 시험 키의 공개키를 pr-search 시험 배포의 정책(`signing_keys`)에 등록하고 발급 요청을 보내 봅니다. RS256은 결정적이라 같은 키·같은 서명 입력이면 서명도 같습니다.

벡터는 고정 시계 `clock_now_seconds`(2033-05-18T03:33:20Z)와 각 벡터의 `now`로 판정됩니다. 시계 경계(TTL 60초, 미래 iat 5초, 만료 뒤 허용 오차 5초)를 확인하는 벡터가 들어 있습니다.

## 시험 client 설정

`vectors.json`의 `client`가 pr-search 정책에 넣었을 값입니다.

```json
{
  "client_id": "pipe-conformance",
  "issuer": "urn:fixture:pipe:conformance",
  "audience": "urn:fixture:pr-search:pipe-integration:conformance",
  "profile": "search-read-v1",
  "kid": "pipe-conformance-2033-01"
}
```

## 다시 만들기

```bash
# vectors.json을 다시 쓴다. 같은 비밀키면 결과가 바이트 단위로 같다.
PIPE_CONFORMANCE_PRIVATE_KEY=<시험 비밀키 PEM 경로> node generate-vectors.mjs
```

비밀키는 저장소 밖에서 관리합니다. 잃었으면 새 키 쌍을 만들고 `keys/`의 공개키, `vectors.json`, pr-search 설정의 거부 목록(`FIXTURE_SIGNING_KEY_SPKI_SHA256`)을 함께 바꿉니다.

pr-search 쪽 시험 `apps/search-api/src/integrations/pipe/conformance.test.ts`가 이 파일의 모든 벡터를 실제 `verifyAssertion`으로 돌려 기대 결과와 사유가 맞는지 확인합니다. 인수인계 자료와 구현이 어긋나면 그 시험이 깨집니다.

## mTLS 시험 인증서

인증서는 만료가 있어 커밋하지 않았습니다. pr-search 통합 시험(`apps/search-api/integration/integrations/pipe/fixtures.ts`의 `generateTls`)이 실행마다 `openssl`로 만드는 방식과 같게 만들면 됩니다.

```bash
# 시험 전용 CA와 client 인증서 (2일 유효). 운영 인증서가 아니다.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout client-ca.key -out client-ca.crt -subj /CN=psi-test-client-ca -days 2
printf 'subjectAltName=URI:spiffe://test/pipe-dev\nextendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\n' > pipe-dev.ext
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout pipe-dev.key -out pipe-dev.csr -subj /CN=pipe-dev
openssl x509 -req -in pipe-dev.csr -CA client-ca.crt -CAkey client-ca.key -CAcreateserial -out pipe-dev.crt -days 2 -extfile pipe-dev.ext
```

pr-search 정책의 `tls_client.subject_alt_names`에 `URI:spiffe://test/pipe-dev`를 적으면 이 인증서가 그 client로 인정됩니다.
