#!/usr/bin/env bun
// Claude Code hook: forwards the stdin JSON payload to the pawgents-office server.
// Prints NOTHING (hook stdout can be injected into Claude's context) and always exits 0.
// Exception: with --decide (headless sessions only, see decision.ts) a PermissionRequest waits for the office's answer
// and prints the decision JSON; no answer prints nothing, which claude treats as "no decision" (denied).
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URL, DATA_DIR, MAX_REPLY_CHARS } from '../server/config.ts';
import type { HookEvent } from '../server/types.ts';
import { safeJsonParse } from '../server/util.ts';
import { errMessage } from './_common.ts';
import { DECIDE_FLAG, DECISION_TIMEOUT_S, decisionOutput } from './decision.ts';
import { autostartEnabled, ensureServer } from './ensure.ts';

const DEBUG = process.env.PAWGENTS_OFFICE_DEBUG === '1';

export function log(msg: string) {
  if (!DEBUG) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(DATA_DIR, 'hook.log'),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
    /* ignore */
  }
}

function clip<T>(v: T, n: number): T | string {
  return typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v;
}

/** A tool's result as text: a shell's stdout (+ stderr), else the JSON of whatever it returned. */
function toolResponseText(r: HookEvent['tool_response']): string {
  if (typeof r === 'string') return r;
  if (!r || typeof r !== 'object') return '';
  return typeof r.stdout === 'string'
    ? r.stdout + (r.stderr ? '\n' + r.stderr : '')
    : JSON.stringify(r) || '';
}

/** Cut the payload down to what the office shows, so a hook never posts a huge body. Mutates and returns `ev`. */
function shrink(ev: HookEvent) {
  if (ev.tool_response !== undefined) {
    const text = toolResponseText(ev.tool_response);
    ev.tool_response_len = text.length;
    ev.tool_response_head = text.slice(0, 400);
    delete ev.tool_response;
  }
  for (const k of [
    'prompt',
    'message',
    'error',
    'compact_summary',
    'custom_instructions',
  ]) {
    if (typeof ev[k] === 'string') ev[k] = clip(ev[k], 2000);
  }
  // Kept whole for the reply dialog; the server caps it (MAX_REPLY_CHARS) well under MAX_BODY_BYTES.
  ev.last_assistant_message = clip(ev.last_assistant_message, MAX_REPLY_CHARS);
  if (ev.tool_input && typeof ev.tool_input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ev.tool_input)) {
      if (typeof v === 'string') out[k] = clip(v, 500);
      else if (typeof v === 'number' || typeof v === 'boolean' || v === null)
        out[k] = v;
    }
    ev.tool_input = out;
  }
  // Stop lists in-flight background work (shells, monitors…): "paused waiting for it", not "done".
  if (Array.isArray(ev.background_tasks)) {
    ev.background_tasks = ev.background_tasks.slice(0, 10).map((t: any) => ({
      id: t?.id,
      type: t?.type,
      status: t?.status,
      description: clip(t?.description, 200),
      command: clip(t?.command, 200),
    }));
  } else delete ev.background_tasks;
  for (const k of ['session_crons', 'permission_suggestions']) delete ev[k];
  return ev;
}

export async function readEvent(): Promise<HookEvent | null> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c);
  let ev: any;
  try {
    ev = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    log('bad json');
    return null;
  }
  return ev && typeof ev === 'object' ? ev : null;
}

function postHook(ev: HookEvent, timeoutMs: number) {
  return fetch(`${BASE_URL}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Long-poll the server for the browser's allow/deny; prints the decision, or nothing (error, timeout, no answer). */
async function awaitDecision(ev: HookEvent) {
  // a dead office server would mean an instant deny; revive it first (it reconnects to this session's runner on boot)
  if (autostartEnabled()) await ensureServer();
  ev.await_decision = true;
  try {
    const r = await postHook(ev, DECISION_TIMEOUT_S * 1000 - 10_000); // give up before claude kills us
    const d = safeJsonParse((await r.text()).trim()); // the body is padded with heartbeat spaces
    if (d?.decision === 'allow' || d?.decision === 'deny') {
      const out = JSON.stringify(
        decisionOutput(
          d.decision === 'allow',
          typeof d.message === 'string' && d.message ? d.message : undefined,
        ),
      );
      await new Promise((resolve) => process.stdout.write(out, resolve)); // flushed before process.exit (pipes are async on macOS)
      log(`decide: ${d.decision} ${ev.tool_name || ''}`);
    } else log(`decide: none ${ev.tool_name || ''}`);
  } catch (e) {
    log(`decide: none (${errMessage(e)})`);
  }
}

export async function forward(
  ev: HookEvent,
  { decide = false }: { decide?: boolean } = {},
) {
  shrink(ev);
  // Set by Orca in its managed terminals; lets the office type into this session.
  if (process.env.ORCA_TERMINAL_HANDLE)
    ev.orca_terminal = process.env.ORCA_TERMINAL_HANDLE;
  if (decide && ev.hook_event_name === 'PermissionRequest')
    return awaitDecision(ev);
  try {
    await postHook(ev, 1000);
    log(`sent ${ev.hook_event_name} ${ev.tool_name || ''}`);
  } catch (e) {
    log(`send failed: ${errMessage(e)}`);
  }
}

if (import.meta.main) {
  readEvent()
    .then(
      (ev) => ev && forward(ev, { decide: process.argv.includes(DECIDE_FLAG) }),
    )
    .catch(() => {})
    .finally(() => process.exit(0));
}
