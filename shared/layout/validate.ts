// validate(): what would break an office, checked in the editor as you go and by the server before saving.
import { MAX_NAME_CHARS } from '../limits.ts';
import { compile } from './compile.ts';
import { bfs } from './grid.ts';
import type { Layout, Pt, Rect, WallError } from './schema.ts';
import {
  DOOR_SIDES,
  hasWalls,
  ITEM_KINDS,
  inRect,
  isHorizontal,
  isOfficeSize,
  itemRect,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  ROOM_TYPES,
  ringRect,
} from './schema.ts';

/**
 * Problems that would break the office, as [{ msg, tiles: [{x,y}] }] (empty = fine). Shapes are checked first;
 * reachability only once the shape is sound. The server runs the same check before saving.
 */
export function validate(office: Layout | null | undefined): WallError[] {
  const errs: WallError[] = [];
  const err = (msg: string, tiles: Pt[] = []) => errs.push({ msg, tiles });
  const int = (n: unknown): n is number => Number.isInteger(n);
  if (!office || typeof office !== 'object')
    return [{ msg: '배치 데이터가 없습니다.', tiles: [] }];
  const { w, h } = office;
  if (!isOfficeSize(w, h))
    return [
      {
        msg: `사무실 크기는 ${MIN_W}×${MIN_H} – ${MAX_W}×${MAX_H} 칸이어야 합니다.`,
        tiles: [],
      },
    ];
  const side = office.door?.side ?? 'bottom',
    along = isHorizontal(side) ? office.door?.x : office.door?.y;
  if (
    !DOOR_SIDES[side] ||
    !int(along) ||
    along < 1 ||
    along > (isHorizontal(side) ? w : h) - 2
  )
    err('정문 위치가 사무실 밖입니다.');
  const rooms = Array.isArray(office.rooms) ? office.rooms : [];
  const items = Array.isArray(office.items) ? office.items : [];
  if (rooms.length > 40 || items.length > 300)
    return [{ msg: '방이나 가구가 너무 많습니다.', tiles: [] }];
  const ids = new Set();
  const cells = (r: Rect) => {
    const t: Pt[] = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) t.push({ x, y });
    return t;
  };
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const both = (a: Rect, b: Rect) =>
    cells(a).filter((c) => inRect(b, c.x, c.y));

  for (const r of rooms) {
    if (typeof r?.id !== 'string' || !r.id || ids.has(r.id)) {
      err('방 id가 잘못되었습니다.');
      continue;
    }
    ids.add(r.id);
    if (!ROOM_TYPES[r.type]) {
      err(`알 수 없는 방 종류: ${r.type}`);
      continue;
    }
    if (typeof r.name !== 'string' || r.name.length > MAX_NAME_CHARS)
      err(`방 이름은 ${MAX_NAME_CHARS}자 이하여야 합니다.`);
    if (
      ![r.x, r.y, r.w, r.h].every(int) ||
      r.w < 2 ||
      r.h < 2 ||
      r.x < 1 ||
      r.y < 1 ||
      r.x + r.w > w - 1 ||
      r.y + r.h > h - 1
    ) {
      err(`${r.name || '방'}이(가) 사무실 밖으로 나갔습니다.`, cells(r));
      continue;
    }
    if (!Array.isArray(r.doors)) {
      err('문 데이터가 잘못되었습니다.');
      continue;
    }
    const g = ringRect(r);
    for (const d of r.doors) {
      const onRing =
        int(d?.x) && int(d?.y) && inRect(g, d.x, d.y) && !inRect(r, d.x, d.y);
      const corner =
        onRing &&
        (d.x === g.x || d.x === g.x + g.w - 1) &&
        (d.y === g.y || d.y === g.y + g.h - 1);
      if (
        !onRing ||
        corner ||
        d.x <= 0 ||
        d.y <= 0 ||
        d.x >= w - 1 ||
        d.y >= h - 1
      )
        err(
          `${r.name}의 문은 방 테두리(모서리 제외, 바깥벽 제외)에 있어야 합니다.`,
          onRing ? [d] : [],
        );
    }
    if (hasWalls(r) && !r.doors.length)
      err(`${r.name}에 문이 없습니다.`, cells(r));
  }
  const good = rooms.filter(
    (r) => ROOM_TYPES[r?.type] && [r.x, r.y, r.w, r.h].every(int),
  );
  for (let i = 0; i < good.length; i++)
    for (let j = i + 1; j < good.length; j++) {
      const a = good[i],
        b = good[j];
      if (overlap(a, b)) {
        err(`${a.name}과(와) ${b.name}이(가) 겹칩니다.`, both(a, b));
        continue;
      }
      // a walled room's ring can't run through another room
      for (const [x, y] of [
        [a, b],
        [b, a],
      ])
        if (hasWalls(x) && overlap(ringRect(x), y))
          err(
            `${x.name}의 벽이 ${y.name}을(를) 지나갑니다.`,
            both(ringRect(x), y),
          );
    }
  if (!good.some((r) => r.type === 'lobby'))
    err('로비가 하나는 있어야 합니다.');

  const count: Record<string, number> = {};
  for (const it of items) {
    if (typeof it?.id !== 'string' || !it.id || ids.has(it.id)) {
      err('가구 id가 잘못되었습니다.');
      continue;
    }
    ids.add(it.id);
    const k = ITEM_KINDS[it.kind];
    if (!k) {
      err(`알 수 없는 가구: ${it.kind}`);
      continue;
    }
    count[it.kind] = (count[it.kind] || 0) + 1;
    if (!int(it.x) || !int(it.y)) {
      err('가구 위치가 잘못되었습니다.');
      continue;
    }
    const r = itemRect(it);
    if (k.wall) {
      if (it.y !== 0 || it.x < 1 || it.x + r.w > w - 1)
        err(
          `${k.label}은(는) 위쪽 벽에만 걸 수 있습니다.`,
          cells({ ...r, y: 0 }),
        );
    } else if (it.x < 1 || it.y < 1 || it.x + r.w > w - 1 || it.y + r.h > h - 1)
      err(
        `${k.label}이(가) 사무실 밖으로 나갔습니다.`,
        cells(r).filter((c) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h),
      );
  }
  for (const [kind, n] of Object.entries(count))
    if (ITEM_KINDS[kind].max && n > ITEM_KINDS[kind].max)
      err(
        `${ITEM_KINDS[kind].label}은(는) ${ITEM_KINDS[kind].max}개까지 둘 수 있습니다.`,
      );
  if (!count.deskPod) err('책상이 하나는 있어야 합니다.');
  if (errs.length) return errs;

  // furniture vs furniture (same layer), and vs walls
  const solid = items.filter((it) => !ITEM_KINDS[it.kind].floor);
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = itemRect(solid[i]),
        b = itemRect(solid[j]);
      if (overlap(a, b))
        err(
          `${ITEM_KINDS[solid[i].kind].label}과(와) ${ITEM_KINDS[solid[j].kind].label}이(가) 겹칩니다.`,
          both(a, b),
        );
    }
  const geo = compile(office);
  const wallAt = new Set(
    geo.wallTiles
      .filter((t) => !geo.isDoor(t.x, t.y))
      .map((t) => `${t.x},${t.y}`),
  );
  for (const it of items) {
    if (ITEM_KINDS[it.kind].wall) {
      if (geo.door.side === 'top' && inRect(itemRect(it), geo.door.x, 0))
        err(`${ITEM_KINDS[it.kind].label}이(가) 정문을 가립니다.`, [geo.door]);
      continue;
    }
    const hit = cells(itemRect(it)).filter(
      (c) => wallAt.has(`${c.x},${c.y}`) || geo.isDoor(c.x, c.y),
    );
    if (hit.length)
      err(`${ITEM_KINDS[it.kind].label}이(가) 벽이나 문 위에 있습니다.`, hit);
  }
  if (geo.isBlocked(geo.spawn.x, geo.spawn.y))
    err('정문 앞이 막혀 있습니다.', [geo.spawn]);
  if (errs.length) return errs;

  // everyone must be able to walk from the front door to every seat and spot
  const prev = bfs(w, h, geo.spawn, (x, y) => !geo.isBlocked(x, y));
  const seen = (i: number) => prev[i] !== undefined && prev[i] !== -1; // off the grid: never
  const reach = (p: Pt) =>
    !geo.isBlocked(p.x, p.y)
      ? seen(p.y * w + p.x)
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => seen((p.y + dy) * w + p.x + dx));
  const cut = (label: string, spots: Pt[]) => {
    const bad = spots.filter((p) => !reach(p));
    if (bad.length) err(`정문에서 갈 수 없는 ${label}이(가) 있습니다.`, bad);
  };
  cut(
    '책상 자리',
    geo.desks.map((d) => d.chair),
  );
  cut(
    '회의실 자리',
    geo.meetings.flatMap((m) => [m.head, ...m.seats]),
  );
  cut('놀이·라운지 자리', [...geo.playSpots, ...geo.loungeSpots]);
  cut('기획·서재 자리', [...geo.planSpots, ...geo.librarySpots]);
  return errs;
}
