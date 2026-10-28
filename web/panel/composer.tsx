// The composer at the foot of the panel (or of the reply dialog while that is open): instructions to the session, its
// permission mode, and a card for each permission request it is waiting on.

import { h, type JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { SessionSnapshot } from '../../shared/api.ts';
import { MsgLine, ToolName } from '../bits.tsx';
import { css } from '../style.ts';
import { isHeadless, MODES, type Msg } from '../ui.ts';

css(/* css */ `
/* the panel's footer, or the reply dialog's while that is open */
.composer {
  border-top: 1px solid #2f3352; padding: 10px 12px; display: grid; gap: 6px; background: var(--panel);
  & textarea {
    width: 100%; font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2);
    border: 1px solid #3b3f5c; border-radius: 6px; padding: 7px 9px;
    resize: vertical; min-height: 44px; max-height: 40vh; line-height: 1.45;
    &:focus { outline: none; border-color: var(--accent); }
    &:disabled { opacity: .5; }
  }
  & .row { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
  & .msg { flex: 1; }
  & select {
    font: inherit; font-size: 12px; color: var(--text); background: var(--panel-2); border: 1px solid #3b3f5c; border-radius: 6px; padding: 4px 6px; cursor: pointer;
    &:focus { outline: none; border-color: var(--accent); }
    &:disabled { opacity: .5; cursor: default; }
  }
  /* permission requests, answered here (one card each) */
  & .perms { display: grid; gap: 6px; }
  & .perm {
    border: 1px solid #f59e0b; border-radius: 8px; padding: 8px 10px; background: rgba(245,158,11,0.08); display: grid; gap: 4px; font-size: 13px;
    & .hd { word-break: break-all; }
    & .detail { color: var(--dim); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; word-break: break-all; max-height: 6em; overflow: auto; }
    & .row { display: flex; gap: 6px; justify-content: flex-end; }
    & .note { color: var(--dim); font-size: 12px; }
    & button { font: inherit; font-size: 12.5px; padding: 5px 14px; border-radius: 6px; border: 0; cursor: pointer; background: var(--panel-2); color: var(--text); }
    & button.primary { background: var(--accent); color: #1f2233; font-weight: 700; }
  }
}
#reply .composer { flex: none; padding: 10px 16px 14px 22px; & textarea { max-height: 30vh; } }
`);

const TUI_UNREACHABLE = new Set(['dontAsk', 'bypassPermissions']); // modes Shift+Tab can't be relied on to reach

/** What the composer works with: this session's draft, the panel's message and its requests in flight. */
export interface ComposerCtl {
  draft: string;
  setDraft: (text: string) => void;
  msg: Msg;
  sending: boolean;
  modeBusy: boolean;
  deciding: { has: (card: string) => boolean }; // permission cards answered, buttons off until the session drops them
  send: () => void;
  decide: (card: string, allow: boolean) => void;
  changeMode: (mode: string) => void;
}

/** A parked headless permission request, or the dialog an Orca / terminal session shows (asking). */
type Card = {
  id: string;
  head: JSX.Element;
  detail: string | null;
  answerable: boolean;
  note: string | null;
};

/**
 * One card per parked permission request. An Orca / terminal session's dialog gets a card too: Allow / Deny make the
 * server press the matching key in its terminal (see answerPermission); a question dialog stays read-only.
 */
export function cardsOf(s: SessionSnapshot): Card[] {
  if (s.ended) return [];
  const cards: Card[] = (s.pendingPermissions || []).map((p) => ({
    id: p.id,
    head: <ToolName name={p.tool} target={p.target} />,
    detail: p.detail,
    answerable: true,
    note: null,
  }));
  const ask = !isHeadless(s) && s.state === 'waiting' ? s.asking : null;
  if (ask) {
    const answerable = !!ask.tool && ask.tool !== 'AskUserQuestion'; // a plain permission dialog: the server presses its Yes / No
    cards.push({
      id: String(ask.at),
      head: ask.tool ? (
        <ToolName name={ask.tool} target={ask.target} />
      ) : (
        <b>{ask.label || '응답 대기'}</b>
      ),
      detail: ask.detail,
      answerable,
      note: answerable
        ? '터미널 화면을 읽어 Yes / No 키를 대신 눌러줍니다. 터미널에서 직접 답해도 됩니다.'
        : `${s.orcaTerminal ? 'Orca 터미널' : '터미널'}에서 답해주세요. 답하면 이 카드는 사라집니다.`,
    });
  }
  return cards;
}

export function Composer({ s, c }: { s: SessionSnapshot; c: ComposerCtl }) {
  const sel = useRef<HTMLSelectElement>(null);
  // headless: no TUI dialog to answer by accident, so a prompt sent while waiting just queues as the next turn
  const off = !!s.ended,
    hl = isHeadless(s),
    waiting = s.state === 'waiting' && !hl;
  const asking =
    hl && s.state === 'waiting' && s.pendingPermissions?.length > 0;
  const cards = cardsOf(s);
  /*
   * The select follows the session's mode except while the user has it open or a switch is in flight.
   * A terminal session switches by Shift+Tab, which never reaches dontAsk, nor bypass unless claude started with
   * --dangerously-skip-permissions: those stay hidden there unless the session is already in them.
   */
  const follow = !c.modeBusy && document.activeElement !== sel.current;
  const known = MODES.some(([v]) => v === s.permissionMode);
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        c.send();
      }}
    >
      {cards.length > 0 && (
        <div class="perms">
          {cards.map((card) => (
            <div key={card.id} class="perm">
              <div class="hd">✋ {card.head}</div>
              {card.detail && <div class="detail">{card.detail}</div>}
              {card.answerable && (
                <div class="row">
                  <button
                    type="button"
                    class="primary"
                    disabled={c.deciding.has(card.id)}
                    onClick={() => c.decide(card.id, true)}
                  >
                    허용
                  </button>
                  <button
                    type="button"
                    disabled={c.deciding.has(card.id)}
                    onClick={() => c.decide(card.id, false)}
                  >
                    거부
                  </button>
                </div>
              )}
              {card.note && <div class="note">{card.note}</div>}
            </div>
          ))}
        </div>
      )}
      <textarea
        rows={2}
        value={c.draft}
        disabled={off}
        placeholder={
          off
            ? '퇴근한 직원입니다.'
            : asking
              ? '권한 요청에 먼저 답해주세요 (위 카드). 지시는 큐에 들어갑니다.'
              : hl
                ? '이 직원에게 지시… (작업 중이면 큐에 들어가요)'
                : waiting
                  ? '권한 승인·질문 응답 대기 중 — 터미널에서 먼저 답해주세요. (써 두고 나중에 보낼 수 있어요)'
                  : `이 직원에게 지시…  (Enter 보내기 · Shift+Enter 줄바꿈)${s.orcaTerminal ? '' : '\nOrca 터미널 연결 전 — 보내면 자동으로 찾아봅니다.'}`
        }
        onInput={(e) => c.setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          // isComposing: Enter that commits a Hangul syllable must not send.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            c.send();
          }
        }}
      />
      <div class="row">
        {!off && (
          <select
            ref={sel}
            title="권한 모드 바꾸기 (Orca 터미널은 Shift+Tab으로 전환)"
            disabled={c.modeBusy || waiting}
            value={follow ? (known ? s.permissionMode! : '') : undefined}
            onChange={(e) => c.changeMode(e.currentTarget.value)}
          >
            {MODES.map(([v, label]) => {
              const hide =
                !hl && TUI_UNREACHABLE.has(v) && s.permissionMode !== v;
              // disabled too: Safari ignores hidden <option>s
              return (
                <option key={v} value={v} hidden={hide} disabled={hide}>
                  {label}
                </option>
              );
            })}
            <option value="" hidden>
              모드 —
            </option>
          </select>
        )}
        <MsgLine msg={c.msg} inline />
        <button
          type="submit"
          class="primary"
          disabled={off || waiting || c.sending}
        >
          보내기
        </button>
      </div>
    </form>
  );
}
