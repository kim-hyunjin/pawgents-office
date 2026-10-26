// Start the pawgents-office server in the background if it isn't answering (shared by ensure-server.ts and send.ts --decide).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, BASE_URL } from '../server/config.ts';

const SERVER = path.resolve(import.meta.dirname, '../server/index.ts');

export async function healthy() {
  try { return (await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
}

// Concurrent starts are fine: the loser exits on EADDRINUSE and the winner writes server.pid.
export async function ensureServer() {
  if (await healthy()) return true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await healthy()) return true;
  }
  return false;
}
