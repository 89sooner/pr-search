/**
 * `GHE_INSTALLATIONS` 파싱 (CR-010, DEV-015).
 *
 * 이 표가 곧 "어느 조직이 어느 rate limit을 쓰는가"의 정의다. 잘못된 항목을
 * 조용히 건너뛰면 그 조직의 이벤트만 영문 모르게 실패 대기열로 간다.
 */

import { describe, expect, it } from 'vitest';
import { parseInstallations } from './config.js';

describe('parseInstallations', () => {
  it('쉼표로 나뉜 org:installationId를 읽는다', () => {
    expect(parseInstallations({ GHE_INSTALLATIONS: 'acme:12345,contoso:67890' })).toEqual([
      { org: 'acme', installationId: 12345 },
      { org: 'contoso', installationId: 67890 },
    ]);
  });

  it('공백과 빈 항목을 견딘다', () => {
    expect(parseInstallations({ GHE_INSTALLATIONS: ' acme : 42 , , contoso:7 ' })).toEqual([
      { org: 'acme', installationId: 42 },
      { org: 'contoso', installationId: 7 },
    ]);
  });

  it('설정이 없으면 빈 목록이다 — 기동 거부는 호출 측이 정한다', () => {
    expect(parseInstallations({})).toEqual([]);
    expect(parseInstallations({ GHE_INSTALLATIONS: '  ' })).toEqual([]);
  });

  it('형식이 깨진 항목은 조용히 건너뛰지 않고 던진다', () => {
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: ':42' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:abc' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:0' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:-1' })).toThrow(/형식/);
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:1.5' })).toThrow(/형식/);
  });

  it('같은 조직이 두 번 나오면 던진다 — 어느 설치를 쓸지 조용히 고르지 않는다', () => {
    expect(() => parseInstallations({ GHE_INSTALLATIONS: 'acme:1,ACME:2' })).toThrow(/두 번/);
  });
});
