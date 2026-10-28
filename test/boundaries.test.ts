// Which top-level folder may import which: the dependency rule, checked on every source file's import lines.
//   shared/       browser-safe, imports only itself (no node:, no shared/node/)
//   shared/node/  shared/ and node:
//   web/          shared/ (browser-safe part), and of packages only those index.html's import map serves
//   hooks/, scripts/  shared/ and their own folder (not each other)
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
    else if (/\.tsx?$/.test(e.name)) yield rel;
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
  if (rel.startsWith('shared/node/')) return 'shared/node';
  const [top = rel] = rel.split('/'); // split always gives one part
  return top;
}

const ALLOWED: Record<string, string[]> = {
  shared: ['shared'],
  'shared/node': ['shared', 'shared/node', 'node'],
  web: ['web', 'shared'],
  hooks: ['hooks', 'shared', 'shared/node', 'node'],
  scripts: ['scripts', 'shared', 'shared/node', 'node'],
  server: ['server', 'shared', 'shared/node', 'node'],
};

/** Packages a folder may import; elsewhere any. web/ gets these from esm.sh through index.html's import map. */
const PACKAGES: Record<string, string[]> = { web: ['preact', 'preact/hooks'] };

test('imports follow the dependency rule', () => {
  const bad: string[] = [];
  let seen = 0;
  for (const top of ['shared', 'web', 'hooks', 'scripts', 'server']) {
    for (const file of sources(top)) {
      const layer = file.startsWith('shared/node/') ? 'shared/node' : top;
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      for (const m of src.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2] ?? ''; // one of the two alternatives matched
        const to = target(file, spec);
        seen++;
        const ok =
          to === 'package'
            ? (PACKAGES[layer]?.includes(spec) ?? true)
            : ALLOWED[layer]?.includes(to);
        if (!ok) bad.push(`${file} → ${spec}`);
      }
    }
  }
  assert.ok(seen > 200, `only ${seen} imports found: is the pattern broken?`);
  assert.deepEqual(bad, []);
});

test("index.html's import map serves web/'s packages at package.json's versions", () => {
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(map?.[1], 'no import map in web/index.html');
  const { imports } = JSON.parse(map[1]) as { imports: Record<string, string> };
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { devDependencies: Record<string, string> };
  assert.deepEqual(
    Object.keys(imports).sort(),
    [...(PACKAGES.web ?? [])].sort(),
  );
  for (const [spec, url] of Object.entries(imports)) {
    const name = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : (spec.split('/')[0] ?? spec);
    const want = pkg.devDependencies[name];
    assert.ok(
      want,
      `${name} is not a devDependency (its types come from there)`,
    );
    assert.ok(
      url.startsWith(`https://esm.sh/${name}@${want}`),
      `${spec}: ${url} is not ${name}@${want}`,
    );
  }
});
