import fs from 'node:fs';
import http from 'node:http';
import type { ServerResponse } from 'node:http';
import { PORT, HOST, GC_INTERVAL_MS, REGISTRY_POLL_MS, TRANSCRIPT_POLL_MS, FILES_SYNC_MS, STATE_FILE, PID_FILE, DATA_DIR } from './config.ts';
import { syncAllFiles } from './files.ts';
import { Store } from './store.ts';
import { Sse } from './sse.ts';
import { serveStatic } from './static.ts';
import { pollRegistry } from './registry.ts';
import { Tailer } from './transcript.ts';
import { decode } from './util.ts';
import { makeRoutes } from './routes.ts';
import { headless } from './backends/index.ts';

const store = new Store();
store.load();
const sse = new Sse();
store.on((type, data) => sse.send(type, data));
const tailer = new Tailer(store);

// Headless runners outlive the server: reattach before the registry poll, so their sessions come back as headless.
const restored = await headless.restore(store).catch((e: Error) => { console.error('[headless] restore failed:', e.message); return 0; });

// Boot: rebuild from the live session registry + transcripts before accepting clients; worked files come from git status.
pollRegistry(store);
tailer.tick();
syncAllFiles(store);

const routes = makeRoutes({ store, sse });
const notFound = (res: ServerResponse) => { res.writeHead(404); res.end('not found'); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${HOST}`);
  const p = url.pathname;
  try {
    for (const [method, path, handler] of routes) {
      const m = req.method === method && (typeof path === 'string' ? p === path && [p] : p.match(path));
      if (!m) continue;
      const params = m.slice(1).map(decode);
      if (params.includes(null)) { notFound(res); return; } // a malformed %-escape names nothing we have
      await handler({ req, res, url, params: params as string[] });
      return;
    }
    if (req.method === 'GET' && serveStatic(p, res)) return;
    notFound(res);
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is another pawgents-office running? Set PAWGENTS_OFFICE_PORT to change it.`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  process.on('exit', () => {
    try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  });
  console.log(`pawgents-office  →  http://${HOST}:${PORT}`);
  console.log(`desk memory: ${STATE_FILE}`);
  console.log(`sessions restored: ${store.sessions.size}`);
  console.log(`headless restored: ${restored}`);
});

setInterval(() => store.gc(), GC_INTERVAL_MS).unref();
setInterval(() => pollRegistry(store), REGISTRY_POLL_MS).unref();
setInterval(() => tailer.tick(), TRANSCRIPT_POLL_MS).unref();
setInterval(() => syncAllFiles(store), FILES_SYNC_MS).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { headless.shutdown(); store.saveNow(); process.exit(0); }); // runners keep their claude running
}
