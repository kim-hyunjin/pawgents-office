import { execFile } from 'node:child_process';
import path from 'node:path';
import { codedError, errMessage } from '../../shared/errors.ts';
import { isPidAlive } from '../../shared/node/process.ts';
import { sleep } from '../../shared/time.ts';
import type { Backend, ProbeResult } from '../app/ports.ts';
import { BACKEND_PROBE_TTL_MS, ORCA_BIN } from '../config.ts';
import { slashPath } from '../infra/path.ts';
import type { Store } from '../store.ts';
import type { Session } from '../types.ts';

const ORCA_TIMEOUT_MS = 15_000; // an ordinary `orca … --json` call
const ORCA_PROBE_TIMEOUT_MS = 5000; // the availability probe: /backends waits on it
const ORCA_MAX_BUFFER = 8 * 1024 * 1024;
const LAUNCH_TIMEOUT_MS = 60_000; // `agent launch` opens a tab and starts claude
const CREATE_WORKTREE_TIMEOUT_MS = 180_000; // `worktree create` checks out a tree and runs the repo's setup
const DIALOG_CLOSE_WAIT_MS = 3000; // after the answer key, the dialog must change within this
const DIALOG_POLL_MS = 150;
const EXIT_WAIT_MS = 30_000; // after `/exit`, how long a launched tab waits for claude to go before it is left open
const EXIT_POLL_MS = 1000;

/** Per-instance state the functions below share: the store, and the tabs this server run opened. */
interface Ctx {
  store: Store;
  launched: Set<string>; // terminal handles opened by a launch (this server run)
}

/** `orca ... --json` output: `result` on success (its shape depends on the subcommand), `error` otherwise. */
interface OrcaReply {
  ok?: boolean;
  result?: unknown;
  error?: { message?: string; code?: string };
}
/** One `orca worktree list` entry (the fields read here). */
interface OrcaWorktree {
  id: string;
  repoId?: string;
  head?: string;
  path?: string;
  displayName?: string;
  branch?: string;
  lastActivityAt?: number;
  isArchived?: boolean;
}
/** A launcher row made from an Orca worktree. */
export interface OrcaWorktreeRow {
  id: string;
  repoId: string;
  head: string;
  path: string;
  repo: string;
  name: string;
  branch: string;
  lastActivityAt: number;
}
/** `orca terminal send`: whether the text went in, when it says so. */
export interface SendResult {
  accepted?: boolean;
}
interface Terminal {
  handle: string;
  agentIdentity?: string;
  connected?: boolean;
  writable?: boolean;
  worktreePath: string;
  title?: string;
}
interface Dialog {
  question: string;
  options: { n: number; label: string }[];
}
interface WorktreeBase {
  id: string;
  repoId: string;
  branch?: string;
  head: string;
}

/** Run `orca <args> --json` and return `result`. Throws Error(message) with `.code` on failure. */
function runOrca<T = unknown>(
  args: string[],
  { timeoutMs = ORCA_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    // No shell: user text goes through argv untouched (orca.cmd would let cmd.exe reparse it).
    execFile(
      ORCA_BIN,
      [...args, '--json'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: ORCA_MAX_BUFFER },
      (err, stdout, stderr) => {
        let out: OrcaReply | null = null;
        try {
          out = JSON.parse(stdout);
        } catch {
          /* not json */
        }
        if (out?.ok) {
          resolve(out.result as T);
          return;
        }
        reject(
          codedError(
            out?.error?.message ||
              ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
                ? `orca CLI를 찾을 수 없습니다 (${ORCA_BIN})`
                : String(stderr || err?.message || 'orca failed')
                    .trim()
                    .slice(0, 300)),
            out?.error?.code ||
              (err as NodeJS.ErrnoException | null)?.code ||
              'orca_failed',
          ),
        );
      },
    );
  });
}

/** Is the Orca CLI installed and its app reachable? */
async function probeOrca(): Promise<ProbeResult> {
  try {
    await runOrca(['worktree', 'list'], { timeoutMs: ORCA_PROBE_TIMEOUT_MS });
    return { available: true };
  } catch (e) {
    return { available: false, reason: errMessage(e) };
  }
}

