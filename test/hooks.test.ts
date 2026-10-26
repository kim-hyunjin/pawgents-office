// hooks/install.ts and hooks/uninstall.ts: the settings edit as pure functions, and the CLI against a temp CLAUDE_CONFIG_DIR.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EVENTS, HOOK_COMMAND, type Settings } from '../hooks/_common.ts';
import { addOurHooks } from '../hooks/install.ts';
import { removeOurHooks } from '../hooks/uninstall.ts';
import { commandGroup } from '../shared/hook-group.ts';

const ours = () => commandGroup(HOOK_COMMAND, { async: true });
const foreign = { hooks: [{ type: 'command', command: 'echo other' }] };

test('commandGroup writes type and command first, then the options', () => {
  assert.equal(
    JSON.stringify(commandGroup('x', { timeout: 5 })),
    '{"hooks":[{"type":"command","command":"x","timeout":5}]}',
  );
  assert.deepEqual(commandGroup('x'), {
    hooks: [{ type: 'command', command: 'x' }],
  });
});

test('addOurHooks adds one async group per event, once', () => {
  const settings: Settings = { model: 'opus' };
  assert.deepEqual(addOurHooks(settings), { added: EVENTS, skipped: [] });
  assert.equal(settings.model, 'opus');
  assert.deepEqual(Object.keys(settings.hooks), EVENTS);
  for (const e of EVENTS) assert.deepEqual(settings.hooks[e], [ours()]);
  const again = structuredClone(settings);
  assert.deepEqual(addOurHooks(again), { added: [], skipped: [] });
  assert.deepEqual(again, settings);
});

test('addOurHooks keeps other hooks and skips what it cannot edit', () => {
  const settings: Settings = {
    hooks: { Stop: [foreign], PreToolUse: [foreign, ours()], SessionEnd: {} },
  };
  const r = addOurHooks(settings);
  assert.deepEqual(r?.skipped, ['SessionEnd']);
  assert.ok(!r?.added.includes('PreToolUse'));
  assert.ok(r?.added.includes('Stop'));
  assert.deepEqual(settings.hooks.Stop, [foreign, ours()]);
  assert.deepEqual(settings.hooks.PreToolUse, [foreign, ours()]);
  assert.deepEqual(settings.hooks.SessionEnd, {});
});

test('addOurHooks refuses a hooks value that is not an object', () => {
  for (const hooks of [[], 'x', 1]) {
    const settings: Settings = { hooks };
    assert.equal(addOurHooks(settings), null);
    assert.deepEqual(settings, { hooks });
  }
});

test('removeOurHooks removes only ours and prunes what is left empty', () => {
  const settings: Settings = {
    model: 'opus',
    hooks: {
      Stop: [foreign, ours()],
      PreToolUse: [ours()],
      Notification: [
        { hooks: [...foreign.hooks, ...ours().hooks] },
        null,
        { matcher: 'x' },
      ],
      Odd: 'not an array',
    },
  };
  assert.equal(removeOurHooks(settings), 3);
  assert.deepEqual(settings, {
    model: 'opus',
    hooks: {
      Stop: [foreign],
      Notification: [{ hooks: foreign.hooks }, null, { matcher: 'x' }],
      Odd: 'not an array',
    },
  });
  const only: Settings = { hooks: { Stop: [ours()] } };
  assert.equal(removeOurHooks(only), 1);
  assert.deepEqual(only, {});
  assert.equal(removeOurHooks({}), 0);
});

// --- the CLI, with settings in a temp dir (never the real ~/.claude) ---

function cli(dir: string, script: string, ...args: string[]) {
  const r = spawnSync(
    process.execPath,
    [path.resolve(import.meta.dirname, '../hooks', script), ...args],
    { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' },
  );
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('install and uninstall round-trip a settings file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-hooks-'));
  const file = path.join(dir, 'settings.json');
  const backups = () =>
    fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.bak-'));
  try {
    let r = cli(dir, 'install.ts', '--dry-run');
    assert.equal(r.code, 0);
    assert.match(r.out, /^\[dry-run\] would add hooks for: SessionStart, /);
    assert.equal(fs.existsSync(file), false);

    r = cli(dir, 'install.ts');
    assert.equal(r.code, 0);
    assert.match(
      r.out,
      new RegExp(
        `^Installed pawgents-office hooks for ${EVENTS.length} events`,
      ),
    );
    assert.doesNotMatch(r.out, /backup:/); // there was no file to back up
    const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(installed.hooks.Stop, [ours()]);

    r = cli(dir, 'install.ts');
    assert.equal(r.code, 0);
    assert.match(r.out, /already installed .* no changes\./);
    assert.equal(backups().length, 0);

    r = cli(dir, 'uninstall.ts');
    assert.equal(r.code, 0);
    assert.match(
      r.out,
      new RegExp(`^Removed ${EVENTS.length} pawgents-office hook entries`),
    );
    assert.match(r.out, /\n {2}backup: /);
    assert.equal(backups().length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{}\n');

    r = cli(dir, 'uninstall.ts');
    assert.equal(r.code, 0);
    assert.match(r.out, /^No pawgents-office hooks found .* nothing to do\./);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('install exits 1 and changes nothing on bad settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-hooks-'));
  const file = path.join(dir, 'settings.json');
  try {
    fs.writeFileSync(file, '{ nope');
    let r = cli(dir, 'install.ts');
    assert.equal(r.code, 1);
    assert.match(r.err, /is not valid JSON/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ nope');

    fs.writeFileSync(file, '{"hooks":[]}');
    r = cli(dir, 'install.ts');
    assert.equal(r.code, 1);
    assert.match(
      r.err,
      /"hooks" in .* is not an object; refusing to touch it\./,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks":[]}');
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
