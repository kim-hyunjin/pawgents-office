// Which top-level folder may import which: the dependency rule, checked on every source file's import lines.
//   shared/       browser-safe, imports only itself (no node:, no shared/node/)
//   shared/node/  shared/ and node:
//   web/          shared/ (browser-safe part) only
//   hooks/, scripts/  shared/ (and each other's own folder)
//   server/       shared/ only besides itself — never web/ or hooks/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const IMPORT =
  /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* sources(rel);
    else if (e.name.endsWith('.ts')) yield rel;
  }
}

/** The folder an import lands in (`shared/node`, `web`, …), or `node` for a built-in module. */
function target(from: string, spec: string) {
  if (spec.startsWith('node:')) return 'node';
  if (!spec.startsWith('.')) return 'package';
  const rel = path
    .relative(root, path.resolve(root, path.dirname(from), spec))
    .split(path.sep)
    .join('/');
  return rel.startsWith('shared/node/') ? 'shared/node' : rel.split('/')[0];
}

const ALLOWED: Record<string, string[]> = {
  shared: ['shared'],
  'shared/node': ['shared', 'shared/node', 'node'],
  web: ['web', 'shared'],
  hooks: ['hooks', 'shared', 'shared/node', 'node'],
  scripts: ['scripts', 'shared', 'shared/node', 'node'],
  server: ['server', 'shared', 'shared/node', 'node'],
};

test('imports follow the dependency rule', () => {
  const bad: string[] = [];
  let seen = 0;
  for (const top of ['shared', 'web', 'hooks', 'scripts', 'server']) {
    for (const file of sources(top)) {
      const layer = file.startsWith('shared/node/') ? 'shared/node' : top;
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      for (const m of src.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2];
        const to = target(file, spec);
        seen++;
        if (to !== 'package' && !ALLOWED[layer].includes(to))
          bad.push(`${file} → ${spec}`);
      }
    }
  }
  assert.ok(seen > 200, `only ${seen} imports found: is the pattern broken?`);
  assert.deepEqual(bad, []);
});
