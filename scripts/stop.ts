#!/usr/bin/env bun
// Stops a background pawgents-office server (one started by the plugin hook or /pawgents-office:open).
import fs from 'node:fs';
import { PID_FILE, PORT } from '../shared/node/env.ts';
import { isPidAlive } from '../shared/node/process.ts';

/** What `file` holds as a number (NaN if it isn't one), or undefined if it can't be read. */
export function readPid(file: string) {
  try {
    return Number(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined; // no pid file
  }
}

export function main(pidFile = PID_FILE, port = PORT) {
  const pid = readPid(pidFile);
  if (!pid) {
    console.log(`pawgents-office is not running (no ${pidFile}).`);
    return;
  }
  const dropPidFile = () => {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* ignore */
    }
  };
  if (!isPidAlive(pid)) {
    console.log(`pawgents-office (pid ${pid}) was not running.`);
    dropPidFile();
    return;
  }
  try {
    process.kill(pid);
    console.log(`Stopped pawgents-office (pid ${pid}, port ${port}).`);
    dropPidFile();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // Anything but ESRCH (e.g. EPERM) means the server may still be up: keep the pid file for a retry.
    if (e.code === 'ESRCH') {
      console.log(`pawgents-office (pid ${pid}) was not running.`);
      dropPidFile();
    } else console.log(`Could not stop pid ${pid}: ${e.message}`);
  }
}

if (import.meta.main) main();
