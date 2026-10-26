// The layout editor's pointer and keyboard input on the office canvas: drawing rooms, dragging rooms / furniture /
// the front door, resizing by corners, cycling doors, keyboard shortcuts. State: the drag in progress and the hover.
import type { Item, Room } from '../../shared/layout.ts';
import { doorFor, ITEM_KINDS, TILE } from '../../shared/layout.ts';
import { clamp } from '../../shared/math.ts';
import type { Editor } from '../editor.ts';
import type { Contained } from '../layout-edit.ts';
import {
  contents,
  fixDoors,
  itemAt,
  moveItem,
  moveRoom,
  onOuterWall,
  roomAt,
  roomName,
  wallRoomsAt,
} from '../layout-edit.ts';

const uid = (p: string) =>
  `${p}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;

export type Tile = { px: number; py: number; tx: number; ty: number };
export type Drag =
  | {
      kind: 'new-room';
      type: string;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | {
      kind: 'resize';
      corner: string;
      r: Room;
      orig: { x: number; y: number; w: number; h: number };
      before: string;
    }
  | { kind: 'item'; it: Item; dx: number; dy: number; before: string }
  | { kind: 'door'; before: string }
  | {
      kind: 'room';
      r: Room;
      x0: number;
      y0: number;
      inside: Contained[];
      before: string;
    };

export class EditorCanvas {
  ed: Editor;
  canvas: HTMLCanvasElement;
  officeXY: (ev: MouseEvent) => [number, number];
  drag: Drag | null = null;
  hover: Tile | null = null; // tile under the pointer
  constructor(
    ed: Editor,
    canvas: HTMLCanvasElement,
    officeXY: (ev: MouseEvent) => [number, number],
  ) {
    this.ed = ed;
    this.canvas = canvas;
    this.officeXY = officeXY;
    this.bind();
  }
  get m() {
    return this.ed.model;
  }

  tileOf(ev: MouseEvent): Tile {
    const [x, y] = this.officeXY(ev);
    return { px: x, py: y, tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
  }
  bind() {
    const c = this.canvas,
      ed = this.ed;
    c.addEventListener('mousedown', (ev) => {
      if (ed.isOpen && ev.button === 0) this.down(this.tileOf(ev));
    });
    c.addEventListener('mousemove', (ev) => {
      if (ed.isOpen) this.move(this.tileOf(ev));
    });
    window.addEventListener('mouseup', () => {
      if (ed.isOpen) this.up();
    });
    c.addEventListener('mouseleave', () => {
      if (ed.isOpen && !this.drag) this.hover = null;
    });
    c.addEventListener('contextmenu', (ev) => {
      if (ed.isOpen) {
        ev.preventDefault();
        ed.setTool('select');
      }
    });
    document.addEventListener(
      'keydown',
      (ev) => {
        if (
          !ed.isOpen ||
          (ev.target as Element).closest?.('input, select, textarea')
        )
          return;
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
          ev.preventDefault();
          this.m.undoOnce();
        } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
          ev.preventDefault();
          ed.removeSelected();
        } else if (ev.key === 'Escape') {
          ev.stopImmediatePropagation();
          if (ed.tool !== 'select') ed.setTool('select');
          else {
            this.m.sel = null;
            ed.panel.sync();
          }
        } else if (ev.key.startsWith('Arrow')) {
          ev.preventDefault();
          this.m.nudge(
            ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[
              ev.key
            ] || 0,
            ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[ev.key] ||
              0,
          );
        }
      },
      true,
    );
  }

  /** Corner handle of the selected room under the pointer (office px). */
  handleAt(px: number, py: number) {
    const r = this.m.sel?.kind === 'room' ? this.m.selected() : null;
    if (!r) return null;
    const near = (a: number, b: number) => Math.abs(a - b) <= 4;
    for (const [c, x, y] of [
      ['nw', r.x, r.y],
      ['ne', r.x + r.w, r.y],
      ['sw', r.x, r.y + r.h],
      ['se', r.x + r.w, r.y + r.h],
    ] as [string, number, number][]) {
      if (near(px, x * TILE) && near(py, y * TILE)) return c;
    }
    return null;
  }

  down({ px, py, tx, ty }: Tile) {
    const m = this.m,
      ed = this.ed,
      tool = ed.tool;
    const before = JSON.stringify(m.draft);
    if (tool.startsWith('room:')) {
      this.drag = {
        kind: 'new-room',
        type: tool.slice(5),
        x0: tx,
        y0: ty,
        x1: tx,
        y1: ty,
      };
      return;
    }
    if (tool.startsWith('item:')) {
      const kind = tool.slice(5),
        k = ITEM_KINDS[kind];
      const it = { id: uid('i'), kind, x: tx, y: ty };
      m.change(() => {
        moveItem(m.draft, it, tx - Math.floor((k.w - 1) / 2), ty);
        m.draft.items.push(it);
      });
      m.sel = { kind: 'item', id: it.id };
      ed.panel.sync();
      return;
    }
    const corner = this.handleAt(px, py);
    if (corner) {
      const r = m.selected()!;
      this.drag = {
        kind: 'resize',
        corner,
        r,
        orig: { x: r.x, y: r.y, w: r.w, h: r.h },
        before,
      };
      return;
    }
    const it = itemAt(m.draft, tx, ty);
    if (it) {
      m.sel = { kind: 'item', id: it.id };
      this.drag = { kind: 'item', it, dx: tx - it.x, dy: ty - it.y, before };
      ed.panel.sync();
      return;
    }
    if (onOuterWall(m.draft, tx, ty)) {
      m.draft.door = doorFor(m.draft, tx, ty);
      this.drag = { kind: 'door', before };
      ed.refresh();
      return;
    }
    if (m.cycleDoor(tx, ty)) return;
    const r = roomAt(m.draft, tx, ty);
    if (r) {
      m.sel = { kind: 'room', id: r.id };
      this.drag = {
        kind: 'room',
        r,
        x0: tx - r.x,
        y0: ty - r.y,
        inside: contents(m.draft, r),
        before,
      };
      ed.panel.sync();
      return;
    }
    m.sel = null;
    ed.panel.sync();
  }
  move(t: Tile) {
    const draft = this.m.draft;
    this.hover = t;
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.cursorAt(t);
      return;
    }
    if (d.kind === 'new-room') {
      d.x1 = t.tx;
      d.y1 = t.ty;
      return;
    }
    if (d.kind === 'door') draft.door = doorFor(draft, t.tx, t.ty);
    else if (d.kind === 'item') moveItem(draft, d.it, t.tx - d.dx, t.ty - d.dy);
    else if (d.kind === 'room')
      moveRoom(draft, d.r, t.tx - d.x0, t.ty - d.y0, d.inside);
    else if (d.kind === 'resize') {
      const o = d.orig,
        { w, h } = draft;
      // the opposite corner stays put; the dragged one snaps to the nearest tile edge
      const ex = clamp(Math.round(t.px / TILE), 1, w - 1),
        ey = clamp(Math.round(t.py / TILE), 1, h - 1);
      let x0 = d.corner.includes('w') ? ex : o.x,
        x1 = d.corner.includes('w') ? o.x + o.w : ex;
      let y0 = d.corner.includes('n') ? ey : o.y,
        y1 = d.corner.includes('n') ? o.y + o.h : ey;
      if (x1 - x0 < 2) {
        if (d.corner.includes('w')) x0 = x1 - 2;
        else x1 = x0 + 2;
      }
      if (y1 - y0 < 2) {
        if (d.corner.includes('n')) y0 = y1 - 2;
        else y1 = y0 + 2;
      }
      Object.assign(d.r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    this.ed.refresh();
  }
  up() {
    const m = this.m,
      d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'new-room') {
      const x = Math.min(d.x0, d.x1),
        y = Math.min(d.y0, d.y1);
      const r: Room = {
        id: uid('r'),
        type: d.type,
        name: roomName(m.draft, d.type),
        x,
        y,
        w: Math.abs(d.x1 - d.x0) + 1,
        h: Math.abs(d.y1 - d.y0) + 1,
        doors: [],
      };
      if (r.w < 2 || r.h < 2) {
        this.ed.panel.msg('방은 2×2 칸 이상으로 끌어서 그려주세요.', 'err');
        return;
      }
      m.change((dr) => {
        fixDoors(m.draft, r);
        dr.rooms.push(r);
      });
      m.sel = { kind: 'room', id: r.id };
      this.ed.setTool('select');
      return;
    }
    if (d.kind === 'resize') fixDoors(m.draft, d.r);
    if (JSON.stringify(m.draft) !== d.before) m.pushUndo(d.before);
    this.ed.refresh();
  }
  cursorAt(t: Tile) {
    const draft = this.m.draft;
    if (this.ed.tool !== 'select') return 'crosshair';
    if (this.handleAt(t.px, t.py)) return 'nwse-resize';
    if (itemAt(draft, t.tx, t.ty)) return 'move';
    if (onOuterWall(draft, t.tx, t.ty))
      return this.ed.world.view.door.x === t.tx &&
        this.ed.world.view.door.y === Math.max(0, t.ty)
        ? 'grab'
        : 'pointer';
    if (
      wallRoomsAt(draft, t.tx, t.ty).length ||
      draft.rooms.some((r) => r.doors.some((d) => d.x === t.tx && d.y === t.ty))
    )
      return 'pointer';
    if (roomAt(draft, t.tx, t.ty)) return 'move';
    return 'default';
  }
}
