// The panel's view of a session: header (name, state, 퇴근, ×), details, subagents, its last answer, worked files and
// activity log. The composer goes under it (composer.tsx).

import { Fragment, h, type JSX } from 'preact';
import type { LogEntry, SessionSnapshot } from '../../../shared/api.ts';
import { CloseButton, StateBadge, ToolName } from '../../common/bits.tsx';
import { css } from '../../common/style.ts';
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
} from '../../common/ui.ts';
import { familyInfo } from '../../scene/sprites.ts';

css(/* css */ `
#panel {
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
`);

const GIT_LABEL: Record<string, string> = {
  M: '수정됨 (git)',
  A: '추가됨 (git)',
  D: '삭제됨 (git)',
  '?': '새 파일 (아직 git에 없음)',
  R: '이름 바뀜 (git)',
  C: '복사됨 (git)',
  U: '충돌 (git)',
};

export function PanelView({
  s,
  entries,
  composer,
  quitting,
  onClose,
  onQuit,
  onReply,
  onDiff,
}: {
  s: SessionSnapshot;
  entries: Map<string, LogEntry>;
  composer: JSX.Element | null;
  quitting: boolean;
  onClose: () => void;
  onQuit: () => void;
  /** Open the last answer in full. */
  onReply: () => void;
  /** Open that file's diff. */
  onDiff: (file: string) => void;
}) {
  const now = Date.now();
  const freshThinking = thinkingFresh(s, now) && s.state !== 'idle';
  return (
    <>
      <header>
        <div class="hd">
          <h2>{s.name}</h2>
          <StateBadge state={s.state} />
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
        <CloseButton onClick={onClose} />
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
            onClick={onReply}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onReply();
              }
            }}
          >
            {s.lastText}
          </blockquote>
        )}
        <Files s={s} onDiff={onDiff} />
        <h3>활동 로그</h3>
        <Log entries={entries} />
      </div>
      {composer}
    </>
  );
}

function Meta({ s, now }: { s: SessionSnapshot; now: number }) {
  const fam = familyInfo(s.model);
  const t = s.currentTool;
  const tool = t ? (
    <>
      <ToolName name={t.name} target={t.target} />{' '}
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
  const rows: [string, JSX.Element | string][] = [
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
function Files({
  s,
  onDiff,
}: {
  s: SessionSnapshot;
  onDiff: (file: string) => void;
}) {
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
            onClick={() => onDiff(f.path)}
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
