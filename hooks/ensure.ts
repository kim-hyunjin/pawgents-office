// Start the pawgents-office server in the background if it isn't answering (shared by ensure-server.ts and send.ts --decide).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URL, DATA_DIR } from '../shared/node/env.ts';
import { SERVER_SCRIPT as SERVER } from '../shared/node/paths.ts';
import { sleep } from '../shared/time.ts';

const START_POLL_MS = 200;
const START_POLL_TRIES = 25;

/** PAWGENTS_OFFICE_AUTOSTART=0 keeps hooks from starting the server. */
export const autostartEnabled = () =>
  process.env.PAWGENTS_OFFICE_AUTOSTART !== '0';

export async function healthy() {
  try {
    return (
      await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(500) })
    ).ok;
  } catch {
    return false;
  }
}

// Concurrent starts are fine: the loser exits on EADDRINUSE and the winner writes server.pid.
export async function ensureServer() {
  if (await healthy()) return true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
  spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  }).unref();
  for (let i = 0; i < START_POLL_TRIES; i++) {
    await sleep(START_POLL_MS);
    if (await healthy()) return true;
  }
  return false;
}
