import type { LogEntry, SessionSnapshot } from '../server/types.ts';
import { EV_ICON, esc, fmtTime, ICON } from './ui.ts';
import { world } from './world.ts';

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
  if (s.officeId === world.officeId) renderFeed(true);
}
/** Redraw the ticker with the current office's items; `live` = new items arrived (animate, keep the scroll anchored). */
/** Sessions move between offices (gathering in one, splitting up): an item follows its session's current office. */
const feedOffice = (it: FeedItem) =>
  world.sessions.get(it.sid)?.officeId ?? it.officeId;
export function renderFeed(live?: boolean) {
  const ul = document.getElementById('ticker-list')!;
  const box = ul.parentElement!;
  const items = feed.items.filter((it) => feedOffice(it) === world.officeId);
  // keep the viewport anchored when the user has scrolled back into history
  const prevTop = box.scrollTop,
    prevH = box.scrollHeight;
  const newest = live ? items[0]?.key : null;
  ul.innerHTML = items
    .map((it) => {
      const e = it.e;
      const icon = e.tool ? ICON[e.tool] || '🔧' : EV_ICON[e.ev] || '•';
      let what: string;
      if (e.tool)
        what = `<b>${esc(e.tool)}</b>${e.target ? ' · ' + esc(e.target) : ''}${e.detail ? ` <span class="dim">— ${esc(e.detail)}</span>` : ''}`;
      else if (e.ev === 'UserPromptSubmit')
        what = `<span class="dim">지시:</span> ${esc(e.text || '')}`;
      else if (e.ev === 'Stop')
        what = `<span class="dim">답변:</span> ${esc(e.text || '')}`;
      else
        what = `${esc(e.ev)}${e.text ? ` <span class="dim">${esc(e.text)}</span>` : ''}`;
      const who = it.agent ? `${esc(it.name)} 🧢` : esc(it.name);
      return `<li class="${it.key === newest ? 'new' : ''}"><time>${fmtTime(e.t)}</time><span class="who ${it.agent ? 'agent' : ''}">${who}</span><span class="ic">${icon}</span><span class="what">${what}</span></li>`;
    })
    .join('');
  if (!live) box.scrollTop = 0;
  else if (prevTop > 0) box.scrollTop = prevTop + (box.scrollHeight - prevH);
}
