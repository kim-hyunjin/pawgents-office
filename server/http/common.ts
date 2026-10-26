// Request plumbing shared by the routes: bodies, JSON replies, the same-origin guard.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecord, safeJsonParse } from '../../shared/json.ts';
import { AppError, type Refusal } from '../app/errors.ts';
import type { ParkedPermission } from '../app/ports.ts';
import { MAX_BODY_BYTES, PERMISSION_HEARTBEAT_MS, PORT } from '../config.ts';
import type { Store } from '../store.ts';
import type { Session } from '../types.ts';

/** decodeURIComponent that answers null instead of throwing on a malformed escape. */
export const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-cache',
};

export function readBody(req: IncomingMessage, limit: number) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Stop reading but keep the socket open: the 413 still has to reach the client (see tooLarge).
      if (size > limit) {
        req.removeAllListeners('data');
        req.pause();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Answer 413 and close the connection once the reply has gone out; the unread rest of the body dies with the socket. */
export function tooLarge(
  req: IncomingMessage,
  res: ServerResponse,
  data?: unknown,
) {
  res.on('finish', () => req.destroy());
  res.writeHead(
    413,
    data ? { Connection: 'close', ...JSON_HEADERS } : { Connection: 'close' },
  );
  res.end(data ? JSON.stringify(data) : undefined);
}

export function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, JSON_HEADERS);
  res.end(body);
}

/**
 * Keep a `--decide` hook's request open until its parked permission settles, then answer with the decision JSON.
 * Headers go out at once and a space every PERMISSION_HEARTBEAT_MS, because undici (the hook's fetch) gives up on a
 * silent response after 300 s; the hook trims them off. A hook that goes away cancels the request.
 */
export function holdForDecision(res: ServerResponse, p: ParkedPermission) {
  res.writeHead(200, JSON_HEADERS);
  res.flushHeaders();
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(' ');
  }, PERMISSION_HEARTBEAT_MS);
  res.on('close', p.cancel);
  return p.reply.then((reply) => {
    clearInterval(hb);
    if (!res.writableEnded) res.end(JSON.stringify(reply));
  });
}

/** Plain-text 404 for paths (and files) we don't serve. */
export function notFound(res: ServerResponse) {
  res.writeHead(404);
  res.end('not found');
}

// Endpoints that type into terminals must come from our own page: a same-origin JSON POST.
// Host check blocks DNS rebinding; Origin + JSON content-type block cross-site form/fetch posts.
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
/** The Host header names us (not a DNS-rebound name): enough for GETs that hand out source code. */
export const isOwnHost = (req: IncomingMessage) =>
  OWN_HOSTS.has(req.headers.host || '');
function isOwnPage(req: IncomingMessage) {
  const host = req.headers.host || '';
  return (
    isOwnHost(req) &&
    req.headers.origin === `http://${host}` &&
    /^application\/json(;|$)/i.test(req.headers['content-type'] || '')
  );
}

/** The JSON body of a same-origin request, or null after answering 403 / 413 / 400. */
export async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  // the body is dynamic JSON from our page
  if (!isOwnPage(req)) {
    json(res, 403, { error: 'forbidden' });
    return null;
  }
  let body: string;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch {
    tooLarge(req, res, { error: 'body too large' });
    return null;
  }
  const data = safeJsonParse(body);
  if (!isRecord(data)) {
    json(res, 400, { error: 'bad json' });
    return null;
  }
  return data;
}

/** Session `id`, or null after answering 404 with `msg`; `live` also turns away ended sessions. */
export function findSession(
  store: Store,
  res: ServerResponse,
  id: string,
  { live = false, msg = 'not found' }: { live?: boolean; msg?: string } = {},
): Session | null {
  const s = store.sessions.get(id);
  if (!s || (live && s.ended)) {
    json(res, 404, { error: msg });
    return null;
  }
  return s;
}

// The HTTP status of a codedError(). Failures the user can act on (wrong tab, claude died, runner not attached, git
// refused, not a repo) are 409, a file outside the repo is 400; the rest is upstream trouble (502).
export const ERROR_STATUS: Record<string, number> = {
  terminal_not_found: 409,
  not_claude: 409,
  headless_exit: 409,
  detached: 409,
  headless_unavailable: 409,
  git_failed: 409,
  mode_refused: 409,
  mode_unknown: 409,
  waiting: 409,
  stale: 409,
  dialog_unknown: 409,
  not_repo: 409,
  outside: 400,
  ENOENT: 502,
};
/** `code` may be anything a caught error carries (a git exit code is a number): unknown ones are 502. */
export const errorStatus = (code?: unknown) =>
  typeof code === 'string' && Object.hasOwn(ERROR_STATUS, code)
    ? ERROR_STATUS[code]
    : 502;
/** The HTTP status of a use case's refusal (app/errors.ts). */
export const REFUSAL_STATUS: Record<Refusal, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  failed: 502,
};
/** Answer a caught error as `{ error, code }`: a refusal by its kind, anything else by errorStatus. */
export const sendError = (res: ServerResponse, e: unknown) => {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: string };
  const status =
    e instanceof AppError ? REFUSAL_STATUS[e.refusal] : errorStatus(code);
  json(res, status, { error: message || String(e), code });
};
/** Answer a use case's refusal (AppError) with sendError; anything else is a bug and propagates (500). */
export const sendRefusal = (res: ServerResponse, e: unknown) => {
  if (!(e instanceof AppError)) throw e;
  sendError(res, e);
};
