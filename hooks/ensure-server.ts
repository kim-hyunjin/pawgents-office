#!/usr/bin/env bun
// Plugin SessionStart hook: starts the pawgents-office server in the background if it isn't running,
// then forwards the event (the server may not have been up for send.ts to reach it).
// Prints NOTHING as a hook. `--open` (used by /pawgents-office:open) also prints the URL and opens a browser.
//   PAWGENTS_OFFICE_AUTOSTART=0 disables starting the server from the hook.
import path from 'node:path';
import { errMessage } from '../shared/errors.ts';
import { openBrowser } from '../shared/node/browser.ts';
import { autostartEnabled, ensureServer } from '../shared/node/ensure.ts';
import { BASE_URL, DATA_DIR, PORT } from '../shared/node/env.ts';
import { forward, log, readEvent } from './send.ts';

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
    if (autostartEnabled()) await ensureServer();
    if (ev) await forward(ev);
  } catch (e) {
    log(`ensure-server: ${errMessage(e)}`);
  } // never fail the hook
}
process.exit(0);
