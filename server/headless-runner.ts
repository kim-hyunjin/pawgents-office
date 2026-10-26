// Per-session runner for the headless backend: `bun server/headless-runner.ts <specJson>`, spawned detached by the server.
// Why a separate process: it owns claude's stdin, so the session survives office-server restarts (the server just
// reconnects through run/<sid>.json + the local socket). If this runner dies, claude's stdin closes and it ends after its turn.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import type { Msg } from './backends/protocol.ts';
import {
  buildClaudeArgs,
  encode,
  feed,
  newFeed,
  parseClaudeLine,
  parseCommand,
  parseRunnerArgv,
  pipePath,
  runFile,
  setModeLine,
  shellQuote,
  userMessageLine,
} from './backends/protocol.ts';
import { RUN_DIR } from './config.ts';

const RECENT_MAX = 30,
  STDERR_MAX = 20,
  KILL_STEP_MS = 3000,
  FLUSH_MS = 300;
const NO_CLIENT_GRACE_MS = 5000; // claude died before anyone connected (bad login, bad flag): keep the socket up so the launcher still learns why

const spec = parseRunnerArgv(process.argv.slice(2));
const { sid, cwd, model, permissionMode, version } = spec;
const pipe = pipePath(sid),
  runPath = runFile(sid),
  startedAt = Date.now();
const isWin = process.platform === 'win32';
fs.mkdirSync(RUN_DIR, { recursive: true });
if (!isWin)
  try {
    fs.unlinkSync(pipe);
  } catch {} // stale socket from a crashed runner

const q = (a: string) => shellQuote(spec.claude, a);
const child = spawn(
  q(spec.claude.file),
  [...spec.claude.prefix, ...buildClaudeArgs(spec)].map(q),
  {
    cwd,
    stdio: 'pipe',
    windowsHide: true,
    shell: spec.claude.shell,
  },
);

const clients = new Set<net.Socket>(),
  recent: Msg[] = [],
  stderrTail: string[] = [];
let exited: { code: number | null; signal: NodeJS.Signals | null } | null =
    null,
  stdinEnded = false,
  everConnected = false,
  finishing = false;
const control = new Map(); // control request id -> socket that asked (its ack waits for claude's control_response)
let controlSeq = 0;
const send = (sock: net.Socket, msg: Msg) => {
  try {
    sock.write(encode(msg));
  } catch {}
};
const broadcast = (msg: Msg) => {
  for (const c of clients) send(c, msg);
};
const event = (ev: Msg) => {
  recent.push(ev);
  if (recent.length > RECENT_MAX) recent.shift();
  broadcast({ type: 'event', ...ev });
};

const out = newFeed();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) =>
  feed(out, d, (o) => {
    const ev = parseClaudeLine(o);
    if (ev?.kind === 'control') {
      // an answer to one client, not an event for everyone
      const sock = control.get(ev.requestId);
      if (!sock) return;
      control.delete(ev.requestId);
      return send(sock, {
        type: 'ack',
        for: 'mode',
        ok: ev.ok,
        error: ev.error ?? undefined,
        code: ev.errorCode ?? undefined,
      });
    }
    if (ev) event(ev);
  }),
);
let errRem = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  const lines = (errRem + d).split(/\r?\n/);
  errRem = lines.pop()!.slice(-4096);
  for (const raw of lines) {
    const line = raw.slice(0, 2000);
    if (!line.trim()) continue;
    stderrTail.push(line);
    if (stderrTail.length > STDERR_MAX) stderrTail.shift();
    event({ kind: 'stderr', line });
  }
});
child.stdin.on('error', () => {
  stdinEnded = true;
}); // EPIPE once claude is gone

function killChild() {
  if (exited || !child.pid) return;
  if (isWin) {
    execFile(
      'taskkill',
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true },
      () => {},
    );
    return;
  }
  // SIGINT ends the turn, SIGTERM runs SessionEnd hooks, SIGKILL is the backstop
  const steps: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGKILL'];
  const next = () => {
    if (exited || !steps.length) return;
    try {
      child.kill(steps.shift()!);
    } catch {}
    setTimeout(next, KILL_STEP_MS).unref();
  };
  next();
}

