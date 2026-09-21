/**
 * mTLS 전송 인증 (CR-112 / 공통 계약 3.3·5.1, PSI-A02~A04).
 *
 * ## 실제 TLS 상태만 믿는다
 *
 * client는 **이 프로세스가 끝낸 TLS 핸드셰이크**에서 정한다 — `TLSSocket.authorized`와 peer
 * 인증서의 DER 바이트다. `X-SSL-Client-Verify`·`X-Client-Cert` 같은 헤더는 **읽지 않는다.**
 * 이 판(v1)의 배포 형상은 TLS passthrough(L4)뿐이다 (ADR-025). 프록시가 TLS를 끝내는 형상은
 * 신뢰 전달 설계가 따로 필요하며, 두 저장소가 함께 계약을 고칠 때까지 지원하지 않는다.
 *
 * 인증서 체인·유효 기간 검증은 Node(OpenSSL)가 리스너의 client CA로 핸드셰이크에서 이미 했다
 * (`requestCert` + `rejectUnauthorized`). 여기서는 그 결과를 다시 확인하고, **어느 client인지**를
 * 등록된 지문·subjectAltName으로 정한다. 같은 CA가 발급한 다른 서비스의 인증서는 client가 아니다.
 */

import { createHash } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import type { PipeClientPolicy } from './config.js';
import { PsiError } from './errors.js';

export interface VerifiedTransport {
  readonly client: PipeClientPolicy;
  /** leaf 인증서 DER의 SHA-256 (소문자 hex). grant가 이 값에 묶인다. */
  readonly certificateSha256: string;
  /** 인증서 만료 시각 (epoch ms). grant 수명은 이것을 넘지 않는다. */
  readonly certificateNotAfterMs: number;
}

/**
 * Node의 `subjectaltname`(`DNS:a, URI:b`)을 항목으로 나눈다.
 *
 * 새 Node는 특수 문자가 든 값을 따옴표로 감싼다. 따옴표 안의 쉼표에서 자르지 않는다 — 그런
 * 값은 설정이 받지 않으므로(config의 SAN 형식) 어느 client와도 맞지 않는다.
 */
export function subjectAltNames(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === '') return [];
  return (raw.match(/(?:[^,"]|"[^"]*")+/g) ?? []).map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * 요청의 소켓에서 client를 정한다.
 *
 * @throws {PsiError} `CLIENT_AUTH_FAILED` — TLS가 아니거나, 검증되지 않았거나, 인증서가 없거나,
 * 등록된 client 하나로 정해지지 않으면.
 */
export function authenticateTransport(socket: unknown, clients: readonly PipeClientPolicy[]): VerifiedTransport {
  // `app.inject`·평문 소켓은 여기서 끝난다 — 헤더로 TLS 상태를 흉내 낼 방법이 없다.
  if (!(socket instanceof TLSSocket) || !socket.encrypted) throw new PsiError('CLIENT_AUTH_FAILED', 'not_tls');
  if (socket.authorized !== true) throw new PsiError('CLIENT_AUTH_FAILED', 'peer_unverified');

  const certificate = socket.getPeerCertificate(false);
  // 세션 재개 등으로 peer 인증서를 얻지 못하면 거절한다 (fail closed).
  if (typeof certificate !== 'object' || !Buffer.isBuffer(certificate.raw) || certificate.raw.length === 0) {
    throw new PsiError('CLIENT_AUTH_FAILED', 'no_peer_certificate');
  }

  const certificateSha256 = createHash('sha256').update(certificate.raw).digest('hex');
  const names = subjectAltNames(certificate.subjectaltname);
  const matches = clients.filter(
    (client) => client.certificateSha256.has(certificateSha256) || names.some((name) => client.subjectAltNames.has(name)),
  );
  if (matches.length === 0) throw new PsiError('CLIENT_AUTH_FAILED', 'unregistered_certificate');
  // 기동 때 중복을 막지만(config), 지문 하나와 SAN 하나가 서로 다른 client를 가리킬 수 있다.
  if (matches.length > 1) throw new PsiError('CLIENT_AUTH_FAILED', 'ambiguous_certificate');

  const notAfter = Date.parse(certificate.valid_to);
  if (!Number.isFinite(notAfter)) throw new PsiError('CLIENT_AUTH_FAILED', 'certificate_validity_unreadable');

  const client = matches[0];
  if (client === undefined) throw new PsiError('CLIENT_AUTH_FAILED', 'unregistered_certificate');
  return { client, certificateSha256, certificateNotAfterMs: notAfter };
}
