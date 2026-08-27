/**
 * 버전 인덱스 이름 규칙 (WP-035 / CR-045·046, DEV-309).
 *
 * 여기서 지키는 것은 하나다: **다음 대상 버전이 "아직 쓰이지 않은 번호"여야 한다.**
 * 느슨한 이름 판정이 그 계산을 틀리게 만드는 경로를 전부 건다.
 */

import { describe, expect, it } from 'vitest';

import { concreteIndexName, isEntityAlias, parseIndexVersion } from './versioned-index.js';

describe('버전 인덱스 이름 (WP-035)', () => {
  it('별칭과 버전으로 구체 이름을 만든다', () => {
    expect(concreteIndexName('prs-commits', 1)).toBe('prs-commits-v1');
    expect(concreteIndexName('prs-commits', 12)).toBe('prs-commits-v12');
  });

  it('0과 음수와 소수는 버전이 아니다', () => {
    expect(() => concreteIndexName('prs-commits', 0)).toThrow();
    expect(() => concreteIndexName('prs-commits', -1)).toThrow();
    expect(() => concreteIndexName('prs-commits', 1.5)).toThrow();
  });

  it('정확히 `<별칭>-v<양의 정수>`만 버전으로 읽는다', () => {
    expect(parseIndexVersion('prs-commits', 'prs-commits-v1')).toBe(1);
    expect(parseIndexVersion('prs-commits', 'prs-commits-v27')).toBe(27);
  });

  it('**접두가 같다는 이유로 남의 인덱스를 세지 않는다**', () => {
    /*
     * 느슨하게 판정하면 다음 버전 계산이 틀린다. `prs-commits-shadow-v2`를
     * `prs-commits`의 v2로 세면 실제 v2가 비어 있는데도 v3을 고르거나 그 반대가
     * 된다 — 어느 쪽이든 DEV-309가 막으려는 상태다.
     */
    expect(parseIndexVersion('prs-commits', 'prs-commits-shadow-v2')).toBeNull();
    expect(parseIndexVersion('prs-commits', 'prs-commits-v2-backup')).toBeNull();
    expect(parseIndexVersion('prs-commits', 'other-prs-commits-v2')).toBeNull();
    expect(parseIndexVersion('prs-commits', 'prs-commits')).toBeNull();
    expect(parseIndexVersion('prs-commits', 'prs-commits-v')).toBeNull();
  });

  it('**앞자리 0을 받지 않는다** — `v1`과 `v01`이 같은 버전의 두 이름이 되면 안 된다', () => {
    expect(parseIndexVersion('prs-commits', 'prs-commits-v01')).toBeNull();
    expect(parseIndexVersion('prs-commits', 'prs-commits-v0')).toBeNull();
  });

  it('별칭에 정규식 특수문자가 있어도 이름 그대로 대조한다', () => {
    // 별칭은 지금 넷 다 안전하지만, 이스케이프를 빼면 다음 별칭에서 조용히 깨진다.
    expect(parseIndexVersion('a.b', 'axb-v1')).toBeNull();
    expect(parseIndexVersion('a.b', 'a.b-v1')).toBe(1);
  });

  it('안정 별칭 넷만 별칭이다 — 구체 인덱스는 받지 않는다 (DEV-294)', () => {
    for (const alias of ['prs-pull-requests', 'prs-commits', 'prs-links', 'prs-releases']) {
      expect(isEntityAlias(alias)).toBe(true);
    }
    expect(isEntityAlias('prs-commits-v1')).toBe(false);
    expect(isEntityAlias('prs-commits-v99')).toBe(false);
    expect(isEntityAlias('anything')).toBe(false);
  });
});
