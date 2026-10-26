// Posting hook events to the office server: shared by hooks/send.ts and scripts/demo.ts.
import type { HookEvent } from '../hook.ts';
import { BASE_URL } from './env.ts';

/** POSTs one event to `${baseUrl}/hook`. With `timeoutMs` the request aborts after that long; without it, it waits. */
export function postHook(
  ev: HookEvent,
  {
    baseUrl = BASE_URL,
    timeoutMs,
  }: { baseUrl?: string; timeoutMs?: number } = {},
) {
  return fetch(`${baseUrl}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ev),
    ...(timeoutMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(timeoutMs) }),
  });
}
