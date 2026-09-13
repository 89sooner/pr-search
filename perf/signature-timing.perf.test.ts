/**
 * 웹훅 서명 비교의 타이밍 진단 (보안 문서 9장·12장, DEV-669).
 *
 * ## 왜 필수 CI가 아니라 여기인가
 *
 * 이 시험은 **시간을 잰다.** 같은 코드라도 러너의 CPU 경합·GC 시점에 따라 값이
 * 흔들린다 — 2026-09-13 main CI(run 34752531241, 단위 시험 143파일이 함께 도는
 * 호스팅 러너)에서 near/far 비율이 0.4617로 하한 0.5에 미달했고, 구현은 그대로
 * `timingSafeEqual`이었다. 상수 시간 성질 자체는 `signature.test.ts`가 원시 함수
 * 위임을 **결정적으로** 검증한다. 여기는 그 위임이 실제 시간에서도 대칭인지
 * 진단하는 자리이며, 릴리스 게이트가 아니다.
 *
 * ## 한계 — 이 수치가 말하는 것과 말하지 않는 것
 *
 * - 비율 구간 (0.5, 2)는 경험값이다. 구간 밖이면 「구현이 깨졌다」가 아니라 「측정
 *   환경이 오염됐거나 구현을 봐야 한다」다. 5회 중앙값을 쓰는 것도 같은 이유다.
 * - 64KB·2,000회는 `===`(이 환경에서 세 자릿수 배)와 `timingSafeEqual`(0.7~1.0배)을
 *   가르기에 충분하지만, 암호학적 상수 시간을 **증명하지 않는다.** 캐시·분기 예측·
 *   할당(`Buffer.from` 두 번)·GC가 전부 측정에 섞인다.
 * - 단독 실행(`fileParallelism: false`)이 전제다. 다른 시험과 병렬로 돌면 흔들린다.
 *
 * 실행: `pnpm run test:perf -- perf/signature-timing`
 */

import { describe, expect, it } from 'vitest';
import { constantTimeEquals } from '../apps/ingest-gateway/src/signature.js';

const BYTES = 64 * 1024;
const ROUNDS = 2_000;
const TRIALS = 5;

function measure(expected: string, candidate: string): number {
  const started = process.hrtime.bigint();
  for (let index = 0; index < ROUNDS; index += 1) {
    constantTimeEquals(expected, candidate);
  }
  return Number(process.hrtime.bigint() - started);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('진단: 앞에서 틀린 값과 끝에서 틀린 값의 비교 시간', () => {
  it('near/far 비율의 5회 중앙값이 (0.5, 2) 안이다 — 조기 종료 비교는 세 자릿수 배로 갈린다', () => {
    const base = 'a'.repeat(BYTES);
    const nearMiss = `${base.slice(0, -1)}b`;
    const farMiss = `b${base.slice(1)}`;

    // 워밍업 — JIT와 첫 할당을 측정에서 뺀다.
    measure(base, nearMiss);
    measure(base, farMiss);

    const ratios: number[] = [];
    for (let trial = 0; trial < TRIALS; trial += 1) {
      ratios.push(measure(base, nearMiss) / measure(base, farMiss));
    }
    const ratio = median(ratios);

    // 값을 남긴다 — 실패했을 때 「얼마나」가 곧 진단이다.
    console.info(JSON.stringify({ diagnostic: 'signature-timing', bytes: BYTES, rounds: ROUNDS, ratios: ratios.map((one) => Number(one.toFixed(3))), median: Number(ratio.toFixed(3)) }));

    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
