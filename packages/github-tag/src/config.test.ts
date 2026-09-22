/**
 * 태그 전용 App 설정 (WP-100 / FR-SEQ-012 AC-6).
 */

import { describe, expect, it } from 'vitest';
import { hasTagCredentials, resolveTagConfig, resolveTagEnabled, tagConfigFailure } from './config.js';

const KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';

describe('전역 스위치는 기본 꺼짐이다', () => {
  it.each([[undefined], [''], ['false']])('%s → false', (raw) => {
    expect(resolveTagEnabled({ ...(raw === undefined ? {} : { MNUMBER_TAG_ENABLED: raw }) })).toBe(false);
  });

  it('`true`만 켠다', () => {
    expect(resolveTagEnabled({ MNUMBER_TAG_ENABLED: 'true' })).toBe(true);
  });

  it('오타는 조용히 꺼짐으로 접지 않고 던진다', () => {
    expect(() => resolveTagEnabled({ MNUMBER_TAG_ENABLED: 'yes' })).toThrow(/MNUMBER_TAG_ENABLED/);
  });
});

describe('자격은 태그 전용 변수에서만 읽는다', () => {
  it('`GHE_TAG_*`만 읽고 표기·조회 App 변수는 보지 않는다', () => {
    const config = resolveTagConfig({
      GHE_BASE_URL: 'https://ghe.example/',
      GHE_TAG_APP_ID: '99',
      GHE_TAG_PRIVATE_KEY: KEY,
      GHE_TAG_INSTALLATIONS: 'acme:5150',
      GHE_ANNOTATE_APP_ID: '77',
      GHE_APP_ID: '11',
    });
    expect(config.appId).toBe('99');
    expect(config.privateKey).toContain('\nabc\n');
    expect(config.installations).toEqual([{ org: 'acme', installationId: 5150 }]);
    expect(config.apiUrl).toBe('https://ghe.example/api/v3');
    expect(hasTagCredentials(config)).toBe(true);
  });

  it('켜 놓고 자격이 비면 사유를 돌려준다 — 값은 문구에 넣지 않는다', () => {
    const config = resolveTagConfig({ MNUMBER_TAG_ENABLED: 'true' });
    expect(tagConfigFailure(config)).toContain('GHE_TAG_APP_ID');
    expect(tagConfigFailure(config)).toContain('GHE_TAG_PRIVATE_KEY');
    expect(tagConfigFailure(config)).toContain('GHE_TAG_INSTALLATIONS');
  });

  it('꺼져 있으면 자격이 비어도 실패가 아니다', () => {
    expect(tagConfigFailure(resolveTagConfig({}))).toBeNull();
  });

  it('쓰기 간격은 1초 아래로 내릴 수 없다', () => {
    expect(() => resolveTagConfig({ MNUMBER_TAG_WRITE_SPACING_MS: '500' })).toThrow(/MNUMBER_TAG_WRITE_SPACING_MS/);
    expect(resolveTagConfig({ MNUMBER_TAG_WRITE_SPACING_MS: '2500' }).writeSpacingMs).toBe(2500);
  });
});
