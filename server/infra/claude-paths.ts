// Where Claude Code keeps things on disk, by its own naming convention.

/** Claude Code encodes the project dir by replacing non-alphanumerics with '-'. */
export function projectDirName(cwd?: string | null) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}
