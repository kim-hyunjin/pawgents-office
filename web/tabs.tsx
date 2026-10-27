// Tabs above the office, one per office, with head count and a dot when someone works (yellow: waiting on you),
// and a button to gather everyone here / split up again. Gathered: only the shared office's tab.
import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import type { Office, SessionSnapshot } from '../shared/api.ts';
import { css } from './style.ts';

css(/* css */ `
#tabs {
  display: flex; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none;
  & button {
    display: flex; align-items: center; gap: 6px; padding: 5px 12px 4px; font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer;
    color: var(--dim); background: var(--panel); border: 1px solid #2f3352; border-bottom: 0; border-radius: 6px 6px 0 0;
  }
  & button:hover { color: var(--text); background: var(--panel-2); }
  & button.on { color: var(--text); background: #2a2d45; box-shadow: inset 0 2px 0 var(--accent); }
  & .n { font-size: 11px; padding: 0 6px; border-radius: 8px; background: rgba(255,255,255,0.08); }
  & .dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
  & .dot.wait { background: #fbbf24; }
  & button.act { margin-left: 6px; border-style: dashed; background: transparent; }
  & button.act:hover { background: var(--panel-2); }
  & button.act:disabled { opacity: .5; cursor: wait; }
}
`);

export function Tabs({
  offices,
  sessions,
  officeId,
  together,
  onPick,
  onTogether,
}: {
  offices: Office[];
  sessions: Map<string, SessionSnapshot>;
  officeId: string | null;
  /** The office everyone works in, or null: one office per repo. */
  together: string | null;
  onPick: (id: string) => void;
  /** Gather everyone in this office (null: split up by repo); settles once the server has it. */
  onTogether: (officeId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const shown = together ? offices.filter((o) => o.id === together) : offices;
  const act = async (to: string | null) => {
    setBusy(true);
    try {
      await onTogether(to);
      setFailed('');
    } catch (e) {
      setFailed(`실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {shown.map((o) => {
        const staff = [...sessions.values()].filter(
          (s) => !s.ended && s.officeId === o.id,
        );
        const dot = staff.some((s) => s.state === 'waiting')
          ? 'dot wait'
          : staff.some((s) => s.state !== 'idle')
            ? 'dot'
            : null;
        return (
          <button
            key={o.id}
            type="button"
            class={o.id === officeId ? 'on' : ''}
            title={
              o.repos.filter((r) => r !== 'default').join('\n') ||
              '저장소 밖에서 일하는 세션'
            }
            onClick={() => {
              if (o.id !== officeId) onPick(o.id);
            }}
          >
            {o.name}
            <span class="n">{staff.length}</span>
            {dot && <i class={dot} />}
          </button>
        );
      })}
      {together ? (
        <button
          type="button"
          class="act"
          title={failed || '저장소마다 각자의 사무실로 돌아갑니다'}
          disabled={busy}
          onClick={() => act(null)}
        >
          ↔ 저장소별로 나누기
        </button>
      ) : (
        <button
          type="button"
          class="act"
          title={
            failed || '모든 세션이 지금 보고 있는 사무실에 모여서 일합니다'
          }
          disabled={busy}
          onClick={() => act(officeId)}
        >
          ⇢ 이 사무실에 모두 모이기
        </button>
      )}
    </>
  );
}
