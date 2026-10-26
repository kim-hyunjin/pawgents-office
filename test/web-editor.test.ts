// The layout editor's model (web/editor/model.ts) has no DOM: undo, selection and door cycling run here as is.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_OFFICE } from '../shared/layout.ts';
import { EditorModel } from '../web/editor/model.ts';

function model() {
  let changes = 0;
  const m = new EditorModel(() => {
    changes++;
    m.check();
  });
  m.reset(DEFAULT_OFFICE, '사무실');
  return { m, changes: () => changes };
}

test('editor model: a change is one undo step, and undo brings the draft back', () => {
  const { m, changes } = model();
  m.change((d) => {
    d.items = [];
  });
  assert.equal(m.draft.items.length, 0);
  assert.equal(m.undo.length, 1);
  assert.ok(m.errs.length > 0); // no desks
  m.undoOnce();
  assert.deepEqual(m.draft, DEFAULT_OFFICE);
  assert.equal(m.undo.length, 0);
  assert.equal(changes(), 2);
  m.undoOnce(); // nothing left: no change
  assert.equal(changes(), 2);
  assert.notEqual(m.draft, DEFAULT_OFFICE); // edits a copy
});

test('editor model: removing the selection, and undo dropping a selection that no longer exists', () => {
  const { m } = model();
  assert.equal(m.removeSelected(), false);
  m.sel = { kind: 'item', id: 'i1' };
  assert.equal(m.selected()?.kind, 'reception');
  assert.equal(m.removeSelected(), true);
  assert.equal(m.sel, null);
  assert.equal(
    m.draft.items.some((it) => it.id === 'i1'),
    false,
  );
  m.change((d) => {
    d.items.push({ id: 'n1', kind: 'plant', x: 10, y: 9 });
  });
  m.sel = { kind: 'item', id: 'n1' };
  m.undoOnce();
  assert.equal(m.sel, null);
});

test('editor model: a wall tile cycles door → open passage → wall', () => {
  const { m } = model();
  const lounge = () => m.draft.rooms.find((r) => r.id === 'r5')!;
  assert.equal(m.cycleDoor(14, 10), true); // the lounge's top wall
  assert.deepEqual(lounge().doors.at(-1), { x: 14, y: 10 });
  m.cycleDoor(14, 10);
  assert.deepEqual(lounge().doors.at(-1), { x: 14, y: 10, open: true });
  m.cycleDoor(14, 10);
  assert.equal(
    lounge().doors.some((d) => d.x === 14 && d.y === 10),
    false,
  );
  assert.equal(m.cycleDoor(5, 5), false); // inside a room: no wall there
});

test('editor model: nudging moves a room with its furniture', () => {
  const { m } = model();
  m.sel = { kind: 'room', id: 'r1' };
  const table = () => m.draft.items.find((it) => it.id === 't1')!;
  const [x0, tx0] = [m.selected()!.x, table().x];
  m.nudge(1, 0);
  assert.equal(m.selected()!.x, x0 + 1);
  assert.equal(table().x - m.selected()!.x, tx0 - x0);
});
