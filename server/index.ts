import fs from 'node:fs';
import { createBackends } from './backends/index.ts';
import {
  DATA_DIR,
  FILES_SYNC_MS,
  GC_INTERVAL_MS,
  HOST,
  PID_FILE,
  PORT,
  REGISTRY_POLL_MS,
  STATE_FILE,
  TRANSCRIPT_POLL_MS,
} from './config.ts';
import { syncAllFiles } from './files.ts';
import { createApp } from './http/app.ts';
import { pollRegistry } from './registry.ts';
import { Sse } from './sse.ts';
import { Store } from './store.ts';
import { Tailer } from './transcript.ts';

export { createApp };

async function main() {
  const store = new Store();
  store.load();
  const sse = new Sse();
  store.on((type, data) => sse.send(type, data));
  const tailer = new Tailer(store);
  const backends = createBackends(store);

  // Headless runners outlive the server: reattach before the registry poll, so their sessions come back as headless.
  const restored = await backends.restore();

  // Boot: rebuild from the live session registry + transcripts before accepting clients; worked files come from git status.
  pollRegistry(store);
  tailer.tick();
  syncAllFiles(store);

  const server = createApp({ store, sse, backends });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. Is another pawgents-office running? Set PAWGENTS_OFFICE_PORT to change it.`,
      );
      process.exit(1);
    }
    throw e;
  });

  server.listen(PORT, HOST, () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
    process.on('exit', () => {
      try {
        if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid))
          fs.unlinkSync(PID_FILE);
      } catch {
        /* ignore */
      }
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
    process.on(sig, () => {
      backends.shutdown();
      store.saveNow();
      process.exit(0);
    }); // runners keep their claude running
  }
}

if (import.meta.main) await main();
