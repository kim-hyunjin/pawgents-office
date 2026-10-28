// Layout editor ("배치 편집"): edits a draft of the current office's layout on the canvas, with a side panel for
// the palette, the selection and the office's size. Rooms are dragged out as rectangles (walls follow), moved by
// their inside, resized by their corners; clicking a wall tile cycles door → open passage → wall. Clicking an outer
// wall moves the front door there (or drag the door along the walls). Furniture is placed from the palette and
// dragged around. Every change is validated (layout.ts) and problem tiles turn red; saving sends the draft to the
// server, which pushes it to every open office.
// The parts: editor/model.ts (draft, undo, selection), editor/canvas.ts (pointer and keys), editor/panel.tsx (side
// panel, drawn by app.tsx while editing; it follows `changes`); the canvas overlay is editor-draw.ts. This class ties
// them to the office on screen.
import type { Office } from '../shared/api.ts';
import { compile, isOfficeSize } from '../shared/layout.ts';
import { closeOffice, renameOffice, saveLayout } from './api.ts';
import { EditorCanvas } from './editor/canvas.ts';
import { EditorModel } from './editor/model.ts';
import { setUi } from './state.ts';
import { createStore } from './store.ts';
import { armConfirm, type Msg, NO_MSG } from './ui.ts';
import type { World } from './world.ts';
import { showDraft, startEditing, stopEditing } from './world.ts';

export class Editor {
  world: World;
  onResize: () => void;
  office: Office | null = null; // the office being edited (server copy)
  tool = 'select'; // 'select' | 'room:<type>' | 'item:<kind>'
  /** Says when the draft, the selection, the tool, the message or the 사무실 닫기 arm changed (the side panel redraws). */
  readonly changes = createStore<object, void>({});
  deleteArm = armConfirm<true>(4000, () => this.changed()); // 사무실 닫기 asks twice
  message: Msg = NO_MSG;
  shown = false;
  saving = false;
  model: EditorModel;
  input: EditorCanvas;
  /** onResize(): the canvas size or the space beside it changed. */
  constructor({
    world,
    canvas,
    officeXY,
    onResize,
  }: {
    world: World;
    canvas: HTMLCanvasElement;
    officeXY: (ev: MouseEvent) => [number, number];
    onResize: () => void;
  }) {
    this.world = world;
    this.onResize = onResize;
    this.model = new EditorModel(() => this.refresh());
    this.input = new EditorCanvas(this, canvas, officeXY);
  }
  get isOpen() {
    return !!this.office;
  }
  // what the overlay (editor-draw.ts) reads
  get draft() {
    return this.model.draft;
  }
  get errs() {
    return this.model.errs;
  }
  get sel() {
    return this.model.sel;
  }
  selected() {
    return this.model.selected();
  }
  get drag() {
    return this.input.drag;
  }
  get hover() {
    return this.input.hover;
  }

  open(office: Office) {
    this.office = office;
    this.model.reset(office.layout, office.name);
    this.tool = 'select';
    this.input.drag = null;
    this.deleteArm.disarm();
    this.message = NO_MSG;
    this.shown = false;
    setUi({ editing: true });
    startEditing();
    this.refresh();
  }
  close() {
    if (!this.office) return;
    this.office = null;
    setUi({ editing: false });
    stopEditing();
    this.input.canvas.style.cursor = 'default';
    this.onResize();
  }

  changed() {
    this.changes.update(() => {});
  }
  /** Show a message in the side panel. */
  msg(text: string, kind: Msg['kind'] = '') {
    this.message = { text, kind };
    this.changed();
  }

  /** Recompile + redraw the draft, re-validate, update the panel. */
  refresh() {
    const d = this.model.draft;
    this.model.check();
    if (isOfficeSize(d.w, d.h)) {
      const prev = this.world.view;
      const geo = compile(d);
      showDraft(geo);
      if (!prev || prev.W !== geo.W || prev.H !== geo.H || !this.shown) {
        this.shown = true;
        this.onResize();
      }
    }
    this.changed();
  }
  setTool(t: string) {
    this.tool = this.tool === t && t !== 'select' ? 'select' : t; // clicking the active tool again drops it
    if (this.tool !== 'select') this.model.sel = null;
    this.changed();
  }
  removeSelected() {
    if (this.model.removeSelected()) this.changed();
  }

  async save() {
    if (this.model.errs.length || this.saving) return;
    this.saving = true;
    this.msg('저장 중…');
    const office = this.office!;
    try {
      const name = this.model.name.trim();
      if (name !== office.name) await renameOffice(office.id, name);
      await saveLayout(office.id, this.model.draft);
      this.saving = false;
      this.close(); // the server pushes the new layout to every open office
    } catch (e) {
      this.saving = false;
      this.msg(`저장 실패: ${(e as Error).message}`, 'err');
    }
  }
  /** Two clicks: close this office; its repos and staff move to the default office. */
  async closeOffice() {
    if (!this.deleteArm.click(true)) return; // stays armed: a failed close can be retried at once
    try {
      await closeOffice(this.office!.id);
      this.close();
    } catch (e) {
      this.msg(`닫기 실패: ${(e as Error).message}`, 'err');
    }
  }
}
