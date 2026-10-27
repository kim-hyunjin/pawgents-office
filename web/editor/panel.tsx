// The layout editor's side panel (#editor): the palette of rooms and furniture, the office's size and front door, the
// selection's fields, problems, undo / reset / save, and sharing a layout (file, clipboard, another office).
// <EditorPanel> (in app.tsx while editing) draws it from the Editor, redrawn whenever the Editor says it changed;
// Edits holds what its controls do to the draft.

import type { ComponentChildren, RefObject } from 'preact';
import { h } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Office } from '../../shared/api.ts';
import { field, isRecord } from '../../shared/json.ts';
import type { Item, Room } from '../../shared/layout.ts';
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
import type { Editor, Msg } from '../editor.ts';
import { fixDoors, fixFrontDoor } from '../layout-edit.ts';
import { useApp } from '../state.ts';
import { useStore } from '../store.ts';
import { css } from '../style.ts';
import { FLOOR } from '../tilemap.ts';
import { downloadBlob } from '../ui.ts';

css(/* css */ `
#editor {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(var(--panel-w), 100vw); z-index: 11;
  background: var(--panel); border-left: 1px solid #2f3352; box-shadow: -10px 0 40px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; font-size: 13px;
  & header { display: flex; align-items: center; padding: 12px 10px 10px 16px; border-bottom: 1px solid #2f3352; }
  & h2 { flex: 1; margin: 0; font-size: 16px; }
  & h2 .dim { font-size: 13px; font-weight: 400; color: var(--dim); }
  & .close { width: 28px; height: 28px; border: 0; border-radius: 6px; background: var(--panel-2); color: var(--text); font-size: 18px; cursor: pointer; }
  & .scroll { flex: 1; overflow-y: auto; padding: 4px 16px 12px; }
  & section { margin-top: 10px; }
  & h3 { margin: 0 0 6px; font-size: 13px; }
  & h3 .dim, & .dim { color: var(--dim); font-weight: 400; }
  & label { display: grid; gap: 3px; font-size: 12px; color: var(--dim); margin-bottom: 6px; }
  & input:not([type=checkbox]), & select {
    font: inherit; font-size: 13px; padding: 5px 7px; border-radius: 6px; border: 1px solid #3b3f5c; background: var(--panel-2); color: var(--text); min-width: 0;
  }
  & input:focus, & select:focus { outline: none; border-color: var(--accent); }
  & .nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  & .checks { display: flex; gap: 14px; }
  & label.check { display: flex; align-items: center; gap: 5px; color: var(--text); }
  & label.from { margin-top: 8px; }
  & .palette { display: flex; flex-wrap: wrap; gap: 4px; }
  & .palette.walls { margin-top: 6px; }
  & .palette button, & .sel button, & footer button:not(.primary) {
    font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 6px; border: 1px solid #3b3f5c; cursor: pointer; background: var(--panel-2); color: var(--text);
    display: inline-flex; align-items: center; gap: 5px;
  }
  & .palette button:hover { border-color: #5a5f8c; }
  & .palette button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent); }
  & .sw { width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.3); }
  & .sel { padding: 10px; border-radius: 8px; background: var(--panel-2); }
  & .sel p { margin: 4px 0 8px; font-size: 12px; line-height: 1.5; }
  & .sel button { background: var(--panel); }
  & .hint { margin: 0 0 6px; font-size: 12px; line-height: 1.5; }
  & .ok { margin: 0; font-size: 12px; color: #4ade80; }
  & .errs { margin: 0; padding-left: 16px; color: #f87171; font-size: 12px; line-height: 1.6; }
  & footer { padding: 10px 16px 12px; border-top: 1px solid #2f3352; }
  & footer .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  & footer .grow { flex: 1; }
  & footer .msg { margin-bottom: 6px; }
  & footer button.delete.armed { border-color: #f87171; color: #f87171; }
}
`);

const SHARE_TYPE = 'pawgents-office-layout'; // marks an exported layout file

