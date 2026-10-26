// Running git: errors.

import { codedError, errMessage } from '../../shared/errors.ts';

export const gitErr = (e: unknown): string =>
  String((e as { stderr?: unknown }).stderr || errMessage(e));
/** A git failure as a 'git_failed' error (409: the user can act on git's message). */
export const gitFailed = (e: unknown, fallback = '') =>
  codedError(gitErr(e).trim().slice(0, 300) || fallback, 'git_failed');
