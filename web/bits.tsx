// Small pieces several views draw the same way: a session's state badge, a tool call's name, the × close button and
// a form's status line.
import { Fragment, h } from 'preact';
import type { EntityState } from '../shared/api.ts';
import { type Msg, STATE_COLOR, STATE_LABEL } from './ui.ts';

/** The session's state as a colored pill (.badge in style.css). */
export function StateBadge({ state }: { state: EntityState }) {
  return (
    <span class="badge" style={{ background: STATE_COLOR[state] || '#888' }}>
      {STATE_LABEL[state] || state}
    </span>
  );
}

/** "**Edit** · office.ts": a tool call's name in bold, then what it works on (toolText() as markup). */
export function ToolName({
  name,
  target,
}: {
  name: string;
  target?: string | null;
}) {
  return (
    <>
      <b>{name}</b>
      {target ? ` · ${target}` : ''}
    </>
  );
}

/** The × button of a panel or dialog header (each view styles its .close). */
export function CloseButton({
  onClick,
  title = '닫기 (Esc)',
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button type="button" class="close" title={title} onClick={onClick}>
      ×
    </button>
  );
}

/** A form's status line (.msg in style.css); `inline`: a <span> in a row of controls instead of a paragraph. */
export function MsgLine({ msg, inline }: { msg: Msg; inline?: boolean }) {
  const cls = `msg ${msg.kind}`;
  return inline ? (
    <span class={cls}>{msg.text}</span>
  ) : (
    <p class={cls}>{msg.text}</p>
  );
}
