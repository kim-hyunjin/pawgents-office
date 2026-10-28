// The side panel: one session's details (view.tsx) and the composer (composer.tsx) that sends it instructions,
// switches its permission mode and answers its permission requests. This holds the panel's state and requests, and
// opens the session's last answer (reply.tsx, which shows the composer as its child while open) and its files'
// diffs (diff.tsx).

import { Fragment, h } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry, SessionSnapshot } from '../../shared/api.ts';
import { decidePermission, getLog, sendPrompt, setMode } from '../api.ts';
import { Diff } from '../diff.tsx';
import { useKeySet, useRedraw, useTick } from '../hooks.ts';
import { quitSession } from '../quit-confirm.tsx';
import { Reply } from '../reply.tsx';
import { css } from '../style.ts';
import { isHeadless, MODE_LABEL, type Msg, NO_MSG } from '../ui.ts';
import { Composer, cardsOf } from './composer.tsx';
import { PanelView } from './view.tsx';

css(/* css */ `
#panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(var(--panel-w), 100vw); z-index: 10;
  background: var(--panel); border-left: 1px solid #2f3352; box-shadow: -10px 0 40px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; overflow: hidden; font-size: 13px;
  /* slide (no layout reflow: office scale is fixed, canvas only translates) */
  transform: translateX(100%); visibility: hidden; transition: transform var(--panel-ms) ease, visibility 0s linear var(--panel-ms);
  &.open { transform: none; visibility: visible; transition: transform var(--panel-ms) ease; }
  @media (prefers-reduced-motion: reduce) { &, &.open { transition: none; } }
}
`);

function addEntries(to: Map<string, LogEntry>, entries: LogEntry[]) {
  for (const e of entries) {
    const key = `${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
    if (!to.has(key)) to.set(key, e);
  }
}

/** The panel for session `s`; null: closed (it slides away). `onClose`: the user closed it (× or Esc). */
export function Panel({
  s,
  onClose,
}: {
  s: SessionSnapshot | null;
  onClose: () => void;
}) {
  const id = s?.id ?? null;
  const shown = useRef(id); // the session on screen, for requests that settle after the user moved on
  shown.current = id;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const redraw = useRedraw();
  useTick(1000, !!id); // durations tick
  const drafts = useRef(new Map<string, string>()); // sessionId -> unsent text, kept while looking at others
  const [msg, setMsg] = useState<Msg>(NO_MSG);
  const [sending, setSending] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const deciding = useKeySet<string>();
  const [reply, setReply] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  /** Show a message about session `about`, unless the panel has moved on to another. */
  const say = (about: string, text: string, kind: Msg['kind'] = '') => {
    if (shown.current === about) setMsg({ text, kind });
  };

  // The activity log: the session's recent lines as they arrive, plus its longer history fetched on open. It only
  // grows while the same session shows, so each draw adds the snapshot's lines to it in place (no state to set).
  const log = useRef({ id, entries: new Map<string, LogEntry>() });
  if (log.current.id !== id) log.current = { id, entries: new Map() };
  if (s) addEntries(log.current.entries, s.log || []);
  useEffect(() => {
    if (!id) return;
    let live = true;
    getLog(id)
      .then((d) => {
        if (!live || log.current.id !== id) return;
        addEntries(log.current.entries, d.log || []);
        redraw();
      })
      .catch(() => {}); // server restarted — SSE will refill
    return () => {
      live = false;
    };
  }, [id]);

  // another session (or none): a message of its own, and the dialogs about the last one close
  useEffect(() => {
    setMsg(NO_MSG);
    setReply(false);
    setDiff(null);
  }, [id]);
  // closed: focus doesn't stay in what slides away
  useLayoutEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    if (!id && focus?.closest('#panel')) focus.blur();
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const t = e.target as HTMLElement;
      if (t.matches?.('.composer textarea')) {
        t.blur();
        return;
      }
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id]);
  // a card the session no longer asks about is done with
  useEffect(() => {
    if (!s) return;
    const asked = new Set(cardsOf(s).map((c) => c.id));
    deciding.retain((c) => asked.has(c));
  }, [s]);

  /** Hand the composer text to the session: typed into its Orca terminal, or queued as the next turn of a headless one. */
  async function send() {
    const text = (id && drafts.current.get(id)?.trim()) || '';
    if (
      !s ||
      !id ||
      !text ||
      sending ||
      (s.state === 'waiting' && !isHeadless(s))
    )
      return;
    setSending(true);
    say(id, '보내는 중…');
    try {
      await sendPrompt(id, text);
      drafts.current.delete(id);
      say(id, '전달됨 ✓', 'ok');
    } catch (e) {
      say(id, (e as Error).message, 'err');
    } finally {
      setSending(false);
    }
  }

  /** Answer one permission card. It stays (buttons off) until the next session event drops it. */
  async function decide(card: string, allow: boolean) {
    if (!id || deciding.has(card)) return;
    deciding.add(card);
    try {
      await decidePermission(id, card, allow);
    } catch (e) {
      deciding.delete(card);
      say(id, (e as Error).message, 'err');
    }
  }

  async function changeMode(mode: string) {
    if (!s || !mode || modeBusy) return;
    const id = s.id;
    setModeBusy(true);
    say(
      id,
      isHeadless(s)
        ? '권한 모드 바꾸는 중…'
        : '권한 모드 바꾸는 중… (Shift+Tab)',
    );
    try {
      const r = await setMode(id, mode);
      say(id, `권한 모드: ${MODE_LABEL[r.mode ?? ''] || r.mode}`, 'ok');
    } catch (e) {
      say(id, (e as Error).message, 'err');
    } finally {
      setModeBusy(false);
      const a = document.activeElement as HTMLElement | null;
      if (a?.matches('.composer select')) a.blur(); // let it follow the session again
    }
  }

  /** End the session, once the confirmation dialog says so (quitSession: idle → /exit, else a forced close). */
  async function quit() {
    if (!s || s.ended || quitting) return;
    const hl = isHeadless(s);
    const id = s.id;
    let force = false;
    try {
      const went = await quitSession(s, (f) => {
        force = f;
        setQuitting(true);
        say(
          id,
          f
            ? hl
              ? '프로세스를 끝내는 중…'
              : '터미널을 닫는 중…'
            : '퇴근 지시 중…',
        );
      });
      if (!went) return;
      say(
        id,
        force
          ? hl
            ? '프로세스를 끝냈습니다.'
            : '터미널을 닫았습니다.'
          : '퇴근합니다 👋',
        'ok',
      );
    } catch (e) {
      say(id, (e as Error).message, 'err');
    } finally {
      setQuitting(false);
    }
  }

  // drawn in the panel, or in the reply dialog while that is open
  const composer = s && (
    <Composer
      s={s}
      c={{
        draft: drafts.current.get(s.id) ?? '',
        setDraft: (text) => {
          drafts.current.set(s.id, text);
          redraw();
        },
        msg,
        sending,
        modeBusy,
        deciding,
        send,
        decide,
        changeMode,
      }}
    />
  );
  return (
    <>
      <aside id="panel" class={s ? 'open' : ''}>
        {s && (
          <PanelView
            s={s}
            entries={log.current.entries}
            composer={reply ? null : composer}
            quitting={quitting}
            onClose={onClose}
            onQuit={quit}
            onReply={() => setReply(true)}
            onDiff={setDiff}
          />
        )}
      </aside>
      <Reply s={s} open={reply} onClose={() => setReply(false)}>
        {composer}
      </Reply>
      <Diff s={s} file={diff} onClose={() => setDiff(null)} />
    </>
  );
}
