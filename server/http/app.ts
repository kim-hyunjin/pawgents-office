// The HTTP server: the routes, then the static files. Exported from server/index.ts as createApp.
import http from 'node:http';
import type { Logger } from '../app/ports.ts';
import { type BackendRegistry, createBackends } from '../backends/index.ts';
import { HOST } from '../config.ts';
import type { Sse } from '../sse.ts';
import type { Store } from '../store.ts';
import { decode, notFound } from './common.ts';
import { makeRoutes } from './routes/index.ts';
import { serveStatic } from './static.ts';

/** The HTTP server over `store`: routes first, then static files. No polling, no listening: see main() in server/index.ts. */
export function createApp({
  store,
  sse,
  backends = createBackends(store),
  logger,
}: {
  store: Store;
  sse: Sse;
  backends?: BackendRegistry;
  /** Where the activity log goes (the console by default). */
  logger?: Logger;
}) {
  const routes = makeRoutes({ store, sse, backends, logger });
  return http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${HOST}`);
    const p = url.pathname;
    try {
      for (const [method, path, handler] of routes) {
        const m =
          req.method === method &&
          (typeof path === 'string' ? p === path && [p] : p.match(path));
        if (!m) continue;
        const params = m.slice(1).map(decode);
        if (params.includes(null)) {
          notFound(res);
          return;
        } // a malformed %-escape names nothing we have
        await handler({ req, res, url, params: params as string[] });
        return;
      }
      if (req.method === 'GET' && serveStatic(p, res)) return;
      notFound(res);
    } catch (e) {
      console.error('[http]', e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  });
}
