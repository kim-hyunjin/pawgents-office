#!/usr/bin/env bun
// Plugin SessionStart hook: starts the pawgents-office server in the background if it isn't running,
// then forwards the event (the server may not have been up for send.ts to reach it).
// Prints NOTHING as a hook. `--open` (used by /pawgents-office:open) also prints the URL and opens a browser.
//   PAWGENTS_OFFICE_AUTOSTART=0 disables starting the server from the hook.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { BASE_URL, DATA_DIR, PORT } from '../server/config.ts';
import { errMessage } from './_common.ts';
import { ensureServer } from './ensure.ts';
import { forward, log, readEvent } from './send.ts';

function openBrowser(url: string) {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    /* ignore */
  }
}

if (process.argv.includes('--open')) {
  if (await ensureServer()) {
    openBrowser(BASE_URL);
    console.log(`pawgents-office is running at ${BASE_URL}`);
  } else {
    console.log(
      `pawgents-office failed to start on port ${PORT}. See ${path.join(DATA_DIR, 'server.log')}`,
    );
  }
} else {
  try {
    const ev = await readEvent();
    if (process.env.PAWGENTS_OFFICE_AUTOSTART !== '0') await ensureServer();
    if (ev) await forward(ev);
  } catch (e) {
    log(`ensure-server: ${errMessage(e)}`);
  } // never fail the hook
}
process.exit(0);
