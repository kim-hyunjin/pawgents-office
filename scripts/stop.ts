#!/usr/bin/env bun
// Stops a background pawgents-office server (one started by the plugin hook or /pawgents-office:open).
import fs from 'node:fs';
import { PID_FILE, PORT } from '../shared/node/env.ts';
import { isPidAlive } from '../shared/node/process.ts';

let pid: number | undefined;
try {
  pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
} catch {
  /* no pid file */
}
if (!pid) {
  console.log(`pawgents-office is not running (no ${PID_FILE}).`);
  process.exit(0);
}
const dropPidFile = () => {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
};
if (!isPidAlive(pid)) {
  console.log(`pawgents-office (pid ${pid}) was not running.`);
  dropPidFile();
  process.exit(0);
}
try {
  process.kill(pid);
  console.log(`Stopped pawgents-office (pid ${pid}, port ${PORT}).`);
  dropPidFile();
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  // Anything but ESRCH (e.g. EPERM) means the server may still be up: keep the pid file for a retry.
  if (e.code === 'ESRCH') {
    console.log(`pawgents-office (pid ${pid}) was not running.`);
    dropPidFile();
  } else console.log(`Could not stop pid ${pid}: ${e.message}`);
}
