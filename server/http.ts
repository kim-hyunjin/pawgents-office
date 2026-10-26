// Request plumbing shared by the routes: bodies, JSON replies, the same-origin guard.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES, PORT } from './config.ts';
import type { Store } from './store.ts';
import type { Session } from './types.ts';
import { safeJsonParse } from './util.ts';

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
): Promise<Record<string, any> | null> {
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
  if (!data || typeof data !== 'object') {
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

// Backend failures the user can act on (wrong tab, claude died, runner not attached, git refused) are 409; the rest is upstream trouble.
export const BACKEND_ERROR_STATUS: Record<string, number> = {
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
  ENOENT: 502,
};
export const backendStatus = (code?: string) =>
  BACKEND_ERROR_STATUS[code as string] ?? 502;
export const backendError = (res: ServerResponse, e: unknown) => {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  json(res, backendStatus(code), { error: message || String(e), code });
};
