// The browser's page state (web/store.ts, web/state.ts): DOM-free, so the change records and the order subscribers
// hear about them can be checked here.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionSnapshot } from '../shared/api.ts';
import {
  app,
  type Change,
  dropSession,
  here,
  putOfficeId,
  putSession,
  seedSessions,
  setUi,
} from '../web/state.ts';
import { createStore } from '../web/store.ts';

const session = (id: string, officeId = 'a') =>
  ({ id, officeId, name: id }) as unknown as SessionSnapshot;

test('store: update returns the change, subscribers get it in order, unsubscribe stops it', () => {
  const s = createStore<{ n: number }, string>({ n: 0 });
  const heard: string[] = [];
  const off = s.subscribe((c, st) => heard.push(`1:${c}:${st.n}`));
  s.subscribe((c) => heard.push(`2:${c}`));
  assert.equal(
    s.update((st) => {
      st.n++;
      return 'inc';
    }),
    'inc',
  );
  off();
  s.update(() => 'again');
  assert.deepEqual(heard, ['1:inc:1', '2:inc', '2:again']);
});

test('state: session actions say what changed', () => {
  const heard: Change[] = [];
  const off = app.subscribe((c) => heard.push(c));
  const a = session('s1'),
    b = session('s1', 'b');
  putSession(a, true);
  putSession(b);
  dropSession('s1');
  seedSessions([session('s2')]);
  off();
  assert.equal(heard.length, 4);
  const [first, second, gone, seed] = heard;
  assert.ok(first && second && gone && seed);
  assert.ok(first.type === 'session' && first.prev === undefined);
  assert.ok(first.type === 'session' && first.seated);
  assert.ok(second.type === 'session' && second.prev === a && !second.seated);
  assert.ok(gone.type === 'remove' && gone.s === b);
  assert.equal(seed.type, 'seed');
  assert.equal(app.get().sessions.has('s1'), false);
  assert.equal(app.get().sessions.get('s2')?.officeId, 'a');
});

test('state: switching office clears the hover, here() follows it', () => {
  setUi({ hoverKey: 'x', connected: true });
  putOfficeId('a');
  assert.equal(app.get().hoverKey, null);
  assert.equal(app.get().connected, true);
  assert.equal(here(session('s', 'a')), true);
  assert.equal(here(session('s', 'b')), false);
});
