#!/usr/bin/env node
/**
 * Turbopack이 해시 이름으로 외부화한 선택 의존성을 배포 트리에 실체화한다
 * (`DEV-551`).
 *
 * **무엇이 문제인가.** `pg/lib/stream.js`는 Cloudflare Workers 전용 함수 **안에서만**
 * `require('pg-cloudflare')`를 부른다. Node 런타임은 그 함수를 부르지 않는다. 그런데
 * Turbopack은 그 지연 호출을 청크 최상단의 외부 모듈 `await`로 승격시키고, 모듈 이름을
 * `pg-<16자리 해시>` 같은 내부 이름으로 바꾼다. 그 이름은 어떤 패키지 이름도 아니다.
 *
 * `pg-cloudflare`는 `pg`의 **선택 의존성**이라 `pnpm deploy --prod`가 만드는 배포
 * 트리의 최상위 `node_modules`에 오지 않는다. 그래서 `next start`가 그것을 불러오지
 * 못하고 **모든 SSR 요청이 500이 된다**:
 *
 *   Failed to load external module pg-71df57fbe79e18ab:
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg-71df57fbe79e18ab'
 *
 * 개발 트리에서는 재현되지 않는다 — pnpm 저장소에 그 패키지가 있어 해석이 다르게
 * 끝난다. **배포 트리에서만 죽는다.** 사내 반입(2026-09-07)에서 실제로 그렇게 죽었고,
 * 서버에서 손으로 스텁을 만들어 넘겼다. 그 손 조치를 이미지 빌드로 옮긴 것이 이
 * 스크립트다.
 *
 * **왜 설정으로 풀지 않았나.** 셋 다 재빌드로 재 보았고 해시 참조가 그대로 남았다.
 *
 *   - `serverExternalPackages`에 `pg` 추가
 *   - `serverExternalPackages`에 `pg-cloudflare` 추가
 *   - `turbopack.resolveAlias`로 빈 모듈 대체
 *
 * `apps/web`에 `pg-cloudflare`를 직접 의존으로 넣는 것도 재 보았다. 배포 트리에
 * 패키지 자체는 담기지만 Next는 여전히 **해시 이름**으로 찾으므로 500이 그대로였다.
 *
 * **왜 빈 모듈로 충분한가.** `pg-cloudflare`의 `exports`는 `workerd` 조건에서만 실제
 * 구현을 주고 그 밖에서는 `dist/empty.js`를 준다. Node 배포가 받는 값이 원래 빈
 * 객체이므로 이 스텁이 그것과 같다. 심볼릭 링크로는 풀리지 않는다 — Node ESM이
 * `package.json`의 `name`을 확인한다.
 *
 * **이름을 추측하지 않는다.** 해시는 빌드마다 달라질 수 있으므로 `.next`의 파일 추적
 * 기록(`*.nft.json`)에서 실제 이름을 읽는다. 하나도 찾지 못하면 조용히 지나가지 않고
 * 실패한다 — 결함이 고쳐졌든 추적 형식이 바뀌었든, 둘 다 사람이 봐야 한다.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const nextDir = join(root, '.next');
const modulesDir = join(root, 'node_modules');

/** Turbopack이 만드는 외부 모듈 이름. 패키지 이름 뒤에 16자리 16진수가 붙는다. */
const EXTERNAL_NAME = /(?:^|\/)node_modules\/([a-z0-9@._-]+-[0-9a-f]{16})$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.nft.json')) yield path;
  }
}

const names = new Set();
for (const tracePath of walk(nextDir)) {
  let files;
  try {
    files = JSON.parse(readFileSync(tracePath, 'utf8')).files ?? [];
  } catch {
    continue;
  }
  for (const file of files) {
    const match = EXTERNAL_NAME.exec(file);
    if (match) names.add(match[1]);
  }
}

if (names.size === 0) {
  console.error(
    '해시 이름의 외부 모듈을 하나도 찾지 못했다 (DEV-551). ' +
      '결함이 사라졌다면 이 단계를 지우고, 추적 형식이 바뀐 것이라면 이 스크립트를 고친다. ' +
      '조용히 넘기면 다음 배포가 500으로 죽는다.',
  );
  process.exit(1);
}

try {
  statSync(modulesDir);
} catch {
  console.error(`배포 트리에 node_modules가 없다: ${modulesDir}`);
  process.exit(1);
}

for (const name of [...names].sort()) {
  const dir = join(modulesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name, version: '0.0.0', main: 'index.js' }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'index.js'),
    [
      '// Turbopack이 외부화한 선택 의존성의 자리 (DEV-551).',
      '// Node 배포에서 이 값은 원래 빈 객체다 — `pg-cloudflare`의 비 workerd 진입점과 같다.',
      'module.exports = {};',
      '',
    ].join('\n'),
  );
  console.log(`실체화: node_modules/${name}`);
}
