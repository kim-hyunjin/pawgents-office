// The tooltip over a cat under the pointer: who it is, where, what it's doing and thinking.
import { type ComponentChildren, Fragment, h } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SessionSnapshot, SubagentSnapshot } from '../../shared/api.ts';
import { ToolName } from '../common/bits.tsx';
import { css } from '../common/style.ts';
import {
  awaitingBg,
  bgSummary,
  STATE_LABEL,
  thinkingFresh,
} from '../common/ui.ts';
import { pointer } from '../data/state.ts';
import { useStore } from '../data/store.ts';
import { familyInfo } from '../scene/sprites.ts';
import type { Ent } from '../scene/world.ts';

css(/* css */ `
#tip {
  position: fixed; z-index: 20; max-width: 380px; padding: 8px 10px; pointer-events: none;
  background: rgba(20,22,40,0.95); border: 1px solid #3b3f5c; border-radius: 6px; font-size: 12px; line-height: 1.5;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4); word-break: break-all;
  & .dim { color: var(--dim); }
  & .st { color: var(--accent); }
  & .detail { color: #cbd5e1; font-size: 11.5px; margin: 2px 0 4px; }
  & .task { color: #e2e8f0; margin: 4px 0; padding-left: 6px; border-left: 2px solid var(--accent); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  & .think { color: var(--dim); font-style: italic; margin-top: 4px; }
}
`);

function ToolLine({ d }: { d: SessionSnapshot | SubagentSnapshot }) {
  const st = <span class="st">{STATE_LABEL[d.state] || d.state}</span>;
  const t = d.currentTool;
  if (!t) return st;
  return (
    <>
      {st} · <ToolName name={t.name} target={t.target} />
      {t.detail && <div class="detail">{t.detail}</div>}
    </>
  );
}
function Think({ d }: { d: SessionSnapshot | SubagentSnapshot }) {
  return thinkingFresh(d, Date.now()) && d.state !== 'idle' ? (
    <div class="think">💭 {d.lastThinking}</div>
  ) : null;
}

/** The tooltip box near the pointer, on the pointer's other side where the window ends; it follows the pointer. */
export function Tip({ children }: { children?: ComponentChildren }) {
  const at = useStore(pointer);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x + 14, top: at.y + 14 });
  // its size is known only once drawn: place it then, before the browser paints
  useLayoutEffect(() => {
    const { offsetWidth: w, offsetHeight: hgt } = ref.current!;
    let left = at.x + 14,
      top = at.y + 14;
    if (left + w > window.innerWidth - 8) left = at.x - w - 8;
    if (top + hgt > window.innerHeight - 8) top = at.y - hgt - 8;
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  });
  return (
    <div
      id="tip"
      ref={ref}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      {children}
    </div>
  );
}

/** `s`: the cat's session; `where`: the place it's at ('' at its desk). */
export function CatTip({
  e,
  s,
  where,
}: {
  e: Ent;
  s: SessionSnapshot;
  where: string;
}) {
  if (e.kind === 'assistant') {
    const a = e.data;
    return (
      <>
        <b>🧢 {a.type || 'agent'}</b>{' '}
        <span class="dim">
          보조 · {s.name}
          {where ? ` · ${where}` : ''}
        </span>
        {a.description && <div>{a.description}</div>}
        {a.task && <div class="task">{a.task}</div>}
        <div>
          <ToolLine d={a} />
        </div>
        <Think d={a} />
      </>
    );
  }
  const tier = familyInfo(s.model).title;
  return (
    <>
      <b>{s.name}</b>
      {tier && (
        <>
          {' '}
          <span class="st">{tier}</span>
        </>
      )}
      {where && <span class="dim"> · {where}</span>}
      {s.title && (
        <>
          <br />
          {s.title}
        </>
      )}
      {s.lastPrompt && <div class="task">지시: {s.lastPrompt}</div>}
      <div>
        <ToolLine d={s} />
        {s.permissionMode && <span class="dim"> · {s.permissionMode}</span>}
      </div>
      <Think d={s} />
      {awaitingBg(s) && <div class="task">⏳ {bgSummary(s)}</div>}
      <div class="dim">
        {s.cwd}
        {s.model ? ` · ${s.model}` : ''}
      </div>
    </>
  );
}
