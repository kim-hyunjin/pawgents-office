import type { LogEntry, SessionSnapshot } from '../server/types.ts';
import { FAMILIES, familyOf } from './sprites.ts';
import { openReply, refreshReply } from './reply.ts';
import { openDiff, refreshDiff } from './diff.ts';
import { api, post, closeSession, decidePermission, setMode } from './api.ts';
import { esc, fmtTime, setMsg, ICON, EV_ICON, MODE_LABEL, BUSY, STATE_LABEL, STATE_COLOR, awaitingBg, bgSummary, toolText, thinkingFresh, isHeadless, quitTitle } from './ui.ts';

const TUI_UNREACHABLE = new Set(['dontAsk', 'bypassPermissions']); // modes Shift+Tab can't be relied on to reach
const GIT_LABEL: Record<string, string> = { M: '수정됨 (git)', A: '추가됨 (git)', D: '삭제됨 (git)', '?': '새 파일 (아직 git에 없음)', R: '이름 바뀜 (git)', C: '복사됨 (git)', U: '충돌 (git)' };

export class Panel {
  el: HTMLElement;
  onOpen?: () => void;
  onClose?: () => void;
  id: string | null = null;
  session: SessionSnapshot | null = null;
  entries = new Map<string, LogEntry>();
  drafts = new Map<string, string>(); // sessionId -> unsent text
  input: HTMLTextAreaElement;
  composeMsg: HTMLElement;
  sendBtn: HTMLButtonElement; // cached: the composer moves into the reply dialog while it's open
  permEl: HTMLElement;
  modeSel: HTMLSelectElement;
  quitBtn: HTMLButtonElement;
  isOpen = false;
  timer: ReturnType<typeof setInterval>;
  sending = false;
  modeBusy = false;
  permKey = '';
  quitArmed = false;
  quitting = false;
  quitTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(el: HTMLElement, { onOpen, onClose }: { onOpen?: () => void; onClose?: () => void } = {}) {
    this.el = el;
    this.onOpen = onOpen;
    this.onClose = onClose;
    el.querySelector('#p-close')!.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (e.target === this.input) { this.input.blur(); return; }
      this.close();
    });
    this.input = el.querySelector('#p-input')!;
    this.composeMsg = el.querySelector('#p-compose-msg')!;
    this.sendBtn = el.querySelector('#p-send')!;
    this.input.addEventListener('keydown', (e) => {
      // isComposing: Enter that commits a Hangul syllable must not send.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    el.querySelector('#p-compose')!.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.permEl = el.querySelector('#p-perm')!;
    this.permEl.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-allow]');
      if (b) this.decide(b.closest<HTMLElement>('.perm')!, b.dataset.allow === '1');
    });
    this.modeSel = el.querySelector('#p-mode')!;
    this.modeSel.addEventListener('change', () => this.changeMode(this.modeSel.value));
    this.quitBtn = el.querySelector('#p-quit')!;
    this.quitBtn.addEventListener('click', () => this.quit());
    const last = el.querySelector<HTMLElement>('#p-last')!;
    last.addEventListener('click', () => { if (this.session) openReply(this.session); });
    last.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && this.session) { e.preventDefault(); openReply(this.session); } });
    el.querySelector('#p-files')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-file]');
      if (b && this.session) openDiff(this.session, b.dataset.file!);
    });
    this.timer = setInterval(() => { if (this.id && this.session) this.renderMeta(this.session); }, 1000);
  }

  async open(session: SessionSnapshot) {
    if (this.id && this.id !== session.id) this.drafts.set(this.id, this.input.value);
    if (this.id !== session.id) { this.input.value = this.drafts.get(session.id) || ''; this.setComposeMsg(''); }
    this.id = session.id;
    this.session = session;
    this.entries = new Map();
    this.resetQuit();
    if (!this.isOpen) {
      this.isOpen = true;
      this.el.classList.add('open'); // slides in via CSS transition
      this.onOpen?.();
    }
    this.renderMeta(session);
    this.addEntries(session.log || []);
    try {
      const d = await api<{ log?: LogEntry[] }>(`/sessions/${encodeURIComponent(session.id)}/log`);
      if (this.id === session.id) this.addEntries(d.log || []);
    } catch { /* server restarted — SSE will refill */ }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.resetQuit();
    if (this.id) this.drafts.set(this.id, this.input.value);
    this.id = null;
    this.session = null;
    this.onClose?.();
  }

  update(session: SessionSnapshot) {
    if (session.id !== this.id) return;
    this.session = session;
    this.renderMeta(session);
    this.addEntries(session.log || []);
    refreshReply(session);
    refreshDiff(session);
  }

  remove(id: string) { this.drafts.delete(id); if (id === this.id) this.close(); }

  setComposeMsg(text: string, kind = '') { setMsg(this.composeMsg, text, kind); }

  /** Hand the composer text to the session: typed into its Orca terminal, or queued as the next turn of a headless one. */
  async send() {
    const id = this.id, text = this.input.value.trim();
    if (!id || !text || this.sending || (this.session?.state === 'waiting' && !isHeadless(this.session))) return;
    this.sending = true;
    this.sendBtn.disabled = true;
    this.setComposeMsg('보내는 중…');
    try {
      await post(`/sessions/${encodeURIComponent(id)}/prompt`, { text });
      this.drafts.delete(id);
      if (this.id === id) { this.input.value = ''; this.setComposeMsg('전달됨 ✓', 'ok'); }
    } catch (e) {
      if (this.id === id) this.setComposeMsg((e as Error).message, 'err');
    } finally {
      this.sending = false;
      this.renderCompose(this.session);
    }
  }

  /** Answer one permission card. It stays (buttons off) until the next session event drops it from pendingPermissions. */
  async decide(card: HTMLElement, allow: boolean) {
    const id = this.id, btns = [...card.querySelectorAll('button')];
    if (!id || btns.some((b) => b.disabled)) return;
    btns.forEach((b) => { b.disabled = true; });
    try {
      await decidePermission(id, card.dataset.id!, allow);
    } catch (e) {
      if (this.id === id) this.setComposeMsg((e as Error).message, 'err');
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  async changeMode(mode: string) {
    const s = this.session;
    if (!s || !mode || this.modeBusy) return;
    const id = s.id;
    this.modeBusy = true;
    this.modeSel.disabled = true;
    this.setComposeMsg(isHeadless(s) ? '권한 모드 바꾸는 중…' : '권한 모드 바꾸는 중… (Shift+Tab)');
    try {
      const r = await setMode(id, mode);
      if (this.id === id) this.setComposeMsg(`권한 모드: ${MODE_LABEL[r.mode] || r.mode}`, 'ok');
    } catch (e) {
      if (this.id === id) this.setComposeMsg((e as Error).message, 'err');
    } finally {
      this.modeBusy = false;
      this.modeSel.blur(); // let it follow the session again
      if (this.session) this.renderMode(this.session);
    }
  }

  /**
   * The select follows the session's mode except while the user has it open or a switch is in flight.
   * A terminal session switches by Shift+Tab, which never reaches dontAsk, nor bypass unless claude started with
   * --dangerously-skip-permissions: those stay hidden there unless the session is already in them.
   */
  renderMode(s: SessionSnapshot) {
    const sel = this.modeSel;
    sel.hidden = !!s.ended;
    sel.disabled = !!s.ended || !!this.modeBusy || (!isHeadless(s) && s.state === 'waiting');
    for (const o of sel.options) {
      if (!o.value) continue;
      const off = !isHeadless(s) && TUI_UNREACHABLE.has(o.value) && s.permissionMode !== o.value;
      o.hidden = off; o.disabled = off; // disabled too: Safari ignores hidden <option>s
    }
    if (this.modeBusy || document.activeElement === sel) return;
    const known = [...sel.options].some((o) => o.value && o.value === s.permissionMode);
    sel.value = known ? s.permissionMode! : '';
  }

  /**
   * One card per parked permission request; rebuilt only when the set changes (renderMeta runs every second).
   * An Orca / terminal session's dialog gets a card too: Allow / Deny make the server press the matching key in its terminal
   * (see answerPermission); a question dialog stays read-only.
   */
  renderPerm(s: SessionSnapshot) {
    const list = !s.ended ? s.pendingPermissions || [] : [];
    const ask = !s.ended && !isHeadless(s) && s.state === 'waiting' ? s.asking : null;
    const answerable = !!ask?.tool && ask.tool !== 'AskUserQuestion'; // a plain permission dialog: the server presses its Yes / No
    const key = `${s.id}|${list.map((p) => p.id).join(',')}|${ask ? `${ask.at}:${ask.tool}:${ask.label}` : ''}`;
    if (key === this.permKey) return;
    this.permKey = key;
    this.permEl.innerHTML = list.map((p) => `<div class="perm" data-id="${esc(p.id)}">
        <div class="hd">✋ <b>${esc(p.tool)}</b>${p.target ? ' · ' + esc(p.target) : ''}</div>
        ${p.detail ? `<div class="detail">${esc(p.detail)}</div>` : ''}
        <div class="row"><button type="button" class="primary" data-allow="1">허용</button><button type="button" data-allow="0">거부</button></div>
      </div>`).join('') + (ask ? `<div class="perm ask" data-id="${esc(ask.at)}">
        <div class="hd">✋ ${ask.tool ? `<b>${esc(ask.tool)}</b>${ask.target ? ' · ' + esc(ask.target) : ''}` : `<b>${esc(ask.label || '응답 대기')}</b>`}</div>
        ${ask.detail ? `<div class="detail">${esc(ask.detail)}</div>` : ''}
        ${answerable
          ? `<div class="row"><button type="button" class="primary" data-allow="1">허용</button><button type="button" data-allow="0">거부</button></div>
        <div class="note">터미널 화면을 읽어 Yes / No 키를 대신 눌러줍니다. 터미널에서 직접 답해도 됩니다.</div>`
          : `<div class="note">${s.orcaTerminal ? 'Orca 터미널' : '터미널'}에서 답해주세요. 답하면 이 카드는 사라집니다.</div>`}
      </div>` : '');
    this.permEl.hidden = !list.length && !ask;
  }

  /**
   * End the session. First click arms, second click (within 4s) sends. Idle → `/exit` (clean
   * SessionEnd, tab stays); anything else → close the Orca terminal outright. Typing `/exit`
   * into a permission dialog could hit its default option, so only an idle prompt gets text.
   */
  async quit() {
    const s = this.session;
    if (!s || s.ended || this.quitting) return;
    const force = s.state !== 'idle';
    if (!this.quitArmed) {
      this.quitArmed = true;
      this.quitBtn.classList.add('armed');
      this.quitBtn.textContent = force ? `${BUSY.has(s.state) ? '작업 중' : '응답 대기'} — 강제 종료?` : '정말 퇴근?';
      this.quitBtn.title = quitTitle(s, force);
      this.quitTimer = setTimeout(() => this.resetQuit(), 4000);
      return;
    }
    this.resetQuit();
    this.quitting = true;
    this.quitBtn.disabled = true;
    const hl = isHeadless(s);
    this.setComposeMsg(force ? (hl ? '프로세스를 끝내는 중…' : '터미널을 닫는 중…') : '퇴근 지시 중…');
    const id = s.id;
    try {
      await closeSession(id, force);
      if (this.id === id) this.setComposeMsg(force ? (hl ? '프로세스를 끝냈습니다.' : '터미널을 닫았습니다.') : '퇴근합니다 👋', 'ok');
    } catch (e) {
      if (this.id === id) this.setComposeMsg((e as Error).message, 'err');
    } finally {
      this.quitting = false;
      this.quitBtn.disabled = false;
    }
  }

  resetQuit() {
    clearTimeout(this.quitTimer);
    this.quitArmed = false;
    if (!this.quitBtn) return;
    this.quitBtn.classList.remove('armed');
    this.quitBtn.textContent = '퇴근';
    this.quitBtn.title = '이 세션 종료';
  }

  renderCompose(s: SessionSnapshot | null) {
    if (!s) return;
    this.quitBtn.hidden = !!s.ended;
    // headless: no TUI dialog to answer by accident, so a prompt sent while waiting just queues as the next turn
    const off = !!s.ended, hl = isHeadless(s), waiting = s.state === 'waiting' && !hl;
    this.renderPerm(s);
    this.renderMode(s);
    const asking = hl && s.state === 'waiting' && s.pendingPermissions?.length > 0;
    this.input.disabled = off;
    this.sendBtn.disabled = off || waiting || !!this.sending;
    this.input.placeholder = off ? '퇴근한 직원입니다.'
      : asking ? '권한 요청에 먼저 답해주세요 (위 카드). 지시는 큐에 들어갑니다.'
      : hl ? '이 직원에게 지시… (작업 중이면 큐에 들어가요)'
      : waiting ? '권한 승인·질문 응답 대기 중 — 터미널에서 먼저 답해주세요. (써 두고 나중에 보낼 수 있어요)'
      : `이 직원에게 지시…  (Enter 보내기 · Shift+Enter 줄바꿈)${s.orcaTerminal ? '' : '\nOrca 터미널 연결 전 — 보내면 자동으로 찾아봅니다.'}`;
  }

  renderMeta(s: SessionSnapshot) {
    const q = (sel: string) => this.el.querySelector<HTMLElement>(sel)!;
    const now = Date.now();
    q('#p-name').textContent = s.name;
    q('#p-title').textContent = s.title || '';
    const badge = q('#p-state');
    badge.textContent = STATE_LABEL[s.state] || s.state;
    badge.style.background = STATE_COLOR[s.state] || '#888';
    const fam = FAMILIES[familyOf(s.model)];
    const tool = s.currentTool
      ? `<b>${esc(s.currentTool.name)}</b>${s.currentTool.target ? ' · ' + esc(s.currentTool.target) : ''} <span class="dim">(${fmtDur(now - s.currentTool.startedAt)})</span>${s.currentTool.detail ? `<div class="detail">${esc(s.currentTool.detail)}</div>` : ''}`
      : awaitingBg(s) ? `⏳ ${esc(bgSummary(s))}`
      : esc(STATE_LABEL[s.state] || '—');
    const turn = s.turnStartedAt && s.state !== 'idle' ? `툴 ${s.turnTools}회 · ${fmtDur(now - s.turnStartedAt)} 경과` : (s.turnStartedAt ? `마지막 턴: 툴 ${s.turnTools}회` : '—');
    const cost = s.cost ? `$${s.cost.usd.toFixed(2)} · <span class="add">+${s.cost.linesAdded}</span> / <span class="del">−${s.cost.linesRemoved}</span> 줄` : '—';
    q('#p-meta').innerHTML = [
      ['현재 작업', tool],
      ['이번 턴', turn],
      ['모델', `${esc(s.model || '—')}${fam.title ? ` <span class="tier">${fam.title}</span>` : ''}`],
      ['권한 모드', esc((s.permissionMode && MODE_LABEL[s.permissionMode]) || s.permissionMode || '—')],
      ['실행', isHeadless(s) ? '직접 실행 (claude -p)' : s.orcaTerminal ? 'Orca 터미널' : '—'],
      ['비용 / 변경', cost],
      ['디렉터리', esc(s.cwd || '—')],
      ['가동 시간', `${fmtDur(now - s.startedAt)}${s.pid ? ` <span class="dim">· PID ${esc(s.pid)}</span>` : ''}`],
      ['세션', `<code>${esc(s.id)}</code>`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    const pr = q('#p-prompt');
    pr.textContent = s.lastPrompt || '';
    pr.hidden = !s.lastPrompt;
    const th = q('#p-thinking');
    const freshThinking = thinkingFresh(s, now) && s.state !== 'idle';
    th.textContent = freshThinking ? s.lastThinking : '';
    th.hidden = !freshThinking;

    const ag = q('#p-agents');
    const live = (s.subagents || []).filter((a) => !a.ended);
    ag.innerHTML = live.map((a) => `<div class="agent" style="--c:${STATE_COLOR[a.state] || '#888'}">
        <div class="agent-hd">🧢 <b>${esc(a.type || 'agent')}</b>${a.description ? ' · ' + esc(a.description) : ''} <em>${esc(STATE_LABEL[a.state] || a.state)}</em> <span class="dim">툴 ${a.toolCount || 0}회</span></div>
        ${a.currentTool ? `<div class="agent-tool">${esc(toolText(a.currentTool))}${a.currentTool.detail ? ` <span class="dim">— ${esc(a.currentTool.detail)}</span>` : ''}</div>` : ''}
        ${a.task ? `<div class="agent-task" title="${esc(a.task)}">${esc(a.task)}</div>` : ''}
        ${thinkingFresh(a, now) ? `<div class="agent-think">💭 ${esc(a.lastThinking)}</div>` : ''}
      </div>`).join('');
    ag.hidden = !live.length;

    const lt = q('#p-last');
    lt.textContent = s.lastText || '';
    lt.hidden = !s.lastText;
    this.renderFiles();
    this.renderCompose(s);
  }

  /**
   * Worked files, newest first: what git status lists for the worktree plus what this session's tools read or
   * edited (the server merges both). A chip opens that file's diff.
   */
  renderFiles() {
    const el = this.el.querySelector<HTMLElement>('#p-files')!;
    const list = (this.session?.files || []).slice(0, 20);
    const html = list.length ? `<h3>작업한 파일</h3><div class="chips">${list.map((f) => `<button type="button" class="chip ${f.edited ? 'edited' : ''}" data-file="${esc(f.path)}" title="${esc(f.path)}&#10;${(f.git && GIT_LABEL[f.git]) || (f.edited ? '이 세션이 편집함 (커밋됨)' : '읽기만 함')}&#10;클릭: diff 보기">${f.git === 'D' ? '🗑️' : f.edited ? '✏️' : '📖'} ${esc(f.name)}</button>`).join('')}</div>` : '';
    if (html !== el.dataset.html) { el.innerHTML = html; el.dataset.html = html; } // redrawn every second: keep hover/focus
  }

  addEntries(entries: LogEntry[]) {
    let added = false;
    for (const e of entries) {
      const key = `${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
      if (this.entries.has(key)) continue;
      this.entries.set(key, e);
      added = true;
    }
    if (added) this.renderLog();
  }

  renderLog() {
    const ul = this.el.querySelector('#p-log')!;
    const list = [...this.entries.values()].sort((a, b) => b.t - a.t).slice(0, 150);
    ul.innerHTML = list.map((e) => {
      const done = e.ev === 'PostToolUse' || e.ev === 'PostToolUseFailure';
      const icon = done ? (e.ev === 'PostToolUse' ? '✓' : '✗') : e.tool ? (ICON[e.tool] || '🔧') : (EV_ICON[e.ev] || '•');
      const dur = done && e.ms ? ` <small>${e.ms >= 1000 ? (e.ms / 1000).toFixed(1) + 's' : e.ms + 'ms'}</small>` : '';
      const head = esc(e.tool ? `${e.tool}${e.target ? ' · ' + e.target : ''}` : e.ev) + dur;
      const cls = e.ev === 'PostToolUseFailure' ? 'err' : e.ev === 'PreToolUse' ? 'pre' : '';
      const detail = e.detail ? `<span class="detail" title="${esc(e.detail)}">${esc(e.detail)}</span>` : '';
      const result = e.result ? `<span class="result" title="${esc(e.result)}">↳ ${esc(e.result)}${e.len! > e.result.length ? ` <small>(${fmtLen(e.len!)})</small>` : ''}</span>` : '';
      return `<li class="${cls}"><time>${fmtTime(e.t)}</time><span class="ic">${icon}</span><span class="head">${head}</span>${e.text ? `<span class="txt">${esc(e.text)}</span>` : ''}${detail}${result}</li>`;
    }).join('');
  }
}

function fmtLen(n: number) { return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}자`; }
function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${sec}초` : `${sec}초`;
}
