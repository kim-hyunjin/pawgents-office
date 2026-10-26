// What a session did to one file, as a unified diff from git. Working tree vs HEAD first; an untracked file
// is shown whole as added; a file already committed during the session shows that commit's change.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { GIT_TIMEOUT_MS, MAX_DIFF_BYTES, MAX_DIFF_CHARS } from './config.ts';
import type { SysError } from './types.ts';

const run = promisify(execFile);
const roots = new Map<string, string | null>(); // cwd -> worktree top level (a worktree's, not the main repo's: repo.ts answers that)

class DiffError extends Error {
  code: 'not_repo' | 'outside';
  constructor(code: 'not_repo' | 'outside', message: string) {
    super(message);
    this.code = code;
  }
}

/** git stdout; `okCodes` exit codes also answer with stdout (diff --no-index exits 1 when the files differ). */
async function git(
  cwd: string,
  args: string[],
  okCodes: number[] = [],
): Promise<{ out: string; truncated: boolean }> {
  try {
    const { stdout } = await run(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', ...args],
      {
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_DIFF_BYTES,
        windowsHide: true,
      },
    );
    return { out: stdout, truncated: false };
  } catch (err) {
    const e = err as SysError;
    if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      return { out: String(e.stdout || ''), truncated: true };
    if (okCodes.includes(e.code as number))
      return { out: String(e.stdout || ''), truncated: false };
    throw e;
  }
}

async function worktreeRoot(cwd: string) {
  if (roots.has(cwd)) return roots.get(cwd)!;
  let root: string | null = null;
  try {
    root = path.resolve(
      (await git(cwd, ['rev-parse', '--show-toplevel'])).out.trim(),
    );
  } catch {
    /* not a repo, or no git */
  }
  roots.set(cwd, root);
  return root;
}

function patchOf({ out, truncated }: { out: string; truncated: boolean }) {
  const patch =
    out.length > MAX_DIFF_CHARS ? out.slice(0, MAX_DIFF_CHARS) : out;
  return { patch, truncated: truncated || patch.length < out.length };
}

/**
 * @returns {Promise<{ rel: string, status: 'changed'|'untracked'|'committed'|'clean'|'missing', patch: string, truncated: boolean, commit?: { hash: string, subject: string } }>}
 * @throws {DiffError} code 'not_repo' (cwd is not in a git worktree) or 'outside' (file is not under it); git failures pass through.
 */
export async function fileDiff(
  cwd: string | undefined,
  file: string,
  { since = 0 }: { since?: number } = {},
) {
  const root = cwd ? await worktreeRoot(cwd) : null;
  if (!root) throw new DiffError('not_repo', 'git 저장소가 아닙니다.');
  const rel = path.relative(root, path.resolve(file));
  if (
    !rel ||
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.split(path.sep)[0] === '.git'
  )
    throw new DiffError('outside', '저장소 밖의 파일입니다.');
  const spec = rel.split(path.sep).join('/');

  let diff: Awaited<ReturnType<typeof git>>;
  try {
    diff = await git(root, [
      'diff',
      'HEAD',
      '--no-color',
      '--no-ext-diff',
      '--',
      spec,
    ]);
  } catch {
    diff = await git(root, ['diff', '--no-color', '--no-ext-diff', '--', spec]);
  } // no commits yet: against the index
  if (diff.out) return { rel: spec, status: 'changed', ...patchOf(diff) };

  const tracked =
    (
      await git(root, ['ls-files', '--error-unmatch', '--', spec], [1])
    ).out.trim() !== '';
  if (!tracked) {
    if (!fs.existsSync(path.join(root, rel)))
      return { rel: spec, status: 'missing', patch: '', truncated: false };
    const added = await git(
      root,
      ['diff', '--no-index', '--no-color', '--', '/dev/null', spec],
      [1],
    );
    return { rel: spec, status: 'untracked', ...patchOf(added) };
  }

  const last = (
    await git(root, [
      'log',
      '-1',
      '--format=%H%x00%s',
      `--since=${new Date(since).toISOString()}`,
      '--',
      spec,
    ])
  ).out.trim();
  if (!last) return { rel: spec, status: 'clean', patch: '', truncated: false };
  const [hash, subject = ''] = last.split('\0');
  const shown = await git(root, [
    'show',
    '--no-color',
    '--no-ext-diff',
    '--format=',
    hash,
    '--',
    spec,
  ]);
  return {
    rel: spec,
    status: 'committed',
    commit: { hash, subject },
    ...patchOf(shown),
  };
}

/**
 * `git status --porcelain -z` output → [{ rel, status }] with one letter per entry: the working-tree column
 * when it says something, else the index column; '?' for untracked. A rename's old name is skipped.
 */
export function parseStatus(z: string) {
  const parts = z.split('\0'),
    out: { rel: string; status: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0],
      y = e[1],
      rel = e.slice(3);
    if (x === 'R' || x === 'C') i++; // the next entry is the source path
    out.push({ rel, status: x === '?' ? '?' : y !== ' ' ? y : x });
  }
  return out;
}

/** Changed, added, deleted and untracked files of the worktree `cwd` is in (absolute paths), or null outside a repo. */
export async function changedFiles(cwd?: string) {
  const root = cwd ? await worktreeRoot(cwd) : null;
  if (!root) return null;
  const { out } = await git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  return parseStatus(out).map((f) => ({
    path: path.join(root, f.rel),
    status: f.status,
  }));
}
