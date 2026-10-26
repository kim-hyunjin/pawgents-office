// An interactive session's terminal dialog: what the office shows, and how the wait ends (hooks + registry status).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyHook } from '../server/reducer.ts';
import { syncWaiting } from '../server/registry.ts';
import { Store } from '../server/store.ts';
import type { HookEvent } from '../server/types.ts';

const SID = '11111111-2222-3333-4444-555555555555';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-waiting-'));
  const store = new Store({
    stateFile: path.join(dir, 'state.json'),
    skinsDir: path.join(dir, 'skins'),
  });
  const hook = (ev: HookEvent) =>
    applyHook(store, { session_id: SID, cwd: dir, ...ev });
  return { store, hook, s: () => store.sessions.get(SID)! };
}
const bash = (description: string) => ({
  tool_name: 'Bash',
  tool_input: { command: 'echo hi > x.txt', description },
});

test('a terminal permission dialog is remembered and survives parallel tool calls', () => {
  const { hook, s } = fixture();
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  hook({ hook_event_name: 'PreToolUse', ...bash('write file') });
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  assert.equal(s().state, 'waiting');
  assert.equal(s().asking!.tool, 'Bash');
  assert.equal(s().asking!.target, 'write file');
  assert.match(s().asking!.detail!, /echo hi/);
  // a sibling call that needs no permission runs meanwhile: the dialog is still up
  hook({ hook_event_name: 'PreToolUse', ...bash('read file') });
  hook({ hook_event_name: 'PostToolUse', ...bash('read file') });
  assert.equal(s().state, 'waiting');
  // allowed in the terminal: the asked call runs
  hook({ hook_event_name: 'PostToolUse', ...bash('write file') });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'thinking');
});

test('a dialog denied in the terminal (no hook) ends when the registry reports a newer status', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'PreToolUse', ...bash('write file') });
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  const at = s().asking!.at;
  // the file still holds the turn's earlier 'busy': not proof the dialog closed
  assert.equal(
    syncWaiting(
      store,
      s(),
      { status: 'busy', statusUpdatedAt: at - 500 },
      at + 100,
    ),
    false,
  );
  assert.equal(s().state, 'waiting');
  // the dialog opens: its label is picked up
  assert.equal(
    syncWaiting(
      store,
      s(),
      {
        status: 'waiting',
        waitingFor: 'approve Bash',
        statusUpdatedAt: at + 50,
      },
      at + 3000,
    ),
    true,
  );
  assert.equal(s().asking!.label, 'approve Bash');
  assert.equal(s().asking!.tool, 'Bash');
  assert.equal(
    syncWaiting(
      store,
      s(),
      {
        status: 'waiting',
        waitingFor: 'approve Bash',
        statusUpdatedAt: at + 50,
      },
      at + 6000,
    ),
    false,
  );
  // denied: the turn is interrupted, the session goes idle without Stop
  assert.equal(
    syncWaiting(
      store,
      s(),
      { status: 'idle', statusUpdatedAt: at + 7000 },
      at + 9000,
    ),
    true,
  );
  assert.equal(s().state, 'idle');
  assert.equal(s().asking, null);
});

test('registry waiting with no hook (a dialog such as /model) still marks the session waiting', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'Stop', last_assistant_message: 'done' });
  assert.equal(
    syncWaiting(store, s(), {
      status: 'waiting',
      waitingFor: 'dialog open',
      statusUpdatedAt: Date.now(),
    }),
    true,
  );
  assert.equal(s().state, 'waiting');
  assert.deepEqual(
    [s().asking!.tool, s().asking!.label],
    [null, 'dialog open'],
  );
  assert.equal(
    syncWaiting(store, s(), {
      status: 'idle',
      statusUpdatedAt: Date.now() + 1000,
    }),
    true,
  );
  assert.equal(s().state, 'idle');
});

test('headless sessions keep their parked requests; the registry never touches their wait', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'SessionStart' });
  s().backend = 'headless';
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'waiting');
  assert.equal(
    syncWaiting(store, s(), {
      status: 'idle',
      statusUpdatedAt: Date.now() + 1000,
    }),
    false,
  );
  assert.equal(s().state, 'waiting');
});

test('the next prompt or Stop drops a stale dialog; the snapshot carries it', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  assert.equal(store.serializeSession(s()).asking!.tool, 'Bash');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'never mind' });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'thinking');
  hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {},
  });
  assert.equal(s().asking!.tool, 'AskUserQuestion');
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'idle');
});
