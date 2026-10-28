// The layout editor's fields for the selected room or piece of furniture, drawn afresh for each selection; they use
// the side panel's styles (#editor in editor/panel.tsx).
import type { RefObject } from 'preact';
import { h } from 'preact';
import { useRef } from 'preact/hooks';
import type { Item, Room } from '../../shared/layout.ts';
import { hasWalls, ITEM_KINDS, ROOM_TYPES } from '../../shared/layout.ts';
import { MAX_NAME_CHARS } from '../../shared/limits.ts';
import type { Edits } from './edits.ts';

/** A field's value, except while it has focus: what is being typed isn't overwritten by a redraw. */
export const unlessFocused = (
  ref: RefObject<HTMLElement | null>,
  v: unknown,
) =>
  ref.current && document.activeElement === ref.current
    ? undefined
    : String(v ?? '');

/** The selected room's or furniture's fields, drawn afresh for each selection. */
export function Selection({ panel }: { panel: Edits }) {
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
