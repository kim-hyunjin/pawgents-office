// Staff roster: a compact list of every working cat under the HUD — state at a glance, click a row for the
// detail panel, or send one home (asks first, like the panel's 퇴근 button). Toggled from the HUD's "목록" button.

import { h } from 'preact';
import type { SessionSnapshot } from '../../shared/api.ts';
import { CloseButton, StateBadge } from '../common/bits.tsx';
import { useKeyMap, useKeySet, useTick } from '../common/hooks.ts';
import { Pic } from '../common/pic.tsx';
import { css } from '../common/style.ts';
import { busyLabel, quitTitle, toolText } from '../common/ui.ts';
import type { Palette } from '../scene/sprites.ts';
import { familyInfo, sprite } from '../scene/sprites.ts';
import { quitSession } from './quit-confirm.tsx';

const ICON_ZOOM = 2;

css(/* css */ `
#roster {
  position: fixed; z-index: 9; width: min(340px, calc(100vw - 16px)); max-height: 70vh; display: flex; flex-direction: column;
  background: rgba(29,32,54,0.97); border: 1px solid #3b3f5c; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); font-size: 13px;
  & header { display: flex; align-items: center; padding: 8px 8px 8px 14px; border-bottom: 1px solid #2f3352; }
  & h2 { flex: 1; margin: 0; font-size: 14px; & .dim { color: var(--dim); font-weight: 400; } }
  & .close { width: 26px; height: 26px; border: 0; border-radius: 6px; background: var(--panel-2); color: var(--text); font-size: 16px; cursor: pointer; }
  & ul { list-style: none; margin: 0; padding: 4px; overflow: auto; }
  & li {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
    &:hover, &:focus { background: var(--panel-2); outline: none; }
    &.empty { cursor: default; color: var(--dim); justify-content: center; padding: 14px; }
  }
  & .cat { flex: none; image-rendering: pixelated; background: #cdb089; border-radius: 4px; padding: 2px; &[width="0"] { padding: 0; } }
  & .info { flex: 1; min-width: 0; }
  & .top { display: flex; align-items: center; gap: 6px; }
  & .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .line { margin-top: 2px; font-size: 11.5px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .line.err { color: #f87171; }
  & .quit {
    flex: none; font: inherit; font-size: 12px; padding: 4px 10px; border: 0; border-radius: 6px; cursor: pointer; background: var(--panel-2); color: var(--text);
    &:hover { background: #4a2e3a; }
    &:disabled { opacity: .6; cursor: default; }
  }
}
`);

export interface RosterProps {
  sessions: Map<string, SessionSnapshot>;
  /** Viewport px just under the HUD; null: the roster is closed. */
  anchor: { left: number; top: number } | null;
  onClose: () => void;
  /** Open that session's detail panel. */
  onPick: (id: string) => void;
  /** Where its cat is right now ('' = at its desk). */
  placeOf: (id: string) => string;
  /** Its cat's look, once it has a cat on screen. */
  palOf: (id: string) => Palette | undefined;
}

/** Rendered by app.tsx, and again every second while open (cats walk around); closed, it keeps only its own state. */
export function Roster({
  sessions,
  anchor,
  onClose,
  onPick,
  placeOf,
  palOf,
}: RosterProps) {
  // ids with a close request in flight or sent; id -> error message, shown in the row for a few seconds
  const pending = useKeySet<string>();
  const failed = useKeyMap<string, string>();
  useTick(1000, !!anchor);
  if (!anchor) return null;

  /** Once confirmed: idle → a clean end, otherwise a forced close (same rule as the panel). */
  async function quit(s: SessionSnapshot) {
    if (pending.has(s.id)) return;
    try {
      if (!(await quitSession(s, () => pending.add(s.id)))) return;
      // the row disappears when the session ends; if it never does, let the button be used again
      setTimeout(() => pending.delete(s.id), 20000);
    } catch (e) {
      pending.delete(s.id);
      failed.set(s.id, (e as Error).message);
      setTimeout(() => failed.delete(s.id), 5000);
    }
  }

  const live = [...sessions.values()]
    .filter((s) => !s.ended)
    .sort(
      (a, b) =>
        (a.desk ?? 99) - (b.desk ?? 99) ||
        String(a.name).localeCompare(String(b.name)),
    );
  return (
    <aside
      id="roster"
      style={{
        left: `${Math.round(anchor.left)}px`,
        top: `${Math.round(anchor.top)}px`,
      }}
    >
      <header>
        <h2>
          직원 목록 <span class="dim">{live.length}</span>
        </h2>
        <CloseButton onClick={onClose} title="닫기" />
      </header>
      <ul>
        {live.length ? (
          live.map((s) => (
            <Row
              key={s.id}
              s={s}
              pal={palOf(s.id)}
              where={placeOf(s.id)}
              err={failed.get(s.id)}
              pending={pending.has(s.id)}
              onPick={() => onPick(s.id)}
              onQuit={() => quit(s)}
            />
          ))
        ) : (
          <li class="empty">근무 중인 직원이 없어요.</li>
        )}
      </ul>
    </aside>
  );
}

function Row({
  s,
  pal,
  where,
  err,
  pending,
  onPick,
  onQuit,
}: {
  s: SessionSnapshot;
  pal: Palette | undefined;
  where: string;
  err: string | undefined;
  pending: boolean;
  onPick: () => void;
  onQuit: () => void;
}) {
  const f = familyInfo(s.model);
  const subs = (s.subagents || []).filter((a) => !a.ended).length;
  const line = err
    ? `⚠ 퇴근 실패: ${err}`
    : [
        s.currentTool && toolText(s.currentTool),
        where && `📍 ${where}`,
        subs && `보조 ${subs}`,
        [f.label, f.title].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(' · ');
  const busy = s.state !== 'idle';
  return (
    <li
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the row is the click target, and a <button> can't hold its 퇴근 button
      tabIndex={0}
      title={s.cwd || ''}
      onClick={onPick}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') onPick();
      }}
    >
      <Pic class="cat" img={pal && sprite(pal, 'idle', 0)} zoom={ICON_ZOOM} />
      <div class="info">
        <div class="top">
          <b class="name">{s.name || s.id.slice(0, 8)}</b>
          <StateBadge state={s.state} />
        </div>
        <div class={err ? 'line err' : 'line'} title={err}>
          {line}
        </div>
      </div>
      <button
        type="button"
        class="quit"
        disabled={pending}
        title={
          busy
            ? `${busyLabel(s.state)} — ${quitTitle(s, true)}`
            : quitTitle(s, false)
        }
        onClick={(ev) => {
          ev.stopPropagation();
          onQuit();
        }}
      >
        {pending ? '퇴근 중…' : '퇴근'}
      </button>
    </li>
  );
}
