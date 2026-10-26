// POST /hook: what Claude Code's hooks (hooks/send.ts) report. Answered 204, or held open for a --decide hook.
import { safeJsonParse } from '../../../shared/json.ts';
import type { SessionActions } from '../../app/sessions.ts';
import { MAX_BODY_BYTES } from '../../config.ts';
import { holdForDecision, readBody, tooLarge } from '../../http.ts';
import type { Route } from './types.ts';

export const hookRoutes = ({
  sessions,
}: {
  sessions: SessionActions;
}): Route[] => [
  [
    'POST',
    '/hook',
    async ({ req, res }) => {
      if (req.headers.origin) {
        res.writeHead(403);
        res.end();
        return;
      } // hooks never send Origin; browsers always do
      let body = '';
      try {
        body = await readBody(req, MAX_BODY_BYTES);
      } catch {
        tooLarge(req, res);
        return;
      }
      const ev = safeJsonParse(body);
      // a --decide hook: hold the request open until the browser answers, if the session's backend parks requests
      const { parked } = ev ? sessions.hook(ev) : { parked: null };
      if (parked) {
        void holdForDecision(res, parked);
        return;
      }
      res.writeHead(204);
      res.end();
    },
  ],
];
