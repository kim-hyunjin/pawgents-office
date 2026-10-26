// Running git: one runner for every server caller (`git -C <cwd> …`, hidden window, a timeout), and its errors.

import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { codedError, errMessage } from '../../shared/errors.ts';
import { GIT_TIMEOUT_MS } from '../config.ts';

const run = promisify(execFile);

export interface GitOptions {
  /** Exit codes that also answer with stdout (diff --no-index exits 1 when the files differ). */
  okCodes?: number[];
  /** Kill git after this long; default GIT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** stdout bytes kept; default Node's (1 MiB). */
  maxBuffer?: number;
  /** Past `maxBuffer`, answer with what was read (`truncated`) instead of failing. */
  truncate?: boolean;
}
export interface GitResult {
  out: string;
  truncated: boolean;
}
/** What a failed run throws: Node's execFile error. `code` is git's exit code, or a string like 'ENOENT'; a timeout has `killed`. */
export interface GitError extends Error {
  code?: string | number | null;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

/** `git -C cwd ...args` → stdout. @throws GitError on any other exit code, a timeout, or git missing. */
export async function git(
  cwd: string,
  args: string[],
  {
    okCodes = [],
    timeoutMs = GIT_TIMEOUT_MS,
    maxBuffer,
    truncate = false,
  }: GitOptions = {},
): Promise<GitResult> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      ...(maxBuffer === undefined ? {} : { maxBuffer }),
      windowsHide: true,
    });
    return { out: stdout, truncated: false };
  } catch (err) {
    const e = err as GitError;
    if (truncate && e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      return { out: String(e.stdout || ''), truncated: true };
    if (okCodes.includes(e.code as number))
      return { out: String(e.stdout || ''), truncated: false };
    throw e;
  }
}

/** Blocking `git -C cwd ...args` → stdout on exit 0, else null (also when git is missing or times out). */
export function gitSync(
  cwd: string,
  args: string[],
  { timeoutMs = GIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): string | null {
  try {
    const r = spawnSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

export const gitErr = (e: unknown): string =>
  String((e as { stderr?: unknown }).stderr || errMessage(e));
/** A git failure as a 'git_failed' error (409: the user can act on git's message). */
export const gitFailed = (e: unknown, fallback = '') =>
  codedError(gitErr(e).trim().slice(0, 300) || fallback, 'git_failed');
