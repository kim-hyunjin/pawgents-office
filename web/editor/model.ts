// The layout editor's model: the draft being edited, its undo stack, the selection and the draft's problems. No DOM:
// every change ends in onChange(), which the Editor uses to recompile, redraw and sync its panel.
import type { Item, Layout, Room } from '../../shared/layout.ts';
import { cloneOffice, validate } from '../../shared/layout.ts';
import { contents, moveItem, moveRoom, wallRoomsAt } from './layout-edit.ts';

const UNDO_MAX = 100;

export type Sel = { kind: 'room' | 'item'; id: string };

export class EditorModel {
  draft!: Layout; // the office's layout, edited in place
  name = ''; // the office's name as typed
  undo: string[] = []; // earlier drafts, as JSON
  sel: Sel | null = null;
  errs: ReturnType<typeof validate> = [];
  onChange: () => void;
  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  /** Start over on a copy of `layout`. */
  reset(layout: Layout, name: string) {
    this.draft = cloneOffice(layout);
    this.name = name;
    this.undo = [];
    this.sel = null;
  }
  /** Re-check the draft (layout.validate). */
  check() {
    this.errs = validate(this.draft);
  }
  /** Record a draft (JSON) as one undo step. */
  pushUndo(before: string) {
    this.undo.push(before);
    if (this.undo.length > UNDO_MAX) this.undo.shift();
  }
  /** Change the draft as one undo step. */
  change(fn: (d: Layout) => unknown) {
    this.pushUndo(JSON.stringify(this.draft));
    fn(this.draft);
    this.onChange();
  }
  undoOnce() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.draft = JSON.parse(prev);
    if (this.sel && !this.selected()) this.sel = null;
    this.onChange();
  }
  selected(): (Room & Item) | null {
    if (!this.sel) return null;
    const sel = this.sel;
    return ((sel.kind === 'room'
      ? this.draft.rooms
      : (this.draft.items as (Room | Item)[])
    ).find((x) => x.id === sel.id) || null) as (Room & Item) | null;
  }
  /** Delete the selected room or furniture (one undo step); false if nothing was selected. */
  removeSelected() {
    const s = this.selected();
    if (!s) return false;
    const kind = this.sel?.kind;
    this.change((d) => {
      if (kind === 'room') d.rooms = d.rooms.filter((r) => r !== s);
      else d.items = d.items.filter((it) => it !== s);
    });
    this.sel = null;
    return true;
  }
  nudge(dx: number, dy: number) {
    const s = this.selected();
    if (!s) return;
    this.change(() =>
      this.sel?.kind === 'room'
        ? moveRoom(this.draft, s, s.x + dx, s.y + dy, contents(this.draft, s))
        : moveItem(this.draft, s, s.x + dx, s.y + dy),
    );
  }
  /** Cycle a wall tile: wall → door → open passage → wall. A door already there belongs to its room. */
  cycleDoor(tx: number, ty: number) {
    const owner = this.draft.rooms.find((r) =>
      r.doors.some((d) => d.x === tx && d.y === ty),
    );
    const cands = wallRoomsAt(this.draft, tx, ty);
    const room = owner || cands.find((r) => r.id === this.sel?.id) || cands[0];
    if (!room) return false;
    this.change(() => {
      const d = room.doors.find((x) => x.x === tx && x.y === ty);
      if (!d) room.doors.push({ x: tx, y: ty });
      else if (!d.open) d.open = true;
      else room.doors = room.doors.filter((x) => x !== d);
    });
    return true;
  }
}
