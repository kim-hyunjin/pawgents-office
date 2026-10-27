// The activity ticker under the office: the latest tool calls, prompts and replies of the office on screen's staff.
// followSessions() collects them from the session list into `feed`; <Ticker> (in app.tsx) shows them.
import { Fragment, h } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { LogEntry, SessionSnapshot } from '../shared/api.ts';
import type { Change } from './state.ts';
import { app, useApp } from './state.ts';
import { createStore, useStore } from './store.ts';
import { css } from './style.ts';
import { fmtTime, logIcon } from './ui.ts';

css(/* css */ `
#ticker {
  & ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  & li { display: grid; grid-template-columns: 62px 150px 20px 1fr; gap: 8px; align-items: baseline; white-space: nowrap; overflow: hidden; line-height: 1.45; }
  & li.new { animation: tick-in .35s ease-out; }
  & time { color: var(--dim); font-variant-numeric: tabular-nums; }
  & .who { font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
  & .who.agent { color: #c4b5fd; font-weight: 500; }
  & .what { overflow: hidden; text-overflow: ellipsis; }
  & .what .dim { color: var(--dim); }
}
@keyframes tick-in { from { background: rgba(255,209,102,0.25); } to { background: transparent; } }
`);

// ---- activity ticker (sessions of the office on screen) ---------------------------
const FEED_EVENTS = new Set([
  'PreToolUse',
  'PostToolUseFailure',
  'UserPromptSubmit',
  'Stop',
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
]);
const FEED_MAX = 500; // per office, so a busy office doesn't push a quiet one's history out
interface FeedItem {
  key: string;
  t: number;
  sid: string;
  officeId: string | null;
  name: string;
  agent: boolean;
  e: LogEntry;
}
const seen = new Set<string>();
const feed = createStore<
  {
    items: FeedItem[]; // newest first, all offices
    newest: string | null; // the line just in on screen: it flashes
    moved: number; // goes up when a session moves office: its lines go along and the ticker starts at the top again
  },
  void
>({ items: [], newest: null, moved: 0 });

function feedFrom(s: SessionSnapshot) {
  const fresh: FeedItem[] = [];
  for (const e of s.log || []) {
    if (!FEED_EVENTS.has(e.ev)) continue;
    const key = `${s.id}|${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({
      key,
      t: e.t,
      sid: s.id,
      officeId: s.officeId,
      name: s.name,
      agent: /^\[/.test(e.text || ''),
      e,
    });
  }
  if (!fresh.length) return;
  feed.update((f) => {
    const all = [...f.items, ...fresh].sort((a, b) => b.t - a.t);
    const per = new Map<string | null, number>();
    f.items = all.filter((it) => {
      const o = feedOffice(it),
        n = (per.get(o) || 0) + 1;
      per.set(o, n);
      return n <= FEED_MAX;
    });
    if (s.officeId === app.get().officeId) f.newest = f.items[0]?.key ?? null;
  });
}
/** A session changed: take in its new log lines; one that moved office takes its history along (or out of view). */
export function followSessions(c: Change) {
  if (c.type !== 'session') return;
  feedFrom(c.s);
  if (c.prev && c.prev.officeId !== c.s.officeId)
    feed.update((f) => {
      f.newest = null;
      f.moved++;
    });
}
/** Sessions move between offices (gathering in one, splitting up): an item follows its session's current office. */
const feedOffice = (it: FeedItem) =>
  app.get().sessions.get(it.sid)?.officeId ?? it.officeId;
/** The office on screen's lines, newest on top; the newest one just in flashes. */
export function Ticker() {
  const { officeId } = useApp();
  const { items, newest, moved } = useStore(feed);
  const box = useRef<HTMLDivElement>(null);
  // where the user had scrolled to before this draw: lines coming in above must not move what they're reading
  const before = box.current && {
    top: box.current.scrollTop,
    h: box.current.scrollHeight,
  };
  // another office (or its staff moved): start from the top
  const view = `${officeId}|${moved}`;
  const lastView = useRef(view);
  useLayoutEffect(() => {
    const el = box.current!;
    if (lastView.current !== view) {
      lastView.current = view;
      el.scrollTop = 0;
    } else if (before && before.top > 0)
      el.scrollTop = before.top + (el.scrollHeight - before.h);
  });
  return (
    <div id="ticker" ref={box}>
      <ul>
        {items
          .filter((it) => feedOffice(it) === officeId)
          .map((it) => (
            <Line key={it.key} it={it} isNew={it.key === newest} />
          ))}
      </ul>
    </div>
  );
}

/** One ticker line; the newest one (just in) flashes as it's added. */
function Line({ it, isNew }: { it: FeedItem; isNew: boolean }) {
  const e = it.e;
  const what = e.tool ? (
    <>
      <b>{e.tool}</b>
      {e.target ? ` · ${e.target}` : ''}
      {e.detail && <span class="dim"> — {e.detail}</span>}
    </>
  ) : e.ev === 'UserPromptSubmit' ? (
    <>
      <span class="dim">지시:</span> {e.text || ''}
    </>
  ) : e.ev === 'Stop' ? (
    <>
      <span class="dim">답변:</span> {e.text || ''}
    </>
  ) : (
    <>
      {e.ev}
      {e.text && <span class="dim"> {e.text}</span>}
    </>
  );
  return (
    <li class={isNew ? 'new' : ''}>
      <time>{fmtTime(e.t)}</time>
      <span class={it.agent ? 'who agent' : 'who'}>
        {it.agent ? `${it.name} 🧢` : it.name}
      </span>
      <span class="ic">{logIcon(e)}</span>
      <span class="what">{what}</span>
    </li>
  );
}
