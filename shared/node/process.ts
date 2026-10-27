import { dlopen, FFIType } from 'bun:ffi';

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

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
let kernel32: ReturnType<typeof openKernel32> | null = null;
const openKernel32 = () =>
  dlopen('kernel32.dll', {
    OpenProcess: {
      args: [FFIType.u32, FFIType.bool, FFIType.u32],
      returns: FFIType.ptr,
    },
    GetProcessTimes: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
  }).symbols;

/** Creation time of `pid` as a Windows FILETIME, or null when it can't be opened (gone, or not the user's). */
function winProcStart(pid: number): bigint | null {
  kernel32 ??= openKernel32();
  const h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return null;
  try {
    const t = new BigUint64Array(4); // creation, exit, kernel, user
    return kernel32.GetProcessTimes(
      h,
      t,
      t.subarray(1),
      t.subarray(2),
      t.subarray(3),
    )
      ? (t[0] ?? null)
      : null;
  } finally {
    kernel32.CloseHandle(h);
  }
}

/**
 * isPidAlive, and still the process that started at `procStart` (Claude Code's registry field: a FILETIME on Windows).
 * Windows hands a dead claude's pid to the next process soon enough, and kill(pid, 0) can't tell them apart.
 * Elsewhere (or without procStart) it is plain isPidAlive.
 */
export function isProcessAlive(pid: number, procStart?: unknown) {
  if (!isPidAlive(pid)) return false;
  if (
    process.platform !== 'win32' ||
    typeof procStart !== 'string' ||
    !/^\d+$/.test(procStart)
  )
    return true;
  try {
    return winProcStart(pid) === BigInt(procStart);
  } catch {
    return true; // no FFI: fall back to the pid alone
  }
}
