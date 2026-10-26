// The layout editor's overlay on the office canvas: tile grid, problem tiles, room outlines and corner handles, the
// selected / hovered furniture, the front door and where a click would move it, the room being drawn and room names.
// Reads the editor's state (draft, selection, hover, drag, tool) and changes nothing.
import type { Editor } from './editor.ts';
import { TILE, WALL_RISE, ROOM_TYPES, ITEM_KINDS, itemRect, doorFor, doorTiles } from './layout.ts';
import { itemAt, onOuterWall, wallRoomsAt } from './layout-edit.ts';
import { clamp } from './anim.ts';
import { FLOOR } from './tilemap.ts';

/** Drawn after the office itself while the editor is open; `ed` is the Editor. */
export function drawEditorOverlay(ctx: CanvasRenderingContext2D, S: number, ed: Editor) {
  const geo = ed.world.view!.geo, d = ed.draft;
  ctx.save();
  ctx.setTransform(S, 0, 0, S, 0, WALL_RISE * S);
  const px = 1 / S;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 1; x < geo.MAP_W; x++) ctx.fillRect(x * TILE, 0, px, geo.H);
  for (let y = 1; y < geo.MAP_H; y++) ctx.fillRect(0, y * TILE, geo.W, px);
  // problems
  ctx.fillStyle = 'rgba(239,68,68,0.45)';
  for (const e of ed.errs) for (const t of e.tiles) ctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
  // rooms: dashed outline, selected one solid with corner handles
  ctx.lineWidth = 2 * px;
  for (const r of d.rooms) {
    const on = ed.sel?.id === r.id;
    ctx.setLineDash(on ? [] : [4 * px, 3 * px]);
    ctx.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.55)';
    ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    if (on) {
      ctx.fillStyle = '#ffd166';
      for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) ctx.fillRect(x * TILE - 2.5, y * TILE - 2.5, 5, 5);
    }
  }
  ctx.setLineDash([]);
  // selected / hovered furniture
  const it = ed.sel?.kind === 'item' && ed.selected();
  if (it) { const b = itemRect(it); ctx.strokeStyle = '#ffd166'; ctx.strokeRect(b.x * TILE, (ITEM_KINDS[it.kind].wall ? -1 : b.y) * TILE, b.w * TILE, (ITEM_KINDS[it.kind].wall ? 2 : b.h) * TILE); }
  // front door, and where a click on the outer wall would move it
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 * px;
  ctx.strokeRect(geo.door.x * TILE + px, geo.door.y * TILE + px, TILE - 2 * px, TILE - 2 * px);
  const h = ed.hover;
  if (h && (!ed.drag || ed.drag.kind === 'door') && ed.tool === 'select' && onOuterWall(ed.draft, h.tx, h.ty) && !itemAt(ed.draft, h.tx, h.ty)) {
    const g = doorTiles({ ...d, door: doorFor(d, h.tx, h.ty) }).door;
    ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(g.x * TILE, g.y * TILE, TILE, TILE);
  } else if (h && !ed.drag) {
    if (ed.tool.startsWith('item:')) {
      const k = ITEM_KINDS[ed.tool.slice(5)], x = clamp(h.tx - Math.floor((k.w - 1) / 2), 1, d.w - 1 - k.w), y = k.wall ? 0 : clamp(h.ty, 1, d.h - 1 - k.h);
      ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(x * TILE, (k.wall ? -1 : y) * TILE, k.w * TILE, (k.wall ? 2 : k.h) * TILE);
    } else if (ed.tool === 'select') {
      const hi = itemAt(ed.draft, h.tx, h.ty);
      if (hi && hi !== it) { const b = itemRect(hi); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = px; ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE); }
      else if (!hi && (wallRoomsAt(ed.draft, h.tx, h.ty).length || geo.isDoor(h.tx, h.ty))) { ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2 * px; ctx.strokeRect(h.tx * TILE + px, h.ty * TILE + px, TILE - 2 * px, TILE - 2 * px); }
    } else {
      ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(h.tx * TILE, h.ty * TILE, TILE, TILE);
    }
  }
  if (ed.drag?.kind === 'new-room') {
    const g = ed.drag, x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1);
    const a = FLOOR[g.type]?.[0] || '#cdb089';
    ctx.globalAlpha = 0.6; ctx.fillStyle = a; ctx.fillRect(x * TILE, y * TILE, (Math.abs(g.x1 - g.x0) + 1) * TILE, (Math.abs(g.y1 - g.y0) + 1) * TILE); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 * px; ctx.strokeRect(x * TILE, y * TILE, (Math.abs(g.x1 - g.x0) + 1) * TILE, (Math.abs(g.y1 - g.y0) + 1) * TILE);
  }
  // room names, screen space
  ctx.setTransform(1, 0, 0, 1, 0, WALL_RISE * S);
  ctx.font = `11px ${getComputedStyle(document.body).fontFamily}`; ctx.textBaseline = 'top';
  for (const r of d.rooms) {
    const type = ROOM_TYPES[r.type]?.label || r.type;
    const label = r.name.startsWith(type) ? r.name : `${r.name} · ${type}`; // "회의실 A", not "회의실 A · 회의실"
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(20,22,40,0.8)'; ctx.fillRect(r.x * TILE * S + 3, r.y * TILE * S + 3, w, 16);
    ctx.fillStyle = ed.sel?.id === r.id ? '#ffd166' : '#e8eaf2'; ctx.fillText(label, r.x * TILE * S + 7, r.y * TILE * S + 6);
  }
  ctx.restore();
}
