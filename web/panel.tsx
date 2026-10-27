// The side panel: one session's details, its subagents, worked files and activity log, and the composer that sends it
// instructions, switches its permission mode and answers its permission requests. Panel holds the state and draws
// it with Preact; the composer is drawn in the reply dialog instead while that is open (setComposerHost).

import { Fragment, h, render as mount } from 'preact';
import { useRef } from 'preact/hooks';
import type { LogEntry, SessionSnapshot } from '../shared/api.ts';
import {
  closeSession,
  decidePermission,
  getLog,
  sendPrompt,
  setMode,
} from './api.ts';
import { openDiff, refreshDiff } from './diff.tsx';
import { confirmQuit } from './quit-confirm.tsx';
import { openReply, refreshReply } from './reply.tsx';
import { FAMILIES, familyOf } from './sprites.ts';
import { css } from './style.ts';
import {
  awaitingBg,
  bgSummary,
  fmtTime,
  isHeadless,
  logIcon,
  MODE_LABEL,
  STATE_COLOR,
  STATE_LABEL,
  thinkingFresh,
  toolText,
} from './ui.ts';

css(/* css */ `
#panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(var(--panel-w), 100vw); z-index: 10;
  background: var(--panel); border-left: 1px solid #2f3352; box-shadow: -10px 0 40px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; overflow: hidden; font-size: 13px;
  /* slide (no layout reflow: office scale is fixed, canvas only translates) */
  transform: translateX(100%); visibility: hidden; transition: transform var(--panel-ms) ease, visibility 0s linear var(--panel-ms);
  &.open { transform: none; visibility: visible; transition: transform var(--panel-ms) ease; }
  @media (prefers-reduced-motion: reduce) { &, &.open { transition: none; } }

  & header { position: relative; padding: 14px 44px 10px 16px; border-bottom: 1px solid #2f3352; }
  & .hd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  & h2 { margin: 0; font-size: 17px; }
  & .title { margin: 6px 0 0; color: var(--dim); font-size: 12px; line-height: 1.4; }
  & .close {
    position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border: 0; border-radius: 6px;
    background: var(--panel-2); color: var(--text); font-size: 18px; cursor: pointer;
    &:hover { background: #343963; }
  }
  & .quit {
    margin-left: auto; font: inherit; font-size: 11.5px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid #4a3a4a; background: transparent; color: #fca5a5;
    &:hover { background: rgba(248,113,113,0.12); }
  }
  & h3 { margin: 12px 16px 6px; font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
  & .scroll { overflow-y: auto; flex: 1; }

  & .meta {
    margin: 0; padding: 10px 16px; display: grid; gap: 5px; border-bottom: 1px solid #2f3352;
    & > div { display: grid; grid-template-columns: 84px 1fr; gap: 8px; }
    & dt { color: var(--dim); }
    & dd { margin: 0; word-break: break-all; }
    & .detail { color: var(--dim); font-size: 12px; margin-top: 2px; word-break: break-all; }
    & .dim { color: var(--dim); }
    & .tier { color: var(--accent); font-weight: 700; margin-left: 4px; }
    & code { font-size: 11px; color: var(--dim); }
    & .add { color: #4ade80; }
    & .del { color: #f87171; }
  }
  & .prompt {
    margin: 10px 16px 0; padding: 8px 10px; border-left: 3px solid var(--accent); background: var(--panel-2); border-radius: 0 8px 8px 0; font-size: 12px; line-height: 1.5; color: var(--text);
    &::before { content: '지시  '; color: var(--accent); font-weight: 700; }
  }
  & .thinking {
    margin: 8px 16px 0; font-size: 12px; line-height: 1.5; color: var(--dim); font-style: italic;
    &::before { content: '💭 '; font-style: normal; }
  }
  & .agents { padding: 8px 16px 0; display: flex; flex-wrap: wrap; gap: 6px; }
  & .agent {
    padding: 6px 8px; border-radius: 6px; background: var(--panel-2); border-left: 3px solid var(--c); font-size: 12px;
    & em { color: var(--c); font-style: normal; margin-left: 4px; }
  }
  & .agent-tool { margin-top: 3px; word-break: break-all; }
  & .agent-task { margin-top: 3px; color: var(--dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  & .agent-think { margin-top: 3px; color: var(--dim); font-style: italic; }
  & .last {
    margin: 10px 16px 0; padding: 8px 10px 20px; background: #fffdf7; color: #1f2233; border-radius: 8px; font-size: 12px; line-height: 1.5;
    cursor: zoom-in; position: relative;
    &::after { content: '⤢ 크게 보기'; position: absolute; right: 8px; bottom: 4px; font-size: 11px; color: #6b7090; }
    &:hover, &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  }
  & .files { padding: 0 16px; }
  & .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  & .chip {
    display: inline-block; padding: 3px 8px; border-radius: 6px; background: var(--panel-2); border-left: 3px solid var(--c); font-size: 12px;
    font: inherit; font-size: 12px; color: inherit; cursor: pointer; text-align: left;
    &.edited { border-left-color: #3b82f6; }
    &:hover, &:focus-visible { filter: brightness(1.25); }
  }

  & .log {
    list-style: none; margin: 0; padding: 0 8px 16px;
    & li { display: grid; grid-template-columns: 58px 20px 1fr; gap: 6px; padding: 5px 8px; border-radius: 6px; align-items: baseline; }
    & li:hover { background: var(--panel-2); }
    & li.pre { opacity: .75; }
    & li.pre .ic { opacity: .6; }
    & li.err .head { color: #f87171; }
    & li.err .result { color: #fca5a5; }
    & time { color: var(--dim); font-variant-numeric: tabular-nums; font-size: 11px; }
    & .head { font-weight: 600; word-break: break-all; }
    & .head small { color: var(--dim); font-weight: 400; margin-left: 4px; }
    & .txt { grid-column: 3; color: var(--dim); font-size: 12px; line-height: 1.4; word-break: break-word; }
    & .detail { grid-column: 3; color: var(--dim); font-size: 11.5px; line-height: 1.4; word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    & .result { grid-column: 3; color: #86efac; font-size: 11.5px; line-height: 1.4; word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    & .result small { color: var(--dim); }
  }
}

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
const MODES: [string, string][] = [
  ['default', '기본'],
  ['acceptEdits', '편집 자동 승인'],
  ['plan', '계획'],
  ['auto', '자동'],
  ['dontAsk', '자동 (dontAsk)'],
  ['bypassPermissions', '자동 (bypass)'],
];
const GIT_LABEL: Record<string, string> = {
  M: '수정됨 (git)',
  A: '추가됨 (git)',
  D: '삭제됨 (git)',
  '?': '새 파일 (아직 git에 없음)',
  R: '이름 바뀜 (git)',
  C: '복사됨 (git)',
  U: '충돌 (git)',
};

type Msg = { text: string; kind: '' | 'ok' | 'err' };

export class Panel {
  el: HTMLElement;
  onOpen?: () => void;
  onClose?: () => void;
  id: string | null = null;
  session: SessionSnapshot | null = null;
  entries = new Map<string, LogEntry>();
  drafts = new Map<string, string>(); // sessionId -> unsent text
  isOpen = false;
  msg: Msg = { text: '', kind: '' };
  sending = false;
  modeBusy = false;
  quitting = false;
  deciding = new Set<string>(); // permission cards answered, buttons off until the session drops them
  composerHost: HTMLElement | null = null; // where the composer is drawn instead of the panel (the reply dialog)

  constructor(
    el: HTMLElement,
    { onOpen, onClose }: { onOpen?: () => void; onClose?: () => void } = {},
  ) {
    this.el = el;
    this.onOpen = onOpen;
    this.onClose = onClose;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const t = e.target as HTMLElement;
      if (t.matches?.('.composer textarea')) {
        t.blur();
        return;
      }
      this.close();
    });
    setInterval(() => {
      if (this.id && this.session) this.render(); // durations tick
    }, 1000);
    this.render();
  }

  async open(session: SessionSnapshot) {
    if (this.id !== session.id) this.msg = { text: '', kind: '' };
    this.id = session.id;
    this.session = session;
    this.entries = new Map();
    if (!this.isOpen) {
      this.isOpen = true;
      this.el.classList.add('open'); // slides in via CSS transition
      this.onOpen?.();
    }
    this.addEntries(session.log || []);
    this.render();
    try {
      const d = await getLog(session.id);
      if (this.id === session.id) {
        this.addEntries(d.log || []);
        this.render();
      }
    } catch {
      /* server restarted — SSE will refill */
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    if (this.el.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.id = null;
    this.session = null;
    this.render();
    this.onClose?.();
  }

  update(session: SessionSnapshot) {
    if (session.id !== this.id) return;
    this.session = session;
    this.addEntries(session.log || []);
    this.render();
    refreshReply(session);
    refreshDiff(session);
  }

  remove(id: string) {
    this.drafts.delete(id);
    if (id === this.id) this.close();
  }

  /** Draw the composer in `host` (the reply dialog borrowing it) instead of the panel; null hands it back. */
  setComposerHost(host: HTMLElement | null) {
    const old = this.composerHost;
    this.composerHost = host;
    if (old && old !== host) mount(null, old);
    this.render();
  }

  setMsg(text: string, kind: Msg['kind'] = '') {
    this.msg = { text, kind };
    this.render();
  }

  render() {
    const s = this.session;
    if (s) {
      // a card the session no longer asks about is done with
      const asked = new Set(cardsOf(s).map((c) => c.id));
      for (const id of this.deciding)
        if (!asked.has(id)) this.deciding.delete(id);
    }
    const composer = s && h(Composer, { s, panel: this });
    mount(
      h(PanelView, {
        s,
        entries: this.entries,
        composer: this.composerHost ? null : composer,
        quitting: this.quitting,
        onClose: () => this.close(),
        onQuit: () => this.quit(),
      }),
      this.el,
    );
    if (this.composerHost) mount(composer, this.composerHost);
  }

  /** Hand the composer text to the session: typed into its Orca terminal, or queued as the next turn of a headless one. */
  async send() {
    const id = this.id,
      text = (id && this.drafts.get(id)?.trim()) || '';
    if (
      !id ||
      !text ||
      this.sending ||
      (this.session?.state === 'waiting' && !isHeadless(this.session))
    )
      return;
    this.sending = true;
    this.setMsg('보내는 중…');
    try {
      await sendPrompt(id, text);
      this.drafts.delete(id);
      if (this.id === id) this.setMsg('전달됨 ✓', 'ok');
    } catch (e) {
      if (this.id === id) this.setMsg((e as Error).message, 'err');
    } finally {
      this.sending = false;
      this.render();
    }
  }

  /** Answer one permission card. It stays (buttons off) until the next session event drops it. */
  async decide(card: string, allow: boolean) {
    const id = this.id;
    if (!id || this.deciding.has(card)) return;
    this.deciding.add(card);
    this.render();
    try {
      await decidePermission(id, card, allow);
    } catch (e) {
      this.deciding.delete(card);
      if (this.id === id) this.setMsg((e as Error).message, 'err');
      else this.render();
    }
  }

  async changeMode(mode: string) {
    const s = this.session;
    if (!s || !mode || this.modeBusy) return;
    const id = s.id;
    this.modeBusy = true;
    this.setMsg(
      isHeadless(s)
        ? '권한 모드 바꾸는 중…'
        : '권한 모드 바꾸는 중… (Shift+Tab)',
    );
    try {
      const r = await setMode(id, mode);
      if (this.id === id)
        this.setMsg(`권한 모드: ${MODE_LABEL[r.mode ?? ''] || r.mode}`, 'ok');
    } catch (e) {
      if (this.id === id) this.setMsg((e as Error).message, 'err');
    } finally {
      this.modeBusy = false;
      const a = document.activeElement as HTMLElement | null;
      if (a?.matches('.composer select')) a.blur(); // let it follow the session again
      this.render();
    }
  }

  /**
   * End the session, once the confirmation dialog says so. Idle → `/exit` (clean SessionEnd, tab stays);
   * anything else → close the Orca terminal outright. Typing `/exit` into a permission dialog could hit
   * its default option, so only an idle prompt gets text.
   */
  async quit() {
    const s = this.session;
    if (!s || s.ended || this.quitting) return;
    const force = s.state !== 'idle';
    if (!(await confirmQuit(s, force))) return;
    this.quitting = true;
    const hl = isHeadless(s);
    this.setMsg(
      force
        ? hl
          ? '프로세스를 끝내는 중…'
          : '터미널을 닫는 중…'
        : '퇴근 지시 중…',
    );
    const id = s.id;
    try {
      await closeSession(id, force);
      if (this.id === id)
        this.setMsg(
          force
            ? hl
              ? '프로세스를 끝냈습니다.'
              : '터미널을 닫았습니다.'
            : '퇴근합니다 👋',
          'ok',
        );
    } catch (e) {
      if (this.id === id) this.setMsg((e as Error).message, 'err');
    } finally {
      this.quitting = false;
      this.render();
    }
  }

  addEntries(entries: LogEntry[]) {
    for (const e of entries) {
      const key = `${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
      if (!this.entries.has(key)) this.entries.set(key, e);
    }
  }
}

