// Where Claude Code keeps things on disk, by its own naming convention.
import path from 'node:path';
import { PROJECTS_DIR } from '../config.ts';

/** Claude Code encodes the project dir by replacing non-alphanumerics with '-'. */
export function projectDirName(cwd?: string | null) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

/** The transcript Claude Code writes for session `sessionId` started in `cwd`. */
export const transcriptPathOf = (
  cwd: string | null | undefined,
  sessionId: string,
  projectsDir = PROJECTS_DIR,
) => path.join(projectsDir, projectDirName(cwd), `${sessionId}.jsonl`);
