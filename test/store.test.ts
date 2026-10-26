// Characterization of the store's persistence and of the reducer's everyday (non-dialog) hook events.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyHook } from '../server/reducer.ts';
import { Store } from '../server/store.ts';
import type { HookEvent } from '../server/types.ts';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-store-'));
  const opts = {
    stateFile: path.join(dir, 'state.json'),
    skinsDir: path.join(dir, 'skins'),
  };
  return { dir, opts, store: new Store(opts) };
}

test('store: offices, cats, together and desks survive a save / load round trip', () => {
  const { dir, opts, store } = tmpStore();
  store.renameOffice('default', '본사');
  store.setCat('opus', 'tabby');
  const s = store.getOrCreateSession('s1', { cwd: dir });
  const desk = s.desk;
  store.setTogether('default');
  store.saveNow();

  const again = new Store(opts);
  again.load();
  assert.equal(again.office('default')!.name, '본사');
  assert.deepEqual(again.cats, { opus: 'tabby' });
  assert.equal(again.together, 'default');
  assert.equal(again.desks.s1?.desk, desk);
  assert.deepEqual(
    again.offices.map((o) => o.id),
    store.offices.map((o) => o.id),
  );
});

test('store: a broken or missing state file loads defaults, bad entries are dropped', () => {
  const { opts } = tmpStore();
  const empty = new Store(opts);
  empty.load();
  assert.deepEqual(
    empty.offices.map((o) => o.id),
    ['default'],
  );

  fs.writeFileSync(
    opts.stateFile,
    JSON.stringify({
      cats: { opus: 'tabby', gpt: 'tabby', haiku: 'skin:0123456789' }, // unknown family, missing skin
      skins: [{ id: '0123456789', name: 'x', cellW: 16, cellH: 16 }], // no png on disk
      offices: [
        { id: 'o1', name: 'A', repos: ['r'], layout: { w: 1 } },
        { id: 'o1', repos: [] },
      ],
      together: 'gone',
      desks: { a: { desk: 1, at: 0 }, b: { desk: 'x' } }, // expired, malformed
    }),
  );
  const store = new Store(opts);
  store.load();
  assert.deepEqual(store.cats, { opus: 'tabby' });
  assert.deepEqual(store.skins, []);
  assert.deepEqual(
    store.offices.map((o) => o.id),
    ['default', 'o1'],
  );
  assert.equal(store.office('o1')!.layout.w > 1, true); // broken layout fell back to the default
  assert.equal(store.together, null);
  assert.deepEqual(store.desks, {});

  fs.writeFileSync(opts.stateFile, '{not json');
  store.load();
  assert.deepEqual(
    store.offices.map((o) => o.id),
    ['default'],
  );
});

test('store: every session change reaches listeners as a serialized snapshot', () => {
  const { dir, store } = tmpStore();
  const seen: [string, any][] = [];
  store.on((type, data) => seen.push([type, data]));
  applyHook(store, {
    session_id: 's1',
    cwd: dir,
    hook_event_name: 'SessionStart',
  });
  const last = seen.filter(([t]) => t === 'session').at(-1)![1];
  assert.equal(last.id, 's1');
  assert.equal(last.state, 'idle');
});