// ---- views -----------------------------------------------------------------------------

function PanelView({
  s,
  entries,
  composer,
  quitting,
  onClose,
  onQuit,
}: {
  s: SessionSnapshot | null;
  entries: Map<string, LogEntry>;
  composer: h.JSX.Element | null;
  quitting: boolean;
  onClose: () => void;
  onQuit: () => void;
}) {
  if (!s) return null;
  const now = Date.now();
  const freshThinking = thinkingFresh(s, now) && s.state !== 'idle';
  return (
    <>
      <header>
        <div class="hd">
          <h2>{s.name}</h2>
          <span
            class="badge"
            style={{ background: STATE_COLOR[s.state] || '#888' }}
          >
            {STATE_LABEL[s.state] || s.state}
          </span>
          {!s.ended && (
            <button
              type="button"
              class="quit"
              title="이 세션 종료"
              disabled={quitting}
              onClick={onQuit}
            >
              퇴근
            </button>
          )}
        </div>
        {s.title && <p class="title">{s.title}</p>}
        <button
          type="button"
          class="close"
          title="닫기 (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div class="scroll">
        <Meta s={s} now={now} />
        {s.lastPrompt && <blockquote class="prompt">{s.lastPrompt}</blockquote>}
        {freshThinking && <p class="thinking">{s.lastThinking}</p>}
        <Agents s={s} now={now} />
        {s.lastText && (
          <blockquote
            class="last"
            title="클릭해서 크게 보기"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a card that opens the full reply, styled as a quote
            tabIndex={0}
            onClick={() => openReply(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openReply(s);
              }
            }}
          >
            {s.lastText}
          </blockquote>
        )}
        <Files s={s} />
        <h3>활동 로그</h3>
        <Log entries={entries} />
      </div>
      {composer}
    </>
  );
}

