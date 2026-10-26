// What can happen to a session from the outside: hooks arriving, and the browser's actions (prompt, close, mode,
// permission answers, opening its panel). Refusals are AppErrors, backend failures pass through as they are.
import path from 'node:path';
import type { DiffReply } from '../../shared/api.ts';
import type { BackendRegistry } from '../backends/index.ts';
import { fileDiff } from '../diff.ts';
import { scheduleFileSync } from '../files.ts';
import { type HookOutcome, reduceHook } from '../reducer.ts';
import type { Store } from '../store.ts';
import type { HookEvent, Session } from '../types.ts';
import { conflict, notFound } from './errors.ts';
import { label, preview } from './log.ts';
import type { Logger, ParkedPermission } from './ports.ts';

/** A clean file's diff shows its last commit since this long before the session started. */
const DIFF_SINCE_SLACK_MS = 60_000;

export const PROMPT_WAITING =
  '권한 승인·질문 응답을 기다리는 중입니다. 터미널에서 먼저 답해주세요.';
const CLOSE_BUSY =
  '작업 중이거나 응답 대기 중이라 /exit 를 보낼 수 없습니다. 강제 종료를 쓰세요.';

/** Carry out what a hook asked for once the store took it in (reducer.ts HookEffect). */
export function runEffects(store: Store, { session, effects }: HookOutcome) {
  for (const e of effects)
    if (e.type === 'syncFiles') scheduleFileSync(store, session);
}

/** A hook payload: into the store, then its effects. Returns the session (or null). */
export function receiveHook(store: Store, ev: HookEvent): Session | null {
  const r = reduceHook(store, ev);
  if (!r) return null;
  runEffects(store, r);
  return r.session;
}

/** `[hook] Event Tool · target  session (id) [agent id] → state` */
function hookLine(s: Session, ev: HookEvent) {
  const ent = ev.agent_id ? s.subagents.get(String(ev.agent_id)) : s;
  const tool = ev.tool_name
    ? ` ${ev.tool_name}${ent?.currentTool?.target ? ' · ' + ent.currentTool.target : ''}`
    : '';
  const agent = ev.agent_id
    ? ` [agent ${String(ev.agent_id).slice(0, 8)}]`
    : '';
  return `[hook] ${ev.hook_event_name}${tool}  ${label(s)}${agent} → ${ent?.state ?? s.state}`;
}

export function createSessionActions({
  store,
  backends,
  logger,
}: {
  store: Store;
  backends: BackendRegistry;
  logger: Logger;
}) {
  return {
    /**
     * POST /hook. A `--decide` PermissionRequest comes back `parked` when the session's backend holds such requests
     * for the browser: the caller keeps the hook's request open until it settles.
     */
    hook(ev: HookEvent): { parked: ParkedPermission | null } {
      const s = receiveHook(store, ev);
      if (s) logger.info(hookLine(s, ev));
      const parked =
        s &&
        ev.await_decision === true &&
        ev.hook_event_name === 'PermissionRequest' &&
        !ev.agent_id
          ? backends.ownerOf(s).parkPermission(s, ev)
          : null;
      return { parked };
    },

    /** The panel opened: its log, and a fresh look at its worked files. */
    openLog(s: Session) {
      if (!s.ended) scheduleFileSync(store, s);
      return { id: s.id, log: s.log.toArray() };
    },

    /** The diff of a file this session's tools touched (only those: anything else is not found). */
    async diff(s: Session, file: string): Promise<DiffReply> {
      const f = file ? s.files.get(path.normalize(file)) : null;
      if (!f) throw notFound('이 세션이 작업한 파일이 아닙니다.');
      const d = await fileDiff(s.cwd, f.path, {
        since: s.startedAt - DIFF_SINCE_SLACK_MS,
      });
      return { file: f.path, ...d };
    },

    /** Send the user's text as a prompt. A detached runner or an open dialog refuses (409). */
    async prompt(s: Session, text: string) {
      const b = backends.driverOf(s);
      if (!b.canPromptWhile(s.state)) throw conflict(PROMPT_WAITING, 'waiting');
      const r = await store.updateSession(s, () => b.sendPrompt(s, text));
      logger.info(`[web] prompt → ${label(s)}: ${preview(text)}`);
      return { accepted: r?.accepted ?? true };
    },

    /** End the session; `/exit` is only safe at an idle prompt, so anything else needs `force` (the client re-asks). */
    async close(s: Session, force: boolean) {
      const b = backends.driverOf(s);
      if (!force && s.state !== 'idle') throw conflict(CLOSE_BUSY, 'busy');
      await b.close(s, { force });
      logger.info(`[web] close${force ? ' (force)' : ''} → ${label(s)}`);
    },

    /** Switch the permission mode (already checked against PERMISSION_MODES); resolves with the mode now on. */
    async setMode(s: Session, mode: string) {
      const b = backends.driverOf(s);
      await store.updateSession(s, async () => {
        await b.setMode(s, mode);
      });
      logger.info(`[web] mode ${mode} → ${label(s)}`);
      return s.permissionMode;
    },

    /** The browser's allow / deny for permission request `id`. */
    async answerPermission(s: Session, id: string, allow: boolean) {
      // not driverOf: a headless request outlives its runner's connection (and answers 'stale' once it's gone)
      const what = await backends.ownerOf(s).answerPermission(s, id, allow);
      logger.info(
        `[web] permission ${allow ? 'allow' : 'deny'} ${what} → ${label(s)}`,
      );
    },
  };
}
export type SessionActions = ReturnType<typeof createSessionActions>;
