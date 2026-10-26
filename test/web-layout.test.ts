// Characterization of shared/layout's compiler and validator: what they produce for the default office and a few
// broken variants is pinned by a hash, so restructuring them can't change a tile.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  cloneOffice,
  compile,
  DEFAULT_OFFICE,
  type Layout,
  validate,
} from '../shared/layout.ts';

/** Everything compile() returns that is data, plus what its functions answer over the whole grid. */
function fingerprint(o: Layout) {
  const geo = compile(o);
  const data = Object.fromEntries(
    Object.entries(geo).filter(([, v]) => typeof v !== 'function'),
  );
  const grid: string[] = [];
  for (let y = -1; y <= geo.MAP_H; y++) {
    let row = '';
    for (let x = -1; x <= geo.MAP_W; x++)
      row += geo.isDoor(x, y) ? 'D' : geo.isBlocked(x, y) ? '#' : '.';
    grid.push(row);
  }
  const near = geo.desks.map((_, i) => geo.nearDeskSpots(i));
  const targets = [
    ...geo.desks.map((d) => d.chair),
    ...geo.playSpots,
    ...geo.librarySpots,
    { x: 0, y: 0 },
    { x: geo.MAP_W - 2, y: 1 },
  ];
  const paths = targets.map((t) => geo.findPath(geo.spawn, t));
  return JSON.stringify({ data, grid, near, paths });
}

/** The default office's second room (the open office), which the variants below change. */
function openOffice(l: Layout) {
  const r = l.rooms[1];
  assert.ok(r, 'the default office has a second room');
  return r;
}

function variants(): Layout[] {
  const base = cloneOffice(DEFAULT_OFFICE);
  const noDoor = cloneOffice(DEFAULT_OFFICE);
  openOffice(noDoor).doors = []; // the open office walled shut
  const blocked = cloneOffice(DEFAULT_OFFICE);
  blocked.items.push({ id: 'x1', kind: 'plant', x: 3, y: 17 }); // on the front door's sill
  const onWall = cloneOffice(DEFAULT_OFFICE);
  onWall.items.push({ id: 'x2', kind: 'coffee', x: 7, y: 4 }); // in a wall
  const sealed = cloneOffice(DEFAULT_OFFICE);
  openOffice(sealed).doors = [{ x: 13, y: 8, open: true }];
  sealed.items.push({ id: 'x3', kind: 'bookshelf', x: 10, y: 9 }); // cuts the corridor
  const side = cloneOffice(DEFAULT_OFFICE);
  side.door = { side: 'left', y: 9 };
  const junk = cloneOffice(DEFAULT_OFFICE);
  junk.items.push({ id: 'x4', kind: 'nope', x: 2, y: 2 });
  junk.rooms.push({
    id: 'r9',
    type: 'play',
    name: '놀이터 2',
    x: 30,
    y: 10,
    w: 5,
    h: 5,
    doors: [],
  });
  return [base, noDoor, blocked, onWall, sealed, side, junk];
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('compile: geometry of the default office and variants is unchanged', () => {
  assert.equal(
    hash(variants().map(fingerprint).join('\n')),
    'eaae9cc470f67c0276f82e630534186ba1e9a0526cc802b5768f55bd81a33240',
  );
});

test('validate: problems found in the variants are unchanged', () => {
  assert.equal(
    hash(JSON.stringify(variants().map((o) => validate(o)))),
    'b67a4219d687b9afa4f3010c7ad372e6f97bb2f4d66235545ee98d55fa7012ef',
  );
});
