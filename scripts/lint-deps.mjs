#!/usr/bin/env node
/**
 * 패키지 의존 방향 검사 (WP-001).
 *
 * 허용 방향은 `domain → 나머지 패키지 → apps` 한 방향뿐이다.
 *
 * 규칙
 *  1. `@prs/domain`은 워크스페이스 내부 의존을 갖지 않는다.
 *  2. `packages/*`는 `@prs/domain`과 다른 `packages/*`만 의존할 수 있다. 앱은 의존할 수 없다.
 *  3. `apps/*`는 어떤 패키지든 의존할 수 있으나 다른 앱은 의존할 수 없다.
 *  4. 워크스페이스 의존 그래프에 순환이 없어야 한다.
 *
 * 위반이 하나라도 있으면 종료 코드 1로 끝난다.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {{ name: string, dir: string, layer: 0 | 1 | 2, deps: string[] }} Pkg */

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** @returns {Pkg[]} */
function loadPackages() {
  /** @type {Pkg[]} */
  const packages = [];

  for (const group of ['packages', 'apps']) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) continue;

    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const manifestPath = join(groupDir, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const deps = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter((dep) =>
        dep.startsWith('@prs/'),
      );

      const layer = group === 'apps' ? 2 : manifest.name === '@prs/domain' ? 0 : 1;
      packages.push({ name: manifest.name, dir: `${group}/${entry.name}`, layer, deps: [...new Set(deps)] });
    }
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Pkg[]} packages
 * @returns {string[]}
 */
function findLayerViolations(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  /** @type {string[]} */
  const violations = [];

  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      const target = byName.get(dep);

      if (!target) {
        violations.push(`${pkg.dir}: '${dep}'는 워크스페이스에 없는 @prs 패키지다`);
        continue;
      }

      if (pkg.layer === 0) {
        violations.push(`${pkg.dir}: @prs/domain은 워크스페이스 의존을 가질 수 없다 (발견: ${dep})`);
        continue;
      }

      if (target.layer > pkg.layer) {
        violations.push(`${pkg.dir}: 역방향 의존 — ${pkg.name}(layer ${pkg.layer}) → ${dep}(layer ${target.layer})`);
        continue;
      }

      if (pkg.layer === 2 && target.layer === 2) {
        violations.push(`${pkg.dir}: 앱은 다른 앱을 의존할 수 없다 (발견: ${dep})`);
      }
    }
  }

  return violations;
}

/**
 * @param {Pkg[]} packages
 * @returns {string[]}
 */
function findCycles(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  /** @type {string[]} */
  const cycles = [];
  /** @type {Map<string, 'visiting' | 'done'>} */
  const state = new Map();

  /**
   * @param {string} name
   * @param {string[]} path
   */
  function visit(name, path) {
    if (state.get(name) === 'done') return;

    if (state.get(name) === 'visiting') {
      cycles.push(`순환 의존: ${[...path.slice(path.indexOf(name)), name].join(' → ')}`);
      return;
    }

    state.set(name, 'visiting');
    for (const dep of byName.get(name)?.deps ?? []) {
      if (byName.has(dep)) visit(dep, [...path, name]);
    }
    state.set(name, 'done');
  }

  for (const pkg of packages) visit(pkg.name, []);

  return [...new Set(cycles)];
}

const packages = loadPackages();

if (packages.length === 0) {
  process.stderr.write('lint:deps: 워크스페이스 패키지를 찾지 못했다\n');
  process.exit(1);
}

const violations = [...findLayerViolations(packages), ...findCycles(packages)];

if (violations.length > 0) {
  process.stderr.write('lint:deps 실패 — 허용 방향은 domain → packages → apps 한 방향뿐이다\n\n');
  for (const violation of violations) process.stderr.write(`  ✗ ${violation}\n`);
  process.stderr.write(`\n위반 ${String(violations.length)}건\n`);
  process.exit(1);
}

process.stdout.write(`lint:deps 통과 — 패키지 ${String(packages.length)}개, 위반 0건\n`);
