// Same-origin JSON calls. The server answers errors as { error } (Korean, shown to the user as is).
/** body !== undefined: sent as JSON (some routes need the JSON content-type even with an empty body — CSRF guard). */
export async function api<T = any>(url: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let d: any = {}; // server JSON, shape depends on the route
  try { const text = await r.text(); if (text) d = JSON.parse(text); } catch { /* empty or non-JSON body */ }
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return (d ?? {}) as T;
}
export const post = <T = any>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body });

/** Send a session home. force: close its Orca terminal tab instead of typing /exit (it isn't idle). */
export const closeSession = (id: string, force?: boolean) => post(`/sessions/${encodeURIComponent(id)}/close`, { force });

/** Switch a live session's permission mode (headless: control request; Orca: Shift+Tab until the footer shows it). */
export const setMode = (id: string, mode: string) => post(`/sessions/${encodeURIComponent(id)}/mode`, { mode });

/** Answer a headless session's parked permission request (reqId from s.pendingPermissions). */
export const decidePermission = (id: string, reqId: string, allow: boolean) => post(`/sessions/${encodeURIComponent(id)}/permission`, { id: reqId, allow });
