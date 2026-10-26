// GET /sessions/:id/diff?file=: what a session changed in one of its worked files.
import type { SessionActions } from '../../app/sessions.ts';
import { findSession, isOwnHost, json, sendError } from '../../http.ts';
import type { Store } from '../../store.ts';
import type { Route } from './types.ts';

export const diffRoutes = ({
  store,
  sessions,
}: {
  store: Store;
  sessions: SessionActions;
}): Route[] => [
  [
    'GET',
    /^\/sessions\/([^/]+)\/diff$/,
    async ({ req, res, url, params: [id] }) => {
      if (!isOwnHost(req)) {
        json(res, 403, { error: 'forbidden' });
        return;
      } // whole files go out here: no DNS rebinding
      const s = findSession(store, res, id);
      if (!s) return;
      try {
        json(
          res,
          200,
          await sessions.diff(s, String(url.searchParams.get('file') || '')),
        );
      } catch (e) {
        sendError(res, e); // not one of its files 404, not_repo 409, outside 400, a git failure 502
      }
    },
  ],
];
