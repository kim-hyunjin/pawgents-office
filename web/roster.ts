// Staff roster: a compact list of every working cat under the HUD — state at a glance, click a row for the
// detail panel, or send one home (asks first, like the panel's 퇴근 button). Toggled from the HUD's "목록" button.

import type { SessionSnapshot } from '../shared/api.ts';
import { isBusyState } from '../shared/model.ts';
import { closeSession } from './api.ts';
import { confirmQuit } from './quit-confirm.ts';
import type { Palette } from './sprites.ts';
import { FAMILIES, familyOf, sprite } from './sprites.ts';
import {
  esc,
  pic,
  quitTitle,
  STATE_COLOR,
  STATE_LABEL,
  toolText,
} from './ui.ts';

const ICON_ZOOM = 2;

type Sessions = Map<string, SessionSnapshot>;
interface Row {
  li: HTMLLIElement;
  icon: HTMLCanvasElement;
  name: HTMLElement;
  badge: HTMLElement;
  line: HTMLElement;
  quit: HTMLButtonElement;
  pal: Palette | null;
  session?: SessionSnapshot;
}

export class Roster {
  el: HTMLElement;
  list: HTMLElement;
  countEl: HTMLElement;
  onPick: (id: string) => void;
  placeOf: (id: string) => string;
  palOf: (id: string) => Palette | undefined;
  rows = new Map<string, Row>(); // id -> row elements
  pending = new Set<string>(); // ids with a close request in flight or sent
  failed = new Map<string, string>(); // id -> error message, shown in the row for a few seconds
  lastSessions: Sessions | undefined = undefined;
  /**
   * onPick(id): open that session's detail panel. placeOf(id): where its cat is right now ('' = at its desk).
   * palOf(id): its cat's look, once it has a cat on screen.
   */
  constructor(
    el: HTMLElement,
    {
      onPick,
      placeOf,
      palOf,
    }: {
      onPick: (id: string) => void;
      placeOf: (id: string) => string;
      palOf: (id: string) => Palette | undefined;
    },
  ) {
    this.el = el;
    this.list = el.querySelector<HTMLElement>('#rs-list')!;
    this.countEl = el.querySelector<HTMLElement>('#rs-count')!;
    this.onPick = onPick;
    this.placeOf = placeOf;
    this.palOf = palOf;
    el.querySelector('#rs-close')!.addEventListener('click', () =>
      this.close(),
    );
  }
  get isOpen() {
    return !this.el.hidden;
  }
  toggle(sessions: Sessions, anchor: { left: number; top: number }) {
    if (this.isOpen) this.close();
    else this.open(sessions, anchor);
  }
  /** anchor: viewport px {left, top} just under the HUD. */
  open(sessions: Sessions, anchor: { left: number; top: number }) {
    this.el.style.left = `${Math.round(anchor.left)}px`;
    this.el.style.top = `${Math.round(anchor.top)}px`;
    this.el.hidden = false;
    this.update(sessions);
  }
  close() {
    this.el.hidden = true;
  }

  update(sessions: Sessions) {
    this.lastSessions = sessions;
    if (!this.isOpen) return;
    const live = [...sessions.values()]
      .filter((s) => !s.ended)
      .sort(
        (a, b) =>
          (a.desk ?? 99) - (b.desk ?? 99) ||
          String(a.name).localeCompare(String(b.name)),
      );
    this.countEl.textContent = String(live.length);
    const keep = new Set(live.map((s) => s.id));
    for (const [id, r] of this.rows)
      if (!keep.has(id)) {
        r.li.remove();
        this.rows.delete(id);
        this.pending.delete(id);
      }
    let empty: HTMLElement | null =
      this.list.querySelector<HTMLElement>('.empty');
    if (!live.length && !empty) {
      empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '근무 중인 직원이 없어요.';
      this.list.append(empty);
    }
    if (live.length && empty) empty.remove();
    live.forEach((s, i) => {
      const r = this.rows.get(s.id) || this.makeRow(s);
      this.fill(r, s);
      if (this.list.children[i] !== r.li)
        this.list.insertBefore(r.li, this.list.children[i] || null);
    });
  }

