// A session's panel and the browser's actions on it: its log and last reply, prompt, close, mode, permissions.
import type { LogReply, ReplyReply } from '../../../shared/api.ts';
import { PERMISSION_MODES } from '../../../shared/permission.ts';
import { BAD_REQUEST, UNKNOWN_MODE } from '../../app/errors.ts';
import type { SessionActions } from '../../app/sessions.ts';
import { MAX_PROMPT_CHARS } from '../../config.ts';
import type { Store } from '../../store.ts';
import { findSession, json, readJson, sendError } from '../common.ts';
import type { Route } from './types.ts';

const SESSION_GONE = '세션이 없거나 종료되었습니다.';

export const sessionRoutes = ({
  store,
  sessions,
}: {
  store: Store;
  sessions: SessionActions;
}): Route[] => [
  [
    'GET',
    /^\/sessions\/([^/]+)\/log$/,
    ({ res, params: [id] }) => {
      const s = findSession(store, res, id);
      if (!s) return;
      json(res, 200, sessions.openLog(s) satisfies LogReply);
    },
  ],
  [
    'GET',
    /^\/sessions\/([^/]+)\/reply$/,
    ({ res, url, params: [id] }) => {
      const s = findSession(store, res, id);
      if (!s) return;
      const agentId = url.searchParams.get('agent');
      const ent = agentId ? s.subagents.get(agentId) : s;
      if (!ent) {
        json(res, 404, { error: 'not found' });
        return;
      }
      json(res, 200, {
        id: s.id,
        agentId,
        text: ent.replyText || ent.lastText || '',
        at: ent.lastTextAt,
      } satisfies ReplyReply);
    },
  ],
  [
    'POST',
    /^\/sessions\/([^/]+)\/prompt$/,
    async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const s = findSession(store, res, id, { live: true, msg: SESSION_GONE });
      if (!s) return;
      const text = String(data.text ?? '').trim();
      if (!text || text.length > MAX_PROMPT_CHARS) {
        json(res, 400, {
          error: `지시는 1–${MAX_PROMPT_CHARS}자여야 합니다.`,
        });
        return;
      }
      try {
        json(res, 200, { ok: true, ...(await sessions.prompt(s, text)) });
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
  [
    'POST',
    /^\/sessions\/([^/]+)\/close$/,
    async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const s = findSession(store, res, id, {
        live: true,
        msg: '세션이 없거나 이미 종료되었습니다.',
      });
      if (!s) return;
      try {
        await sessions.close(s, data.force === true);
        json(res, 200, { ok: true });
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
  [
    'POST',
    /^\/sessions\/([^/]+)\/mode$/,
    async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const mode = String(data.mode ?? '');
      if (!PERMISSION_MODES.includes(mode)) {
        json(res, 400, { error: UNKNOWN_MODE });
        return;
      }
      const s = findSession(store, res, id, { live: true, msg: SESSION_GONE });
      if (!s) return;
      try {
        json(res, 200, { ok: true, mode: await sessions.setMode(s, mode) });
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
  [
    'POST',
    /^\/sessions\/([^/]+)\/permission$/,
    async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      if (typeof data.id !== 'string' || typeof data.allow !== 'boolean') {
        json(res, 400, { error: BAD_REQUEST });
        return;
      }
      const s = findSession(store, res, id, { live: true, msg: SESSION_GONE });
      if (!s) return;
      try {
        await sessions.answerPermission(s, data.id, data.allow);
        json(res, 200, { ok: true });
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
];
