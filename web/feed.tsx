// The activity ticker under the office: the latest tool calls, prompts and replies of the office on screen's staff.
import { Fragment, h, render as mount } from 'preact';
import type { LogEntry, SessionSnapshot } from '../shared/api.ts';
import type { Change } from './state.ts';
import { app } from './state.ts';
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
const feed = { seen: new Set<string>(), items: [] as FeedItem[] };
export function feedFrom(s: SessionSnapshot) {
  let added = false;
  for (const e of s.log || []) {
    if (!FEED_EVENTS.has(e.ev)) continue;
    const key = `${s.id}|${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
    if (feed.seen.has(key)) continue;
    feed.seen.add(key);
    feed.items.push({
      key,
      t: e.t,
      sid: s.id,
      officeId: s.officeId,
      name: s.name,
      agent: /^\[/.test(e.text || ''),
      e,
    });
    added = true;
  }
  if (!added) return;
  feed.items.sort((a, b) => b.t - a.t);
  const per = new Map<string | null, number>();
  feed.items = feed.items.filter((it) => {
    const o = feedOffice(it),
      n = (per.get(o) || 0) + 1;
    per.set(o, n);
    return n <= FEED_MAX;
  });
  if (s.officeId === app.get().officeId) renderFeed(true);
}
/** A session changed: take in its new log lines; one that moved office takes its history along (or out of view). */
export function followSessions(c: Change) {
  if (c.type !== 'session') return;
  feedFrom(c.s);
  if (c.prev && c.prev.officeId !== c.s.officeId) renderFeed(false);
}
/** Sessions move between offices (gathering in one, splitting up): an item follows its session's current office. */
const feedOffice = (it: FeedItem) =>
  app.get().sessions.get(it.sid)?.officeId ?? it.officeId;
/** Redraw the ticker with the current office's items; `live` = new items arrived (animate, keep the scroll anchored). */
export function renderFeed(live?: boolean) {
  const ul = document.getElementById('ticker-list')!;
  const box = ul.parentElement!;
  const { officeId } = app.get();
  const items = feed.items.filter((it) => feedOffice(it) === officeId);
  // keep the viewport anchored when the user has scrolled back into history
  const prevTop = box.scrollTop,
    prevH = box.scrollHeight;
  const newest = live ? items[0]?.key : null;
  mount(
    h(
      Fragment,
      null,
      items.map((it) => (
        <Line key={it.key} it={it} isNew={it.key === newest} />
      )),
    ),
    ul,
  );
  if (!live) box.scrollTop = 0;
  else if (prevTop > 0) box.scrollTop = prevTop + (box.scrollHeight - prevH);
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