  makeRow(s: SessionSnapshot): Row {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.innerHTML =
      '<canvas class="cat"></canvas><div class="info"><div class="top"><b class="name"></b><span class="badge"></span></div>' +
      '<div class="line dim"></div></div><button type="button" class="quit">퇴근</button>';
    const r: Row = {
      li,
      icon: li.querySelector('.cat')!,
      name: li.querySelector('.name')!,
      badge: li.querySelector('.badge')!,
      line: li.querySelector('.line')!,
      quit: li.querySelector('.quit')!,
      pal: null,
    };
    li.addEventListener('click', () => this.onPick(s.id));
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.onPick(s.id);
    });
    r.quit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.quit(r.session);
    });
    this.rows.set(s.id, r);
    return r;
  }

  fill(r: Row, s: SessionSnapshot) {
    r.session = s;
    const pal = this.palOf(s.id);
    if (pal && pal !== r.pal) {
      // (re)draw the icon when the cat's palette is known or changes
      r.pal = pal;
      pic(sprite(pal, 'idle', 0), ICON_ZOOM, r.icon);
    }
    r.name.textContent = s.name || s.id.slice(0, 8);
    r.badge.textContent = STATE_LABEL[s.state] || s.state;
    r.badge.style.background = STATE_COLOR[s.state] || '#888';
    const f = FAMILIES[familyOf(s.model)];
    const subs = (s.subagents || []).filter((a) => !a.ended).length;
    const doing = s.currentTool ? toolText(s.currentTool) : '';
    const where = this.placeOf(s.id);
    const err = this.failed.get(s.id);
    r.line.classList.toggle('err', !!err);
    r.line.innerHTML = err
      ? `⚠ 퇴근 실패: ${esc(err)}`
      : [
          doing && esc(doing),
          where && `📍 ${esc(where)}`,
          subs && `보조 ${subs}`,
          f && esc([f.label, f.title].filter(Boolean).join(' ')),
        ]
          .filter(Boolean)
          .join(' · ');
    if (err) r.line.title = err;
    else r.line.removeAttribute('title');
    r.li.title = s.cwd || '';
    const busy = s.state !== 'idle';
    if (this.pending.has(s.id)) {
      r.quit.textContent = '퇴근 중…';
      r.quit.disabled = true;
      r.quit.className = 'quit';
    } else {
      r.quit.textContent = '퇴근';
      r.quit.disabled = false;
      r.quit.className = 'quit';
    }
    r.quit.title = busy
      ? `${isBusyState(s.state) ? '작업 중' : '응답 대기'} — ${quitTitle(s, true)}`
      : quitTitle(s, false);
  }

  /** Once confirmed: idle → a clean end, otherwise a forced close (same rule as the panel). */
  async quit(s: SessionSnapshot | undefined) {
    if (!s || this.pending.has(s.id)) return;
    if (!(await confirmQuit(s, s.state !== 'idle')) || this.pending.has(s.id))
      return;
    this.pending.add(s.id);
    this.refreshRow(s.id);
    try {
      await closeSession(s.id, s.state !== 'idle');
      // the row disappears when the session ends; if it never does, let the button be used again
      setTimeout(() => {
        this.pending.delete(s.id);
        this.refreshRow(s.id);
      }, 20000);
    } catch (e) {
      this.pending.delete(s.id);
      this.failed.set(s.id, (e as Error).message);
      setTimeout(() => {
        this.failed.delete(s.id);
        this.refreshRow(s.id);
      }, 5000);
    }
    this.refreshRow(s.id);
  }
  refreshRow(id: string) {
    const r = this.rows.get(id);
    if (r && r.session && this.lastSessions) this.fill(r, r.session);
  }
}
