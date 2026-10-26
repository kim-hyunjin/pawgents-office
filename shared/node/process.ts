/** True if `pid` names a running process (one we may not signal still counts). */
export function isPidAlive(pid?: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
