#!/usr/bin/env bun
// /pawgents-office:open: starts the pawgents-office server in the background if it isn't running,
// opens the office in a browser and prints one line (the URL, or where to look when it failed).
import path from 'node:path';
import { openBrowser } from '../shared/node/browser.ts';
import { ensureServer } from '../shared/node/ensure.ts';
import { BASE_URL, DATA_DIR, PORT } from '../shared/node/env.ts';

export async function main() {
  if (await ensureServer()) {
    openBrowser(BASE_URL);
    console.log(`pawgents-office is running at ${BASE_URL}`);
  } else {
    console.log(
      `pawgents-office failed to start on port ${PORT}. See ${path.join(DATA_DIR, 'server.log')}`,
    );
  }
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
