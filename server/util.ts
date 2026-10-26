import fs from 'node:fs';

export function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readSafe(file: string) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Read bytes [startOf(size), size) of a file. Returns { text, start, size }, or null on error. */
function readSlice(
  file: string,
  startOf: (size: number) => number,
): { text: string; start: number; size: number } | null {
  let fd: number | undefined;
  try {
    const st = fs.statSync(file);
    const start = startOf(st.size);
    const len = Math.max(0, st.size - start);
    if (!len) return { text: '', start, size: st.size };
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    return { text: buf.toString('utf8'), start, size: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Read up to `bytes` from the end of a file. */
export const readTail = (file: string, bytes: number) =>
  readSlice(file, (n) => Math.max(0, n - bytes));
/** Read bytes [from, size) of a file. */
export const readFrom = (file: string, from: number) =>
  readSlice(file, () => from);

/** decodeURIComponent that answers null instead of throwing on a malformed escape. */
export const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** Claude Code encodes the project dir by replacing non-alphanumerics with '-'. */
export function projectDirName(cwd?: string | null) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
}