function Meta({ s, now }: { s: SessionSnapshot; now: number }) {
  const fam = FAMILIES[familyOf(s.model)] ?? FAMILIES.other; // familyOf names FAMILIES' keys
  const t = s.currentTool;
  const tool = t ? (
    <>
      <b>{t.name}</b>
      {t.target ? ` · ${t.target}` : ''}{' '}
      <span class="dim">({fmtDur(now - t.startedAt)})</span>
      {t.detail && <div class="detail">{t.detail}</div>}
    </>
  ) : awaitingBg(s) ? (
    `⏳ ${bgSummary(s)}`
  ) : (
    STATE_LABEL[s.state] || '—'
  );
  const turn =
    s.turnStartedAt && s.state !== 'idle'
      ? `툴 ${s.turnTools}회 · ${fmtDur(now - s.turnStartedAt)} 경과`
      : s.turnStartedAt
        ? `마지막 턴: 툴 ${s.turnTools}회`
        : '—';
  const cost = s.cost ? (
    <>
      ${s.cost.usd.toFixed(2)} · <span class="add">+{s.cost.linesAdded}</span> /{' '}
      <span class="del">−{s.cost.linesRemoved}</span> 줄
    </>
  ) : (
    '—'
  );
  const rows: [string, h.JSX.Element | string][] = [
    ['현재 작업', tool],
    ['이번 턴', turn],
    [
      '모델',
      <>
        {s.model || '—'}
        {fam.title && (
          <>
            {' '}
            <span class="tier">{fam.title}</span>
          </>
        )}
      </>,
    ],
    [
      '권한 모드',
      (s.permissionMode && MODE_LABEL[s.permissionMode]) ||
        s.permissionMode ||
        '—',
    ],
    [
      '실행',
      isHeadless(s)
        ? '직접 실행 (claude -p)'
        : s.orcaTerminal
          ? 'Orca 터미널'
          : '—',
    ],
    ['비용 / 변경', cost],
    ['디렉터리', s.cwd || '—'],
    [
      '가동 시간',
      <>
        {fmtDur(now - s.startedAt)}
        {s.pid && <span class="dim"> · PID {s.pid}</span>}
      </>,
    ],
    ['세션', <code>{s.id}</code>],
  ];
  return (
    <dl class="meta">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Agents({ s, now }: { s: SessionSnapshot; now: number }) {
  const live = (s.subagents || []).filter((a) => !a.ended);
  if (!live.length) return null;
  return (
    <div class="agents">
      {live.map((a) => (
        <div
          key={a.agentId}
          class="agent"
          style={`--c:${STATE_COLOR[a.state] || '#888'}`}
        >
          <div class="agent-hd">
            🧢 <b>{a.type || 'agent'}</b>
            {a.description ? ` · ${a.description}` : ''}{' '}
            <em>{STATE_LABEL[a.state] || a.state}</em>{' '}
            <span class="dim">툴 {a.toolCount || 0}회</span>
          </div>
          {a.currentTool && (
            <div class="agent-tool">
              {toolText(a.currentTool)}
              {a.currentTool.detail && (
                <span class="dim"> — {a.currentTool.detail}</span>
              )}
            </div>
          )}
          {a.task && (
            <div class="agent-task" title={a.task}>
              {a.task}
            </div>
          )}
          {thinkingFresh(a, now) && (
            <div class="agent-think">💭 {a.lastThinking}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Worked files, newest first: what git status lists for the worktree plus what this session's tools read or
 * edited (the server merges both). A chip opens that file's diff.
 */
function Files({ s }: { s: SessionSnapshot }) {
  const list = (s.files || []).slice(0, 20);
  if (!list.length) return null;
  return (
    <div class="files">
      <h3>작업한 파일</h3>
      <div class="chips">
        {list.map((f) => (
          <button
            key={f.path}
            type="button"
            class={f.edited ? 'chip edited' : 'chip'}
            title={`${f.path}\n${(f.git && GIT_LABEL[f.git]) || (f.edited ? '이 세션이 편집함 (커밋됨)' : '읽기만 함')}\n클릭: diff 보기`}
            onClick={() => openDiff(s, f.path)}
          >
            {f.git === 'D' ? '🗑️' : f.edited ? '✏️' : '📖'} {f.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Log({ entries }: { entries: Map<string, LogEntry> }) {
  const list = [...entries].sort(([, a], [, b]) => b.t - a.t).slice(0, 150);
  return (
    <ul class="log">
      {list.map(([key, e]) => {
        const done = e.ev === 'PostToolUse' || e.ev === 'PostToolUseFailure';
        const icon = done ? (e.ev === 'PostToolUse' ? '✓' : '✗') : logIcon(e);
        const cls =
          e.ev === 'PostToolUseFailure'
            ? 'err'
            : e.ev === 'PreToolUse'
              ? 'pre'
              : '';
        return (
          <li key={key} class={cls}>
            <time>{fmtTime(e.t)}</time>
            <span class="ic">{icon}</span>
            <span class="head">
              {e.tool ? toolText({ name: e.tool, target: e.target }) : e.ev}
              {done && e.ms ? (
                <>
                  {' '}
                  <small>
                    {e.ms >= 1000
                      ? `${(e.ms / 1000).toFixed(1)}s`
                      : `${e.ms}ms`}
                  </small>
                </>
              ) : null}
            </span>
            {e.text && <span class="txt">{e.text}</span>}
            {e.detail && (
              <span class="detail" title={e.detail}>
                {e.detail}
              </span>
            )}
            {e.result && (
              <span class="result" title={e.result}>
                ↳ {e.result}
                {e.len! > e.result.length && (
                  <>
                    {' '}
                    <small>({fmtLen(e.len!)})</small>
                  </>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A parked headless permission request, or the dialog an Orca / terminal session shows (asking). */
type Card = {
  id: string;
  head: h.JSX.Element;
  detail: string | null;
  answerable: boolean;
  note: string | null;
};

/**
 * One card per parked permission request. An Orca / terminal session's dialog gets a card too: Allow / Deny make the
 * server press the matching key in its terminal (see answerPermission); a question dialog stays read-only.
 */
function cardsOf(s: SessionSnapshot): Card[] {
  if (s.ended) return [];
  const cards: Card[] = (s.pendingPermissions || []).map((p) => ({
    id: p.id,
    head: (
      <>
        <b>{p.tool}</b>
        {p.target ? ` · ${p.target}` : ''}
      </>
    ),
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
        <>
          <b>{ask.tool}</b>
          {ask.target ? ` · ${ask.target}` : ''}
        </>
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

function Composer({ s, panel }: { s: SessionSnapshot; panel: Panel }) {
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
  const follow = !panel.modeBusy && document.activeElement !== sel.current;
  const known = MODES.some(([v]) => v === s.permissionMode);
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        panel.send();
      }}
    >
      {cards.length > 0 && (
        <div class="perms">
          {cards.map((c) => (
            <div key={c.id} class="perm">
              <div class="hd">✋ {c.head}</div>
              {c.detail && <div class="detail">{c.detail}</div>}
              {c.answerable && (
                <div class="row">
                  <button
                    type="button"
                    class="primary"
                    disabled={panel.deciding.has(c.id)}
                    onClick={() => panel.decide(c.id, true)}
                  >
                    허용
                  </button>
                  <button
                    type="button"
                    disabled={panel.deciding.has(c.id)}
                    onClick={() => panel.decide(c.id, false)}
                  >
                    거부
                  </button>
                </div>
              )}
              {c.note && <div class="note">{c.note}</div>}
            </div>
          ))}
        </div>
      )}
      <textarea
        rows={2}
        value={panel.drafts.get(s.id) ?? ''}
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
        onInput={(e) => {
          panel.drafts.set(s.id, e.currentTarget.value);
          panel.render();
        }}
        onKeyDown={(e) => {
          // isComposing: Enter that commits a Hangul syllable must not send.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            panel.send();
          }
        }}
      />
      <div class="row">
        {!off && (
          <select
            ref={sel}
            title="권한 모드 바꾸기 (Orca 터미널은 Shift+Tab으로 전환)"
            disabled={panel.modeBusy || waiting}
            value={follow ? (known ? s.permissionMode! : '') : undefined}
            onChange={(e) => panel.changeMode(e.currentTarget.value)}
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
        <span class={`msg ${panel.msg.kind}`}>{panel.msg.text}</span>
        <button
          type="submit"
          class="primary"
          disabled={off || waiting || panel.sending}
        >
          보내기
        </button>
      </div>
    </form>
  );
}

function fmtLen(n: number) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}자`;
}
function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hr = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return hr ? `${hr}시간 ${m}분` : m ? `${m}분 ${sec}초` : `${sec}초`;
}