function cleanup() {
  try {
    fs.unlinkSync(runPath);
  } catch {}
  if (!isWin)
    try {
      fs.unlinkSync(pipe);
    } catch {}
}

function finish(code: number) {
  if (finishing) return;
  finishing = true;
  broadcast({
    type: 'exit',
    code: exited?.code ?? null,
    signal: exited?.signal ?? null,
    stderrTail,
  });
  cleanup();
  server.close();
  setTimeout(() => process.exit(code), FLUSH_MS);
}

let closed = false;
const onGone = () => {
  if (!closed) return;
  if (!listening) return; // the listen callback calls back here
  if (everConnected) finish(0);
  else setTimeout(() => finish(0), NO_CLIENT_GRACE_MS); // the waiting server's first connect ends it sooner (below)
};
child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
  exited = { code, signal };
});
child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
  exited ??= { code, signal };
  closed = true;
  onGone();
}); // close: stdout drained, so the final result went out first
child.on('error', (err) => {
  // spawn failure (ENOENT): no exit event follows
  if (child.pid && !exited) return;
  exited ??= { code: null, signal: null };
  stderrTail.push(String(err.message).slice(0, 2000));
  closed = true;
  onGone();
});

/** claude can't take input any more: the refusal a prompt / mode command gets, or null while stdin is open. */
function inputClosedAck(type: 'prompt' | 'mode'): Msg | null {
  if (!exited && !stdinEnded && !child.stdin.writableEnded) return null;
  return {
    type: 'ack',
    for: type,
    ok: false,
    error: exited ? 'claude has exited' : 'input already closed',
  };
}

function onCommand(sock: net.Socket, cmd: ReturnType<typeof parseCommand>) {
  if (!cmd) return send(sock, { type: 'error', message: 'unknown command' });
  if (cmd.type === 'status')
    return send(sock, {
      type: 'status',
      alive: !exited,
      claudePid: child.pid ?? null,
      exited,
    });
  if (cmd.type === 'prompt') {
    const refused = inputClosedAck('prompt');
    if (refused) return send(sock, refused);
    child.stdin.write(userMessageLine(cmd.text!));
    return send(sock, { type: 'ack', for: 'prompt', ok: true });
  }
  if (cmd.type === 'mode') {
    const refused = inputClosedAck('mode');
    if (refused) return send(sock, refused);
    const id = `po-mode-${++controlSeq}`;
    control.set(id, sock);
    child.stdin.write(setModeLine(id, cmd.mode!));
    return;
  }
  if (cmd.type === 'close') {
    stdinEnded = true;
    try {
      child.stdin.end();
    } catch {}
    return send(sock, { type: 'ack', for: 'close', ok: true });
  }
  if (cmd.type === 'kill') {
    killChild();
    return send(sock, { type: 'ack', for: 'kill', ok: true });
  }
}

const server = net.createServer((sock) => {
  clients.add(sock);
  everConnected = true;
  sock.setEncoding('utf8');
  sock.on('error', () => clients.delete(sock));
  sock.on('close', () => clients.delete(sock));
  send(sock, {
    type: 'hello',
    sid,
    pid: process.pid,
    claudePid: child.pid ?? null,
    cwd,
    model,
    permissionMode,
    startedAt,
    alive: !exited,
    exited,
    stderrTail: exited ? stderrTail : undefined,
    recent,
  });
  const st = newFeed();
  sock.on('data', (d) => feed(st, d, (o) => onCommand(sock, parseCommand(o))));
  if (closed) finish(0); // claude already gone: this client got hello (alive:false) and now gets exit
});

let listening = false;
server.on('error', () => {
  if (listening) return;
  killChild();
  process.exit(1);
}); // EADDRINUSE: another runner owns this session (leave its files alone)
server.listen(pipe, () => {
  listening = true;
  const info = {
    sid,
    pid: process.pid,
    claudePid: child.pid ?? null,
    cwd,
    model,
    permissionMode,
    startedAt,
    pipe,
    version,
  };
  const tmp = `${runPath}.${process.pid}.tmp`; // write+rename so the server never reads a half-written file
  fs.writeFileSync(tmp, JSON.stringify(info));
  fs.renameSync(tmp, runPath);
  if (closed) onGone();
});

const bail = () => {
  killChild();
  cleanup();
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('SIGTERM', bail);
process.on('SIGINT', bail);
