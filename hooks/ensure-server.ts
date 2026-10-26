#!/usr/bin/env bun
// Plugin SessionStart hook: starts the pawgents-office server in the background if it isn't running,
// then forwards the event (the server may not have been up for send.ts to reach it).
// Prints NOTHING. /pawgents-office:open runs scripts/open.ts instead.
//   PAWGENTS_OFFICE_AUTOSTART=0 disables starting the server from the hook.
import { errMessage } from '../shared/errors.ts';
import { autostartEnabled, ensureServer } from '../shared/node/ensure.ts';
import { forward, log, readEvent } from './send.ts';

export async function main() {
  try {
    const ev = await readEvent();
    if (autostartEnabled()) await ensureServer();
    if (ev) await forward(ev);
  } catch (e) {
    log(`ensure-server: ${errMessage(e)}`);
  } // never fail the hook
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
