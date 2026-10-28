// What the layout editor's side panel does to the draft (the canvas does the rest: editor/canvas.ts): the office's
// size and front door, walls for every room, a room's type and walls, starting over, and sharing a layout as JSON
// (file, clipboard, another office).
import { field, isRecord } from '../../shared/json.ts';
import type { Room } from '../../shared/layout.ts';
import {
  cloneOffice,
  DEFAULT_OFFICE,
  isHorizontal,
  isOfficeSize,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  normalize,
  ROOM_TYPES,
} from '../../shared/layout.ts';
import type { Editor } from '../editor.ts';
import { fixDoors, fixFrontDoor } from '../layout-edit.ts';
import { downloadBlob, type Msg } from '../ui.ts';

const SHARE_TYPE = 'pawgents-office-layout'; // marks an exported layout file

/** The edits the panel's controls make to the draft (the canvas makes the rest: editor/canvas.ts). */
export class Edits {
  ed: Editor;
  constructor(ed: Editor) {
    this.ed = ed;
  }
  get m() {
    return this.ed.model;
  }
  msg(text: string, kind: Msg['kind'] = '') {
    this.ed.msg(text, kind);
  }

  // ---- edits ----------------------------------------------------------------------------
  /** A size or front-door field was committed. */
  setNum(key: 'w' | 'h' | 'door', v: number) {
    this.m.change((d) => {
      if (key === 'door') {
        const side = d.door?.side || 'bottom';
        d.door = isHorizontal(side) ? { side, x: v } : { side, y: v };
      } else {
        d[key] = v;
        fixFrontDoor(d);
      }
    });
  }
  setDoorSide(side: string) {
    // same spot along the new wall, as far as it goes
    this.m.change((d) => {
      const at = d.door?.x ?? d.door?.y ?? 1;
      d.door = isHorizontal(side) ? { side, x: at } : { side, y: at };
      fixFrontDoor(d);
    });
  }
  /** Walls on/off for every room at once (one undo step); a room that gets walls gets a door if it has none. */
  allWalls(on: boolean) {
    const m = this.m;
    m.change((d) => {
      for (const r of d.rooms) {
        if (on === (ROOM_TYPES[r.type]?.walls ?? true)) delete r.walls;
        else r.walls = on;
        fixDoors(m.draft, r);
      }
    });
  }
  resetDefault() {
    this.m.change((d) => Object.assign(d, cloneOffice(DEFAULT_OFFICE)));
    this.m.sel = null;
    this.ed.changed();
  }
  /** Empty floor to start over: size and front door stay; one undo step brings it all back. */
  clearAll() {
    this.m.change((d) => {
      d.rooms = [];
      d.items = [];
    });
    this.m.sel = null;
    this.ed.changed();
  }
  /** A room becomes another type: its walls and glass go back to that type's. */
  setRoomType(s: Room, type: string) {
    const m = this.m;
    m.change(() => {
      s.type = type;
      delete s.walls;
      delete s.glass;
      fixDoors(m.draft, s);
    });
  }
  /** Walls or glass on / off for one room; the type's own setting is kept as no override. */
  setRoomFlag(s: Room, f: 'walls' | 'glass', on: boolean) {
    const m = this.m;
    m.change(() => {
      if (f === 'walls') {
        if (on === (ROOM_TYPES[s.type]?.walls ?? true)) delete s.walls;
        else s.walls = on;
        fixDoors(m.draft, s);
      } else if (on === !!ROOM_TYPES[s.type]?.glass) delete s.glass;
      else s.glass = on;
    });
  }

  // ---- sharing --------------------------------------------------------------------------
  /** The draft as a shareable JSON document (also what the file holds). */
  shareText() {
    return JSON.stringify(
      {
        type: SHARE_TYPE,
        v: 1,
        name: this.m.name.trim() || this.ed.office!.name,
        layout: normalize(this.m.draft),
      },
      null,
      2,
    );
  }
  exportFile() {
    const name = (this.m.name.trim() || this.ed.office!.name).replace(
      /[\\/:*?"<>|\s]+/g,
      '-',
    );
    const file = `pawgents-office-${name}.json`;
    downloadBlob(
      new Blob([this.shareText()], { type: 'application/json' }),
      file,
    );
    this.msg(`${file} 로 내보냈어요.`, 'ok');
  }
  async copy() {
    try {
      await navigator.clipboard.writeText(this.shareText());
      this.msg(
        '배치를 복사했어요. 다른 사무실 편집 화면에서 Ctrl+V로 붙여넣으세요.',
        'ok',
      );
    } catch {
      this.msg('클립보드에 쓸 수 없어요. 파일로 내보내기를 써주세요.', 'err');
    }
  }
  /** Shared JSON (or a bare layout) → draft. `from` reads like "붙여넣은" / "x.json의". */
  importText(text: string, from: string) {
    let data: unknown; // untrusted JSON
    try {
      data = JSON.parse(text);
    } catch {
      this.msg(`${from} 내용이 배치 JSON이 아니에요.`, 'err');
      return;
    }
    const layout =
      field(data, 'type') === SHARE_TYPE ? field(data, 'layout') : data;
    if (
      !isRecord(layout) ||
      !Array.isArray(layout.rooms) ||
      !Array.isArray(layout.items)
    ) {
      this.msg(`${from} 내용에 배치가 없어요.`, 'err');
      return;
    }
    this.importLayout(layout, from);
  }
  importLayout(layout: unknown, from: string) {
    const next = normalize(cloneOffice(layout));
    if (!next || !isOfficeSize(next.w, next.h)) {
      this.msg(
        `${from} 배치는 사무실 크기가 ${MIN_W}×${MIN_H} – ${MAX_W}×${MAX_H} 칸을 벗어나요.`,
        'err',
      );
      return;
    }
    this.m.change((d) => {
      for (const k of Object.keys(d)) Reflect.deleteProperty(d, k);
      Object.assign(d, next);
    });
    this.m.sel = null;
    this.msg(
      `${from} 배치를 불러왔어요. 확인하고 저장하세요. (Ctrl+Z: 되돌리기)`,
      'ok',
    );
  }
}
