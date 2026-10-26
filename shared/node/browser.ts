import { spawn } from 'node:child_process';

/** Opens `url` in the default browser, detached. Failing to launch one is not an error. */
export function openBrowser(url: string) {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    /* ignore */
  }
}
