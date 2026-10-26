// An interactive session's terminal dialog: what the office shows, and how the wait ends (hooks + registry status).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { applyHook } from '../server/reducer.ts';
import { syncWaiting } from '../server/registry.ts';
import type { HookEvent } from '../server/types.ts';

const SID = '11111111-2222-3333-4444-555555555555';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-waiting-'));
  const store = new Store({ stateFile: path.join(dir, 'state.json'), skinsDir: path.join(dir, 'skins') });
  const hook = (ev: HookEvent) => applyHook(store, { session_id: SID, cwd: dir, ...ev });
  return { store, hook, s: () => store.sessions.get(SID)! };
}
const bash = (description: string) => ({ tool_name: 'Bash', tool_input: { command: 'echo hi > x.txt', description } });

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
  assert.equal(syncWaiting(store, s(), { status: 'busy', statusUpdatedAt: at - 500 }, at + 100), false);
  assert.equal(s().state, 'waiting');
  // the dialog opens: its label is picked up
  assert.equal(syncWaiting(store, s(), { status: 'waiting', waitingFor: 'approve Bash', statusUpdatedAt: at + 50 }, at + 3000), true);
  assert.equal(s().asking!.label, 'approve Bash');
  assert.equal(s().asking!.tool, 'Bash');
  assert.equal(syncWaiting(store, s(), { status: 'waiting', waitingFor: 'approve Bash', statusUpdatedAt: at + 50 }, at + 6000), false);
  // denied: the turn is interrupted, the session goes idle without Stop
  assert.equal(syncWaiting(store, s(), { status: 'idle', statusUpdatedAt: at + 7000 }, at + 9000), true);
  assert.equal(s().state, 'idle');
  assert.equal(s().asking, null);
});

test('registry waiting with no hook (a dialog such as /model) still marks the session waiting', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'Stop', last_assistant_message: 'done' });
  assert.equal(syncWaiting(store, s(), { status: 'waiting', waitingFor: 'dialog open', statusUpdatedAt: Date.now() }), true);
  assert.equal(s().state, 'waiting');
  assert.deepEqual([s().asking!.tool, s().asking!.label], [null, 'dialog open']);
  assert.equal(syncWaiting(store, s(), { status: 'idle', statusUpdatedAt: Date.now() + 1000 }), true);
  assert.equal(s().state, 'idle');
});

test('headless sessions keep their parked requests; the registry never touches their wait', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'SessionStart' });
  s().backend = 'headless';
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'waiting');
  assert.equal(syncWaiting(store, s(), { status: 'idle', statusUpdatedAt: Date.now() + 1000 }), false);
  assert.equal(s().state, 'waiting');
});

test('the next prompt or Stop drops a stale dialog; the snapshot carries it', () => {
  const { store, hook, s } = fixture();
  hook({ hook_event_name: 'PermissionRequest', ...bash('write file') });
  assert.equal(store.serializeSession(s()).asking!.tool, 'Bash');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'never mind' });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'thinking');
  hook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.equal(s().asking!.tool, 'AskUserQuestion');
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  assert.equal(s().asking, null);
  assert.equal(s().state, 'idle');
});

// ---- answering the dialog from the office: screens captured from a real Orca terminal (claude 2.1.309) ----
import { parseDialog, pickOption } from '../server/backends/orca.ts';
const DASH = '╌'.repeat(60);
const BASH_SCREEN = [
  '● some earlier answer', '────────────────────────────────────────', ' Bash command', ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  ' Write capture-b to scratchpad file', DASH, ' │ echo capture-b > C:/x/scratchpad/cap-b.txt', DASH,
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to C:\Users\hjkim\AppData\Local\Temp\claude\scratchpad',
  '      from this project', '   3. Yes, and switch to auto mode · auto mode handles these prompts for you', '   4. No', ' Esc to cancel · Tab to amend',
];
const WRITE_SCREEN = [
  ' Create file', ' ..\..\AppData\Local\Temp\scratchpad\cap-w.txt', DASH, '  1 hello', DASH, ' Do you want to create cap-w.txt?', ' ❯ 1. Yes',
  '   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session; Yes, and always allow access to',
  '      C:\Users\hjkim\AppData\Local\Temp\scratchpad for this session (shift+tab)', '   3. No', ' Esc to cancel · Tab to amend',
];
const FETCH_SCREEN = [
  ' Fetch · from the web-fetch agent', ' Claude wants to fetch content from example.com', DASH, ' url: https://example.com/', ' │ prompt: What is the title?', DASH,
  ' Do you want to allow Claude to fetch this content?', ' ❯ 1. Yes', "   2. Yes, and don't ask again for example.com", '   3. No, and tell Claude what to do differently (esc)',
];
const QUESTION_SCREEN = [
  '❯ Use the AskUserQuestion tool', '────────────────────────────────────────', ' ☐ Color', 'Which color do you like?', '❯ 1. Red', '     Choose red', '  2. Blue',
  '     Choose blue', '  3. Type something.', '────────────────────────────────────────', '  4. Chat about this', 'Enter to select · ↑/↓ to navigate · Esc to cancel',
];

test('parseDialog + pickOption: the key is whichever number is the plain Yes / No', () => {
  const bash = parseDialog(BASH_SCREEN);
  assert.equal(bash!.question, 'Do you want to proceed?');
  assert.deepEqual(bash!.options.map((o) => o.n), [1, 2, 3, 4]); // the wrapped label is not an option
  assert.deepEqual([pickOption(bash, true), pickOption(bash, false)], [1, 4]);
  const write = parseDialog(WRITE_SCREEN);
  assert.deepEqual([pickOption(write, true), pickOption(write, false)], [1, 3]); // same dialog, "No" is 3 here
  const fetch = parseDialog(FETCH_SCREEN);
  assert.deepEqual([pickOption(fetch, true), pickOption(fetch, false)], [1, 3]); // "No, and tell Claude what to do differently (esc)"
});

test('parseDialog: no dialog, or one with no plain Yes / No, gives no key', () => {
  assert.equal(parseDialog(['● done', '────', '❯ ', '────', '  ⏸ manual mode on']), null);
  assert.equal(parseDialog([]), null);
  assert.equal(pickOption(parseDialog(QUESTION_SCREEN), true), null); // choices, not a permission dialog
  assert.equal(pickOption(parseDialog(QUESTION_SCREEN), false), null);
  // "Yes, and always …" is never taken for a plain Yes
  assert.equal(pickOption({ question: '', options: [{ n: 1, label: 'Yes, and always allow' }, { n: 2, label: 'No' }] }, true), null);
  // a list that does not start at 1 is something else (scrolled, or a numbered answer in the transcript)
  assert.equal(parseDialog(['text', '  2. Yes', '  3. No']), null);
});