/** Lowercased on every platform (unlike normalizePath, which folds case only on Windows). */
const norm = (p: unknown) => slashPath(p).toLowerCase();
const normTitle = (t: unknown) =>
  String(t || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const within = (dir: unknown, root: unknown) => {
  const d = norm(dir),
    r = norm(root);
  return !!r && (d === r || d.startsWith(r + '/'));
};

// ---- terminal I/O --------------------------------------------------------------------------------------------------
/** Type `text` into a terminal; `enter` submits it. */
const sendText = (handle: string, text: string, { enter = false } = {}) =>
  runOrca<SendResult | null>([
    'terminal',
    'send',
    '--terminal',
    handle,
    '--text',
    text,
    ...(enter ? ['--enter'] : []),
  ]);
const closeTerminal = (handle: string) =>
  runOrca(['terminal', 'close', '--terminal', handle]);
/** The rendered screen's last lines. */
async function readScreen(handle: string): Promise<string[]> {
  const r = await runOrca<{ terminal?: { tail?: string[] } } | null>([
    'terminal',
    'read',
    '--terminal',
    handle,
    '--screen',
  ]);
  return r?.terminal?.tail || [];
}

async function listTerminals(): Promise<Terminal[]> {
  const r = await runOrca<{ terminals?: Terminal[] }>(['terminal', 'list']);
  return r.terminals || [];
}

export async function listWorktrees(): Promise<OrcaWorktreeRow[]> {
  const r = await runOrca<{ worktrees?: OrcaWorktree[] }>(['worktree', 'list']);
  return (r.worktrees || [])
    .filter(
      (w): w is OrcaWorktree & { path: string } => !w.isArchived && !!w.path,
    )
    .map((w) => ({
      id: w.id,
      repoId: w.repoId || String(w.id).replace(/::[\s\S]*$/, ''), // `<repoId>::<path>`
      head: w.head || '',
      path: w.path,
      repo: path.basename(w.path),
      name: w.displayName || '',
      branch: String(w.branch || '').replace(/^refs\/heads\//, ''),
      lastActivityAt: w.lastActivityAt || 0,
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Find the Orca terminal that runs session `s`. Hook-reported handle wins; otherwise
 * guess from the single live claude terminal whose worktree contains the session cwd,
 * breaking a tie by the tab title (Orca shows the claude session title there).
 */
async function resolveTerminal(store: Store, s: Session): Promise<Terminal> {
  const terms = await listTerminals();
  if (s.orcaTerminal) {
    const t = terms.find((x) => x.handle === s.orcaTerminal);
    if (t) return t;
  }
  const claimed = new Set<string>();
  for (const o of store.sessions.values())
    if (o !== s && !o.ended && o.orcaTerminal) claimed.add(o.orcaTerminal);
  const cands = terms.filter(
    (t) =>
      t.agentIdentity === 'claude' &&
      t.connected &&
      t.writable &&
      !claimed.has(t.handle) &&
      within(s.cwd, t.worktreePath),
  );
  const rivals = [...store.sessions.values()].filter(
    (o) =>
      o !== s &&
      !o.ended &&
      !o.orcaTerminal &&
      cands.some((t) => within(o.cwd, t.worktreePath)),
  );
  const [only] = cands;
  if (only && cands.length === 1 && !rivals.length) return only;
  const title = normTitle(s.title);
  if (title && cands.length) {
    const hits = cands.filter((t) => normTitle(t.title) === title);
    const twin = [...store.sessions.values()].some(
      (o) => o !== s && !o.ended && normTitle(o.title) === title,
    );
    const [hit] = hits;
    if (hit && hits.length === 1 && !twin) return hit;
  }
  throw codedError(
    cands.length
      ? `이 세션의 Orca 터미널을 특정할 수 없습니다 (같은 worktree의 claude 탭 ${cands.length}개, 제목 일치 없음). 플러그인 설치 후 시작한 세션이면 프롬프트를 한 번 보내면 연결됩니다.`
      : 'Orca 터미널에서 실행 중인 세션이 아닙니다.',
    'terminal_not_found',
  );
}

/** resolveTerminal, remembered on the session (so later calls and a server restart find it directly). */
async function boundTerminal(store: Store, s: Session) {
  const t = await resolveTerminal(store, s);
  store.bindTerminal(s, t.handle);
  return t;
}

async function sendPrompt(store: Store, s: Session, text: string) {
  const t = await resolveTerminal(store, s);
  if (t.agentIdentity && t.agentIdentity !== 'claude') {
    throw codedError(
      `이 터미널은 claude가 아닌 ${t.agentIdentity}를 실행 중입니다.`,
      'not_claude',
    );
  }
  store.bindTerminal(s, t.handle);
  return sendText(t.handle, text, { enter: true });
}

/**
 * End session `s`. Default types `/exit` (clean SessionEnd; the tab stays). `force` closes the
 * Orca terminal, killing whatever runs there — the only safe option when the TUI isn't at its prompt.
 */
async function closeSession(
  { store, launched }: Ctx,
  s: Session,
  { force = false }: { force?: boolean } = {},
) {
  const t = await boundTerminal(store, s);
  if (force) {
    launched.delete(t.handle);
    return closeTerminal(t.handle);
  }
  const r = await sendText(t.handle, '/exit', { enter: true });
  // A tab we opened has nothing left once claude exits; a user's own tab keeps its shell.
  if (launched.has(t.handle)) closeAfterExit(launched, s, t.handle);
  return r;
}

// ---- permission mode (Shift+Tab in the TUI) --------------------------------------------------------------------
// The TUI only cycles modes with Shift+Tab, and no hook fires on a switch, so we read the mode off the rendered footer
// (the line under the input box) and press until it shows the one asked for.
const SHIFT_TAB = '\x1b[Z';
const MODE_PRESSES = 6,
  MODE_SETTLE_MS = 1500,
  MODE_POLL_MS = 150;
const FOOTER_MODES: [RegExp, string][] = [
  [/accept edits on/i, 'acceptEdits'],
  [/plan mode on/i, 'plan'],
  [/auto mode on/i, 'auto'],
  [/bypass permissions on/i, 'bypassPermissions'],
  [/don.?t ask (mode )?on/i, 'dontAsk'],
  [/manual mode on/i, 'default'], // newer TUIs name default "manual"
];
const isBorder = (line: string) => /^\s*[─━-]{20,}\s*$/.test(line);

/** The mode the TUI footer shows: a mode key, 'default' (no mode line), or null when no input box is on screen. */
export function footerMode(lines: string[]): string | null {
  const tail = lines.slice(-12);
  const b = tail.findLastIndex(isBorder);
  if (b < 0) return null; // a menu, dialog or something else owns the screen
  const footer = tail.slice(b + 1).join('\n');
  for (const [re, mode] of FOOTER_MODES) if (re.test(footer)) return mode;
  return 'default';
}

const screenMode = async (handle: string) =>
  footerMode(await readScreen(handle));

async function setMode(store: Store, s: Session, mode: string) {
  // dontAsk is never in the Shift+Tab cycle: refuse before pressing anything (cycling would leave some other mode on)
  if (mode === 'dontAsk' && s.permissionMode !== mode)
    throw codedError(
      'dontAsk 모드는 터미널에서 Shift+Tab으로 켤 수 없습니다. claude --permission-mode dontAsk 로 시작해야 합니다.',
      'mode_refused',
    );
  if (s.state === 'waiting')
    throw codedError(
      '권한 승인·질문 응답을 기다리는 중입니다. Shift+Tab이 다이얼로그에 들어갈 수 있어 터미널에서 먼저 답해주세요.',
      'waiting',
    );
  const t = await boundTerminal(store, s);
  let cur = await screenMode(t.handle);
  const seen: string[] = [];
  for (let i = 0; ; i++) {
    if (!cur)
      throw codedError(
        '터미널 화면에서 Claude 입력창을 찾지 못했습니다. 메뉴나 다이얼로그가 열려 있으면 닫고 다시 시도해주세요.',
        'mode_unknown',
      );
    if (cur === mode) break;
    if (seen.includes(cur) || i >= MODE_PRESSES) {
      throw codedError(
        `이 세션의 Shift+Tab 순환에 '${mode}' 모드가 없습니다 (순환: ${seen.join(' → ')}).`,
        'mode_refused',
      );
    }
    seen.push(cur);
    await sendText(t.handle, SHIFT_TAB);
    const prev = cur,
      end = Date.now() + MODE_SETTLE_MS;
    do {
      await sleep(MODE_POLL_MS);
      cur = await screenMode(t.handle);
    } while (cur === prev && Date.now() < end);
  }
  s.permissionMode = mode;
  return { mode };
}

// ---- answering a permission dialog (a digit key, picked off the rendered dialog) ---------------------------------
// The dialog lists numbered options ("1. Yes" … "3. No") and a digit selects one at once. The numbers and the list differ per
// tool (2 or 3 options, "No, and tell Claude what to do differently"), so never send a fixed key: read the screen, find the
// option whose label is exactly "Yes" (once, not "Yes, and always …") or starts with "No", and press that number.
const OPTION_RE = /^\s*(?:❯\s*)?(\d{1,2})\.\s+(\S.*?)\s*$/;
const DIALOG_FOOTER_RE = /^\s*(Esc to cancel|Enter to select)\b/i;

/** The numbered option list ending the screen: { question, options: [{ n, label }] }, or null when there is none. */
export function parseDialog(lines: string[]): Dialog | null {
  const line = (k: number) => lines[k] ?? ''; // only called with 0 <= k < lines.length
  let end = lines.length;
  while (
    end > 0 &&
    (!line(end - 1).trim() || DIALOG_FOOTER_RE.test(line(end - 1)))
  )
    end--;
  const options: Dialog['options'] = [];
  let i = end - 1;
  for (; i >= 0; i--) {
    const m = OPTION_RE.exec(line(i));
    if (m) {
      const [, n = '', label = ''] = m;
      options.unshift({ n: Number(n), label });
      if (n === '1') {
        i--;
        break;
      }
      continue;
    }
    if (/^\s{4,}\S/.test(line(i))) continue; // a wrapped label or an option's description
    break;
  }
  if (options[0]?.n !== 1 || options.some((o, k) => o.n !== k + 1)) return null;
  while (i >= 0 && !line(i).trim()) i--;
  return { question: i >= 0 ? line(i).trim() : '', options };
}

/** The key that answers the dialog, or null when it has no plain Yes / No (unknown dialog: leave it to the user). */
export function pickOption(
  dialog: Dialog | null,
  allow: boolean,
): number | null {
  const o = dialog?.options.find((x) =>
    allow ? x.label === 'Yes' : /^No\b/.test(x.label),
  );
  return o && o.n <= 9 ? o.n : null;
}

const dialogKey = (d: Dialog | null) =>
  d ? `${d.question}|${d.options.map((o) => o.label).join('|')}` : '';
const screenDialog = async (handle: string) =>
  parseDialog(await readScreen(handle));

/**
 * Allow or deny the permission dialog that session `s`'s terminal shows. `ref` is the `asking.at` of the card the user
 * clicked: an answer for a request that has since changed is refused rather than applied to the next one.
 */
async function answerPermission(
  store: Store,
  s: Session,
  allow: boolean,
  ref: unknown,
) {
  const a = s.asking;
  if (s.state !== 'waiting' || !a || String(a.at) !== String(ref))
    throw codedError('이미 처리되었거나 바뀐 요청입니다.', 'stale');
  if (!a.tool || a.tool === 'AskUserQuestion')
    throw codedError(
      '질문·선택 다이얼로그는 터미널에서 직접 답해주세요.',
      'dialog_unknown',
    );
  const t = await boundTerminal(store, s);
  const dialog = await screenDialog(t.handle);
  const n = pickOption(dialog, allow);
  if (!n)
    throw codedError(
      `터미널 화면에서 '${allow ? 'Yes' : 'No'}' 선택지를 찾지 못했습니다. 터미널에서 직접 답해주세요.`,
      'dialog_unknown',
    );
  await sendText(t.handle, String(n));
  const sig = dialogKey(dialog);
  for (const end = Date.now() + DIALOG_CLOSE_WAIT_MS; Date.now() < end; ) {
    await sleep(DIALOG_POLL_MS);
    if (dialogKey(await screenDialog(t.handle)) !== sig) {
      // gone, or the next call's dialog
      store.log(s, {
        ev: 'Notification',
        text: `사무실에서 ${allow ? '허용' : '거부'}: ${a.tool}${a.target ? ' · ' + a.target : ''}`,
      });
      return { allowed: allow };
    }
  }
  throw codedError(
    '키를 보냈지만 다이얼로그가 닫히지 않았습니다. 터미널을 확인해주세요.',
    'dialog_unknown',
  );
}

function closeAfterExit(launched: Set<string>, s: Session, handle: string) {
  const deadline = Date.now() + EXIT_WAIT_MS;
  const tick = () => {
    if (s.pid && isPidAlive(s.pid) && Date.now() < deadline) {
      setTimeout(tick, EXIT_POLL_MS);
      return;
    }
    if (s.pid && isPidAlive(s.pid)) return; // didn't exit; leave the tab alone
    launched.delete(handle);
    closeTerminal(handle).catch((e) =>
      console.error('[orca] close tab:', errMessage(e)),
    );
  };
  setTimeout(tick, EXIT_POLL_MS);
}

/** The terminal handle an Orca launch opened, wherever the result nests it ({ kind: 'terminal', handle }). */
function launchedHandle(r: unknown, depth = 0): string | null {
  if (!r || typeof r !== 'object' || depth > 4) return null;
  const o = r as { kind?: unknown; handle?: unknown };
  if (o.kind === 'terminal' && typeof o.handle === 'string') return o.handle;
  for (const v of Object.values(r)) {
    const h = launchedHandle(v, depth + 1);
    if (h) return h;
  }
  return null;
}

/** `--prompt` / `--model` for a launch, when given. */
const promptAndModelArgs = (prompt?: string | null, model?: string | null) => [
  ...(prompt ? ['--prompt', prompt] : []),
  ...(model ? ['--model', model] : []),
];

/** Run an Orca launch and remember the tab it opened, so closing that session can close the tab too. */
async function launchTracked(
  launched: Set<string>,
  args: string[],
  timeoutMs: number,
) {
  const r = await runOrca(args, { timeoutMs });
  const h = launchedHandle(r);
  if (h) launched.add(h);
  return r;
}

export interface LaunchClaude {
  worktreeId: string;
  prompt?: string | null;
  model?: string | null;
}
function launchClaude(
  launched: Set<string>,
  { worktreeId, prompt, model }: LaunchClaude,
) {
  const args = [
    'agent',
    'launch',
    '--agent',
    'claude',
    '--worktree',
    `id:${worktreeId}`,
    ...promptAndModelArgs(prompt, model),
  ];
  return launchTracked(launched, args, LAUNCH_TIMEOUT_MS);
}

export interface CreateWorktree {
  base: WorktreeBase;
  name: string;
  prompt?: string | null;
  model?: string | null;
}
/**
 * New worktree branched from `base` (its branch, or its commit when detached), recorded as its child,
 * with claude started in the first terminal. Repo setup hooks follow the repo's own policy.
 */
function createWorktreeWithClaude(
  launched: Set<string>,
  { base, name, prompt, model }: CreateWorktree,
) {
  const args = [
    'worktree',
    'create',
    '--name',
    name,
    '--repo',
    `id:${base.repoId}`,
    '--base-branch',
    base.branch || base.head,
    '--parent-worktree',
    `worktree:${base.id}`,
    '--agent',
    'claude',
    ...promptAndModelArgs(prompt, model),
  ];
  return launchTracked(launched, args, CREATE_WORKTREE_TIMEOUT_MS);
}

// ---- the backend ---------------------------------------------------------------------------------------------------
export interface OrcaBackend extends Backend {
  readonly id: 'orca';
  listWorktrees(): Promise<OrcaWorktreeRow[]>;
  /** Start claude in an existing worktree's new tab. */
  launchClaude(o: LaunchClaude): Promise<unknown>;
  createWorktreeWithClaude(o: CreateWorktree): Promise<unknown>;
}

export function createOrcaBackend({ store }: { store: Store }): OrcaBackend {
  const ctx: Ctx = { store, launched: new Set() };
  let probed: { at: number; result: ProbeResult } | null = null; // `orca worktree list` per hit would stall every /backends call

  return {
    id: 'orca',
    /** Cached for BACKEND_PROBE_TTL_MS. */
    async probe() {
      if (probed && Date.now() - probed.at < BACKEND_PROBE_TTL_MS)
        return probed.result;
      const result = await probeOrca();
      probed = { at: Date.now(), result };
      return result;
    },
    owns: (s) => s.backend == null || s.backend === 'orca', // a terminal session we don't launch is driven through Orca too
    ensureAttached: () => {}, // found per call (resolveTerminal), nothing to attach
    // a permission/question dialog would take our Enter as its default answer
    canPromptWhile: (state) => state !== 'waiting',
    sendPrompt: async (s, text) => (await sendPrompt(store, s, text)) ?? {},
    close: (s, { force }) => closeSession(ctx, s, { force }),
    setMode: (s, mode) => setMode(store, s, mode),
    /** Press the dialog's Yes / No in the session's terminal; `id` is the `asking.at` of the card clicked. */
    async answerPermission(s, id, allow) {
      await store.updateSession(s, async () => {
        await answerPermission(store, s, allow, id);
      });
      return `${s.asking?.tool || '?'} (terminal)`;
    },
    parkPermission: () => null, // terminal dialogs are answered on screen (answerPermission), never held
    listWorktrees,
    launchClaude: (o) => launchClaude(ctx.launched, o),
    createWorktreeWithClaude: (o) => createWorktreeWithClaude(ctx.launched, o),
  };
}
