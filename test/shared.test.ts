// Tests for the code shared by server, hooks and browser: DOM-free modules only (limits, sprites' SKIN_ROWS, layout, layout-edit).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { EVENTS } from '../hooks/_common.ts';
import { cloneOffice, DEFAULT_OFFICE, validate } from '../web/layout.ts';
import { fixDoors, moveRoom, roomName } from '../web/layout-edit.ts';
import { isCell, isName, MAX_SKIN_ROWS, skinGridError } from '../web/limits.ts';
import { SKIN_ROWS } from '../web/sprites.ts';

const root = new URL('..', import.meta.url);
const hooks = JSON.parse(
  fs.readFileSync(new URL('hooks/hooks.json', root), 'utf8'),
);

test('hooks.json registers exactly the events hooks/_common.ts installs', () => {
  assert.deepEqual(new Set(Object.keys(hooks.hooks)), new Set(EVENTS));
});

test('skin limits', () => {
  assert.equal(SKIN_ROWS.length, MAX_SKIN_ROWS);
  assert.equal(skinGridError(64, 32, 16, 16), null);
  assert.equal(typeof skinGridError(272, 32, 16, 16), 'string'); // 17 columns
  assert.equal(typeof skinGridError(64, 16, 16, 16), 'string'); // 1 row
  assert.equal(isName(''), false);
  assert.equal(isName('a'.repeat(30)), true);
  assert.equal(isName('a'.repeat(31)), false);
  for (const n of [4, 64]) assert.equal(isCell(n), true);
  for (const n of [3, 65, 4.5]) assert.equal(isCell(n), false);
});

test('config: PAWGENTS_OFFICE_PORT wins over PORT', () => {
  const read = (extra: Record<string, string>) => {
    const env = { ...process.env, ...extra };
    if (!extra.PAWGENTS_OFFICE_PORT) delete env.PAWGENTS_OFFICE_PORT;
    const code =
      "import('./server/config.ts').then(m => console.log(m.PORT, m.BASE_URL))";
    return execFileSync(process.execPath, ['-e', code], {
      env,
      cwd: root,
      encoding: 'utf8',
    }).trim();
  };
  assert.equal(read({ PORT: '18001' }), '18001 http://127.0.0.1:18001');
  assert.equal(
    read({ PORT: '18001', PAWGENTS_OFFICE_PORT: '18002' }),
    '18002 http://127.0.0.1:18002',
  );
});

test('layout: default office validates', () => {
  assert.deepEqual(validate(DEFAULT_OFFICE), []);
});

test('layout-edit: fixDoors, roomName, moveRoom', () => {
  const draft = cloneOffice(DEFAULT_OFFICE),
    room = draft.rooms.find((r) => r.type === 'meeting')!;
  room.doors = [];
  fixDoors(draft, room);
  assert.equal(room.doors.length, 1);

  draft.rooms.push({ ...cloneOffice(room), id: 'x', name: '회의실 A' });
  assert.equal(roomName(draft, 'meeting'), '회의실 B');

  moveRoom(draft, room, -50, -50, []);
  assert.deepEqual([room.x, room.y], [1, 1]);
  moveRoom(draft, room, 999, 999, []);
  assert.deepEqual(
    [room.x, room.y],
    [draft.w - 1 - room.w, draft.h - 1 - room.h],
  );
});