/** The edits the panel's controls make to the draft (the canvas makes the rest: editor/canvas.ts). */
class Edits {
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

// ---- view -------------------------------------------------------------------------------

/** The side panel of editor `ed`, which is open: drawn again whenever the editor says something changed. */
export function EditorPanel({ ed }: { ed: Editor }) {
  useStore(ed.changes);
  const { offices } = useApp();
  const edits = useMemo(() => new Edits(ed), [ed]);
  // a layout copied from another office's editor (or anywhere) pastes in, unless a field takes the text
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      if ((ev.target as Element).closest?.('input, textarea')) return;
      const text = ev.clipboardData?.getData('text');
      if (text) {
        ev.preventDefault();
        edits.importText(text, '붙여넣은');
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [edits]);
  if (!ed.office || !ed.model.draft) return null;
  // offices to copy a layout from
  const others = offices.filter((o) => o.id !== ed.office?.id);
  return <EditorView panel={edits} others={others} />;
}

/** A field's value, except while it has focus: what is being typed isn't overwritten by a redraw. */
const unlessFocused = (ref: RefObject<HTMLElement | null>, v: unknown) =>
  ref.current && document.activeElement === ref.current
    ? undefined
    : String(v ?? '');

function EditorView({ panel, others }: { panel: Edits; others: Office[] }) {
  const ed = panel.ed,
    m = panel.m,
    d = m.draft,
    office = ed.office!;
  const nameRef = useRef<HTMLInputElement>(null),
    wRef = useRef<HTMLInputElement>(null),
    hRef = useRef<HTMLInputElement>(null),
    doorRef = useRef<HTMLInputElement>(null),
    sideRef = useRef<HTMLSelectElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const side = d.door?.side || 'bottom';
  const tool = (
    t: string,
    label: string,
    extra?: ComponentChildren,
    title?: string,
  ) => (
    <button
      key={t}
      type="button"
      class={ed.tool === t ? 'on' : ''}
      title={title}
      onClick={() => ed.setTool(t)}
    >
      {extra}
      {label}
    </button>
  );
  const armed = ed.deleteArm.is(true);
  return (
    <aside id="editor">
      <header>
        <h2>
          배치 편집 <span class="dim">{office.name}</span>
        </h2>
        <button
          type="button"
          class="close"
          title="취소"
          onClick={() => ed.close()}
        >
          ×
        </button>
      </header>
      <div class="scroll">
        <section>
          <h3>사무실</h3>
          <label>
            이름{' '}
            <input
              ref={nameRef}
              autocomplete="off"
              // office name, same limit the server checks
              maxLength={MAX_NAME_CHARS}
              value={unlessFocused(nameRef, m.name)}
              onInput={(e) => {
                m.name = e.currentTarget.value;
                ed.changed();
              }}
            />
          </label>
          <div class="nums">
            <label>
              가로{' '}
              <input
                ref={wRef}
                type="number"
                min={MIN_W}
                max={MAX_W}
                value={unlessFocused(wRef, d.w)}
                onChange={(e) =>
                  panel.setNum('w', Number(e.currentTarget.value))
                }
              />
            </label>
            <label>
              세로{' '}
              <input
                ref={hRef}
                type="number"
                min={MIN_H}
                max={MAX_H}
                value={unlessFocused(hRef, d.h)}
                onChange={(e) =>
                  panel.setNum('h', Number(e.currentTarget.value))
                }
              />
            </label>
            <label>
              정문 벽{' '}
              <select
                ref={sideRef}
                value={unlessFocused(sideRef, side)}
                onChange={(e) => panel.setDoorSide(e.currentTarget.value)}
              >
                {Object.entries(DOOR_SIDES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              정문 위치{' '}
              <input
                ref={doorRef}
                type="number"
                min={1}
                max={((isHorizontal(side) ? d.w : d.h) || MIN_W) - 2}
                value={unlessFocused(doorRef, d.door?.x ?? d.door?.y)}
                onChange={(e) =>
                  panel.setNum('door', Number(e.currentTarget.value))
                }
              />
            </label>
          </div>
          <p class="dim">바깥벽을 누르거나 정문을 끌어서 옮길 수도 있어요.</p>
        </section>
        <section>
          <h3>
            방 <span class="dim">— 끌어서 그리기</span>
          </h3>
          <div class="palette">
            {Object.entries(ROOM_TYPES).map(([t, v]) =>
              tool(
                `room:${t}`,
                v.label,
                <i
                  class="sw"
                  style={{ background: FLOOR[t]?.[0] ?? '#cdb089' }}
                />,
              ),
            )}
          </div>
          <div class="palette walls">
            <button
              type="button"
              title="모든 방에 벽을 세웁니다 (문 없는 방에는 문이 하나 생겨요)"
              onClick={() => panel.allWalls(true)}
            >
              모든 방 벽 넣기
            </button>
            <button
              type="button"
              title="모든 방의 벽을 걷어 열린 구역으로 만듭니다"
              onClick={() => panel.allWalls(false)}
            >
              모든 방 벽 빼기
            </button>
          </div>
        </section>
        <section>
          <h3>
            가구 <span class="dim">— 눌러서 놓기</span>
          </h3>
          <div class="palette">
            {Object.entries(ITEM_KINDS).map(([k, v]) =>
              tool(
                `item:${k}`,
                v.label,
                null,
                `${v.w}×${v.h} 칸${v.wall ? ' · 위쪽 벽' : ''}`,
              ),
            )}
          </div>
        </section>
        <section>
          <h3>공유</h3>
          <div class="palette">
            <button
              type="button"
              title="배치를 JSON 파일로 저장"
              onClick={() => panel.exportFile()}
            >
              파일로 내보내기
            </button>
            <button
              type="button"
              title="배치를 클립보드에 복사 (메신저 등에 붙여넣기)"
              onClick={() => panel.copy()}
            >
              복사
            </button>
            <button
              type="button"
              title="내보낸 JSON 파일 불러오기"
              onClick={() => fileRef.current?.click()}
            >
              파일 가져오기
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const input = e.currentTarget,
                  f = input.files?.[0];
                input.value = '';
                if (f) panel.importText(await f.text(), `${f.name}의`);
              }}
            />
          </div>
          <label class="from">
            다른 사무실 배치 가져오기
            <select
              value=""
              disabled={!others.length}
              onChange={(e) => {
                const o = others.find((x) => x.id === e.currentTarget.value);
                e.currentTarget.value = '';
                if (o) panel.importLayout(o.layout, `'${o.name}' 사무실의`);
              }}
            >
              <option value="">
                {others.length ? '사무실 고르기…' : '다른 사무실이 없어요'}
              </option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <p class="dim">
            복사한 배치는 편집 중에 Ctrl+V로 붙여넣을 수 있어요. 가져온 배치도
            저장해야 반영됩니다.
          </p>
        </section>
        <Selection panel={panel} />
        <section>
          <p class="dim hint">
            {ed.tool.startsWith('room:')
              ? '사무실 위에서 끌어서 방을 그리세요. (Esc: 취소)'
              : ed.tool.startsWith('item:')
                ? '놓을 곳을 누르세요. 여러 개 놓을 수 있어요. (Esc·우클릭: 그만 놓기)'
                : '가구·방을 끌어서 옮기고, Delete로 지우고, 방향키로 한 칸씩 움직여요. Ctrl+Z: 되돌리기'}
          </p>
          {!m.errs.length && <p class="ok">문제 없음 — 저장할 수 있어요.</p>}
          <ul class="errs">
            {m.errs.map((e, i) => (
              // problems are recomputed whole each time; their order is their identity
              <li key={i}>{e.msg}</li>
            ))}
          </ul>
        </section>
      </div>
      <footer>
        <p class={`msg ${ed.message.kind}`}>{ed.message.text}</p>
        <div class="row">
          <button
            type="button"
            title="되돌리기 (Ctrl+Z)"
            disabled={!m.undo.length}
            onClick={() => m.undoOnce()}
          >
            되돌리기
          </button>
          <button
            type="button"
            title="처음 배치로 (저장해야 반영)"
            onClick={() => panel.resetDefault()}
          >
            기본 배치로
          </button>
          <button
            type="button"
            title="방과 가구를 모두 치웁니다 (저장해야 반영, Ctrl+Z로 되돌리기)"
            onClick={() => panel.clearAll()}
          >
            모두 지우기
          </button>
          {office.id !== 'default' && (
            <button
              type="button"
              class={armed ? 'delete armed' : 'delete'}
              title="이 사무실을 닫고 직원을 기본 사무실로 보냅니다"
              onClick={() => ed.closeOffice()}
            >
              {armed ? '정말 닫기?' : '사무실 닫기'}
            </button>
          )}
          <span class="grow" />
          <button type="button" onClick={() => ed.close()}>
            취소
          </button>
          <button
            type="button"
            class="primary"
            disabled={m.errs.length > 0 || ed.saving || !m.name.trim()}
            onClick={() => ed.save()}
          >
            저장
          </button>
        </div>
      </footer>
    </aside>
  );
}

/** The selected room's or furniture's fields, drawn afresh for each selection. */
function Selection({ panel }: { panel: Edits }) {
  const m = panel.m,
    s = m.selected(),
    sel = m.sel;
  if (!s || !sel) return null;
  return sel.kind === 'room' ? (
    <RoomFields key={`room|${s.id}`} panel={panel} s={s} />
  ) : (
    <ItemFields key={`item|${s.id}`} panel={panel} s={s} />
  );
}

function RoomFields({ panel, s }: { panel: Edits; s: Room }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const walls = hasWalls(s),
    glass = s.glass ?? !!ROOM_TYPES[s.type]?.glass;
  return (
    <section class="sel">
      <h3>선택한 방</h3>
      <label>
        이름{' '}
        <input
          ref={nameRef}
          maxLength={MAX_NAME_CHARS}
          value={unlessFocused(nameRef, s.name)}
          onInput={(e) => {
            s.name = e.currentTarget.value;
            panel.ed.refresh(); // typing: no undo step per key
          }}
        />
      </label>
      <label>
        종류{' '}
        <select
          value={s.type}
          onChange={(e) => panel.setRoomType(s, e.currentTarget.value)}
        >
          {Object.entries(ROOM_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <div class="checks">
        <label class="check">
          <input
            type="checkbox"
            checked={walls}
            onChange={(e) =>
              panel.setRoomFlag(s, 'walls', e.currentTarget.checked)
            }
          />{' '}
          벽
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={glass}
            disabled={!walls}
            onChange={(e) =>
              panel.setRoomFlag(s, 'glass', e.currentTarget.checked)
            }
          />{' '}
          유리벽
        </label>
      </div>
      <p class="dim doors">
        {walls
          ? `문 ${s.doors.filter((x) => !x.open).length}개 · 통로 ${s.doors.filter((x) => x.open).length}개 — 벽 칸을 누르면 문 → 통로 → 벽 순으로 바뀝니다. 모서리를 끌면 크기가 바뀝니다.`
          : '벽 없는 구역입니다. 모서리를 끌면 크기가 바뀝니다.'}
      </p>
      <button type="button" onClick={() => panel.ed.removeSelected()}>
        방 지우기
      </button>
    </section>
  );
}

function ItemFields({ panel, s }: { panel: Edits; s: Item }) {
  const k = ITEM_KINDS[s.kind] ?? { label: s.kind, w: 1, h: 1 }; // a draft's kinds are known (validate)
  return (
    <section class="sel">
      <h3>선택한 가구</h3>
      <p>
        {k.label}{' '}
        <span class="dim">
          · {k.w}×{k.h} 칸 · ({s.x}, {s.y})
        </span>
      </p>
      <button type="button" onClick={() => panel.ed.removeSelected()}>
        가구 지우기
      </button>
    </section>
  );
}
