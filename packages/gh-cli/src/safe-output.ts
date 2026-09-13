/**
 * `SafeGhOutput` 경계 (NFR-010, ADR-018, WP-062).
 *
 * gh의 stdout·stderr와 GitHub에서 온 모든 텍스트는 외부 입력이다. 화면·저장·
 * 스트리밍으로 나가는 문자열은 예외 없이 여기를 지난다.
 *
 * | 처리 | 방법 |
 * | --- | --- |
 * | ANSI CSI | `ESC [` … 최종 바이트(0x40~0x7E)까지 제거 |
 * | OSC | `ESC ]` … `BEL` 또는 `ESC \`까지 제거 (제목·클립보드·하이퍼링크 주입 차단) |
 * | 그 밖의 ESC 시퀀스 | `ESC` + 중간 바이트들 + 최종 바이트 제거 |
 * | C0·C1·DEL | `\t`·`\n`·`\r`만 남기고 제거 |
 * | invalid UTF-8 | `TextDecoder`가 U+FFFD로 치환 |
 * | 바이트 상한 | 상한까지만 보관하고 `truncated`를 켠다 |
 * | 바이너리 | NUL이 있거나 제어 문자 비율이 높으면 텍스트를 내지 않는다 |
 * | 청크 경계 | 완결되지 않은 ESC 시퀀스와 UTF-8 조각을 다음 청크까지 들고 간다 |
 *
 * **순수 모듈이다.** `TextDecoder`와 `Uint8Array`만 쓰므로 브라우저에서도 같은
 * 함수가 돈다 — 화면이 서버와 다른 규칙으로 「한 번 더」 정리하는 일이 없다.
 */

import type { GhSafeText } from './types.js';

const ESC = 0x1b;
const BEL = 0x07;

/** 아직 완결되지 않은 ESC 시퀀스의 길이. 완결됐거나 시퀀스가 아니면 `null`. */
function pendingEscapeLength(bytes: Uint8Array, start: number): number | null {
  // start는 ESC 위치다.
  if (start + 1 >= bytes.length) return null;
  const kind = bytes[start + 1] ?? 0;
  if (kind === 0x5b) {
    // CSI: 매개변수 0x30~0x3F, 중간 0x20~0x2F, 최종 0x40~0x7E
    for (let index = start + 2; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0;
      if (byte >= 0x40 && byte <= 0x7e) return index - start + 1;
      if (byte < 0x20 || byte > 0x3f) return index - start; // 깨진 시퀀스 — 여기까지 버린다
    }
    return null;
  }
  if (kind === 0x5d || kind === 0x50 || kind === 0x5e || kind === 0x5f) {
    // OSC / DCS / PM / APC: BEL 또는 ST(ESC \)까지
    for (let index = start + 2; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0;
      if (byte === BEL) return index - start + 1;
      if (byte === ESC) {
        if (index + 1 >= bytes.length) return null;
        if (bytes[index + 1] === 0x5c) return index - start + 2;
        return index - start; // 새 ESC가 시작됐다 — 앞 시퀀스는 여기서 끝난 것으로 본다
      }
    }
    return null;
  }
  // 2바이트 시퀀스(ESC + 0x40~0x5F 등)와 중간 바이트가 있는 시퀀스
  let index = start + 1;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (byte >= 0x20 && byte <= 0x2f) {
      index += 1;
      continue;
    }
    if (byte >= 0x30 && byte <= 0x7e) return index - start + 1;
    return index - start; // 시퀀스가 아니다 — ESC만 버린다
  }
  return null;
}

/**
 * 완결된 시퀀스를 걷어 낸 바이트와, 다음 청크로 넘길 미완결 꼬리를 나눈다.
 *
 * 청크 경계에서 잘린 `ESC ]8;;` 같은 조각을 그대로 내보내면 뒤 청크의 나머지와
 * 합쳐져 화면에서 하이퍼링크가 된다 (THR-024). 꼬리를 들고 가면 그 조합이 생기지
 * 않는다.
 */
export function stripEscapes(bytes: Uint8Array, final: boolean): { readonly clean: Uint8Array; readonly carry: Uint8Array } {
  const out: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (byte === ESC) {
      const length = pendingEscapeLength(bytes, index);
      if (length === null) {
        if (final) return { clean: Uint8Array.from(out), carry: new Uint8Array(0) };
        return { clean: Uint8Array.from(out), carry: bytes.slice(index) };
      }
      index += length;
      continue;
    }
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      index += 1;
      continue;
    }
    if (byte === 0x7f) {
      index += 1;
      continue;
    }
    out.push(byte);
    index += 1;
  }
  return { clean: Uint8Array.from(out), carry: new Uint8Array(0) };
}

