/**
 * 같은 출처의 경로로 보내는 리다이렉트 (CR-092 / DEV-699).
 *
 * 역방향 프록시 뒤에서는 서버가 자기 외부 이름을 모른다. 그래서 `Location`에 호스트를 싣지 않고, 그 대가로 이
 * 함수가 받는 값이 **다른 출처로 읽힐 수 있는 모양이면 던진다** — 호출부가 걸렀어야 할 값을 조용히 고치면 결함이
 * 가려진다.
 */

import { describe, expect, it } from 'vitest';
import { redirectToPath } from './redirect';

describe('redirectToPath (CR-092 / DEV-699)', () => {
  it('경로를 그대로 Location에 싣는다 — 호스트를 조립하지 않는다', () => {
    const response = redirectToPath('/search?q=abc#top');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/search?q=abc#top');
  });

  it('폼 제출의 결과 화면으로는 303을 쓴다', () => {
    expect(redirectToPath('/auth/signed-out', 303).status).toBe(303);
  });

  it.each([
    ['절대 URL', 'https://evil.example/phish'],
    ['프로토콜 상대 URL', '//evil.example/phish'],
    ['역슬래시 변형', '/\\evil.example'],
    ['상대 경로', 'search'],
    ['빈 값', ''],
    ['헤더를 쪼개는 제어 문자', '/ok\r\nset-cookie: x=1'],
  ])('%s는 다른 출처로 읽히거나 헤더를 깨므로 던진다', (_label, path) => {
    expect(() => redirectToPath(path)).toThrow('같은 출처의 절대 경로가 아니다');
  });
});
