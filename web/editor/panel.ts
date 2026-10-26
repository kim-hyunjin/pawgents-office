// The layout editor's side panel (#editor): the palette of rooms and furniture, the office's size and front door, the
// selection's fields, problems, undo / reset / save, and sharing a layout (file, clipboard, another office).
import {
  cloneOffice,
  DEFAULT_OFFICE,
  DOOR_SIDES,
  hasWalls,
  ITEM_KINDS,
  isHorizontal,
  isOfficeSize,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  normalize,
  ROOM_TYPES,
} from '../../shared/layout.ts';
import { MAX_NAME_CHARS } from '../../shared/limits.ts';
import type { Editor } from '../editor.ts';
import { fixDoors, fixFrontDoor } from '../layout-edit.ts';
import { app } from '../state.ts';
import { FLOOR } from '../tilemap.ts';
import { $, downloadBlob, esc, setMsg } from '../ui.ts';

const SHARE_TYPE = 'pawgents-office-layout'; // marks an exported layout file

export class EditorPanel {
  ed: Editor;
  el: HTMLElement;
  constructor(ed: Editor) {
    this.ed = ed;
    this.el = $('editor');
    this.buildPalette();
    this.bind();
  }
  get m() {
    return this.ed.model;
  }

  buildPalette() {
    const swatch = (t: string) => {
      const f = FLOOR[t];
      return `<i class="sw" style="background:${f ? f[0] : '#cdb089'}"></i>`;
    };
    $('ed-rooms').innerHTML = Object.entries(ROOM_TYPES)
      .map(
        ([t, v]) =>
          `<button type="button" data-tool="room:${t}">${swatch(t)}${esc(v.label)}</button>`,
      )
      .join('');
    $('ed-door-side').innerHTML = Object.entries(DOOR_SIDES)
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join('');
    $('ed-items').innerHTML = Object.entries(ITEM_KINDS)
      .map(
        ([k, v]) =>
          `<button type="button" data-tool="item:${k}" title="${v.w}×${v.h} 칸${v.wall ? ' · 위쪽 벽' : ''}">${esc(v.label)}</button>`,
      )
      .join('');
  }
  bind() {
    const ed = this.ed,
      m = this.m;
    this.el.addEventListener('click', (ev) => {
      const b = (ev.target as Element).closest<HTMLElement>(
        'button[data-tool]',
      );
      if (b) ed.setTool(b.dataset.tool!);
    });
    const num = (id: string, key: 'w' | 'h' | 'door') =>
      $<HTMLInputElement>(id).addEventListener('change', () => {
        const v = Number($<HTMLInputElement>(id).value);
        this.m.change((d) => {
          if (key === 'door') {
            const side = d.door?.side || 'bottom';
            d.door = isHorizontal(side) ? { side, x: v } : { side, y: v };
          } else {
            d[key] = v;
            fixFrontDoor(d);
          }
        });
      });
    $('ed-door-side').addEventListener('change', () =>
      this.m.change((d) => {
        // same spot along the new wall, as far as it goes
        const side = $<HTMLSelectElement>('ed-door-side').value,
          at = d.door?.x ?? d.door?.y ?? 1;
        d.door = isHorizontal(side) ? { side, x: at } : { side, y: at };
        fixFrontDoor(d);
      }),
    );
    num('ed-w', 'w');
    num('ed-h', 'h');
    num('ed-door', 'door');
    $<HTMLInputElement>('ed-name').maxLength = MAX_NAME_CHARS; // office name, same limit the server checks
    $('ed-name').addEventListener('input', () => {
      m.name = $<HTMLInputElement>('ed-name').value;
      this.sync();
    });
    $('ed-sel').addEventListener('input', (ev) => {
      const s = m.selected();
      if (!s) return;
      const t = ev.target as HTMLInputElement;
      const f = t.dataset.f;
      if (f === 'name') {
        s.name = t.value;
        ed.refresh();
        return;
      } // typing: no undo step per key
      m.change(() => {
        if (f === 'type') {
          s.type = t.value;
          delete s.walls;
          delete s.glass;
          fixDoors(m.draft, s);
        } else if (f === 'walls') {
          if (t.checked === (ROOM_TYPES[s.type].walls ?? true)) delete s.walls;
          else s.walls = t.checked;
          fixDoors(m.draft, s);
        } else if (f === 'glass') {
          if (t.checked === !!ROOM_TYPES[s.type].glass) delete s.glass;
          else s.glass = t.checked;
        }
      });
    });
    $('ed-sel').addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).dataset.f === 'remove')
        ed.removeSelected();
    });
    // walls on/off for every room at once (one undo step); a room that gets walls gets a door if it has none
    const allWalls = (on: boolean) =>
      m.change((d) => {
        for (const r of d.rooms) {
          if (on === (ROOM_TYPES[r.type]?.walls ?? true)) delete r.walls;
          else r.walls = on;
          fixDoors(m.draft, r);
        }
      });
    $('ed-walls-on').addEventListener('click', () => allWalls(true));
    $('ed-walls-off').addEventListener('click', () => allWalls(false));
    $('ed-undo').addEventListener('click', () => m.undoOnce());
    $('ed-reset').addEventListener('click', () => {
      m.change((d) => Object.assign(d, cloneOffice(DEFAULT_OFFICE)));
      m.sel = null;
      this.sync();
    });
    // empty floor to start over: size and front door stay; one undo step brings it all back
    $('ed-clear').addEventListener('click', () => {
      m.change((d) => {
        d.rooms = [];
        d.items = [];
      });
      m.sel = null;
      this.sync();
    });
    $('ed-cancel').addEventListener('click', () => ed.close());
    $('ed-close').addEventListener('click', () => ed.close());
    $('ed-save').addEventListener('click', () => ed.save());
    $('ed-delete').addEventListener('click', () => ed.closeOffice());
    // sharing: file / clipboard out, file / paste / another office in
    $('ed-export').addEventListener('click', () => this.exportFile());
    $('ed-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.shareText());
        this.msg(
          '배치를 복사했어요. 다른 사무실 편집 화면에서 Ctrl+V로 붙여넣으세요.',
          'ok',
        );
      } catch {
        this.msg('클립보드에 쓸 수 없어요. 파일로 내보내기를 써주세요.', 'err');
      }
    });
    $('ed-import').addEventListener('click', () => $('ed-file').click());
    $('ed-file').addEventListener('change', async () => {
      const input = $<HTMLInputElement>('ed-file'),
        f = input.files?.[0];
      input.value = '';
      if (f) this.importText(await f.text(), `${f.name}의`);
    });
    $('ed-from').addEventListener('change', () => {
      const from = $<HTMLSelectElement>('ed-from');
      const o = app.get().offices.find((x) => x.id === from.value);
      from.value = '';
      if (o) this.importLayout(o.layout, `'${o.name}' 사무실의`);
    });
    document.addEventListener('paste', (ev) => {
      if (!ed.isOpen || (ev.target as Element).closest?.('input, textarea'))
        return;
      const text = ev.clipboardData?.getData('text');
      if (text) {
        ev.preventDefault();
        this.importText(text, '붙여넣은');
      }
    });
  }

  /** Fill the panel for an office just opened: title, whether it can be closed, the offices to copy a layout from. */
  open(office: { id: string; name: string }) {
    $('ed-title').textContent = office.name;
    $('ed-delete').hidden = office.id === 'default';
    const others = app.get().offices.filter((o) => o.id !== office.id);
    $('ed-from').innerHTML =
      `<option value="">${others.length ? '사무실 고르기…' : '다른 사무실이 없어요'}</option>` +
      others
        .map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`)
        .join('');
    $<HTMLSelectElement>('ed-from').disabled = !others.length;
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
  /** Shared JSON (or a bare layout) → draft. `from` reads like "붙여넣은" / "x.json의". */
  importText(text: string, from: string) {
    let data: any; // untrusted JSON
    try {
      data = JSON.parse(text);
    } catch {
      this.msg(`${from} 내용이 배치 JSON이 아니에요.`, 'err');
      return;
    }
    const layout = data?.type === SHARE_TYPE ? data.layout : data;
    if (
      !layout ||
      typeof layout !== 'object' ||
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
      for (const k of Object.keys(d)) delete (d as any)[k];
      Object.assign(d, next);
    });
    this.m.sel = null;
    this.msg(
      `${from} 배치를 불러왔어요. 확인하고 저장하세요. (Ctrl+Z: 되돌리기)`,
      'ok',
    );
    this.sync();
  }

  /** Bring every field in line with the draft, the selection, the tool and the problems. */
  sync() {
    const m = this.m,
      ed = this.ed,
      d = m.draft;
    if (!d) return;
    for (const b of this.el.querySelectorAll('button[data-tool]'))
      b.classList.toggle('on', (b as HTMLElement).dataset.tool === ed.tool);
    const setVal = (id: string, v: unknown) => {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = String(v ?? '');
    };
    setVal('ed-name', m.name);
    setVal('ed-w', d.w);
    setVal('ed-h', d.h);
    setVal('ed-door', d.door?.x ?? d.door?.y);
    setVal('ed-door-side', d.door?.side || 'bottom');
    for (const [id, lo, hi] of [
      ['ed-w', MIN_W, MAX_W],
      ['ed-h', MIN_H, MAX_H],
    ] as [string, number, number][]) {
      $<HTMLInputElement>(id).min = String(lo);
      $<HTMLInputElement>(id).max = String(hi);
    }
    const doorIn = $<HTMLInputElement>('ed-door');
    doorIn.min = '1';
    doorIn.max = String(
      ((isHorizontal(d.door?.side || 'bottom') ? d.w : d.h) || MIN_W) - 2,
    );
    // selection
    const s = m.selected(),
      box = $('ed-sel');
    box.hidden = !s;
    if (s && m.sel?.kind === 'room') {
      const t = ROOM_TYPES[s.type] || {};
      const walls = hasWalls(s),
        glass = s.glass ?? !!t.glass;
      const key = `room|${s.id}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = `<h3>선택한 방</h3>
          <label>이름 <input data-f="name" maxlength="${MAX_NAME_CHARS}"></label>
          <label>종류 <select data-f="type">${Object.entries(ROOM_TYPES)
            .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`)
            .join('')}</select></label>
          <div class="checks"><label class="check"><input type="checkbox" data-f="walls"> 벽</label><label class="check"><input type="checkbox" data-f="glass"> 유리벽</label></div>
          <p class="dim doors"></p>
          <button type="button" data-f="remove">방 지우기</button>`;
      }
      const q = <T extends HTMLElement = HTMLInputElement>(f: string) =>
        box.querySelector<T>(`[data-f="${f}"]`)!;
      if (document.activeElement !== q('name')) q('name').value = s.name;
      q<HTMLSelectElement>('type').value = s.type;
      q('walls').checked = walls;
      q('glass').checked = glass;
      q('glass').disabled = !walls;
      box.querySelector('.doors')!.textContent = walls
        ? `문 ${s.doors.filter((x) => !x.open).length}개 · 통로 ${s.doors.filter((x) => x.open).length}개 — 벽 칸을 누르면 문 → 통로 → 벽 순으로 바뀝니다. 모서리를 끌면 크기가 바뀝니다.`
        : '벽 없는 구역입니다. 모서리를 끌면 크기가 바뀝니다.';
    } else if (s) {
      const k = ITEM_KINDS[s.kind];
      box.dataset.key = `item|${s.id}`;
      box.innerHTML = `<h3>선택한 가구</h3><p>${esc(k.label)} <span class="dim">· ${k.w}×${k.h} 칸 · (${s.x}, ${s.y})</span></p><button type="button" data-f="remove">가구 지우기</button>`;
    } else box.dataset.key = '';
    // problems
    $('ed-errs').innerHTML = m.errs
      .map((e) => `<li>${esc(e.msg)}</li>`)
      .join('');
    $('ed-ok').hidden = m.errs.length > 0;
    $<HTMLButtonElement>('ed-save').disabled =
      m.errs.length > 0 || ed.saving || !m.name.trim();
    $<HTMLButtonElement>('ed-undo').disabled = !m.undo.length;
    $('ed-hint').textContent = ed.tool.startsWith('room:')
      ? '사무실 위에서 끌어서 방을 그리세요. (Esc: 취소)'
      : ed.tool.startsWith('item:')
        ? '놓을 곳을 누르세요. 여러 개 놓을 수 있어요. (Esc·우클릭: 그만 놓기)'
        : '가구·방을 끌어서 옮기고, Delete로 지우고, 방향키로 한 칸씩 움직여요. Ctrl+Z: 되돌리기';
  }
  /** The 사무실 닫기 button: armed, it asks to be clicked again. */
  showDelete() {
    const b = $('ed-delete'),
      on = this.ed.deleteArm.is(true);
    b.textContent = on ? '정말 닫기?' : '사무실 닫기';
    b.classList.toggle('armed', on);
  }
  msg(text: string, cls = '') {
    setMsg($('ed-msg'), text, cls);
  }
}
