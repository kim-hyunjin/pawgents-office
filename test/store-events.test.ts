// What the browser hears: the exact sequence of store events (SSE) for everyday changes, so moving the emits
// around (mutators, effects) can't add, drop or reorder one unnoticed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { newOffice } from '../server/domain/office.ts';
import { applyHook } from '../server/reducer.ts';
import { Store } from '../server/store.ts';
import type { SessionSnapshot } from '../server/types.ts';

function recorder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawgents-events-'));
  const store = new Store({
    stateFile: path.join(dir, 'state.json'),
    skinsDir: path.join(dir, 'skins'),
  });
  const seen: string[] = [];
  store.on((type, data) => {
    const s = data as SessionSnapshot;
    seen.push(
      type === 'session'
        ? `session ${s.id} ${s.state} ${s.officeId}/${s.desk}`
        : type === 'remove'
          ? `remove ${(data as { id: string }).id}`
          : type,
    );
  });
  const take = () => seen.splice(0);
  return { dir, store, take };
}

test('events: hooks, office moves and settings, one event per change', () => {
  const { dir, store, take } = recorder();
  const hook = (sid: string, ev: Record<string, unknown>) =>
    applyHook(store, { session_id: sid, cwd: dir, ...ev });

  hook('s1', { hook_event_name: 'SessionStart' });
  hook('s1', { hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  hook('s2', { hook_event_name: 'SessionStart' });
  hook('s2', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: path.join(dir, 'a.ts') },
  });
  assert.deepEqual(take(), [
    'session s1 idle default/0',
    'session s1 thinking default/0',
    'session s2 idle default/1',
    'session s2 reading default/1',
  ]);

  store.offices.push(newOffice('o2', 'B', ['elsewhere']));
  store.setTogether('o2');
  assert.deepEqual(take(), [
    'session s1 thinking o2/0',
    'session s2 reading o2/1',
    'offices',
  ]);
  store.setTogether('o2'); // nobody moves: only the office list goes out
  assert.deepEqual(take(), ['offices']);
  store.deleteOffice('o2');
  assert.deepEqual(take(), [
    'session s1 thinking default/0',
    'session s2 reading default/1',
    'offices',
  ]);
  store.renameOffice('default', 'HQ');
  store.setCat('opus', 'tabby');
  assert.deepEqual(take(), ['offices', 'settings']);

  hook('s2', { hook_event_name: 'SessionEnd', reason: 'bye' });
  assert.deepEqual(take(), ['session s2 offduty default/1']);
  hook('s2', { hook_event_name: 'Stop' }); // a late hook revives it
  assert.deepEqual(take(), ['session s2 idle default/1']);
});

test('events: gc clocks out quiet sessions and removes long-ended ones', () => {
  const { store, take } = recorder();
  const s = store.getOrCreateSession('g1', {});
  take();
  s.lastEventAt = Date.now() - 31 * 60_000; // no pid, silent for 31 min
  store.gc();
  assert.deepEqual(take(), ['session g1 offduty default/0']);
  store.gc();
  assert.deepEqual(take(), []);
  s.endedAt = Date.now() - 6 * 60_000;
  store.gc();
  assert.deepEqual(take(), ['remove g1']);
  assert.equal(store.sessions.has('g1'), false);
  assert.equal(store.desks.g1, undefined);
});
