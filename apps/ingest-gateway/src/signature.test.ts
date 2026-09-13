/**
 * 웹훅 서명 검증 단위 테스트 (FR-ING-001 AC-1, 보안 문서 9장 "웹훅 서명 —
 * 유효·무효·변조·타이밍").
 *
 * 상수 시간 성질은 **시간을 재지 않고** 검증한다 — 비교 판정이 `timingSafeEqual`에
 * 위임되는지를 호출로 본다. 시간을 재는 진단은 `perf/signature-timing.perf.test.ts`에
 * 있으며 필수 CI가 아니다 (DEV-669: 러너 부하에서 비율이 0.46까지 흔들렸다).
 */

import { createHmac } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeSignature, constantTimeEquals, verifyWebhookSignature } from './signature.js';

/**
 * `timingSafeEqual`을 **감싸서 관찰한다** — 대체하지 않는다. 기본 구현은 실제 함수라
 * 판정 시험은 그대로 실제 비교로 돌고, 상수 시간 절만 호출 사실과 위임 여부를 본다.
 */
const { timingSafeEqualSpy } = vi.hoisted(() => ({
  timingSafeEqualSpy: vi.fn<(left: Uint8Array, right: Uint8Array) => boolean>(),
}));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

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

/**
 * 조기 종료 비교(`===`, `Buffer.compare`)로 되돌아가는 회귀를 **결정적으로** 잡는다.
 *
 * 밖에서 보이는 boolean만으로는 `===`와 `timingSafeEqual`을 가를 수 없다 — 같은 답을
 * 내기 때문이다. 그래서 판정이 원시 함수에 **위임되는지**를 본다: 호출이 있었는지,
 * 무엇을 넘겼는지, 그리고 원시 함수의 답이 곧 결과인지. 시간을 재던 이전 시험은
 * 러너 부하에서 실패했고(DEV-669) 진단용으로 옮겼다.
 */
describe('보안 문서 9장: 상수 시간 비교 — 원시 함수 위임', () => {
  afterEach(() => {
    // 구현은 남기고 호출 기록만 지운다 — `mockReset`은 실제 구현까지 지운다.
    timingSafeEqualSpy.mockClear();
  });

  it('일치 접두 길이가 달라도 같은 결과를 낸다', () => {
    const value = 'a'.repeat(71);
    expect(constantTimeEquals(value, value)).toBe(true);
    expect(constantTimeEquals(value, `${value.slice(0, -1)}b`)).toBe(false);
    expect(constantTimeEquals(value, `b${value.slice(1)}`)).toBe(false);
    expect(constantTimeEquals(value, value.slice(0, 10))).toBe(false);
  });

  it('같은 길이의 판정을 `timingSafeEqual`에 넘긴다 — 조기 종료 비교로 바꾸면 호출이 사라진다', () => {
    const value = 'a'.repeat(71);
    const nearMiss = `${value.slice(0, -1)}b`;

    expect(constantTimeEquals(value, nearMiss)).toBe(false);

    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
    const [left, right] = timingSafeEqualSpy.mock.calls[0]!;
    expect(Buffer.from(left).equals(Buffer.from(value, 'utf8'))).toBe(true);
    expect(Buffer.from(right).equals(Buffer.from(nearMiss, 'utf8'))).toBe(true);
  });

  it('판정은 오직 `timingSafeEqual`의 답이다 — 그 앞뒤에 `===` 지름길이 없다', () => {
    const value = 'a'.repeat(71);

    // 다른 값인데 원시 함수가 참이라 하면 참이어야 한다. 앞에 `===` 지름길이 있으면 거짓이 된다.
    timingSafeEqualSpy.mockImplementationOnce(() => true);
    expect(constantTimeEquals(value, `${value.slice(0, -1)}b`)).toBe(true);

    // 같은 값인데 원시 함수가 거짓이라 하면 거짓이어야 한다. 뒤에 `===` 지름길이 있으면 참이 된다.
    timingSafeEqualSpy.mockImplementationOnce(() => false);
    expect(constantTimeEquals(value, value)).toBe(false);
  });

  it('길이가 다르면 예외 없이 거짓이고, 그래도 같은 길이의 비교를 한 번 치른다', () => {
    const value = 'a'.repeat(71);

    // 길이 검사를 없애면 `timingSafeEqual`이 RangeError를 던진다 — 이 단언이 그 변이를 잡는다.
    expect(constantTimeEquals(value, value.slice(0, 10))).toBe(false);

    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
    const [left, right] = timingSafeEqualSpy.mock.calls[0]!;
    expect(left.length).toBe(right.length);
    expect(Buffer.from(left).equals(Buffer.from(value, 'utf8'))).toBe(true);
  });

  it('시크릿이 여럿이면 하나가 맞아도 끝까지 전부 비교한다 — 몇 번째가 맞았는지 시간에 남기지 않는다', () => {
    const secrets = [SECRET, OTHER_SECRET, 'third-secret'];

    expect(verifyWebhookSignature(BODY, computeSignature(BODY, SECRET), secrets)).toBe(true);

    // 첫 시크릿에서 맞았는데도 셋 다 비교했다. 일치에서 끊는 변이는 1회로 줄어든다.
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(secrets.length);
  });
});