/** C1 제어 문자(U+0080~U+009F)는 UTF-8 디코딩 뒤에만 보인다. */
function stripC1(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[-]/g, '');
}

/** NUL이 있거나 제어 문자 비율이 8분의 1을 넘으면 텍스트가 아니다. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const window = bytes.subarray(0, Math.min(bytes.length, 8192));
  let control = 0;
  for (const byte of window) {
    if (byte === 0) return true;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== ESC) control += 1;
  }
  return control * 8 > window.length;
}

export interface SafeOutputOptions {
  /** 보관하는 최대 바이트. 넘치는 만큼은 세기만 하고 버린다. */
  readonly maxBytes: number;
}

/**
 * 스트리밍 무해화기. `push`가 청크를 받아 **지금까지 안전해진 텍스트 조각**을 돌려주고,
 * `finish`가 남은 꼬리를 정리해 전체 요약을 낸다.
 */
export class SafeOutputStream {
  readonly #maxBytes: number;
  readonly #decoder = new TextDecoder('utf-8', { fatal: false });
  readonly #kept: Uint8Array[] = [];
  #carry: Uint8Array = new Uint8Array(0);
  #bytesTotal = 0;
  #bytesKept = 0;
  #truncated = false;
  #binary = false;
  #text = '';
  #finished = false;

  constructor(options: SafeOutputOptions) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new Error('maxBytes는 0 이상의 정수여야 한다');
    this.#maxBytes = options.maxBytes;
  }

  get bytesTotal(): number {
    return this.#bytesTotal;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  /** 청크를 받아 새로 안전해진 텍스트를 돌려준다. 상한을 넘긴 바이트는 세기만 한다. */
  push(chunk: Uint8Array): string {
    if (this.#finished) throw new Error('finish 뒤에는 push할 수 없다');
    this.#bytesTotal += chunk.length;
    const room = this.#maxBytes - this.#bytesKept;
    if (room <= 0) {
      this.#truncated = this.#truncated || chunk.length > 0;
      return '';
    }
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (take.length < chunk.length) this.#truncated = true;
    this.#bytesKept += take.length;
    this.#kept.push(Uint8Array.from(take));

    if (!this.#binary && looksBinary(this.#concat())) this.#binary = true;
    if (this.#binary) return '';

    const merged = new Uint8Array(this.#carry.length + take.length);
    merged.set(this.#carry, 0);
    merged.set(take, this.#carry.length);
    const { clean, carry } = stripEscapes(merged, false);
    this.#carry = carry;
    const piece = stripC1(this.#decoder.decode(clean, { stream: true }));
    this.#text += piece;
    return piece;
  }

  #concat(): Uint8Array {
    const total = this.#kept.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.#kept) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  finish(): GhSafeText {
    if (!this.#finished) {
      this.#finished = true;
      if (!this.#binary) {
        const { clean } = stripEscapes(this.#carry, true);
        this.#text += stripC1(this.#decoder.decode(clean, { stream: false }));
      }
      this.#carry = new Uint8Array(0);
    }
    return {
      text: this.#binary ? '' : this.#text,
      truncated: this.#truncated,
      binary: this.#binary,
      bytesTotal: this.#bytesTotal,
      bytesKept: this.#bytesKept,
    };
  }
}

/** 한 번에 받은 바이트를 무해화한다. 스트림 없이 쓰는 자리용. */
export function sanitizeOutput(bytes: Uint8Array, maxBytes: number): GhSafeText {
  const stream = new SafeOutputStream({ maxBytes });
  stream.push(bytes);
  return stream.finish();
}

/**
 * 이미 문자열인 값(JSON 필드 등)을 무해화한다. ESC 시퀀스·제어 문자·C1을 걷어 낸다.
 *
 * `TextEncoder`로 되돌려 같은 경계를 지나게 한다 — 문자열용 규칙을 따로 두면 두
 * 규칙이 갈린다.
 */
export function sanitizeText(value: string, maxBytes = 65_536): string {
  const bytes = new TextEncoder().encode(value);
  return sanitizeOutput(bytes, maxBytes).text;
}
