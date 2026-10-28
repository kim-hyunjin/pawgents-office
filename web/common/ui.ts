// Small DOM and formatting helpers shared by the office, its panels and dialogs, and the words, colors and icons
// every view uses for a session (state, permission mode, tools, background work).

import type {
  Backend,
  CurrentTool,
  EntityState,
  LogEntry,
  SessionSnapshot,
} from '../../shared/api.ts';
import { isBusyState } from '../../shared/model.ts';
import type { Sprite } from '../scene/sprites.ts';
import { spriteSize } from '../scene/sprites.ts';

/** getElementById for an element index.html is known to have. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c); // the pattern matches only ENTITIES' keys
export const fmtTime = (t: number | string | Date) =>
  new Date(t).toTimeString().slice(0, 8);
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {
    href: url,
    download: filename,
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A drawable (sprite frame or skin frame) on a canvas, sized by its world size × zoom (uploaded skins carry a scale). */
export function pic(
  img: Sprite | HTMLCanvasElement | ImageBitmap,
  zoom = 1,
  canvas = document.createElement('canvas'),
) {
  const { w, h } = spriteSize(img);
  canvas.width = Math.round(w * zoom);
  canvas.height = Math.round(h * zoom);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A one-line status message under a form: plain, ok (green) or err (red). */
export type Msg = { text: string; kind: '' | 'ok' | 'err' };
export const NO_MSG: Msg = { text: '', kind: '' };

// localStorage that never throws (blocked storage, private mode). Keys stay as they are: renaming one resets a setting.
export const storage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | number) {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      /* storage blocked */
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
  },
};

// ---- session display vocabulary ---------------------------------------------------
export const STATE_LABEL: Record<EntityState, string> = {
  idle: '대기',
  thinking: '생각 중',
  reading: '읽는 중',
  coding: '코딩 중',
  terminal: '터미널',
  searching: '검색 중',
  delegating: '위임 중',
  working: '작업 중',
  waiting: '응답 대기',
  offduty: '퇴근',
};
export const STATE_COLOR: Record<EntityState, string> = {
  idle: '#8e9aaf',
  thinking: '#a78bfa',
  reading: '#60a5fa',
  coding: '#3b82f6',
  terminal: '#22c55e',
  searching: '#06b6d4',
  delegating: '#f59e0b',
  working: '#e5e7eb',
  waiting: '#fbbf24',
  offduty: '#6b7280',
};
/** Permission modes, in the order the panel offers them, and their names. */
export const MODES: readonly (readonly [string, string])[] = [
  ['default', '기본'],
  ['acceptEdits', '편집 자동 승인'],
  ['plan', '계획'],
  ['auto', '자동'],
  ['dontAsk', '자동 (dontAsk)'],
  ['bypassPermissions', '자동 (bypass)'],
];
export const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES);
const ICON: Record<string, string> = {
  Read: '📖',
  Grep: '🔍',
  Glob: '🔍',
  LS: '📂',
  Edit: '✏️',
  Write: '✏️',
  MultiEdit: '✏️',
  NotebookEdit: '✏️',
  Bash: '💻',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Agent: '🤝',
  Task: '🤝',
  AskUserQuestion: '❓',
  Skill: '🧩',
  TodoWrite: '📝',
};
const EV_ICON: Record<string, string> = {
  SessionStart: '🚪',
  SessionEnd: '🚪',
  UserPromptSubmit: '🗣️',
  Stop: '💬',
  PermissionRequest: '✋',
  Notification: '🔔',
  SubagentStart: '🧢',
  SubagentStop: '🧢',
  PostToolUseFailure: '⚠️',
  PreModelSwitch: '🔁',
  PostModelSwitch: '🔁',
};

/** A log line's icon: its tool's (🔧 for one we don't know), else its event's. */
export const logIcon = (e: Pick<LogEntry, 'tool' | 'ev'>) =>
  e.tool ? ICON[e.tool] || '🔧' : EV_ICON[e.ev] || '•';
/** "Edit · office.ts": a tool call as one line of plain text. */
export const toolText = (
  t: Pick<CurrentTool, 'name'> & { target?: string | null },
) => `${t.name}${t.target ? ' · ' + t.target : ''}`;
/** Thinking text recent enough to show (3 min); most callers also hide it once the session is idle. */
export const thinkingFresh = (
  d: { lastThinking: string | null; lastThinkingAt: number },
  now: number,
) => !!d.lastThinking && now - d.lastThinkingAt < 3 * 60_000;

/** A `claude -p` session behind the office's own runner (no Orca terminal). */
export const isHeadless = (s?: { backend?: Backend | null } | null) =>
  s?.backend === 'headless';
/** 퇴근 button tooltip: what a click will do to this session — busy means the forced close. */
export function quitTitle(s: { backend?: Backend | null }, busy: boolean) {
  if (isHeadless(s))
    return busy
      ? '지금 턴을 끊고 프로세스를 종료합니다'
      : '입력을 닫아 세션을 끝냅니다 (SessionEnd 실행)';
  return busy
    ? 'Orca 터미널 탭을 닫아 진행 중인 작업을 끊습니다'
    : '/exit 로 세션을 끝냅니다';
}

/** What a session that isn't idle is doing, for the 퇴근 question: working, or waiting on you. */
export const busyLabel = (state: EntityState) =>
  isBusyState(state) ? '작업 중' : '응답 대기 중';

/** Turn ended, but background work (a shell, a monitor…) will wake the session again. */
export function awaitingBg(
  s: Pick<SessionSnapshot, 'state' | 'bgTasks' | 'awaitingShell'>,
) {
  return s.state === 'idle' && (s.bgTasks?.length > 0 || !!s.awaitingShell);
}

/** "백그라운드 작업 대기 · npm test 외 1개" — what an idle session is waiting on. */
export function bgSummary(s: Pick<SessionSnapshot, 'bgTasks'>) {
  const tasks = s.bgTasks || [];
  if (!tasks.length) return '백그라운드 셸 결과 대기';
  const [t] = tasks;
  if (!t) return '백그라운드 셸 결과 대기';
  const what = t.command || t.description || t.type || '작업';
  return `백그라운드 작업 대기 · ${what}${tasks.length > 1 ? ` 외 ${tasks.length - 1}개` : ''}`;
}
