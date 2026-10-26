// What a session did to one file, as a unified diff from git. Working tree vs HEAD first; an untracked file
// is shown whole as added; a file already committed during the session shows that commit's change.

import fs from 'node:fs';
import path from 'node:path';
import type { DiffReply } from '../shared/api.ts';
import { codedError } from '../shared/errors.ts';
import { MAX_DIFF_BYTES, MAX_DIFF_CHARS } from './config.ts';
import { type GitResult, git as runGit } from './infra/git.ts';

const roots = new Map<string, string | null>(); // cwd -> worktree top level (a worktree's, not the main repo's: repo.ts answers that)

/** git stdout, cut at MAX_DIFF_BYTES (`truncated`); `okCodes` exit codes also answer with stdout. */
const git = (cwd: string, args: string[], okCodes: number[] = []) =>
  runGit(cwd, ['-c', 'core.quotepath=false', ...args], {
    okCodes,
    maxBuffer: MAX_DIFF_BYTES,
    truncate: true,
  });

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

function patchOf({ out, truncated }: GitResult) {
  const patch =
    out.length > MAX_DIFF_CHARS ? out.slice(0, MAX_DIFF_CHARS) : out;
  return { patch, truncated: truncated || patch.length < out.length };
}

/**
 * @throws codedError 'not_repo' (cwd is not in a git worktree) or 'outside' (file is not under it); git failures pass through.
 */
export async function fileDiff(
  cwd: string | undefined,
  file: string,
  { since = 0 }: { since?: number } = {},
): Promise<Omit<DiffReply, 'file'>> {
  const root = cwd ? await worktreeRoot(cwd) : null;
  if (!root) throw codedError('git 저장소가 아닙니다.', 'not_repo');
  const rel = path.relative(root, path.resolve(file));
  if (
    !rel ||
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.split(path.sep)[0] === '.git'
  )
    throw codedError('저장소 밖의 파일입니다.', 'outside');
  const spec = rel.split(path.sep).join('/');

  let diff: GitResult;
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
