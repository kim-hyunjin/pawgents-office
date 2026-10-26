// The reducer's effects: which hooks ask for a git status of the worktree (the caller runs it, see app/sessions.ts).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reduceHook } from '../server/reducer.ts';
import { Store } from '../server/store.ts';
import type { HookEvent } from '../server/types.ts';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-reducer-'));
  const store = new Store({
    stateFile: path.join(dir, 'state.json'),
    skinsDir: path.join(dir, 'skins'),
  });
  const effects = (ev: HookEvent) =>
    reduceHook(store, { session_id: 'r1', cwd: dir, ...ev })?.effects;
  return { store, effects };
}

test('reducer: edits, shell commands and the end of a turn ask for a file sync', () => {
  const { effects } = fixture();
  const sync = [{ type: 'syncFiles' }];
  assert.deepEqual(effects({ hook_event_name: 'SessionStart' }), []);
  for (const tool of ['Edit', 'Write', 'Bash'])
    assert.deepEqual(
      effects({ hook_event_name: 'PostToolUse', tool_name: tool }),
      sync,
      tool,
    );
  assert.deepEqual(
    effects({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }),
    sync,
  );
  assert.deepEqual(
    effects({ hook_event_name: 'PostToolUse', tool_name: 'Read' }),
    [],
  );
  assert.deepEqual(effects({ hook_event_name: 'Stop' }), sync);
  assert.deepEqual(
    effects({ hook_event_name: 'Stop', agent_id: 'a1' }), // a subagent's turn: the session's goes on
    [],
  );
});

test('reducer: an event name we have no handler for (even an Object key) is only logged', () => {
  const { store, effects } = fixture();
  for (const name of ['PreCompact', 'constructor', 'toString']) {
    assert.deepEqual(
      effects({ hook_event_name: name, trigger: 'auto' }),
      [],
      name,
    );
    assert.deepEqual(
      [
        store.sessions.get('r1')!.log.last(1)[0].ev,
        store.sessions.get('r1')!.log.last(1)[0].text,
      ],
      [name, 'auto'],
    );
  }
  assert.equal(reduceHook(store, { hook_event_name: 'Stop' }), null); // no session id
});
