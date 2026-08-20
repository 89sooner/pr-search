/**
 * 웹훅 서명 검증 단위 테스트 (FR-ING-001 AC-1, 보안 문서 9장 "웹훅 서명 —
 * 유효·무효·변조·타이밍").
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSignature, constantTimeEquals, verifyWebhookSignature } from './signature.js';

const SECRET = 'test-webhook-secret';
const OTHER_SECRET = 'rotated-webhook-secret';
const BODY = Buffer.from('{"action":"opened","number":1234}', 'utf8');

describe('FR-ING-001 AC-1: 웹훅 HMAC-SHA256 서명 검증', () => {
  it('유효한 서명을 통과시킨다', () => {
    expect(verifyWebhookSignature(BODY, computeSignature(BODY, SECRET), [SECRET])).toBe(true);
  });

  it('GitHub이 계산하는 값과 같은 서명을 만든다', () => {
    const expected = `sha256=${createHmac('sha256', SECRET).update(BODY).digest('hex')}`;
    expect(computeSignature(BODY, SECRET)).toBe(expected);
  });

  it('다른 시크릿으로 만든 서명을 거부한다', () => {
    expect(verifyWebhookSignature(BODY, computeSignature(BODY, OTHER_SECRET), [SECRET])).toBe(false);
  });

  it('본문이 한 바이트라도 변조되면 거부한다', () => {
    const signature = computeSignature(BODY, SECRET);
    const tampered = Buffer.from('{"action":"opened","number":1235}', 'utf8');
    expect(verifyWebhookSignature(tampered, signature, [SECRET])).toBe(false);
  });

  it('서명 헤더가 없거나 비어 있으면 거부한다', () => {
    expect(verifyWebhookSignature(BODY, undefined, [SECRET])).toBe(false);
    expect(verifyWebhookSignature(BODY, '', [SECRET])).toBe(false);
  });

  it('접두사가 없거나 길이가 다른 서명을 예외 없이 거부한다', () => {
    const hex = computeSignature(BODY, SECRET).slice('sha256='.length);
    expect(verifyWebhookSignature(BODY, hex, [SECRET])).toBe(false);
    expect(verifyWebhookSignature(BODY, 'sha256=abc', [SECRET])).toBe(false);
    expect(verifyWebhookSignature(BODY, `sha1=${hex}`, [SECRET])).toBe(false);
  });

  it('시크릿이 하나도 설정되지 않았으면 무조건 거부한다', () => {
    expect(verifyWebhookSignature(BODY, computeSignature(BODY, SECRET), [])).toBe(false);
  });
});

describe('보안 문서 6장: 시크릿 회전 중 무중단 검증', () => {
  it('구·신 두 시크릿 중 어느 쪽으로 서명해도 통과한다', () => {
    const secrets = [OTHER_SECRET, SECRET];
    expect(verifyWebhookSignature(BODY, computeSignature(BODY, SECRET), secrets)).toBe(true);
    expect(verifyWebhookSignature(BODY, computeSignature(BODY, OTHER_SECRET), secrets)).toBe(true);
  });

  it('회전 목록에 없는 시크릿은 여전히 거부한다', () => {
    expect(
      verifyWebhookSignature(BODY, computeSignature(BODY, 'third-secret'), [OTHER_SECRET, SECRET]),
    ).toBe(false);
  });
});

describe('보안 문서 9장: 상수 시간 비교', () => {
  it('일치 접두 길이가 달라도 같은 결과를 낸다', () => {
    const value = 'a'.repeat(71);
    expect(constantTimeEquals(value, value)).toBe(true);
    expect(constantTimeEquals(value, `${value.slice(0, -1)}b`)).toBe(false);
    expect(constantTimeEquals(value, `b${value.slice(1)}`)).toBe(false);
    expect(constantTimeEquals(value, value.slice(0, 10))).toBe(false);
  });

  /**
   * 조기 종료 비교(`===`, `Buffer.compare`)로 되돌아가는 회귀를 잡는 테스트다.
   *
   * **왜 서명 길이가 아니라 64KB로 재는가.** 71자 서명에서는 HMAC 계산이 비교보다
   * 수십 배 비싸서, 비교를 `===`로 바꿔도 전체 시간이 거의 그대로다. 즉 그
   * 길이에서 잰 값은 어떤 구현이든 통과시킨다. 비교 함수만 떼어 내 입력을 키우면
   * 차이가 드러난다 — 이 환경에서 `===`는 4KB에서 18배, 64KB에서 세 자릿수 배로
   * 갈렸고, `timingSafeEqual`은 두 경우 모두 0.9배 언저리였다.
   */
  it('앞에서 틀린 값과 끝에서 틀린 값의 비교 시간이 갈리지 않는다', () => {
    const base = 'a'.repeat(64 * 1024);
    const nearMissCandidate = `${base.slice(0, -1)}b`;
    const farMissCandidate = `b${base.slice(1)}`;
    const rounds = 2_000;

    const measure = (candidate: string): number => {
      const started = process.hrtime.bigint();
      for (let index = 0; index < rounds; index += 1) {
        constantTimeEquals(base, candidate);
      }
      return Number(process.hrtime.bigint() - started);
    };

    measure(nearMissCandidate); // 워밍업
    measure(farMissCandidate);
    const ratio = measure(nearMissCandidate) / measure(farMissCandidate);

    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