test('reducer: a turn with tools, a subagent, a reply and the end of the session', () => {
  const { dir, store } = tmpStore();
  const sid = 's2';
  const hook = (ev: HookEvent) =>
    applyHook(store, { session_id: sid, cwd: dir, ...ev });
  const s = () => store.sessions.get(sid)!;

  hook({
    hook_event_name: 'SessionStart',
    model: 'claude-opus-5-5',
    source: 'startup',
  });
  assert.deepEqual([s().state, s().model], ['idle', 'claude-opus-5-5']);

  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
  assert.deepEqual(
    [s().state, s().lastPrompt, s().turnTools],
    ['thinking', 'fix it', 0],
  );

  const states: Record<string, string> = {
    Read: 'reading',
    Edit: 'coding',
    Bash: 'terminal',
    WebSearch: 'searching',
    Mystery: 'working',
  };
  for (const [tool, state] of Object.entries(states)) {
    const input = {
      file_path: path.join(dir, 'a.ts'),
      command: 'ls',
      query: 'q',
    };
    hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
    assert.equal(s().state, state, tool);
    assert.equal(s().currentTool?.name, tool);
    hook({
      hook_event_name: 'PostToolUse',
      tool_name: tool,
      tool_input: input,
    });
    assert.equal(s().state, 'thinking');
    assert.equal(s().currentTool, null);
  }
  assert.equal(s().turnTools, 5);
  assert.ok(s().files.has(path.join(dir, 'a.ts')));

  hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'Explore',
      description: 'look',
      prompt: 'find x',
    },
    tool_use_id: 't1',
  });
  assert.equal(s().state, 'delegating');
  hook({
    hook_event_name: 'SubagentStart',
    agent_id: 'ag1',
    agent_type: 'Explore',
  });
  const a = s().subagents.get('ag1')!;
  assert.deepEqual([a.state, a.description], ['thinking', 'look']);
  hook({
    hook_event_name: 'SubagentStop',
    agent_id: 'ag1',
    last_assistant_message: 'found',
  });
  assert.equal(a.ended, true);
  assert.equal(s().state, 'thinking'); // no live subagent left

  hook({
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    error: 'boom',
  });
  assert.equal(s().log.toArray().at(-1)!.text, 'boom');

  hook({ hook_event_name: 'Stop', last_assistant_message: '# Done\nall good' });
  assert.equal(s().state, 'idle');
  assert.equal(s().replyText, '# Done\nall good');

  hook({ hook_event_name: 'PostModelSwitch', from_model: 'a', to_model: 'b' });
  assert.equal(s().model, 'b');
  hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt' });
  assert.equal(s().state, 'idle');

  hook({ hook_event_name: 'SessionEnd', reason: 'logout' });
  assert.deepEqual([s().ended, s().state], [true, 'offduty']);
  assert.equal(applyHook(store, { hook_event_name: 'Stop' }), null); // no session id
});

test('store: offices come from the injected repo resolver, one per repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-store-'));
  const store = new Store({
    stateFile: path.join(dir, 'state.json'),
    skinsDir: path.join(dir, 'skins'),
    repoOf: (cwd) =>
      cwd
        ? { key: `/repos/${path.basename(cwd)}`, name: path.basename(cwd) }
        : { key: 'default', name: '' },
  });
  const a = store.getOrCreateSession('a', { cwd: '/w/alpha' });
  const b = store.getOrCreateSession('b', { cwd: '/w/alpha' });
  const c = store.getOrCreateSession('c', { cwd: '/w/beta' });
  const d = store.getOrCreateSession('d', {});
  assert.equal(a.officeId, b.officeId);
  assert.notEqual(a.officeId, c.officeId);
  assert.equal(d.officeId, 'default');
  assert.deepEqual(
    store.offices.map((o) => [o.name, o.repos]),
    [
      ['사무실', ['default']],
      ['alpha', ['/repos/alpha']],
      ['beta', ['/repos/beta']],
    ],
  );
  assert.deepEqual([a.desk, b.desk, c.desk], [0, 1, 0]);
});

test('store: the loaders take any JSON shape and keep only what passes', () => {
  const { opts } = tmpStore();
  const store = new Store(opts);
  for (const text of [
    '5',
    '"x"',
    '[1,2]',
    'null',
    '{"desks":"ab","cats":7,"offices":{},"skins":"s"}',
  ]) {
    fs.writeFileSync(opts.stateFile, text);
    store.load();
    assert.deepEqual(
      store.offices.map((o) => o.id),
      ['default'],
      text,
    );
    assert.deepEqual(
      [store.desks, store.cats, store.skins, store.together],
      [{}, {}, [], null],
      text,
    );
  }
  const now = Date.now();
  fs.writeFileSync(
    opts.stateFile,
    JSON.stringify({
      // a time saved as numeric text still counts
      desks: { a: { desk: 2, at: String(now) }, b: 'x', c: null, d: { at: 1 } },
      cats: { opus: ['tabby'], sonnet: 'tabby', haiku: 'Tabby' },
      offices: ['x', null, { id: 'o1', repos: ['r', 3, null] }],
      together: 'o1',
    }),
  );
  store.load();
  assert.deepEqual(Object.keys(store.desks), ['a']);
  assert.equal(store.desks.a?.desk, 2);
  assert.deepEqual(store.cats, { sonnet: 'tabby' });
  assert.deepEqual(store.office('o1')!.repos, ['r']);
  assert.equal(store.office('o1')!.name, '사무실');
  assert.equal(store.together, 'o1');
});
