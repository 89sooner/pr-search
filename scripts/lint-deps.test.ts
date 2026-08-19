import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./lint-deps.mjs', import.meta.url));

describe('lint:deps', () => {
  it('현재 워크스페이스에서 종료 코드 0으로 통과한다', () => {
    const output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(output).toContain('위반 0건');
  });
});
