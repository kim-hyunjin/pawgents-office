// The running server: the composition root. start() boots (reattach runners, first polls), listens and starts the
// timers and signal handlers; stop() undoes all of it. server/index.ts runs it.
import fs from 'node:fs';
import type { Server } from 'node:http';
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

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** Our pid file, removed only while it still names this process. */
function removePidFile() {
  try {
    if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid))
      fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

export function createServerRuntime() {
  const store = new Store();
  const sse = new Sse();
  const tailer = new Tailer(store);
  const backends = createBackends(store);
  const timers: ReturnType<typeof setInterval>[] = [];
  let server: Server | null = null;

  /** A signal: let go of everything (runners keep their claude running) and exit. */
  const onSignal = () => {
    stop();
    process.exit(0);
  };

  async function start() {
    store.load();
    store.on((type, data) => sse.send(type, data));

    // Headless runners outlive the server: reattach before the registry poll, so their sessions come back as headless.
    const restored = await backends.restore();

    // Boot: rebuild from the live session registry + transcripts before accepting clients; worked files come from git status.
    pollRegistry(store);
    tailer.tick();
    syncAllFiles(store);

    const app = createApp({ store, sse, backends });
    server = app;

    app.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.error(
          `Port ${PORT} is already in use. Is another pawgents-office running? Set PAWGENTS_OFFICE_PORT to change it.`,
        );
        process.exit(1);
      }
      throw e;
    });

    app.listen(PORT, HOST, () => {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PID_FILE, String(process.pid));
      process.on('exit', removePidFile);
      console.log(`pawgents-office  →  http://${HOST}:${PORT}`);
      console.log(`desk memory: ${STATE_FILE}`);
      console.log(`sessions restored: ${store.sessions.size}`);
      console.log(`headless restored: ${restored}`);
    });

    const every = (ms: number, fn: () => void) =>
      timers.push(setInterval(fn, ms).unref());
    every(GC_INTERVAL_MS, () => store.gc());
    every(REGISTRY_POLL_MS, () => pollRegistry(store));
    every(TRANSCRIPT_POLL_MS, () => tailer.tick());
    every(FILES_SYNC_MS, () => syncAllFiles(store));

    for (const sig of SIGNALS) process.on(sig, onSignal);
  }

  /** Stop polling and listening, drop the runner sockets and write the state file now. */
  function stop() {
    for (const sig of SIGNALS) process.off(sig, onSignal);
    for (const t of timers.splice(0)) clearInterval(t);
    backends.shutdown();
    store.saveNow();
    sse.stop();
    server?.close();
    server = null;
    removePidFile();
    process.off('exit', removePidFile);
  }

  return { store, start, stop };
}
