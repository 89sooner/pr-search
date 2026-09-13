/**
 * SafeGhOutput 경계 (NFR-010, ADR-018, WP-062 DoD, QA-GH-22·23·25).
 */

import { describe, expect, it } from 'vitest';
import { SafeOutputStream, looksBinary, sanitizeOutput, sanitizeText, stripEscapes } from './safe-output.js';

const ESC = '';
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('QA-GH-22: CSI·OSC·제어 문자가 화면에 닿지 않는다', () => {
  it('CSI 색상·커서 이동을 걷어 낸다', () => {
    expect(sanitizeOutput(enc(`a${ESC}[31mred${ESC}[0m b${ESC}[2J${ESC}[H`), 1024).text).toBe('ared b');
  });

  it('OSC 하이퍼링크·제목 설정을 BEL·ST 종결 모두 걷어 낸다', () => {
    expect(sanitizeOutput(enc(`x${ESC}]8;;https://evil${ESC}\\link${ESC}]8;;${ESC}\\ y${ESC}]0;titlez`), 1024).text).toBe(
      'xlink yz',
    );
  });

  it('C0·C1·DEL은 지우되 탭·개행·CR은 남긴다', () => {
    expect(sanitizeOutput(enc('a\tb\nc\rdef'), 1024).text).toBe('a\tb\nc\rdef');
    expect(sanitizeOutput(enc('abc'), 1024).text).toBe('abc');
  });

  it('잘못된 UTF-8은 대체 문자가 된다', () => {
    const bytes = Uint8Array.from([0x61, 0xff, 0xfe, 0x62]);
    expect(sanitizeOutput(bytes, 1024).text).toBe('a��b');
  });

  it('원시 HTML은 그대로 문자열이다 — 렌더링 여부는 화면 규칙(dangerouslySetInnerHTML 금지)이 정한다', () => {
    expect(sanitizeOutput(enc('<script>alert(1)</script>'), 1024).text).toBe('<script>alert(1)</script>');
  });
});

describe('QA-GH-23: 청크 경계에서 잘린 시퀀스', () => {
  it('OSC가 두 청크에 걸쳐도 조합되지 않는다', () => {
    const stream = new SafeOutputStream({ maxBytes: 1024 });
    const first = stream.push(enc(`x${ESC}]8;;https://ev`));
    const second = stream.push(enc(`il${ESC}\\link`));
    const result = stream.finish();
    expect(first).toBe('x');
    expect(second).toBe('link');
    expect(result.text).toBe('xlink');
  });

  it('CSI가 ESC 한 바이트에서 잘려도 걷어 낸다', () => {
    const stream = new SafeOutputStream({ maxBytes: 1024 });
    stream.push(enc(`a${ESC}`));
    stream.push(enc('[31mb'));
    expect(stream.finish().text).toBe('ab');
  });

  it('UTF-8 다바이트 문자가 청크 경계에서 잘려도 온전하다', () => {
    const bytes = enc('가나다');
    const stream = new SafeOutputStream({ maxBytes: 1024 });
    stream.push(bytes.subarray(0, 4));
    stream.push(bytes.subarray(4));
    expect(stream.finish().text).toBe('가나다');
  });

  it('끝에 미완결 ESC가 남으면 버린다', () => {
    const stream = new SafeOutputStream({ maxBytes: 1024 });
    stream.push(enc(`ok${ESC}]8;;never`));
    expect(stream.finish().text).toBe('ok');
  });
});

describe('FR-GH-006 AC-5 / QA-GH-11: 바이트 상한과 절단 표시', () => {
  it('상한까지만 보관하고 절단을 알린다. 총 바이트는 계속 센다', () => {
    const stream = new SafeOutputStream({ maxBytes: 5 });
    stream.push(enc('abcdefgh'));
    stream.push(enc('ij'));
    const result = stream.finish();
    expect(result).toMatchObject({ text: 'abcde', truncated: true, bytesTotal: 10, bytesKept: 5 });
  });

  it('상한 안이면 절단이 아니다', () => {
    expect(sanitizeOutput(enc('abc'), 3)).toMatchObject({ text: 'abc', truncated: false, bytesTotal: 3 });
  });
});

describe('QA-GH-25: 바이너리 출력은 텍스트로 내지 않는다', () => {
  it('NUL이 있으면 바이너리다', () => {
    const result = sanitizeOutput(Uint8Array.from([0x61, 0x00, 0x62]), 1024);
    expect(result.binary).toBe(true);
    expect(result.text).toBe('');
  });

  it('제어 문자 비율이 높으면 바이너리다', () => {
    const bytes = Uint8Array.from(Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x01 : 0x61)));
    expect(looksBinary(bytes)).toBe(true);
  });

  it('ESC가 많은 텍스트는 바이너리가 아니다 — 무해화 대상이다', () => {
    expect(looksBinary(enc(`${ESC}[31m${ESC}[0m${ESC}[1m`))).toBe(false);
  });
});

describe('문자열 값 무해화 (JSON 필드)', () => {
  it('같은 경계를 지난다', () => {
    expect(sanitizeText(`Fix ${ESC}[31mred${ESC}[0m race`)).toBe('Fix red race');
  });

  it('stripEscapes는 final이 아니면 꼬리를 돌려준다', () => {
    const { clean, carry } = stripEscapes(enc(`ab${ESC}[3`), false);
    expect(new TextDecoder().decode(clean)).toBe('ab');
    expect(carry.length).toBe(3);
  });
});
